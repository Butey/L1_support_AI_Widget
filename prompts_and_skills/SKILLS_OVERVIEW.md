# Каталог скиллов (Skills) L1 Support AI Assistant

> Данный каталог отражает текущую конфигурацию навыков ИИ-ассистента в системе.  
> Хранилище: [`storage/settings.json`](file:///opt/webapps/omniai/gemini_omni/storage/settings.json)  
> Управление: Web-админка (раздел *Agent Skills / Навыки*)  
> Синхронизация: скрипт [`prompts_and_skills/sync.py`](file:///opt/webapps/omniai/gemini_omni/prompts_and_skills/sync.py) (`--check` / `--export`)  
> Внедрение в LLM: [`server.ts:2225-2315`](file:///opt/webapps/omniai/gemini_omni/server.ts#L2225-L2315) — **Динамический Skill Router (`selectRelevantSkills`)**: вместо монолитной вставки всех навыков сервер динамически выбирает базовые навыки поддержки (core) и до 3 наиболее релевантных навыков на основе интента оператора, ключевых слов тикета, оборудования и сетевых протоколов (экономия ~70% токенов контекста).  
> Инструкции эскалации: [`server.ts:2658-2663`](file:///opt/webapps/omniai/gemini_omni/server.ts#L2658-L2663) и детерминированная автозапись с 60с дедупликацией заметок в Omnidesk: [`server.ts:1746`](file:///opt/webapps/omniai/gemini_omni/server.ts#L1746), [`server.ts:2670-2720`](file:///opt/webapps/omniai/gemini_omni/server.ts#L2670-L2720).  
> Валидация классификации: [`server.ts:1095-1195`](file:///opt/webapps/omniai/gemini_omni/server.ts#L1095-L1195) — функция `validateClassificationFields` со строгим server-side allowlist, безопасной обработкой неизвестного продукта (`cf_10704: "0"`), фильтрацией CRM/системных полей и санитизацией строк.

---

## 1. Активные скиллы (16 включены в контекст модели)

Все активные скиллы лежат в папке [`skills/active/`](file:///opt/webapps/omniai/gemini_omni/prompts_and_skills/skills/active/):

| № | Файл | Название | Описание и назначение |
|---|------|----------|-----------------------|
| 1 | [`02-agentic-optimization.md`](file:///opt/webapps/omniai/gemini_omni/prompts_and_skills/skills/active/02-agentic-optimization.md) | **Agentic Optimization** | Общие правила оптимизации цепочек рассуждений агента и компактности вывода. |
| 2 | [`06-support-customer-response.md`](file:///opt/webapps/omniai/gemini_omni/prompts_and_skills/skills/active/06-support-customer-response.md) | **support-customer-response** | Подготовка и доработка клиентского ответа технической поддержки SmartPlatform на языке переписки (результат, запрос данных, инструкции). |
| 3 | [`07-support-escalation.md`](file:///opt/webapps/omniai/gemini_omni/prompts_and_skills/skills/active/07-support-escalation.md) | **support-escalation** | Проверка готовности обращения к эскалации разработчикам, сервисным инженерам или продуктовой команде. Формирует заметку Omnidesk по структуре «Что есть» / «Чего не хватает». |
| 4 | [`08-shablony-zadach-dlya-vnutrenney-peredachi.md`](file:///opt/webapps/omniai/gemini_omni/prompts_and_skills/skills/active/08-shablony-zadach-dlya-vnutrenney-peredachi.md) | **Шаблоны задач для внутренней передачи** | Шаблоны передачи задач в смежные отделы. Баг-репорт обогащён таблицей окружения (Платформа/ПО/Версия/Устройство/Прошивка/Стенд/Сервер), полем Источник ОР и явным статусом Workaround. |
| 5 | [`09-support-first-response.md`](file:///opt/webapps/omniai/gemini_omni/prompts_and_skills/skills/active/09-support-first-response.md) | **support-first-response** | Формирование первого ответа на новое обращение: валидация контекста, обязательная подстановка номера обращения через `#`, учет прикрепленных изображений/скриншотов, рисков и эмоционального фона. |
| 6 | [`10-support-human-style.md`](file:///opt/webapps/omniai/gemini_omni/prompts_and_skills/skills/active/10-support-human-style.md) | **support-human-style** | Стандарты живого, спокойного, профессионального тона без канцелярщины, роботизированных клише и панибратства. |
| 7 | [`11-support-omnidesk-output.md`](file:///opt/webapps/omniai/gemini_omni/prompts_and_skills/skills/active/11-support-omnidesk-output.md) | **support-omnidesk-output** | Правила оформления вывода для Omnidesk: чистый текст без служебных тегов разметки, готовый к отправке клиенту в один клик. |
| 8 | [`12-support-response-audit.md`](file:///opt/webapps/omniai/gemini_omni/prompts_and_skills/skills/active/12-support-response-audit.md) | **support-response-audit** | Экспертный аудит ответов сотрудников на техническую точность, безопасность формулировок и полноту. |
| 9 | [`13-support-stop-words.md`](file:///opt/webapps/omniai/gemini_omni/prompts_and_skills/skills/active/13-support-stop-words.md) | **support-stop-words** | Запрещенные слова и фразы: обвинительные реплики в адрес клиента, категоричные неподтвержденные обещания, ссылки на внутренние базы (BookStack). |
| 10 | [`14-support-technical-diagnostics.md`](file:///opt/webapps/omniai/gemini_omni/prompts_and_skills/skills/active/14-support-technical-diagnostics.md) | **support-technical-diagnostics** | Доказательная диагностика: анализ логов, дампов, топологии шин KNX/Modbus/Bus77, а также прямое визуальное исследование скриншотов, всплывающих окон ошибок, версий ПО и сетевых индикаторов. |
| 11 | [`15-support-ticket-classification.md`](file:///opt/webapps/omniai/gemini_omni/prompts_and_skills/skills/active/15-support-ticket-classification.md) | **support-ticket-classification** | Рекомендации по маршрутизации и типам обращений. Обогащён 10-шаговым алгоритмом классификации и чёткими критериями Авария vs Баг (ключ: наличие workaround). |
| 12 | [`16-prakticheskiy-spravochnik-po-marshrutizatsii.md`](file:///opt/webapps/omniai/gemini_omni/prompts_and_skills/skills/active/16-prakticheskiy-spravochnik-po-marshrutizatsii.md) | **Практический справочник по маршрутизации SmartPlatform** | Детальная карта матриц ответственности отделов SmartPlatform (R&D, техподдержка 1-й/2-й линии, производство, продажи). |
| 13 | [`17-support-ticket-intake.md`](file:///opt/webapps/omniai/gemini_omni/prompts_and_skills/skills/active/17-support-ticket-intake.md) | **support-ticket-intake** | Первичный разбор структуры тикета, нормализация переписки и восстановление хронологии событий. |
| 14 | [`18-support-incident.md`](file:///opt/webapps/omniai/gemini_omni/prompts_and_skills/skills/active/18-support-incident.md) | **support-incident** | ⭐ НОВЫЙ. Регламент обработки крупных инцидентов: критерии квалификации (несколько аварий на объекте, >2 компонентов, критичные сроки, фин.риски), матрица зон ответственности (Продакт, ПО, Hardware, Коммерция, ТП), правило единого окна коммуникации, шаблон эскалации. Подключается по ключевым словам инцидента/масштабного сбоя. |
| 15 | [`19-support-postmortem.md`](file:///opt/webapps/omniai/gemini_omni/prompts_and_skills/skills/active/19-support-postmortem.md) | **support-postmortem** | ⭐ НОВЫЙ. Анализ корневых причин после устранения аварии/инцидента: диаграмма Исикавы (5 категорий: Люди/Процессы/Инструменты/Код/Инфраструктура), Timeline из 11 точек, разделы «Как быстрее» и «Где ждали», шаблон готового документа. |
| 16 | [`20-support-qa-testing.md`](file:///opt/webapps/omniai/gemini_omni/prompts_and_skills/skills/active/20-support-qa-testing.md) | **support-qa-testing** | ⭐ НОВЫЙ. QA-пакет: стандарты тест-кейсов по структуре репозитория проекта (Bus77_Home, i3Pro, SCADA, HRDW, Studio, Web), тест-планы с матрицей уровней тестирования и оценкой трудозатрат, отчёты с таблицей PASSED/FAILED. Подключается по явному запросу тест-документации. |

---

## 2. Отключенные скиллы (4 выключены)

Находятся в папке [`skills/disabled/`](file:///opt/webapps/omniai/gemini_omni/prompts_and_skills/skills/disabled/).  
Они были базовыми шаблонами по умолчанию и сейчас выключены (`enabled: false`), чтобы не засорять контекстное окно модели общими абстрактными инструкциями:

1. [`01-technical-support-expert.md`](file:///opt/webapps/omniai/gemini_omni/prompts_and_skills/skills/disabled/01-technical-support-expert.md) — Базовый шаблон эксперта ТП.
2. [`03-draft-response-customer-support.md`](file:///opt/webapps/omniai/gemini_omni/prompts_and_skills/skills/disabled/03-draft-response-customer-support.md) — Общий шаблон черновиков (заменен на `06-support-customer-response`).
3. [`04-ticket-triage-customer-support.md`](file:///opt/webapps/omniai/gemini_omni/prompts_and_skills/skills/disabled/04-ticket-triage-customer-support.md) — Общий шаблон триажа (заменен на `15-support-ticket-classification` и программную классификацию).
4. [`05-customer-research-customer-support.md`](file:///opt/webapps/omniai/gemini_omni/prompts_and_skills/skills/disabled/05-customer-research-customer-support.md) — Исследование профиля клиента.
