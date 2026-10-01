import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {
  app,
  settings,
  formatCustomerDraft,
  detectFirstResponse,
  sanitizeCustomerDraft
} from '../server.ts';

const TEST_WIDGET_SECRET = 'mock-test-secret-key-for-unit-tests-only'; // gitleaks:allow
const TEST_ADMIN_PASSWORD = 'admin-secret-password-xyz';

let server: http.Server;
let baseUrl: string;

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.WIDGET_SECRET = TEST_WIDGET_SECRET;
  process.env.ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;

  settings.omnidesk_domain = 'test.omnidesk.ru';
  settings.omnidesk_api_key = 'test-omnidesk-api-key';
  settings.omnidesk_email = 'support@example.com';

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;

    // Mock Omnidesk ticket fetch
    if (url.includes('test.omnidesk.ru/api/cases/')) {
      if (url.includes('/cases/810-499430.json') || url.includes('/cases/4820.json')) {
        const cId = url.includes('4820') ? '4820' : '810-499430';
        return new Response(JSON.stringify({
          case: { case_id: cId, case_number: cId, subject: 'First Response Subject' }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (url.includes('/cases/810-499430/messages.json')) {
        // Only client message, no staff reply yet -> isFirstResponse = true
        return new Response(JSON.stringify([
          { message: { message_id: 1, user_id: 42, content: 'Клиент написал первый раз' } }
        ]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (url.includes('/cases/4820/messages.json')) {
        // Staff already replied -> has_staff_reply = true
        return new Response(JSON.stringify([
          { message: { message_id: 1, user_id: 42, content: 'Вопрос клиента' } },
          { message: { message_id: 2, staff_id: 101, content: 'Первый ответ сотрудника' } }
        ]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    return originalFetch(input, init);
  };

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

after(async () => {
  globalThis.fetch = originalFetch;
  process.env = originalEnv;
  await new Promise<void>((resolve) => {
    if (server) {
      server.close(() => resolve());
    } else {
      resolve();
    }
  });
});

describe('First Response & Ticket Number Substitution', () => {

  describe('detectFirstResponse logic', () => {
    test('returns true when has_staff_reply is false', () => {
      const isFirst = detectFirstResponse({ has_staff_reply: false }, 'Подготовь черновик', []);
      assert.equal(isFirst, true);
    });

    test('returns false when has_staff_reply is true and query is generic', () => {
      const isFirst = detectFirstResponse({ has_staff_reply: true }, 'Клиент прислал логи', [{ role: 'user', content: 'prev' }]);
      assert.equal(isFirst, false);
    });

    test('returns true when has_staff_reply is true but query explicitly asks for first response', () => {
      const isFirst = detectFirstResponse({ has_staff_reply: true }, 'Подготовь черновик первого ответа клиенту', []);
      assert.equal(isFirst, true);
    });

    test('detects staff message in description when has_staff_reply not set', () => {
      const isFirstWithStaff = detectFirstResponse({ description: 'CLIENT: Hello\n\nSTAFF: Hi there' }, 'Что дальше?');
      assert.equal(isFirstWithStaff, false);

      const isFirstWithoutStaff = detectFirstResponse({ description: 'CLIENT: Hello, I have an issue' }, 'Сформируй ответ');
      assert.equal(isFirstWithoutStaff, true);
    });

    test('defaults to true when history is empty and no staff presence', () => {
      const isFirst = detectFirstResponse({}, 'Сделай ответ', []);
      assert.equal(isFirst, true);
    });
  });

  describe('formatCustomerDraft formatting and substitution', () => {
    test('substitutes placeholders: [номер обращения], [номер тикета], {case_number}, XXX-XXXXXX using #', () => {
      const input = 'Здравствуйте, Иван!\n\nПо вашему обращению №[номер обращения] сообщаем, что шлюз в сети.\nТакже проверен тикет {case_number}.';
      const output = formatCustomerDraft(input, '810-499430', true);

      assert.ok(output.includes('#810-499430'));
      assert.ok(!output.includes('№810-499430'));
      assert.ok(!output.includes('[номер обращения]'));
      assert.ok(!output.includes('{case_number}'));
    });

    test('substitutes XXX-XXXXXX pattern in draft using #', () => {
      const input = 'Здравствуйте!\n\nПо вашему обращению №XXX-XXXXXX взяли задачу в работу.';
      const output = formatCustomerDraft(input, '810-499430', true);

      assert.equal(output, 'Здравствуйте!\n\nПо вашему обращению #810-499430 взяли задачу в работу.');
    });

    test('converts existing № symbol before ticket number to #', () => {
      const input = 'Здравствуйте, Алексей!\n\nПо вашему обращению №810-499430 сообщаем: версия драйвера обновлена.';
      const output = formatCustomerDraft(input, '810-499430', true);

      assert.equal(output, 'Здравствуйте, Алексей!\n\nПо вашему обращению #810-499430 сообщаем: версия драйвера обновлена.');
      const count = (output.match(/810-499430/g) || []).length;
      assert.equal(count, 1, 'Ticket number must appear only once');
      assert.ok(!output.includes('№'));
    });

    test('does not duplicate number if already present in draft with #', () => {
      const input = 'Здравствуйте, Алексей!\n\nПо вашему обращению #810-499430 сообщаем: версия драйвера обновлена.';
      const output = formatCustomerDraft(input, '810-499430', true);

      assert.equal(output, input);
      const count = (output.match(/810-499430/g) || []).length;
      assert.equal(count, 1, 'Ticket number must appear only once');
    });

    test('inserts ticket number with # into existing "ваше обращение" phrase when number is missing', () => {
      const input = 'Здравствуйте!\n\nВаше обращение принято в работу службой поддержки.';
      const output = formatCustomerDraft(input, '810-499430', true);

      assert.ok(output.includes('Ваше обращение #810-499430 принято в работу'));
    });

    test('inserts ticket number with # after greeting when first response lacks any ticket reference', () => {
      const input = 'Здравствуйте, Сергей!\n\nМы проанализировали проект и обнаружили конфликт адресов KNX.';
      const output = formatCustomerDraft(input, '810-499430', true);

      assert.ok(output.includes('Здравствуйте, Сергей!'));
      assert.ok(output.includes('По вашему обращению #810-499430:'));
      assert.ok(output.includes('Мы проанализировали проект'));
    });

    test('handles English greeting and inserts inquiry reference with #', () => {
      const input = 'Hello John!\n\nWe have checked your server logs and found no critical errors.';
      const output = formatCustomerDraft(input, '810-499430', true);

      assert.ok(output.includes('Hello John!'));
      assert.ok(output.includes('Regarding your inquiry #810-499430:'));
      assert.ok(output.includes('We have checked your server logs'));
    });

    test('for subsequent responses (isFirstResponse = false), does NOT forcibly prepend ticket number', () => {
      const input = 'Здравствуйте, Сергей!\n\nСпасибо за присланные файлы. Мы передали их инженерам.';
      const output = formatCustomerDraft(input, '810-499430', false);

      assert.equal(output, input);
      assert.ok(!output.includes('По вашему обращению #810-499430:'));
      assert.ok(!output.includes('По вашему обращению №810-499430:'));
    });

    test('for subsequent responses, still replaces explicit placeholders if any exist using #', () => {
      const input = 'Уточнили статус по обращению [номер обращения]: стендовая проверка завершена.';
      const output = formatCustomerDraft(input, '810-499430', false);

      assert.ok(output.includes('#810-499430'));
      assert.ok(!output.includes('№810-499430'));
      assert.ok(!output.includes('[номер обращения]'));
    });

    test('cleans leading # or № from caseNumber parameter and formats with #', () => {
      const input = 'Здравствуйте!\n\nПо вашему обращению взяли в работу.';
      const outputWithHash = formatCustomerDraft(input, '#4820', true);
      assert.ok(outputWithHash.includes('#4820'));
      assert.ok(!outputWithHash.includes('##'));

      const outputWithNo = formatCustomerDraft(input, '№4820', true);
      assert.ok(outputWithNo.includes('#4820'));
      assert.ok(!outputWithNo.includes('№'));
    });

    test('strips BookStack links and internal directives while preserving ticket number with #', () => {
      const input = ':::writing{draft}\nЗдравствуйте!\n\nПо вашему обращению №[номер обращения]: подробности в [документации](https://wiki.mytunnel.org/books/support/page/setup).\n:::';
      const output = formatCustomerDraft(input, '810-499430', true);

      assert.ok(output.includes('#810-499430'));
      assert.ok(!output.includes('№810-499430'));
      assert.ok(!output.includes(':::writing'));
      assert.ok(!output.includes('https://wiki.mytunnel.org'));
      assert.ok(output.includes('документации'));
    });
  });

  describe('Prompt and Skill Configuration Integrity', () => {
    test('SYSTEM_PROMPT.md mandates ticket number in first response with #', () => {
      const promptPath = path.join(process.cwd(), 'prompts_and_skills', 'SYSTEM_PROMPT.md');
      const content = fs.readFileSync(promptPath, 'utf8');

      assert.ok(
        content.includes('В клиентском тексте первого ответа обязательно подставляй номер обращения через #'),
        'SYSTEM_PROMPT.md must mandate ticket number in first response with #'
      );
      assert.ok(
        content.includes('обязательно подставлен номер обращения через #'),
        'SYSTEM_PROMPT.md checklist must verify ticket number in first response with #'
      );
    });

    test('support-first-response skill file mandates ticket number with #', () => {
      const skillPath = path.join(process.cwd(), 'prompts_and_skills', 'skills', 'active', '09-support-first-response.md');
      const content = fs.readFileSync(skillPath, 'utf8');

      assert.ok(
        content.includes('обязательным указанием номера обращения через #'),
        'support-first-response skill file must mandate ticket number with #'
      );
      assert.ok(
        content.includes('Всегда используй фактический номер тикета из контекста с символом # вместо шаблонных заглушек'),
        'support-first-response skill file must mandate # symbol'
      );
    });

    test('settings or skill file contains updated prompt and skill with #', () => {
      const settingsPath = path.join(process.cwd(), 'storage', 'settings.json');
      if (fs.existsSync(settingsPath)) {
        const data = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        assert.ok(
          data.system_prompt.includes('В клиентском тексте первого ответа обязательно подставляй номер обращения через #'),
          'settings.json system_prompt must mandate ticket number with #'
        );
        assert.ok(
          data.system_prompt.includes('обязательно подставлен номер обращения через #'),
          'settings.json system_prompt checklist must verify ticket number with #'
        );

        const skills = typeof data.skills === 'string' ? JSON.parse(data.skills) : data.skills;
        const firstRespSkill = skills.find((s: any) => s.name && s.name.includes('first-response'));
        if (firstRespSkill) {
          assert.ok(
            firstRespSkill.content.includes('обязательным указанием номера обращения через #'),
            'first-response in settings.json must mandate ticket number with #'
          );
        }
      } else {
        const skillPath = path.join(process.cwd(), 'prompts_and_skills', 'skills', 'active', '09-support-first-response.md');
        const content = fs.readFileSync(skillPath, 'utf8');
        assert.ok(
          content.includes('обязательным указанием номера обращения через #'),
          'skill file must mandate ticket number with #'
        );
      }
    });
  });
});
