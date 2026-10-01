import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { selectRelevantSkills } from '../server.ts';

describe('Support Knowledge Assistant & Skills Integration', () => {
  const rootDir = process.cwd();
  const systemPromptPath = path.join(rootDir, 'prompts_and_skills', 'SYSTEM_PROMPT.md');
  const systemPrompt = fs.existsSync(systemPromptPath) ? fs.readFileSync(systemPromptPath, 'utf8') : '';

  describe('1. Sources Policy in System Prompt', () => {
    test('System prompt contains official documentation sources with clear hierarchy', () => {
      assert.ok(systemPrompt.length > 0, 'SYSTEM_PROMPT.md must exist');
      assert.ok(systemPrompt.includes('docs.example.com') || systemPrompt.includes('документаци'), 'Must reference documentation sources');
      assert.ok(systemPrompt.includes('Wiki') || systemPrompt.includes('баз'), 'Must identify documentation wiki source');
    });

    test('System prompt distinguishes technical questions from process questions', () => {
      assert.ok(systemPrompt.includes('Технический вопрос'), 'Must contain technical questions distinction');
      assert.ok(systemPrompt.includes('Процессный вопрос'), 'Must contain process questions distinction');
      assert.ok(systemPrompt.includes('Смешанный вопрос'), 'Must contain mixed questions distinction');
    });

    test('System prompt strictly forbids inventing Expected Result (ОР)', () => {
      assert.ok(
        systemPrompt.includes('Ожидаемый результат не подтверждён требованиями или документацией и требует уточнения'),
        'Must contain explicit mandate for unverified ОР'
      );
    });
  });

  describe('2. 10-Step Triage and Category Criteria in Classification Skill', () => {
    const classificationPath = path.join(rootDir, 'prompts_and_skills', 'skills', 'active', '15-support-ticket-classification.md');
    const classificationContent = fs.existsSync(classificationPath) ? fs.readFileSync(classificationPath, 'utf8') : '';

    test('Classification skill file exists and is populated', () => {
      assert.ok(classificationContent.length > 0, 'support-ticket-classification skill must exist');
    });

    test('Classification skill contains complete 10-step triage algorithm', () => {
      assert.ok(classificationContent.includes('10-шаговый алгоритм'), 'Must have 10-step algorithm heading');
      assert.ok(classificationContent.includes('1. **Определить продукт'), 'Step 1: Product');
      assert.ok(classificationContent.includes('2. **Определить компонент:'), 'Step 2: Component');
      assert.ok(classificationContent.includes('3. **Зафиксировать задачу клиента:'), 'Step 3: User task');
      assert.ok(classificationContent.includes('4. **Зафиксировать ожидаемый результат (ОР)'), 'Step 4: ОР and source');
      assert.ok(classificationContent.includes('5. **Зафиксировать фактический результат (ФР):'), 'Step 5: ФР');
      assert.ok(classificationContent.includes('6. **Проверить официальную Wiki:'), 'Step 6: Wiki check');
      assert.ok(classificationContent.includes('7. **Проверить историю поведения:'), 'Step 7: History');
      assert.ok(classificationContent.includes('8. **Проверить наличие обходного решения (Workaround):'), 'Step 8: Workaround');
      assert.ok(classificationContent.includes('9. **Оценить влияние на клиента:'), 'Step 9: Impact');
      assert.ok(classificationContent.includes('10. **Определить категорию и маршрут:'), 'Step 10: Category & route');
    });

    test('Classification skill defines distinction between Авария (no workaround) and Баг (has workaround)', () => {
      assert.ok(classificationContent.includes('обходного пути нет (No Workaround)'), 'Авария must specify no workaround');
      assert.ok(classificationContent.includes('есть рабочий обходной путь (Workaround)'), 'Баг must specify workaround exists');
      assert.ok(classificationContent.includes('Инцидент'), 'Must describe Incident criteria');
      assert.ok(classificationContent.includes('Ошибка документации'), 'Must describe Doc error criteria');
      assert.ok(classificationContent.includes('Идея'), 'Must describe Idea criteria');
    });
  });

  describe('3. Bug Report Standards in Internal Task Templates', () => {
    const templatesPath = path.join(rootDir, 'prompts_and_skills', 'skills', 'active', '08-shablony-zadach-dlya-vnutrenney-peredachi.md');
    const templatesContent = fs.existsSync(templatesPath) ? fs.readFileSync(templatesPath, 'utf8') : '';

    test('Task templates skill exists and is populated', () => {
      assert.ok(templatesContent.length > 0, 'Task templates skill must exist');
    });

    test('Bug template contains structured environment table and workaround section', () => {
      assert.ok(templatesContent.includes('## Окружение') || templatesContent.includes('**Окружение**'), 'Must contain environment header');
      assert.ok(templatesContent.includes('| Платформа |'), 'Table must contain Platform');
      assert.ok(templatesContent.includes('| ПО |'), 'Table must contain Software');
      assert.ok(templatesContent.includes('| Версия |'), 'Table must contain Version');
      assert.ok(templatesContent.includes('| Устройство / модель |'), 'Table must contain Device');
      assert.ok(templatesContent.includes('| Прошивка |'), 'Table must contain Firmware');
      assert.ok(templatesContent.includes('| Тестовый стенд |'), 'Table must contain Test stand');
      assert.ok(templatesContent.includes('| Сервер |'), 'Table must contain Server');
      assert.ok(templatesContent.includes('Источник ОР:'), 'Must specify ОР source requirement');
      assert.ok(templatesContent.includes('Обходной путь (Workaround)'), 'Must specify Workaround section');
      assert.ok(templatesContent.includes('`Есть` / `Нет`'), 'Must specify Workaround status');
    });
  });

  describe('4. Dynamic Skill Router Selection (server.ts)', () => {
    const mockSkills = [
      { name: 'customer-support', enabled: true },
      { name: 'support-stop-words', enabled: true },
      { name: 'support-escalation', enabled: true },
      { name: 'support-incident', enabled: true },
      { name: 'support-postmortem', enabled: true },
      { name: 'support-qa-testing', enabled: true },
      { name: 'network-troubleshooting', enabled: true },
      { name: 'modbus-knx-protocols', enabled: true },
      { name: 'server-hardware', enabled: true }
    ];

    test('Selects support-incident when incident indicators are present', () => {
      const selected = selectRelevantSkills(
        mockSkills,
        { description: 'У нас масштабный сбой на объекте, несколько аварий одновременно и сорван критичный срок сдачи' }
      );
      const names = selected.map((s: any) => s.name);
      assert.ok(names.includes('support-incident'), 'Should include support-incident');
    });

    test('Selects support-postmortem when postmortem / root cause analysis is requested', () => {
      const selected = selectRelevantSkills(
        mockSkills,
        { description: 'Проведите разбор аварии, составьте post mortem и диаграмму исикавы по вчерашнему инциденту' }
      );
      const names = selected.map((s: any) => s.name);
      assert.ok(names.includes('support-postmortem'), 'Should include support-postmortem');
    });

    test('Selects support-qa-testing when QA documentation is requested', () => {
      const selected = selectRelevantSkills(
        mockSkills,
        { description: 'Нужно написать тест-кейс и тест-план для проверки интеграции KNX' }
      );
      const names = selected.map((s: any) => s.name);
      assert.ok(names.includes('support-qa-testing'), 'Should include support-qa-testing');
    });

    test('Does NOT load incident/postmortem/qa skills for ordinary customer questions (conserves tokens)', () => {
      const selected = selectRelevantSkills(
        mockSkills,
        { description: 'Здравствуйте! Подскажите, как подключить панель к Wi-Fi сети?' }
      );
      const names = selected.map((s: any) => s.name);
      assert.ok(!names.includes('support-incident'), 'Must not include support-incident');
      assert.ok(!names.includes('support-postmortem'), 'Must not include support-postmortem');
      assert.ok(!names.includes('support-qa-testing'), 'Must not include support-qa-testing');
    });
  });

  describe('5. Support Skills Structure and Integrity', () => {
    test('All 3 specialized skills exist on disk with expected properties', () => {
      const incidentPath = path.join(rootDir, 'prompts_and_skills', 'skills', 'active', '18-support-incident.md');
      const postmortemPath = path.join(rootDir, 'prompts_and_skills', 'skills', 'active', '19-support-postmortem.md');
      const qaPath = path.join(rootDir, 'prompts_and_skills', 'skills', 'active', '20-support-qa-testing.md');

      assert.ok(fs.existsSync(incidentPath), '18-support-incident.md must exist');
      assert.ok(fs.existsSync(postmortemPath), '19-support-postmortem.md must exist');
      assert.ok(fs.existsSync(qaPath), '20-support-qa-testing.md must exist');

      const incidentContent = fs.readFileSync(incidentPath, 'utf8');
      const postmortemContent = fs.readFileSync(postmortemPath, 'utf8');
      const qaContent = fs.readFileSync(qaPath, 'utf8');

      // Verify key contents
      assert.ok(incidentContent.includes('Рабочая группа'), 'Incident must have working group');
      assert.ok(incidentContent.includes('Правило единого окна'), 'Incident must have single window rule');

      assert.ok(postmortemContent.includes('Исикавы'), 'Postmortem must have Ishikawa diagram');
      assert.ok(postmortemContent.includes('Timeline'), 'Postmortem must have timeline');

      assert.ok(qaContent.includes('Префикс.Название_проверки.md'), 'QA skill must have filename standard');
      assert.ok(qaContent.includes('Шаблон тест-кейса'), 'QA skill must have testcase template');
    });
  });
});
