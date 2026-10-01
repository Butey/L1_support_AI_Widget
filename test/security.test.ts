import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { app, settings } from '../server.ts';

const TEST_WIDGET_SECRET = 'mock-test-secret-key-for-unit-tests-only'; // gitleaks:allow
const TEST_ADMIN_PASSWORD = 'admin-secret-password-xyz';

let server: http.Server;
let baseUrl: string;

// Store original environment and fetch
const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

// Mock dispatcher for external requests (Omnidesk, Gemini, etc.)
let mockOmnideskHandler: ((url: string, init?: RequestInit) => Response | Promise<Response>) | null = null;

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.WIDGET_SECRET = TEST_WIDGET_SECRET;
  process.env.ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;

  // Configure settings for Omnidesk
  settings.omnidesk_domain = 'test.omnidesk.ru';
  settings.omnidesk_api_key = 'test-omnidesk-api-key';
  settings.omnidesk_email = 'support@example.com';

  // Intercept global fetch
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;

    // Check if this is a mocked upstream call (Omnidesk / BookStack / etc.)
    if (mockOmnideskHandler && url.includes('omnidesk.ru')) {
      return mockOmnideskHandler(url, init);
    }

    if (url.includes('googleapis.com')) {
      return new Response(JSON.stringify({ error: { message: 'Mocked Gemini API call' } }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Call through for internal test requests or fallback
    return originalFetch(input, init);
  };

  // Start ephemeral HTTP server
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
});

describe('CRITERION 1: Widget Shared Secret Authorization (401 Unauthorized)', () => {
  test('POST /api/chat without X-Widget-Secret returns 401', async () => {
    const res = await originalFetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticketContext: { id: '100' },
        userQuery: 'Test question'
      })
    });

    assert.equal(res.status, 401);
    const data = await res.json();
    assert.equal(data.error, 'Unauthorized: Missing or invalid widget secret');
  });

  test('POST /api/chat with invalid X-Widget-Secret returns 401', async () => {
    const res = await originalFetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Widget-Secret': 'invalid-secret-key'
      },
      body: JSON.stringify({
        ticketContext: { id: '100' },
        userQuery: 'Test question'
      })
    });

    assert.equal(res.status, 401);
    const data = await res.json();
    assert.equal(data.error, 'Unauthorized: Missing or invalid widget secret');
  });

  test('POST /api/omnidesk/cases/:id/messages without secret returns 401', async () => {
    const res = await originalFetch(`${baseUrl}/api/omnidesk/cases/100/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Hello customer' })
    });

    assert.equal(res.status, 401);
  });

  test('POST /api/omnidesk/cases/:id/notes without secret returns 401', async () => {
    const res = await originalFetch(`${baseUrl}/api/omnidesk/cases/100/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Internal note' })
    });

    assert.equal(res.status, 401);
  });

  test('POST /api/analytics/event without secret returns 401', async () => {
    const res = await originalFetch(`${baseUrl}/api/analytics/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'suggestion_applied' })
    });

    assert.equal(res.status, 401);
  });

  test('Request with alternative header X-Omni-Widget-Secret succeeds auth check', async () => {
    const res = await originalFetch(`${baseUrl}/api/analytics/event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Omni-Widget-Secret': TEST_WIDGET_SECRET
      },
      body: JSON.stringify({ action: 'suggestion_applied' })
    });

    assert.equal(res.status, 200);
  });

  test('Request with admin Bearer token succeeds widget auth check (preview mode)', async () => {
    const res = await originalFetch(`${baseUrl}/api/analytics/event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TEST_ADMIN_PASSWORD}`
      },
      body: JSON.stringify({ action: 'suggestion_applied' })
    });

    assert.equal(res.status, 200);
  });

  test('GET /api/omnidesk/cases/:id/history without secret returns 401', async () => {
    const res = await originalFetch(`${baseUrl}/api/omnidesk/cases/100/history`);
    assert.equal(res.status, 401);
  });

  test('GET /api/omnidesk/cases/:id/history with valid ?ws= query param succeeds auth check', async () => {
    const res = await originalFetch(`${baseUrl}/api/omnidesk/cases/100/history?ws=${encodeURIComponent(TEST_WIDGET_SECRET)}`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.caseNumber, '100');
  });

  test('GET /api/omnidesk/cases/:id/history with valid ?token= query param succeeds auth check', async () => {
    const res = await originalFetch(`${baseUrl}/api/omnidesk/cases/100/history?token=${encodeURIComponent(TEST_ADMIN_PASSWORD)}`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.caseNumber, '100');
  });

  test('GET /api/omnidesk/cases/:id/history with invalid ?ws= query param returns 401', async () => {
    const res = await originalFetch(`${baseUrl}/api/omnidesk/cases/100/history?ws=invalid_secret`);
    assert.equal(res.status, 401);
  });

  test('GET /api/widget/config without auth returns 401', async () => {
    const res = await originalFetch(`${baseUrl}/api/widget/config`);
    assert.equal(res.status, 401);
  });

  test('GET /api/widget/config with admin token succeeds and returns widgetSecret', async () => {
    const res = await originalFetch(`${baseUrl}/api/widget/config?token=${encodeURIComponent(TEST_ADMIN_PASSWORD)}`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.widgetSecret, TEST_WIDGET_SECRET);
  });

  test('GET /api/widget/config with widget secret succeeds', async () => {
    const res = await originalFetch(`${baseUrl}/api/widget/config?ws=${encodeURIComponent(TEST_WIDGET_SECRET)}`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.widgetSecret, TEST_WIDGET_SECRET);
  });
});

