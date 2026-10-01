import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { 
  app, 
  settings, 
  CLASSIFICATION_FIELDS, 
  EXCLUDED_CLASSIFICATION_FIELDS,
  validateClassificationFields, 
  selectRelevantSkills, 
  formatCustomerDraft,
  clearTicketImagesCache,
  findInRecognizedCache,
  recordRecognizedImage,
  clearRecognizedImagesCache,
  getTicketConversation,
  addTicketConversationMessage,
  clearTicketConversation,
  buildConversationSummary
} from '../server.ts';

const TEST_WIDGET_SECRET = 'mock-test-secret-key-for-unit-tests-only'; // gitleaks:allow
const TEST_ADMIN_PASSWORD = 'admin-secret-password-xyz';

let server: http.Server;
let baseUrl: string;

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

let capturedPutBodies: any[] = [];
let capturedPostBodies: any[] = [];
let mockOmnideskHandler: ((url: string, init?: RequestInit) => Response | Promise<Response>) | null = null;

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
      if (init?.method === 'PUT') {
        const body = JSON.parse(init.body as string);
        capturedPutBodies.push({ url, headers: init.headers, body });
        return new Response(JSON.stringify({ case: { case_id: 999, ...body.case } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (init?.method === 'POST' && url.includes('/notes.json')) {
        const body = JSON.parse(init.body as string);
        capturedPostBodies.push({ url, headers: init.headers, body });
        return new Response(JSON.stringify({ note: { note_id: 12345, ...body.note } }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (url.includes('/cases/999.json')) {
        return new Response(JSON.stringify({
          case: {
            case_id: 999,
            case_number: '999',
            subject: 'Проблема с подключением сервера Bus77',
            content: 'Сервер UMC C3 не отвечает на команды, объект ЖК Ривьера'
          }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (url.includes('/cases/999/messages.json')) {
        return new Response(JSON.stringify([
          { message: { message_id: 1, user_id: 10, content: 'Сервер UMC C3 не отвечает на команды' } }
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

beforeEach(() => {
  mockOmnideskHandler = null;
  capturedPutBodies = [];
  capturedPostBodies = [];
});

describe('Safety & Robustness Workflows (Audit Requirements)', () => {

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Server-Side Allowlist & Unknown Option Handling
  // ─────────────────────────────────────────────────────────────────────────────
  describe('1. Server-side allowlist validation (validateClassificationFields)', () => {
    test('accepts valid fields and known options', () => {
      const result = validateClassificationFields({
        cf_10049: '1', // Сервер
        cf_10704: '0', // Не определен
        cf_10065: '3', // Освещение
        cf_10272: 'ЖК Ривьера' // Имя объекта (текст)
      });

      assert.equal(result.valid, true);
      assert.equal(result.fields.cf_10049, '1');
      assert.equal(result.fields.cf_10704, '0');
      assert.equal(result.fields.cf_10065, '3');
      assert.equal(result.fields.cf_10272, 'ЖК Ривьера');
      assert.equal(result.errors.length, 0);
    });

    test('accepts option label and normalizes to numerical key', () => {
      const result = validateClassificationFields({
        cf_10049: 'Панели', // Option 3
        cf_10704: 'SmartPro' // Option 1
      });

      assert.equal(result.valid, true);
      assert.equal(result.fields.cf_10049, '3');
      assert.equal(result.fields.cf_10704, '1');
    });

    test('strictly rejects unknown custom field keys not in allowlist', () => {
      const result = validateClassificationFields({
        cf_999999: '1',
        unknown_key: 'test',
        cf_10049: '1'
      });

      assert.equal(result.valid, false);
      assert.equal(result.fields.cf_10049, '1');
      assert.equal(result.fields.cf_999999, undefined);
      assert.ok(result.errors.some(e => e.includes('cf_999999')));
      assert.ok(result.errors.some(e => e.includes('unknown_key')));
    });

    test('strictly rejects excluded system fields (EXCLUDED_CLASSIFICATION_FIELDS)', () => {
      const result = validateClassificationFields({
        group: '123',
        group_id: '123',
        status: 'open',
        status_id: '1',
        cf_5286: '1', // Статус клиента
        cf_11462: 'https://audit.example.com', // Ссылка на аудит
        cf_10049: '1'
      });

      assert.equal(result.valid, false);
      assert.equal(result.fields.group, undefined);
      assert.equal(result.fields.group_id, undefined);
      assert.equal(result.fields.status, undefined);
      assert.equal(result.fields.cf_5286, undefined);
      assert.equal(result.fields.cf_11462, undefined);
      assert.equal(result.fields.cf_10049, '1');
      assert.ok(result.errors.length >= 6);
    });

    test('strictly rejects invalid numerical option values without loose fallback', () => {
      const result = validateClassificationFields({
        cf_10049: '999', // Not a valid option in cf_10049
        cf_10704: '777'  // Not a valid option in cf_10704
      });

      assert.equal(result.valid, false);
      assert.equal(result.fields.cf_10049, undefined);
      assert.equal(result.fields.cf_10704, undefined);
      assert.ok(result.errors.some(e => e.includes('cf_10049')));
      assert.ok(result.errors.some(e => e.includes('cf_10704')));
    });

    test('sanitizes text fields to single-line and max length 200 chars', () => {
      const multiline = 'First line\nSecond line\r\nThird line\twith tabs';
      const veryLong = 'A'.repeat(300);
      const result = validateClassificationFields({
        cf_10272: multiline,
        cf_10928: veryLong
      });

      assert.equal(result.valid, true);
      assert.ok(!result.fields.cf_10272.includes('\n'));
      assert.ok(!result.fields.cf_10272.includes('\r'));
      assert.equal(result.fields.cf_10928.length, 200);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. Deterministic Server-Side Routing for Omnidesk Writes
  // ─────────────────────────────────────────────────────────────────────────────
  describe('2. Deterministic Server-Side Routing for Omnidesk Writes', () => {
    test('POST /api/omnidesk/cases/:caseNumber/classify/apply requires valid widget secret (401)', async () => {
      const res = await fetch(`${baseUrl}/api/omnidesk/cases/999/classify/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { cf_10049: '1' } })
      });

      assert.equal(res.status, 401);
    });

    test('POST /api/omnidesk/cases/:caseNumber/classify/apply rejects invalid fields with 400', async () => {
      const res = await fetch(`${baseUrl}/api/omnidesk/cases/999/classify/apply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Widget-Secret': TEST_WIDGET_SECRET
        },
        body: JSON.stringify({ fields: { cf_999999: '1' } })
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.ok(data.error);
    });

    test('POST /api/omnidesk/cases/:caseNumber/classify/apply applies valid fields to Omnidesk via PUT', async () => {
      const res = await fetch(`${baseUrl}/api/omnidesk/cases/999/classify/apply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Widget-Secret': TEST_WIDGET_SECRET
        },
        body: JSON.stringify({
          fields: {
            cf_10049: '1',
            cf_10704: '1',
            cf_10272: 'Объект Ривьера'
          }
        })
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.appliedFields.cf_10049, '1');
      assert.equal(data.appliedFields.cf_10704, '1');
      assert.equal(data.appliedFields.cf_10272, 'Объект Ривьера');

      // Verify Omnidesk PUT was called
      assert.equal(capturedPutBodies.length, 1);
      const putData = capturedPutBodies[0].body;
      assert.equal(putData.case.custom_fields.cf_10049, '1');
      assert.equal(putData.case.custom_fields.cf_10704, '1');
      assert.equal(putData.case.custom_fields.cf_10272, 'Объект Ривьера');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. Screenshot Cache Isolation & Management
  // ─────────────────────────────────────────────────────────────────────────────
  describe('3. Screenshot Cache Isolation & Lifecycle', () => {
    beforeEach(() => {
      clearRecognizedImagesCache();
    });

    test('screenshot cached for ticket 1001 is NOT matched for ticket 2002 (cross-ticket isolation)', () => {
      const imgRecord = {
        fileName: 'error_screenshot.png',
        fileId: 55512,
        hash: 'hash_abc123_unique',
        caseNumber: '1001',
        visualDescription: 'Stack trace showing NullPointerException in Bus77Driver.js'
      };

      recordRecognizedImage(imgRecord);

      // Search within same ticket 1001 -> MUST match
      const matchedSameTicket = findInRecognizedCache({ hash: 'hash_abc123_unique' }, '1001');
      assert.ok(matchedSameTicket, 'Should match for same ticket');
      assert.equal(matchedSameTicket?.visualDescription, imgRecord.visualDescription);

      // Search within foreign ticket 2002 -> MUST NOT match
      const matchedOtherTicket = findInRecognizedCache({ hash: 'hash_abc123_unique' }, '2002');
      assert.equal(matchedOtherTicket, null, 'Must NOT match across different tickets');
    });

    test('clearTicketImagesCache clears only images for the specified ticket', () => {
      recordRecognizedImage({
        fileName: 'img1.png',
        fileId: 101,
        hash: 'h1',
        caseNumber: '777',
        visualDescription: 'Desc 777'
      });

      recordRecognizedImage({
        fileName: 'img2.png',
        fileId: 102,
        hash: 'h2',
        caseNumber: '888',
        visualDescription: 'Desc 888'
      });

      const removed = clearTicketImagesCache('777');
      assert.ok(removed > 0, 'Should have removed records for 777');

      // 777 must be gone
      assert.equal(findInRecognizedCache({ file_id: 101 }, '777'), null);
      // 888 must still be intact
      const remaining888 = findInRecognizedCache({ file_id: 102 }, '888');
      assert.ok(remaining888, 'Ticket 888 cache must remain intact');
    });

    test('DELETE /api/omnidesk/cases/:caseNumber/images-cache removes ticket cache via API', async () => {
      recordRecognizedImage({
        fileName: 'screenshot.png',
        fileId: 201,
        hash: 'h_api_del',
        caseNumber: '999',
        visualDescription: 'Desc API delete'
      });

      // Without secret -> 401
      const resUnauth = await fetch(`${baseUrl}/api/omnidesk/cases/999/images-cache`, {
        method: 'DELETE'
      });
      assert.equal(resUnauth.status, 401);

      // With secret -> 200
      const res = await fetch(`${baseUrl}/api/omnidesk/cases/999/images-cache`, {
        method: 'DELETE',
        headers: { 'X-Widget-Secret': TEST_WIDGET_SECRET }
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.caseNumber, '999');
      assert.ok(data.removedCount >= 1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. Draft Placeholder Hygiene
  // ─────────────────────────────────────────────────────────────────────────────
  describe('4. Draft placeholder hygiene (formatCustomerDraft)', () => {
    test('does not leave stray # or unreplaced tokens when case number is absent or empty', () => {
      const draftWithTokens = 'Здравствуйте! Ваше обращение #[номер обращения] принято в работу. Номер тикета: #XXX-XXXXXX. Проверим информацию.';
      
      const formattedEmpty = formatCustomerDraft(draftWithTokens, '', false);
      assert.ok(!formattedEmpty.includes('#[номер обращения]'));
      assert.ok(!formattedEmpty.includes('#XXX-XXXXXX'));
      assert.ok(!formattedEmpty.includes('#['));
      assert.ok(!formattedEmpty.match(/обращение\s+#(?!\w)/i));
      assert.ok(!formattedEmpty.match(/тикета:\s*#/i));

      const formattedNull = formatCustomerDraft(draftWithTokens, undefined as any, false);
      assert.ok(!formattedNull.includes('#['));
      assert.ok(!formattedNull.includes('#XXX-XXXXXX'));
    });

    test('replaces placeholders cleanly with #12345 when case number is provided', () => {
      const draft = 'Здравствуйте! По обращению #[номер обращения] мы проверили настройки сервера.';
      const formatted = formatCustomerDraft(draft, '12345', false);
      assert.ok(formatted.includes('#12345'));
      assert.ok(!formatted.includes('#[номер обращения]'));
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. Skill Router (Dynamic Skill Selection)
  // ─────────────────────────────────────────────────────────────────────────────
  describe('5. Dynamic Skill Selection (selectRelevantSkills)', () => {
    const mockSkills = [
      { name: 'customer-support', content: 'Core support instructions', enabled: true },
      { name: 'support-escalation', content: 'Escalation guidelines and note formats', enabled: true },
      { name: 'network-troubleshooting', content: 'Network debugging (IP, DHCP, ping)', enabled: true },
      { name: 'modbus-knx-protocols', content: 'KNX, Modbus RTU, BACnet integration', enabled: true },
      { name: 'ui-ux-design', content: 'UI/UX styling and layout guide', enabled: true },
      { name: 'server-hardware', content: 'Hardware specs for UMC, WB, NUC', enabled: true }
    ];

    test('always includes core skill customer-support', () => {
      const selected = selectRelevantSkills(mockSkills, 'Проверь настройки сети', undefined, 3);
      assert.ok(selected.some(s => s.name === 'customer-support'), 'Must include customer-support');
    });

    test('limits injected skills to maxSkills (core + max 3)', () => {
      const selected = selectRelevantSkills(mockSkills, 'сеть knx интерфейс сервер', undefined, 2);
      // core (1) + max 2 = at most 3
      assert.ok(selected.length <= 3, `Selected ${selected.length} skills, expected <= 3`);
    });

    test('picks escalation skill when query relates to escalation or developers', () => {
      const selected = selectRelevantSkills(
        mockSkills, 
        'Нужно передать баг разработчикам и оформить эскалацию',
        undefined, 
        2
      );
      assert.ok(selected.some(s => s.name === 'support-escalation'), 'Should pick support-escalation');
    });

    test('picks network troubleshooting skill when query mentions router/dhcp/ping', () => {
      const selected = selectRelevantSkills(
        mockSkills, 
        'Клиент говорит что роутер mikrotik не выдает dhcp адрес серверу',
        undefined, 
        2
      );
      assert.ok(selected.some(s => s.name === 'network-troubleshooting'), 'Should pick network-troubleshooting');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. Persistent Conversation History per Ticket
  // ─────────────────────────────────────────────────────────────────────────────
  describe('6. Persistent Conversation History per Ticket', () => {
    beforeEach(() => {
      clearTicketConversation('999');
      clearTicketConversation('888');
    });

    test('GET /api/omnidesk/cases/:caseNumber/history requires widget secret (401)', async () => {
      const res = await fetch(`${baseUrl}/api/omnidesk/cases/999/history`);
      assert.equal(res.status, 401);
    });

    test('POST and GET conversation history works cleanly for ticket', async () => {
      // 1. Post message to history
      const postRes = await fetch(`${baseUrl}/api/omnidesk/cases/999/history`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Widget-Secret': TEST_WIDGET_SECRET
        },
        body: JSON.stringify({
          role: 'user',
          userQuery: 'Как настроить подсветку кнопок на выключателе Bus77?'
        })
      });

      assert.equal(postRes.status, 200);
      const postData = await postRes.json();
      assert.equal(postData.success, true);
      assert.equal(postData.message.userQuery, 'Как настроить подсветку кнопок на выключателе Bus77?');

      // 2. Fetch history
      const getRes = await fetch(`${baseUrl}/api/omnidesk/cases/999/history`, {
        headers: { 'X-Widget-Secret': TEST_WIDGET_SECRET }
      });
      assert.equal(getRes.status, 200);
      const getData = await getRes.json();
      assert.equal(getData.caseNumber, '999');
      assert.equal(getData.messages.length, 1);
      assert.equal(getData.messages[0].userQuery, 'Как настроить подсветку кнопок на выключателе Bus77?');

      // 3. Delete history
      const delRes = await fetch(`${baseUrl}/api/omnidesk/cases/999/history`, {
        method: 'DELETE',
        headers: { 'X-Widget-Secret': TEST_WIDGET_SECRET }
      });
      assert.equal(delRes.status, 200);

      // 4. Verify empty after delete
      const verifyRes = await fetch(`${baseUrl}/api/omnidesk/cases/999/history`, {
        headers: { 'X-Widget-Secret': TEST_WIDGET_SECRET }
      });
      const verifyData = await verifyRes.json();
      assert.equal(verifyData.messages.length, 0);
    });

    test('GET /api/omnidesk/conversations requires admin auth and lists saved conversations', async () => {
      // Add message
      addTicketConversationMessage('888', {
        id: 'msg_test',
        timestamp: new Date().toISOString(),
        role: 'user',
        userQuery: 'Тестовый запрос для тикета 888',
        replyText: 'Ответ ассистента'
      });

      // Without auth -> 401
      const resUnauth = await fetch(`${baseUrl}/api/omnidesk/conversations`);
      assert.equal(resUnauth.status, 401);

      // With admin Bearer auth -> 200
      const res = await fetch(`${baseUrl}/api/omnidesk/conversations`, {
        headers: { 'Authorization': `Bearer ${TEST_ADMIN_PASSWORD}` }
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(Array.isArray(data.conversations));
      assert.ok(data.conversations.some((c: any) => c.caseNumber === '888'));
    });

    test('Dual indexing: lookup works across caseNumber, unhyphenated number, and caseId', () => {
      clearTicketConversation('495-685067');
      clearTicketConversation('421639126');

      addTicketConversationMessage('495-685067', {
        id: 'msg_dual',
        timestamp: new Date().toISOString(),
        role: 'assistant',
        userQuery: 'Проблема с KNX шлюзом',
        replyText: 'Проверьте физическое подключение шины'
      }, '421639126');

      // 1. Lookup by formatted case number
      const byCaseNumber = getTicketConversation('495-685067');
      assert.ok(byCaseNumber, 'Must find by formatted case number');
      assert.equal(byCaseNumber?.caseNumber, '495-685067');
      assert.equal(byCaseNumber?.caseId, '421639126');
      assert.equal(byCaseNumber?.messages[0].replyText, 'Проверьте физическое подключение шины');

      // 2. Lookup by unhyphenated case number
      const byUnhyphenated = getTicketConversation('495685067');
      assert.ok(byUnhyphenated, 'Must find by unhyphenated case number');
      assert.equal(byUnhyphenated?.caseNumber, '495-685067');

      // 3. Lookup by database caseId
      const byCaseId = getTicketConversation('421639126');
      assert.ok(byCaseId, 'Must find by numerical caseId');
      assert.equal(byCaseId?.caseId, '421639126');

      // 4. Cleanup removes all references
      clearTicketConversation('421639126');
      assert.equal(getTicketConversation('495-685067'), null);
      assert.equal(getTicketConversation('495685067'), null);
      assert.equal(getTicketConversation('421639126'), null);
    });

    test('Preview ticket OMNIDESK_ACTIVE_TICKET is saved and retrieved successfully', () => {
      clearTicketConversation('OMNIDESK_ACTIVE_TICKET');

      addTicketConversationMessage('OMNIDESK_ACTIVE_TICKET', {
        id: 'msg_preview',
        timestamp: new Date().toISOString(),
        role: 'assistant',
        userQuery: 'Тестовый запрос в режиме preview',
        replyText: 'Тестовый ответ в режиме preview'
      });

      const previewConv = getTicketConversation('OMNIDESK_ACTIVE_TICKET');
      assert.ok(previewConv, 'Must find conversation for OMNIDESK_ACTIVE_TICKET');
      assert.equal(previewConv?.messages.length, 1);
      assert.equal(previewConv?.messages[0].replyText, 'Тестовый ответ в режиме preview');

      clearTicketConversation('OMNIDESK_ACTIVE_TICKET');
      assert.equal(getTicketConversation('OMNIDESK_ACTIVE_TICKET'), null);
    });

    test('buildConversationSummary constructs concise informative summary of past dialogues', () => {
      const summary = buildConversationSummary([
        {
          id: '1',
          timestamp: new Date().toISOString(),
          role: 'assistant',
          userQuery: 'Как настроить подсветку кнопок на выключателе Bus77?',
          replyText: 'В приложении перейдите в настройки панели...',
          suggestions: [{ id: 's1', text: 'Здравствуйте! Для настройки...', title: 'Ответ клиенту', type: 'Draft' }]
        },
        {
          id: '2',
          timestamp: new Date().toISOString(),
          role: 'assistant',
          userQuery: 'Клиент просит выслать инструкцию по ETS',
          replyText: 'Ссылка на документацию по ETS для Bus77 доступна в wiki...',
          escalation: { required: false, used: false, noteContent: '', notePushed: false }
        }
      ]);

      assert.ok(summary.includes('Ранее в виджете зафиксировано 2 обращения'));
      assert.ok(summary.includes('подсветку кнопок'));
      assert.ok(summary.includes('инструкцию по ETS'));
      assert.ok(summary.includes('черновик ответа клиенту'));
    });
  });

});
