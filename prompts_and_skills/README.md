# L1 Support AI Assistant: Системный промпт, Скиллы и Документация изменений

В этой директории сохранены актуальные файлы конфигурации ИИ-ассистента, активные навыки и детальное описание последних доработок системы.

---

## Структура файлов

- **[`SYSTEM_PROMPT.md`](file:///opt/webapps/omniai/gemini_omni/prompts_and_skills/SYSTEM_PROMPT.md)**  
  Полный рабочий текст системного промпта (29 124 символа). Роль ассистента, стандарты общения, правила оформления ответов, подстановка номера тикета через `#`, диагностика скриншотов, запреты. Включает **Политику источников (Sources Policy)**: три официальных URL Wiki с иерархией и запретом домысливания ОР.

- **[`SKILLS_OVERVIEW.md`](file:///opt/webapps/omniai/gemini_omni/prompts_and_skills/SKILLS_OVERVIEW.md)**  
  Сводный каталог всех скиллов (навыков) с их статусами, описанием и механизмом внедрения в модель.

- **[`CHANGELOG_AND_RATIONALE.md`](file:///opt/webapps/omniai/gemini_omni/prompts_and_skills/CHANGELOG_AND_RATIONALE.md)**  
  Подробный отчёт по дням: детальный разбор изменений системного промпта и скиллов за 17–21 сентября 2026 года.

- **[`ANTIGRAVITY_CHANGELOG.md`](file:///opt/webapps/omniai/gemini_omni/prompts_and_skills/ANTIGRAVITY_CHANGELOG.md)**  
  Чейнджлог по всем доработкам системного промпта, активных скиллов, бэкенда и виджета, выполненным в сессиях парного программирования с **Antigravity**.

- **[`skills/active/`](file:///opt/webapps/omniai/gemini_omni/prompts_and_skills/skills/active/)**  
  Папка с 16 отдельными markdown-файлами активных скиллов, загружаемых в контекст ИИ:
  - [`02-agentic-optimization.md`](file:///opt/webapps/omniai/gemini_omni/prompts_and_skills/skills/active/02-agentic-optimization.md)
  - [`06-support-customer-response.md`](file:///opt/webapps/omniai/gemini_omni/prompts_and_skills/skills/active/06-support-customer-response.md)
  - [`07-support-escalation.md`](file:///opt/webapps/omniai/gemini_omni/prompts_and_skills/skills/active/07-support-escalation.md)
  - [`08-shablony-zadach-dlya-vnutrenney-peredachi.md`](file:///opt/webapps/omniai/gemini_omni/prompts_and_skills/skills/active/08-shablony-zadach-dlya-vnutrenney-peredachi.md)
  - [`09-support-first-response.md`](file:///opt/webapps/omniai/gemini_omni/prompts_and_skills/skills/active/09-support-first-response.md)
  - [`10-support-human-style.md`](file:///opt/webapps/omniai/gemini_omni/prompts_and_skills/skills/active/10-support-human-style.md)
  - [`11-support-omnidesk-output.md`](file:///opt/webapps/omniai/gemini_omni/prompts_and_skills/skills/active/11-support-omnidesk-output.md)
  - [`12-support-response-audit.md`](file:///opt/webapps/omniai/gemini_omni/prompts_and_skills/skills/active/12-support-response-audit.md)
  - [`13-support-stop-words.md`](file:///opt/webapps/omniai/gemini_omni/prompts_and_skills/skills/active/13-support-stop-words.md)
  - [`14-support-technical-diagnostics.md`](file:///opt/webapps/omniai/gemini_omni/prompts_and_skills/skills/active/14-support-technical-diagnostics.md)
  - [`15-support-ticket-classification.md`](file:///opt/webapps/omniai/gemini_omni/prompts_and_skills/skills/active/15-support-ticket-classification.md)
  - [`16-prakticheskiy-spravochnik-po-marshrutizatsii.md`](file:///opt/webapps/omniai/gemini_omni/prompts_and_skills/skills/active/16-prakticheskiy-spravochnik-po-marshrutizatsii.md)
  - [`17-support-ticket-intake.md`](file:///opt/webapps/omniai/gemini_omni/prompts_and_skills/skills/active/17-support-ticket-intake.md)
  - [`18-support-incident.md`](file:///opt/webapps/omniai/gemini_omni/prompts_and_skills/skills/active/18-support-incident.md) ⭐ **новый**
  - [`19-support-postmortem.md`](file:///opt/webapps/omniai/gemini_omni/prompts_and_skills/skills/active/19-support-postmortem.md) ⭐ **новый**
  - [`20-support-qa-testing.md`](file:///opt/webapps/omniai/gemini_omni/prompts_and_skills/skills/active/20-support-qa-testing.md) ⭐ **новый**

- **[`sync.py`](file:///opt/webapps/omniai/gemini_omni/prompts_and_skills/sync.py)**  
  Утилита двусторонней синхронизации между `storage/settings.json` и `prompts_and_skills/`:
  - `--check` — проверка совпадения и статуса;
  - `--export` — экспорт из settings.json в Markdown;
  - `--import` — импорт из Markdown в settings.json.

- **[`skills/disabled/`](file:///opt/webapps/omniai/gemini_omni/prompts_and_skills/skills/disabled/)**  
  4 отключённых скилла-заглушки, не попадающих в контекст модели.

---

## Текущий статус системы (на 21 сентября 2026)

- **95 тестов / 20 сьютов / 0 failures (100% pass):**
  - `test/security.test.ts` — авторизация, `GET /api/widget/config`, изоляция тикетов
  - `test/skills_import.test.ts` — парсинг YAML, пакетный импорт, лимиты
  - `test/escalation_note.test.ts` — заметки Omnidesk строго при необходимости эскалации
  - `test/classification.test.ts` — квалификация, иерархия категорий, CRM-поля
  - `test/first_response_ticket_number.test.ts` — подстановка номера тикета через `#`
  - `test/image_recognition.test.ts` — распознавание скриншотов, vision-роутинг, кэш
  - `test/safety_workflows.test.ts` — allowlist, изоляция кэша, Skill Router

- **Ключевые нововведения (21 сентября 2026 — интеграция GPTKnowledge):**
  - **Sources Policy в ядре промпта:** три официальные Wiki, разделение технических/процессных вопросов, запрет домысливания ОР.
  - **10-шаговый алгоритм классификации** в `support-ticket-classification`: Авария (workaround нет) vs Баг (workaround есть), поле «Ключевые критерии».
  - **`support-incident`** — регламент крупных инцидентов: критерии, матрица РГ, единое окно коммуникации.
  - **`support-postmortem`** — диаграмма Исикавы, Timeline 11 точек, «Как быстрее», «Где ждали».
  - **`support-qa-testing`** — тест-кейсы, тест-планы, отчёты PASSED/FAILED по стандартам репозитория проекта.
  - **Шаблон Баг-репорта** обогащён таблицей окружения (7 полей), Источником ОР и `Workaround: Есть/Нет`.
  - **Skill Router** расширен regex-триггерами для трёх новых скиллов.

- **Ключевые нововведения (ранее, v3):**
  - Автоматическая синхронизация `WIDGET_SECRET` (нет ошибок 401 при открытии истории).
  - Компактное саммари диалога в чате вместо длинной ленты.
  - Динамический Skill Router (~70% экономии токенов).
  - Кэш скриншотов: изоляция по тикету, TTL 14 дней, LRU 1000.
  - История переписки в `storage/conversations.json` с полноэкранным просмотром.

- **Активных скиллов:** 16 (13 прежних + 3 новых из GPTKnowledge Assistant)
- **Продакшн:** Docker-контейнер `omniai-assistant`, порт `5555`, ротация пула Gemini API-ключей с fallback.
