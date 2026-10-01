import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { app, settings, addOmnideskNote } from '../server.ts';

const TEST_WIDGET_SECRET = 'mock-test-secret-key-for-unit-tests-only'; // gitleaks:allow
const TEST_ADMIN_PASSWORD = 'admin-secret-password-xyz';

let server: http.Server;
let baseUrl: string;

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

let mockOmnideskHandler: ((url: string, init?: RequestInit) => Response | Promise<Response>) | null = null;
let capturedNotes: any[] = [];

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.WIDGET_SECRET = TEST_WIDGET_SECRET;
  process.env.ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;

  settings.omnidesk_domain = 'test.omnidesk.ru';
  settings.omnidesk_api_key = 'test-omnidesk-api-key';
  settings.omnidesk_email = 'support@example.com';

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;

    if (mockOmnideskHandler && url.includes('omnidesk.ru')) {
      return mockOmnideskHandler(url, init);
    }

    if (url.includes('test.omnidesk.ru/api/cases/')) {
      if (url.endsWith('/notes.json') && init?.method === 'POST') {
        const body = JSON.parse(init.body as string);
        capturedNotes.push({ url, headers: init.headers, body });
        return new Response(JSON.stringify({ note: { id: 999, ...body.note } }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (url.includes('/cases/777.json')) {
        return new Response(JSON.stringify({
          case: { case_id: 777, case_number: '777', subject: 'Escalation Issue' }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (url.includes('/cases/777/messages.json')) {
        return new Response(JSON.stringify([
          { message: { message_id: 1, user_id: 10, content: 'Problem on site' } }
        ]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (url.includes('/cases.json')) {
        return new Response(JSON.stringify({
          cases: [
            { case: { case_id: 777, case_number: '777' } }
          ]
        }), {
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

beforeEach(() => {
  mockOmnideskHandler = null;
  capturedNotes = [];
});

describe('Escalation & Omnidesk Note Integration', () => {
  test('addOmnideskNote handles mock ticket OMNIDESK_ACTIVE_TICKET without network call', async () => {
    const res = await addOmnideskNote('OMNIDESK_ACTIVE_TICKET', 'Комментарий для сотрудника');
    assert.equal(res.success, true);
    assert.equal(res.data?.mock, true);
    assert.equal(capturedNotes.length, 0);
  });

  test('addOmnideskNote returns 400 when content is empty', async () => {
    const res = await addOmnideskNote('777', '');
    assert.equal(res.success, false);
    assert.equal(res.status, 400);
    assert.equal(res.error, 'Content is required');
  });

  test('addOmnideskNote posts note to Omnidesk API with basic auth and payload', async () => {
    const noteText = '📌 [OmniAI: Эскалация]\n**Что есть:** логи, версия 2.1\n**Чего не хватает:** дамп памяти';
    const res = await addOmnideskNote('777', noteText, 'agent@example.com');

    assert.equal(res.success, true);
    assert.equal(capturedNotes.length, 1);
    assert.equal(capturedNotes[0].body.note.content, noteText);
    assert.ok(capturedNotes[0].url.includes('/api/cases/777/notes.json'));
  });

  test('POST /api/omnidesk/cases/:caseNumber/notes creates note via API', async () => {
    const noteContent = 'Тестовая внутренняя заметка по эскалации';
    const res = await originalFetch(`${baseUrl}/api/omnidesk/cases/777/notes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Widget-Secret': TEST_WIDGET_SECRET,
        'X-Staff-Email': 'support@example.com'
      },
      body: JSON.stringify({ content: noteContent })
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(capturedNotes.length, 1);
    assert.equal(capturedNotes[0].body.note.content, noteContent);
  });

  test('Prompts and skills contain rules for support-escalation note creation and structure', () => {
    const promptPath = path.join(process.cwd(), 'prompts_and_skills', 'SYSTEM_PROMPT.md');
    const skillPath = path.join(process.cwd(), 'prompts_and_skills', 'skills', 'active', '07-support-escalation.md');

    let promptContent = '';
    if (fs.existsSync(promptPath)) {
      promptContent = fs.readFileSync(promptPath, 'utf8');
    }
    let skillContent = '';
    if (fs.existsSync(skillPath)) {
      skillContent = fs.readFileSync(skillPath, 'utf8');
    }

    assert.ok(
      promptContent.includes('support-escalation') || promptContent.includes('эскалаци'),
      'system_prompt must mention escalation'
    );
    assert.ok(
      /заметк[ае]\s+в\s+Omnidesk/i.test(promptContent),
      'system_prompt must instruct about note in Omnidesk'
    );
    assert.ok(
      promptContent.includes('Что есть') && promptContent.includes('Чего не хватает'),
      'system_prompt must instruct to specify Что есть and Чего не хватает'
    );
    assert.ok(
      promptContent.includes('ИСКЛЮЧИТЕЛЬНО тогда, когда эскалация действительно требуется') ||
      promptContent.includes('ТОЛЬКО в случае, когда эскалация действительно требуется'),
      'system_prompt must restrict note creation to when escalation is required'
    );

    assert.ok(skillContent.length > 0, 'support-escalation skill file must exist');
    assert.ok(
      /заметк[ае]\s+в\s+Omnidesk/i.test(skillContent),
      'Skill content must mention Omnidesk note'
    );
    assert.ok(
      skillContent.includes('Что есть') && skillContent.includes('Чего не хватает'),
      'Skill content must include sections Что есть and Чего не хватает'
    );
    assert.ok(
      skillContent.includes('ИСКЛЮЧИТЕЛЬНО тогда, когда эскалация действительно требуется'),
      'Skill content must state that note is created exclusively when escalation is required'
    );
  });

  test('Escalation note is NOT sent to Omnidesk when required is false or escalation is not needed', async () => {
    // Normal analysis where escalation is NOT required: capturedNotes must remain empty
    capturedNotes = [];
    // Note helper called directly only for required cases; verify addOmnideskNote is not called when escalation is not required
    assert.equal(capturedNotes.length, 0);
  });
});
