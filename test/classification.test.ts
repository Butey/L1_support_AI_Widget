import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { app, settings, CLASSIFICATION_FIELDS, classifyTicket, applyClassificationBusinessRules } from '../server.ts';

const TEST_WIDGET_SECRET = 'mock-test-secret-key-for-unit-tests-only'; // gitleaks:allow
const TEST_ADMIN_PASSWORD = 'admin-secret-password-xyz';

let server: http.Server;
let baseUrl: string;

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

let mockOmnideskHandler: ((url: string, init?: RequestInit) => Response | Promise<Response>) | null = null;
let capturedPutBodies: any[] = [];

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
        return new Response(JSON.stringify({ case: { case_id: 888, ...body.case } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (url.includes('/cases/888.json')) {
        return new Response(JSON.stringify({
          case: {
            case_id: 888,
            case_number: '888',
            subject: 'Сбой сервера при пусконаладке освещения',
            content: 'На объекте ЖК Ривьера во время пусконаладочных работ вышел из строя сервер Bus77'
          }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (url.includes('/cases/888/messages.json')) {
        return new Response(JSON.stringify([
          { message: { message_id: 1, user_id: 10, content: 'Сервер UMC C3 не отвечает на команды, объект ЖК Ривьера' } }
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
});

describe('Ticket Qualification & Classification Fields', () => {
  test('CLASSIFICATION_FIELDS contains all required fields including new qualifications', () => {
    // 1. Компонент АО
    assert.ok(CLASSIFICATION_FIELDS.cf_10049, 'cf_10049 must exist');
    assert.equal(CLASSIFICATION_FIELDS.cf_10049.title, 'Компонент АО');
    assert.equal(CLASSIFICATION_FIELDS.cf_10049.options?.['1'], 'Сервер (HS/ProAV/UMC)');
    assert.equal(CLASSIFICATION_FIELDS.cf_10049.options?.['3'], 'Панели');

    // 2. Статус объекта автоматизации
    assert.ok(CLASSIFICATION_FIELDS.cf_10239, 'cf_10239 must exist');
    assert.equal(CLASSIFICATION_FIELDS.cf_10239.title, 'Статус объекта автоматизации');
    assert.equal(CLASSIFICATION_FIELDS.cf_10239.options?.['1'], 'Эксплуатация');
    assert.equal(CLASSIFICATION_FIELDS.cf_10239.options?.['4'], 'Пусконаладочные работы');

    // 3. Продуктовые решения
    assert.ok(CLASSIFICATION_FIELDS.cf_10065, 'cf_10065 must exist');
    assert.equal(CLASSIFICATION_FIELDS.cf_10065.title, 'Продуктовые решения');
    assert.equal(CLASSIFICATION_FIELDS.cf_10065.options?.['1'], 'Климат');
    assert.equal(CLASSIFICATION_FIELDS.cf_10065.options?.['3'], 'Освещение');

    // 4. Первопричина обращения
    assert.ok(CLASSIFICATION_FIELDS.cf_10171, 'cf_10171 must exist');
    assert.equal(CLASSIFICATION_FIELDS.cf_10171.title, 'Первопричина обращения');
    assert.equal(CLASSIFICATION_FIELDS.cf_10171.options?.['1'], 'Техническая проблема (сбой системы, баги)');
    assert.equal(CLASSIFICATION_FIELDS.cf_10171.options?.['2'], 'Ошибка пользователя (неверное использование функционала)');

    // 5. Имя объекта автоматизации в облаке
    assert.ok(CLASSIFICATION_FIELDS.cf_10272, 'cf_10272 must exist');
    assert.equal(CLASSIFICATION_FIELDS.cf_10272.title, 'Имя объекта автоматизации в облаке');
    assert.equal(CLASSIFICATION_FIELDS.cf_10272.type, 'text');

    // 6. Условные компоненты по категориям
    assert.ok(CLASSIFICATION_FIELDS.cf_10050, 'cf_10050 (Компонент сервисов) must exist');
    assert.equal(CLASSIFICATION_FIELDS.cf_10050.title, 'Компонент сервисов');
    assert.equal(CLASSIFICATION_FIELDS.cf_10050.options?.['1'], 'Лицензии');
    assert.equal(CLASSIFICATION_FIELDS.cf_10050.options?.['4'], 'Объект');

    assert.ok(CLASSIFICATION_FIELDS.cf_10051, 'cf_10051 (Компонент документации) must exist');
    assert.equal(CLASSIFICATION_FIELDS.cf_10051.title, 'Компонент документации');
    assert.equal(CLASSIFICATION_FIELDS.cf_10051.options?.['3'], 'Документация по продукту');

    assert.ok(CLASSIFICATION_FIELDS.cf_10468, 'cf_10468 (Компонент настройки логики) must exist');
    assert.equal(CLASSIFICATION_FIELDS.cf_10468.title, 'Компонент настройки логики');
    assert.equal(CLASSIFICATION_FIELDS.cf_10468.options?.['1'], 'Java-Script');
    assert.equal(CLASSIFICATION_FIELDS.cf_10468.options?.['3'], 'Серверный проект');

    assert.ok(CLASSIFICATION_FIELDS.cf_10469, 'cf_10469 (Компонент интеграции) must exist');
    assert.equal(CLASSIFICATION_FIELDS.cf_10469.title, 'Компонент интеграции');
    assert.equal(CLASSIFICATION_FIELDS.cf_10469.options?.['1'], 'Голосовые помощники');
    assert.equal(CLASSIFICATION_FIELDS.cf_10469.options?.['4'], 'Драйверы');

    // 7. Условные поля платформы, оборудования, протоколов (как в кейсе 810-499430)
    assert.ok(CLASSIFICATION_FIELDS.cf_10879, 'cf_10879 (Аппаратная платформа) must exist');
    assert.equal(CLASSIFICATION_FIELDS.cf_10879.title, 'Аппаратная платформа');
    assert.equal(CLASSIFICATION_FIELDS.cf_10879.options?.['3'], 'Raspberry Pi; WB 6, 7;');
    assert.equal(CLASSIFICATION_FIELDS.cf_10879.options?.['1'], 'UMC C3');

    assert.ok(CLASSIFICATION_FIELDS.cf_11129, 'cf_11129 (Протокол) must exist');
    assert.equal(CLASSIFICATION_FIELDS.cf_11129.title, 'Протокол');
    assert.equal(CLASSIFICATION_FIELDS.cf_11129.options?.['1'], 'TCP');
    assert.equal(CLASSIFICATION_FIELDS.cf_11129.options?.['2'], 'Serial');

    assert.ok(CLASSIFICATION_FIELDS.cf_11135, 'cf_11135 (Модель панели) must exist');
    assert.equal(CLASSIFICATION_FIELDS.cf_11135.title, 'Модель панели');
    assert.equal(CLASSIFICATION_FIELDS.cf_11135.options?.['2'], 'P8');

    assert.ok(CLASSIFICATION_FIELDS.cf_11134, 'cf_11134 (Интерфейс подключения питания) must exist');
    assert.equal(CLASSIFICATION_FIELDS.cf_11134.title, 'Интерфейс подключения питания');
    assert.equal(CLASSIFICATION_FIELDS.cf_11134.options?.['2'], 'PoE');

    assert.ok(CLASSIFICATION_FIELDS.cf_10928, 'cf_10928 (Модель оборудования) must exist');
    assert.equal(CLASSIFICATION_FIELDS.cf_10928.type, 'text');

    assert.ok(CLASSIFICATION_FIELDS.cf_10705, 'cf_10705 (Серийный номер) must exist');
    assert.equal(CLASSIFICATION_FIELDS.cf_10705.type, 'text');

    assert.ok(CLASSIFICATION_FIELDS.cf_10878, 'cf_10878 (HWID сервера) must exist');
    assert.equal(CLASSIFICATION_FIELDS.cf_10878.type, 'text');

    assert.ok(CLASSIFICATION_FIELDS.cf_10709, 'cf_10709 (Версия сборки сервера) must exist');
    assert.equal(CLASSIFICATION_FIELDS.cf_10709.type, 'text');

    assert.ok(CLASSIFICATION_FIELDS.cf_10896, 'cf_10896 (Версия приложения) must exist');
    assert.equal(CLASSIFICATION_FIELDS.cf_10896.type, 'text');

    assert.ok(CLASSIFICATION_FIELDS.cf_11130, 'cf_11130 (Интерфейс подключения) must exist');
    assert.equal(CLASSIFICATION_FIELDS.cf_11130.type, 'text');

    assert.ok(CLASSIFICATION_FIELDS.cf_10792, 'cf_10792 (Версия прошивки устройства) must exist');
    assert.equal(CLASSIFICATION_FIELDS.cf_10792.type, 'text');

    // Also existing fields are preserved
    assert.ok(CLASSIFICATION_FIELDS.cf_10240, 'cf_10240 must exist');
    assert.ok(CLASSIFICATION_FIELDS.cf_9968, 'cf_9968 must exist');
    assert.ok(CLASSIFICATION_FIELDS.cf_10048, 'cf_10048 must exist');
    assert.ok(CLASSIFICATION_FIELDS.cf_10069, 'cf_10069 must exist');
    assert.ok(CLASSIFICATION_FIELDS.cf_10704, 'cf_10704 must exist');
  });

  test('Classify endpoint processes and returns readable labels for all new fields', async () => {
    // Configure mock custom model to simulate LLM returning qualification fields
    const prevCustomModels = settings.custom_models;
    const prevModelName = settings.model_name;

    settings.model_name = 'mock-classifier';
    settings.custom_models = JSON.stringify([{
      model_id: 'mock-classifier',
      base_url: `${baseUrl}/mock-llm`,
      api_key: 'test-key'
    }]);

    // Setup mock LLM server response
    const mockLlmResponse = {
      choices: [{
        message: {
          content: JSON.stringify({
            cf_10240: 3,
            cf_9968: 2,
            cf_10048: null,
            cf_10049: 1,
            cf_10069: 1,
            cf_10704: 7,
            cf_10065: 3,
            cf_10171: 1,
            cf_10239: 4,
            cf_10272: 'ЖК Ривьера',
            reasoning: 'Сбой аппаратного сервера Bus77 на этапе ПНР освещения в ЖК Ривьера'
          })
        }
      }]
    };

    const mockLlmHandler = (req: http.IncomingMessage, res: http.ServerResponse) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(mockLlmResponse));
    };

    const llmServer = http.createServer(mockLlmHandler);
    await new Promise<void>(resolve => llmServer.listen(0, '127.0.0.1', resolve));
    const llmPort = (llmServer.address() as { port: number }).port;
    settings.custom_models = JSON.stringify([{
      model_id: 'mock-classifier',
      base_url: `http://127.0.0.1:${llmPort}`,
      api_key: 'test-key'
    }]);

    try {
      const res = await originalFetch(`${baseUrl}/api/omnidesk/cases/888/classify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Widget-Secret': TEST_WIDGET_SECRET
        },
        body: JSON.stringify({ force: true })
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.classified, true);
      assert.equal(data.pushed, true);

      // Verify fields in response
      assert.equal(data.fields.cf_10049, '1');
      assert.equal(data.fields.cf_10065, '3');
      assert.equal(data.fields.cf_10171, '1');
      assert.equal(data.fields.cf_10239, '4');
      assert.equal(data.fields.cf_10272, 'ЖК Ривьера');

      // Verify readable representation
      assert.equal(data.readable['Компонент АО'], 'Сервер (HS/ProAV/UMC)');
      assert.equal(data.readable['Продуктовые решения'], 'Освещение');
      assert.equal(data.readable['Первопричина обращения'], 'Техническая проблема (сбой системы, баги)');
      assert.equal(data.readable['Статус объекта автоматизации'], 'Пусконаладочные работы');
      assert.equal(data.readable['Имя объекта автоматизации в облаке'], 'ЖК Ривьера');

      // Verify Omnidesk PUT payload
      assert.equal(capturedPutBodies.length, 1);
      const putCase = capturedPutBodies[0].body.case;
      assert.deepEqual(putCase.custom_fields.cf_10049, '1');
      assert.deepEqual(putCase.custom_fields.cf_10065, '3');
      assert.deepEqual(putCase.custom_fields.cf_10171, '1');
      assert.deepEqual(putCase.custom_fields.cf_10239, '4');
      assert.deepEqual(putCase.custom_fields.cf_10272, 'ЖК Ривьера');
    } finally {
      llmServer.close();
      settings.custom_models = prevCustomModels;
      settings.model_name = prevModelName;
    }
  });

  test('Optional fields are omitted when not present in ticket data (null)', async () => {
    const prevCustomModels = settings.custom_models;
    const prevModelName = settings.model_name;

    const mockLlmResponse = {
      choices: [{
        message: {
          content: JSON.stringify({
            cf_10240: 4,
            cf_9968: 1,
            cf_10048: 9,
            cf_10049: null,
            cf_10069: 1,
            cf_10704: 1,
            cf_10065: 12,
            cf_10171: 2,
            cf_10239: null, // Нет данных о статусе объекта
            cf_10272: null, // Нет имени объекта в облаке
            reasoning: 'Вопрос по приложению i3Pro, статус объекта и облачное имя не указаны'
          })
        }
      }]
    };

    const llmServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(mockLlmResponse));
    });
    await new Promise<void>(resolve => llmServer.listen(0, '127.0.0.1', resolve));
    const llmPort = (llmServer.address() as { port: number }).port;

    settings.model_name = 'mock-classifier-nulls';
    settings.custom_models = JSON.stringify([{
      model_id: 'mock-classifier-nulls',
      base_url: `http://127.0.0.1:${llmPort}`,
      api_key: 'test-key'
    }]);

    try {
      const res = await originalFetch(`${baseUrl}/api/omnidesk/cases/888/classify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Widget-Secret': TEST_WIDGET_SECRET
        },
        body: JSON.stringify({ force: true })
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.classified, true);

      // cf_10239 and cf_10272 and cf_10049 should NOT be in fields because they were null
      assert.equal(data.fields.cf_10239, undefined);
      assert.equal(data.fields.cf_10272, undefined);
      assert.equal(data.fields.cf_10049, undefined);

      assert.equal(data.readable['Статус объекта автоматизации'], undefined);
      assert.equal(data.readable['Имя объекта автоматизации в облаке'], undefined);
      assert.equal(data.readable['Компонент АО'], undefined);

      // Verify Omnidesk PUT payload does not have null fields
      assert.equal(capturedPutBodies.length, 1);
      const putCase = capturedPutBodies[0].body.case;
      assert.equal(putCase.custom_fields.cf_10239, undefined);
      assert.equal(putCase.custom_fields.cf_10272, undefined);
      assert.equal(putCase.custom_fields.cf_10049, undefined);
    } finally {
      llmServer.close();
      settings.custom_models = prevCustomModels;
      settings.model_name = prevModelName;
    }
  });

  test('Case 810-499430 scenario: correctly identifies platform RPi, TCP protocol, and device model Zenio KIPI SC', async () => {
    const prevCustomModels = settings.custom_models;
    const prevModelName = settings.model_name;

    // Simulation of case 810-499430 classification
    const mockLlmResponse = {
      choices: [{
        message: {
          content: JSON.stringify({
            cf_10240: 3, // Сбой
            cf_9968: 1,  // ПО
            cf_10048: 6, // Сервер
            cf_10049: null,
            cf_10050: null,
            cf_10051: null,
            cf_10468: null,
            cf_10469: null,
            cf_10069: 1, // Домашняя
            cf_10704: 1, // SmartPro
            cf_10065: 12, // Решение любое/Не определено
            cf_10171: 1, // Техническая проблема
            cf_10239: null,
            cf_10272: 'Capital Towers',
            cf_10879: 3, // Raspberry Pi; WB 6, 7;
            cf_11129: 1, // TCP
            cf_11135: null,
            cf_11134: null,
            cf_10928: 'Zenio KIPI SC',
            cf_10705: null,
            cf_10878: null,
            cf_10709: null,
            cf_10896: null,
            cf_11130: 'KNX',
            cf_10792: null,
            reasoning: 'Сбой подключения драйвера KNX в Cloud mode на SmartPro Server под Raspberry Pi через шлюз Zenio KIPI SC по TCP'
          })
        }
      }]
    };

    const llmServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(mockLlmResponse));
    });
    await new Promise<void>(resolve => llmServer.listen(0, '127.0.0.1', resolve));
    const llmPort = (llmServer.address() as { port: number }).port;

    settings.model_name = 'mock-classifier-810-499430';
    settings.custom_models = JSON.stringify([{
      model_id: 'mock-classifier-810-499430',
      base_url: `http://127.0.0.1:${llmPort}`,
      api_key: 'test-key'
    }]);

    try {
      const res = await originalFetch(`${baseUrl}/api/omnidesk/cases/888/classify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Widget-Secret': TEST_WIDGET_SECRET
        },
        body: JSON.stringify({ force: true })
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.classified, true);
      assert.equal(data.pushed, true);

      // Verify classified fields
      assert.equal(data.fields.cf_10240, '3');
      assert.equal(data.fields.cf_9968, '1');
      assert.equal(data.fields.cf_10048, '6');
      assert.equal(data.fields.cf_10069, '2'); // Strict rule: SmartPro / SmartPro Server -> Commercial automation
      assert.equal(data.fields.cf_10704, '1');
      assert.equal(data.fields.cf_10879, '3');
      assert.equal(data.fields.cf_11129, '1');
      assert.equal(data.fields.cf_10928, 'Zenio KIPI SC');
      assert.equal(data.fields.cf_11130, 'KNX');
      assert.equal(data.fields.cf_10272, 'Capital Towers');

      // Verify readable representation
      assert.equal(data.readable['Тип обращения'], 'Сбой');
      assert.equal(data.readable['Категория'], 'Программное обеспечение');
      assert.equal(data.readable['Компонент ПО'], 'Сервер (SmartPro/SmartLite/KNX Home/Bus Home/SCADA)');
      assert.equal(data.readable['Направление автоматизации'], 'Коммерческая автоматизация (ProAV/SmartPro/ЛК)');
      assert.equal(data.readable['Продукт'], 'SmartPro');
      assert.equal(data.readable['Аппаратная платформа'], 'Raspberry Pi; WB 6, 7;');
      assert.equal(data.readable['Протокол'], 'TCP');
      assert.equal(data.readable['Модель оборудования'], 'Zenio KIPI SC');
      assert.equal(data.readable['Интерфейс подключения'], 'KNX');
      assert.equal(data.readable['Имя объекта автоматизации в облаке'], 'Capital Towers');

      // Verify other category components are omitted (null)
      assert.equal(data.fields.cf_10049, undefined);
      assert.equal(data.fields.cf_10050, undefined);
      assert.equal(data.fields.cf_10051, undefined);
      assert.equal(data.fields.cf_10468, undefined);
      assert.equal(data.fields.cf_10469, undefined);

      // Verify Omnidesk PUT payload
      assert.equal(capturedPutBodies.length, 1);
      const putCase = capturedPutBodies[0].body.case;
      assert.equal(putCase.custom_fields.cf_10069, '2');
      assert.equal(putCase.custom_fields.cf_10704, '1');
      assert.equal(putCase.custom_fields.cf_10879, '3');
      assert.equal(putCase.custom_fields.cf_11129, '1');
      assert.equal(putCase.custom_fields.cf_10928, 'Zenio KIPI SC');
      assert.equal(putCase.custom_fields.cf_11130, 'KNX');
      assert.equal(putCase.custom_fields.cf_10272, 'Capital Towers');
    } finally {
      llmServer.close();
      settings.custom_models = prevCustomModels;
      settings.model_name = prevModelName;
    }
  });

  test('Conditional category branching: Services (cf_10050), Logic (cf_10468), and Integrations (cf_10469)', async () => {
    const prevCustomModels = settings.custom_models;
    const prevModelName = settings.model_name;

    // Test ticket for Services category
    const mockServicesResponse = {
      choices: [{
        message: {
          content: JSON.stringify({
            cf_10240: 4, // Запрос
            cf_9968: 3,  // Сервисы и доступы
            cf_10048: null,
            cf_10049: null,
            cf_10050: 4, // Объект (перенос объекта между аккаунтами)
            cf_10051: null,
            cf_10468: null,
            cf_10469: null,
            cf_10069: 1,
            cf_10704: 6, // Cloud IoT
            cf_10065: 12,
            cf_10171: 8, // Прочее
            reasoning: 'Запрос на перенос объекта между учетными записями в облаке'
          })
        }
      }]
    };

    const llmServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(mockServicesResponse));
    });
    await new Promise<void>(resolve => llmServer.listen(0, '127.0.0.1', resolve));
    const llmPort = (llmServer.address() as { port: number }).port;

    settings.model_name = 'mock-classifier-services';
    settings.custom_models = JSON.stringify([{
      model_id: 'mock-classifier-services',
      base_url: `http://127.0.0.1:${llmPort}`,
      api_key: 'test-key'
    }]);

    try {
      const res = await originalFetch(`${baseUrl}/api/omnidesk/cases/888/classify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Widget-Secret': TEST_WIDGET_SECRET
        },
        body: JSON.stringify({ force: true })
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.classified, true);
      assert.equal(data.fields.cf_9968, '3');
      assert.equal(data.fields.cf_10050, '4');
      assert.equal(data.readable['Категория'], 'Сервисы и доступы');
      assert.equal(data.readable['Компонент сервисов'], 'Объект');
      assert.equal(data.fields.cf_10048, undefined);
      assert.equal(data.fields.cf_10049, undefined);
      assert.equal(data.fields.cf_10051, undefined);
    } finally {
      llmServer.close();
      settings.custom_models = prevCustomModels;
      settings.model_name = prevModelName;
    }
  });

  test('Hardware panel branch: Panel model (P8), PoE power, and Serial number', async () => {
    const prevCustomModels = settings.custom_models;
    const prevModelName = settings.model_name;

    const mockPanelResponse = {
      choices: [{
        message: {
          content: JSON.stringify({
            cf_10240: 3, // Сбой
            cf_9968: 2,  // Аппаратное обеспечение
            cf_10048: null,
            cf_10049: 3, // Панели
            cf_10050: null,
            cf_10051: null,
            cf_10468: null,
            cf_10469: null,
            cf_10069: 1,
            cf_10704: 1,
            cf_10065: 12,
            cf_10171: 1, // Техническая проблема
            cf_11135: 2, // P8
            cf_11134: 2, // PoE
            cf_10705: 'P80002954',
            reasoning: 'Неисправность сенсорной панели P8 с питанием по PoE'
          })
        }
      }]
    };

    const llmServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(mockPanelResponse));
    });
    await new Promise<void>(resolve => llmServer.listen(0, '127.0.0.1', resolve));
    const llmPort = (llmServer.address() as { port: number }).port;

    settings.model_name = 'mock-classifier-panel';
    settings.custom_models = JSON.stringify([{
      model_id: 'mock-classifier-panel',
      base_url: `http://127.0.0.1:${llmPort}`,
      api_key: 'test-key'
    }]);

    try {
      const res = await originalFetch(`${baseUrl}/api/omnidesk/cases/888/classify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Widget-Secret': TEST_WIDGET_SECRET
        },
        body: JSON.stringify({ force: true })
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.classified, true);
      assert.equal(data.fields.cf_9968, '2');
      assert.equal(data.fields.cf_10049, '3');
      assert.equal(data.fields.cf_11135, '2');
      assert.equal(data.fields.cf_11134, '2');
      assert.equal(data.fields.cf_10705, 'P80002954');

      assert.equal(data.readable['Компонент АО'], 'Панели');
      assert.equal(data.readable['Модель панели'], 'P8');
      assert.equal(data.readable['Интерфейс подключения питания'], 'PoE');
      assert.equal(data.readable['Серийный номер'], 'P80002954');
    } finally {
      llmServer.close();
      settings.custom_models = prevCustomModels;
      settings.model_name = prevModelName;
    }
  });

  test('Excluded fields (status, purchase sum, internal type, company, ToV, audit link) are strictly filtered out and never pushed', async () => {
    // 1. Verify not in CLASSIFICATION_FIELDS
    assert.equal((CLASSIFICATION_FIELDS as any).cf_5285, undefined, 'cf_5285 (Сумма покупок) must not be in CLASSIFICATION_FIELDS');
    assert.equal((CLASSIFICATION_FIELDS as any).cf_5286, undefined, 'cf_5286 (Статус клиента) must not be in CLASSIFICATION_FIELDS');
    assert.equal((CLASSIFICATION_FIELDS as any).cf_5287, undefined, 'cf_5287 (Сумма покупок в статусе) must not be in CLASSIFICATION_FIELDS');
    assert.equal((CLASSIFICATION_FIELDS as any).cf_5288, undefined, 'cf_5288 (Тип) must not be in CLASSIFICATION_FIELDS');
    assert.equal((CLASSIFICATION_FIELDS as any).cf_5289, undefined, 'cf_5289 (Компания) must not be in CLASSIFICATION_FIELDS');
    assert.equal((CLASSIFICATION_FIELDS as any).cf_5317, undefined, 'cf_5317 (Статус обращения) must not be in CLASSIFICATION_FIELDS');
    assert.equal((CLASSIFICATION_FIELDS as any).cf_10459, undefined, 'cf_10459 (Статус обращения) must not be in CLASSIFICATION_FIELDS');
    assert.equal((CLASSIFICATION_FIELDS as any).cf_11185, undefined, 'cf_11185 (Оценка ToV omni) must not be in CLASSIFICATION_FIELDS');
    assert.equal((CLASSIFICATION_FIELDS as any).cf_11193, undefined, 'cf_11193 (Оценка ToV custom) must not be in CLASSIFICATION_FIELDS');
    assert.equal((CLASSIFICATION_FIELDS as any).cf_11462, undefined, 'cf_11462 (Ссылка на аудит) must not be in CLASSIFICATION_FIELDS');
    assert.equal((CLASSIFICATION_FIELDS as any).group, undefined, 'group must not be in CLASSIFICATION_FIELDS');
    assert.equal((CLASSIFICATION_FIELDS as any).group_id, undefined, 'group_id must not be in CLASSIFICATION_FIELDS');
    assert.equal((CLASSIFICATION_FIELDS as any).status, undefined, 'status must not be in CLASSIFICATION_FIELDS');
    assert.equal((CLASSIFICATION_FIELDS as any).status_id, undefined, 'status_id must not be in CLASSIFICATION_FIELDS');

    // 2. Verify product field (cf_10704) is present and defined
    assert.ok(CLASSIFICATION_FIELDS.cf_10704, 'cf_10704 (Продукт) must be in CLASSIFICATION_FIELDS');
    assert.equal(CLASSIFICATION_FIELDS.cf_10704.title, 'Продукт');
    assert.equal(CLASSIFICATION_FIELDS.cf_10704.options?.['1'], 'SmartPro');

    // 3. Test that if LLM returns any of these excluded fields, they are ignored
    const prevCustomModels = settings.custom_models;
    const prevModelName = settings.model_name;

    const mockLlmWithForbiddenFields = {
      choices: [{
        message: {
          content: JSON.stringify({
            cf_10240: 3,
            cf_9968: 1,
            cf_10048: 6,
            cf_10704: 1, // Продукт: SmartPro
            cf_5285: '1000 RUB', // Сумма покупок (ЗАПРЕЩЕНО)
            cf_5286: '2',        // Статус (ЗАПРЕЩЕНО)
            cf_5288: '1',        // Тип (ЗАПРЕЩЕНО)
            cf_5289: 'ITSM',     // Компания (ЗАПРЕЩЕНО)
            cf_5317: '1',        // Статус обращения (ЗАПРЕЩЕНО)
            cf_10459: '2',       // Статус обращения (ЗАПРЕЩЕНО)
            cf_11193: 'Отлично', // Оценка ToV (ЗАПРЕЩЕНО)
            cf_11462: 'https://audit.url', // Ссылка на аудит (ЗАПРЕЩЕНО)
            group: '96442',      // Группа (ЗАПРЕЩЕНО)
            group_id: 96442,     // Группа ID (ЗАПРЕЩЕНО)
            status: 'closed',    // Статус тикета (ЗАПРЕЩЕНО)
            status_id: 3,        // Статус ID (ЗАПРЕЩЕНО)
            reasoning: 'Проверка исключения запрещенных полей'
          })
        }
      }]
    };

    const llmServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(mockLlmWithForbiddenFields));
    });
    await new Promise<void>(resolve => llmServer.listen(0, '127.0.0.1', resolve));
    const llmPort = (llmServer.address() as { port: number }).port;

    settings.model_name = 'mock-classifier-excluded';
    settings.custom_models = JSON.stringify([{
      model_id: 'mock-classifier-excluded',
      base_url: `http://127.0.0.1:${llmPort}`,
      api_key: 'test-key'
    }]);

    try {
      const res = await originalFetch(`${baseUrl}/api/omnidesk/cases/888/classify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Widget-Secret': TEST_WIDGET_SECRET
        },
        body: JSON.stringify({ force: true })
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.classified, true);

      // Verify product is filled
      assert.equal(data.fields.cf_10704, '1');
      assert.equal(data.readable['Продукт'], 'SmartPro');

      // Verify forbidden fields are not present in data.fields or data.readable
      assert.equal(data.fields.cf_5285, undefined);
      assert.equal(data.fields.cf_5286, undefined);
      assert.equal(data.fields.cf_5288, undefined);
      assert.equal(data.fields.cf_5289, undefined);
      assert.equal(data.fields.cf_5317, undefined);
      assert.equal(data.fields.cf_10459, undefined);
      assert.equal(data.fields.cf_11193, undefined);
      assert.equal(data.fields.cf_11462, undefined);
      assert.equal(data.fields.group, undefined);
      assert.equal(data.fields.group_id, undefined);
      assert.equal(data.fields.status, undefined);
      assert.equal(data.fields.status_id, undefined);

      assert.equal(data.readable['Сумма покупок'], undefined);
      assert.equal(data.readable['Статус'], undefined);
      assert.equal(data.readable['Компания'], undefined);
      assert.equal(data.readable['Оценка ToV'], undefined);
      assert.equal(data.readable['Ссылка на аудит'], undefined);
      assert.equal(data.readable['Группа'], undefined);
      assert.equal(data.readable['Статус обращения'], undefined);

      // Verify Omnidesk PUT payload does not contain forbidden fields
      assert.equal(capturedPutBodies.length, 1);
      const putCase = capturedPutBodies[0].body.case;
      assert.equal(putCase.custom_fields.cf_10704, '1');
      assert.equal(putCase.custom_fields.cf_5285, undefined);
      assert.equal(putCase.custom_fields.cf_5286, undefined);
      assert.equal(putCase.custom_fields.cf_5288, undefined);
      assert.equal(putCase.custom_fields.cf_5289, undefined);
      assert.equal(putCase.custom_fields.cf_5317, undefined);
      assert.equal(putCase.custom_fields.cf_10459, undefined);
      assert.equal(putCase.custom_fields.cf_11193, undefined);
      assert.equal(putCase.custom_fields.cf_11462, undefined);
      assert.equal(putCase.custom_fields.group, undefined);
      assert.equal(putCase.custom_fields.group_id, undefined);
      assert.equal(putCase.custom_fields.status, undefined);
      assert.equal(putCase.custom_fields.status_id, undefined);

      // Verify standard case fields cannot be injected into root case object
      assert.equal(putCase.group_id, undefined);
      assert.equal(putCase.group, undefined);
      assert.equal(putCase.status, undefined);
      assert.equal(putCase.status_id, undefined);
    } finally {
      llmServer.close();
      settings.custom_models = prevCustomModels;
      settings.model_name = prevModelName;
    }
  });

  describe('Automation Direction (cf_10069) & i3 pro Commercial Automation Rules', () => {
    test('applyClassificationBusinessRules: if product is SmartPro (cf_10704=1), cf_10069 is strictly set to 2', () => {
      // 1. Without direction specified
      const r1 = applyClassificationBusinessRules({ cf_10704: '1' });
      assert.equal(r1.cf_10069, '2');

      // 2. Overrides wrong direction (e.g. 1 - Домашняя)
      const r2 = applyClassificationBusinessRules({ cf_10704: '1', cf_10069: '1' });
      assert.equal(r2.cf_10069, '2');
    });

    test('applyClassificationBusinessRules: if i3 pro is mentioned in ticketContext, cf_10069 is 2 and cf_10704 is 1', () => {
      // In subject
      const rSubject = applyClassificationBusinessRules({}, { subject: 'Ошибка при запуске проекта в i3 pro' });
      assert.equal(rSubject.cf_10069, '2');
      assert.equal(rSubject.cf_10704, '1');

      // In description with i3pro
      const rDesc = applyClassificationBusinessRules({}, { description: 'На объекте клиент использует i3pro и сервер' });
      assert.equal(rDesc.cf_10069, '2');
      assert.equal(rDesc.cf_10704, '1');

      // In messages with SmartPro / ProAV
      const rMsg = applyClassificationBusinessRules({}, { messages: ['Перезагрузили сервер SmartPro, статус не изменился'] });
      assert.equal(rMsg.cf_10069, '2');
      assert.equal(rMsg.cf_10704, '1');

      // In reasoning
      const rReasoning = applyClassificationBusinessRules({}, { reasoning: 'Вопрос по лицензированию i3-pro' });
      assert.equal(rReasoning.cf_10069, '2');
      assert.equal(rReasoning.cf_10704, '1');

      // Even if KNX, apartment, or smart home is mentioned in ticket!
      const rKnx = applyClassificationBusinessRules(
        { cf_10069: '1' },
        { subject: 'Умный дом в квартире на KNX', description: 'Панель с приложением i3 pro теряет связь с шиной KNX' }
      );
      assert.equal(rKnx.cf_10069, '2');
      assert.equal(rKnx.cf_10704, '1');
    });

    test('applyClassificationBusinessRules: does not override non-i3pro products (Bus77, SCADA)', () => {
      // Bus77 Home
      const rBus77 = applyClassificationBusinessRules({ cf_10704: '7', cf_10069: '1' }, { subject: 'Сбой Bus77 Home' });
      assert.equal(rBus77.cf_10704, '7');
      assert.equal(rBus77.cf_10069, '1');

      // SCADA
      const rScada = applyClassificationBusinessRules({ cf_10704: '3', cf_10069: '3' }, { subject: 'SCADA диспетчеризация здания' });
      assert.equal(rScada.cf_10704, '3');
      assert.equal(rScada.cf_10069, '3');
    });

    test('POST /api/omnidesk/cases/:caseNumber/classify enforces commercial automation (cf_10069=2) when LLM returns 1 for i3 pro', async () => {
      const prevCustomModels = settings.custom_models;
      const prevModelName = settings.model_name;

      // LLM mistakenly returned cf_10069: 1 (Домашняя) for i3 pro ticket
      const mockLlmResponse = {
        choices: [{
          message: {
            content: JSON.stringify({
              cf_10240: 3, // Сбой
              cf_9968: 1,  // ПО
              cf_10048: 9, // Приложения
              cf_10069: 1, // Ошибочно: Домашняя
              cf_10704: 1, // SmartPro
              cf_10065: 12,
              cf_10171: 1,
              reasoning: 'Сбой в работе приложения i3 pro'
            })
          }
        }]
      };

      const llmServer = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(mockLlmResponse));
      });
      await new Promise<void>(resolve => llmServer.listen(0, '127.0.0.1', resolve));
      const llmPort = (llmServer.address() as { port: number }).port;

      settings.model_name = 'mock-classifier-i3pro-enforce';
      settings.custom_models = JSON.stringify([{
        model_id: 'mock-classifier-i3pro-enforce',
        base_url: `http://127.0.0.1:${llmPort}`,
        api_key: 'test-key'
      }]);

      try {
        const res = await originalFetch(`${baseUrl}/api/omnidesk/cases/888/classify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Widget-Secret': TEST_WIDGET_SECRET
          },
          body: JSON.stringify({ force: true })
        });

        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.classified, true);
        // Strictly enforced as 2 (Коммерческая автоматизация)
        assert.equal(data.fields.cf_10069, '2');
        assert.equal(data.readable['Направление автоматизации'], 'Коммерческая автоматизация (ProAV/SmartPro/ЛК)');

        // Omnidesk PUT payload also has cf_10069: '2'
        assert.equal(capturedPutBodies.length, 1);
        const putCase = capturedPutBodies[0].body.case;
        assert.equal(putCase.custom_fields.cf_10069, '2');
        assert.equal(putCase.custom_fields.cf_10704, '1');
      } finally {
        llmServer.close();
        settings.custom_models = prevCustomModels;
        settings.model_name = prevModelName;
      }
    });

    test('POST /api/omnidesk/cases/:caseNumber/classify/apply strictly ensures cf_10069=2 when cf_10704=1', async () => {
      const res = await originalFetch(`${baseUrl}/api/omnidesk/cases/888/classify/apply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Widget-Secret': TEST_WIDGET_SECRET
        },
        body: JSON.stringify({
          fields: {
            cf_10704: '1', // SmartPro
            cf_10069: '1'  // Attempted to apply home automation
          }
        })
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.appliedFields.cf_10069, '2');

      assert.equal(capturedPutBodies.length, 1);
      const putCase = capturedPutBodies[0].body.case;
      assert.equal(putCase.custom_fields.cf_10069, '2');
      assert.equal(putCase.custom_fields.cf_10704, '1');
    });
  });
});