describe('CRITERION 2: Foreign or Non-existent Ticket Verification (403 Forbidden & zero data leak)', () => {
  test('POST /api/chat with valid secret but non-existent ticket returns 403 with no ticket data', async () => {
    // Omnidesk returns 404 for non-existent ticket 999999
    mockOmnideskHandler = async (url) => {
      if (url.includes('/api/cases/999999.json')) {
        return new Response(JSON.stringify({ error: 'Case not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    };

    const res = await originalFetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Widget-Secret': TEST_WIDGET_SECRET
      },
      body: JSON.stringify({
        ticketContext: { id: '999999' },
        userQuery: 'Give me the confidential data for this ticket'
      })
    });

    assert.equal(res.status, 403);
    const data = await res.json();
    assert.ok(data.error);
    // Crucial: body must NOT contain any ticket content or suggestions
    assert.equal(data.reply, undefined);
    assert.equal(data.suggestions, undefined);
    assert.equal(data.ticket, undefined);
  });

  test('POST /api/omnidesk/cases/:id/messages with non-existent ticket returns 403', async () => {
    mockOmnideskHandler = async () => {
      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    };

    const res = await originalFetch(`${baseUrl}/api/omnidesk/cases/999999/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Widget-Secret': TEST_WIDGET_SECRET
      },
      body: JSON.stringify({ content: 'Trying to post to non-existent ticket' })
    });

    assert.equal(res.status, 403);
    const data = await res.json();
    assert.ok(data.error);
  });

  test('POST /api/omnidesk/cases/:id/notes with non-existent ticket returns 403', async () => {
    mockOmnideskHandler = async () => {
      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    };

    const res = await originalFetch(`${baseUrl}/api/omnidesk/cases/999999/notes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Widget-Secret': TEST_WIDGET_SECRET
      },
      body: JSON.stringify({ content: 'Trying to post note to non-existent ticket' })
    });

    assert.equal(res.status, 403);
    const data = await res.json();
    assert.ok(data.error);
  });
});

describe('CRITERION 3: Agent Lacking Access in Omnidesk (403 Forbidden)', () => {
  test('POST /api/chat from an agent lacking access in Omnidesk returns 403', async () => {
    // Omnidesk evaluates agent access based on the basic auth header (staff email)
    // If agent lacks access to case 555, Omnidesk returns 403
    mockOmnideskHandler = async (url, init) => {
      const auth = (init?.headers as Record<string, string>)?.[ 'Authorization' ] || '';
      const decoded = Buffer.from(auth.replace('Basic ', ''), 'base64').toString();

      // If requested by restricted agent, Omnidesk rejects access
      if (decoded.startsWith('restricted-agent@example.com:')) {
        return new Response(JSON.stringify({ error: 'Access denied to this ticket' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({
        case: {
          case_id: 555,
          case_number: '555',
          subject: 'Allowed Subject',
          content: 'Secret client conversation'
        }
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    const res = await originalFetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Widget-Secret': TEST_WIDGET_SECRET,
        'X-Staff-Email': 'restricted-agent@example.com'
      },
      body: JSON.stringify({
        ticketContext: { id: '555' },
        userQuery: 'Summarize ticket'
      })
    });

    assert.equal(res.status, 403);
    const data = await res.json();
    assert.ok(data.error);
    // Ensure zero ticket content is leaked
    assert.equal(JSON.stringify(data).includes('Secret client conversation'), false);
    assert.equal(JSON.stringify(data).includes('Allowed Subject'), false);
  });

  test('POST /api/omnidesk/cases/:id/messages from unauthorized agent returns 403', async () => {
    mockOmnideskHandler = async (url, init) => {
      const auth = (init?.headers as Record<string, string>)?.[ 'Authorization' ] || '';
      const decoded = Buffer.from(auth.replace('Basic ', ''), 'base64').toString();

      if (decoded.startsWith('restricted-agent@example.com:')) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
      }

      return new Response(JSON.stringify({ case: { case_id: 555, case_number: '555' } }), { status: 200 });
    };

    const res = await originalFetch(`${baseUrl}/api/omnidesk/cases/555/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Widget-Secret': TEST_WIDGET_SECRET,
        'X-Staff-Email': 'restricted-agent@example.com'
      },
      body: JSON.stringify({ content: 'Unauthorized message attempt' })
    });

    assert.equal(res.status, 403);
  });
});

describe('CRITERION 4: Normal Widget Operations with Valid Credentials', () => {
  test('POST /api/chat with mock ticket OMNIDESK_ACTIVE_TICKET bypasses Omnidesk lookup but requires valid secret', async () => {
    const res = await originalFetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Widget-Secret': TEST_WIDGET_SECRET
      },
      body: JSON.stringify({
        ticketContext: { id: 'OMNIDESK_ACTIVE_TICKET', subject: 'Mock Ticket', description: 'Mock Description' },
        history: [],
        userQuery: 'Test question'
      })
    });

    // 200 OK or handled gracefully by AI handler
    assert.ok(res.status === 200 || res.status === 500); // 500 only if Gemini API key not valid in test env
    // Crucially: NOT 401 and NOT 403
    assert.notEqual(res.status, 401);
    assert.notEqual(res.status, 403);
  });
});

describe('CRITERION 5: Secret and Key Leak Prevention', () => {
  test('Responses do not expose WIDGET_SECRET or Omnidesk API Key', async () => {
    const res = await originalFetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Widget-Secret': 'wrong-secret'
      },
      body: JSON.stringify({ ticketContext: { id: '100' } })
    });

    const bodyText = await res.text();
    assert.equal(bodyText.includes(TEST_WIDGET_SECRET), false, 'Widget secret must not be leaked');
    assert.equal(bodyText.includes('test-omnidesk-api-key'), false, 'Omnidesk API key must not be leaked');
    assert.equal(bodyText.includes(TEST_ADMIN_PASSWORD), false, 'Admin password must not be leaked');
  });
});
