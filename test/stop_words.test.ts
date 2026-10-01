import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyStopWordFilters,
  sanitizeCustomerDraft,
  formatCustomerDraft
} from '../server.ts';

describe('Support Stop-Words & Customer Communication Standards', () => {

  describe('Rule 1: Запрет слова "Проблема"', () => {
    test('Заменяет "У вас проблема с" на "Разберём ситуацию с"', () => {
      const input = 'У вас проблема с драйвером Modbus.';
      const output = applyStopWordFilters(input);
      assert.match(output, /Разберём ситуацию с драйвером/);
      assert.doesNotMatch(output, /проблема с/i);
    });

    test('Заменяет "Проблема из-за старой версии" на "Обновление версии улучшит работу"', () => {
      const input = 'Проблема из-за старой версии прошивки.';
      const output = applyStopWordFilters(input);
      assert.match(output, /Обновление версии улучшит работу/);
      assert.doesNotMatch(output, /проблема из-за/i);
    });

    test('Заменяет "для решения проблемы" на "для решения вопроса"', () => {
      const input = 'Для решения проблемы выполните перезагрузку.';
      const output = applyStopWordFilters(input);
      assert.match(output, /Для решения вопроса/);
      assert.doesNotMatch(output, /решения проблемы/i);
    });

    test('Заменяет "проблема на вашей стороне" на "вопрос в настройках конфигурации"', () => {
      const input = 'Похоже, проблема на вашей стороне.';
      const output = applyStopWordFilters(input);
      assert.match(output, /вопрос в настройках конфигурации/);
      assert.doesNotMatch(output, /проблема на вашей стороне/i);
    });

    test('Заменяет отдельные формы слова "проблема" на "ситуация/вопрос"', () => {
      const input = 'Мы изучим данную проблему и решим все проблемы.';
      const output = applyStopWordFilters(input);
      assert.doesNotMatch(output, /проблем/i);
      assert.match(output, /вопрос/i);
    });
  });

  describe('Rule 2: Запрет слов "Ошибка" и "Баг"', () => {
    test('Заменяет "Это ошибка в приложении" на "Обнаружено нестандартное поведение приложения"', () => {
      const input = 'Это ошибка в приложении сервера.';
      const output = applyStopWordFilters(input);
      assert.match(output, /Обнаружено нестандартное поведение приложения/);
      assert.doesNotMatch(output, /ошибка в приложении/i);
    });

    test('Слово "баг" и его склонения заменяются на "сбой"', () => {
      const input = 'В модуле обнаружен баг, разработчики исправят этот баг в следующем релизе.';
      const output = applyStopWordFilters(input);
      assert.doesNotMatch(output, /(?<![\p{L}\p{N}_])баг[а-я]*(?![\p{L}\p{N}_])/iu);
      assert.match(output, /сбой/i);
    });

    test('Множественное число "баги" заменяется на "сбои"', () => {
      const input = 'Все известные баги будут исправлены.';
      const output = applyStopWordFilters(input);
      assert.doesNotMatch(output, /(?<![\p{L}\p{N}_])баги(?![\p{L}\p{N}_])/iu);
      assert.match(output, /сбои/i);
    });
  });

  describe('Rule 3: Запрет категоричных требований ("Вы должны", "Вам надо")', () => {
    test('Заменяет "Вы должны перезагрузить сервер" на "Предлагаем выполнить перезагрузку сервера"', () => {
      const input = 'Вы должны перезагрузить сервер для применения настроек.';
      const output = applyStopWordFilters(input);
      assert.match(output, /Предлагаем выполнить перезагрузку сервера/);
      assert.doesNotMatch(output, /вы должны/i);
    });

    test('Заменяет "Вы должны" на "Рекомендуем"', () => {
      const input = 'Вы должны проверить права доступа.';
      const output = applyStopWordFilters(input);
      assert.match(output, /Рекомендуем проверить/);
      assert.doesNotMatch(output, /вы должны/i);
    });

    test('Заменяет "Вам надо" / "Вам нужно" на "Предлагаем"', () => {
      const input = 'Вам надо обновить проект. Также вам нужно сверить порты.';
      const output = applyStopWordFilters(input);
      assert.match(output, /Предлагаем обновить/);
      assert.match(output, /предлагаем сверить/);
      assert.doesNotMatch(output, /вам надо|вам нужно/i);
    });
  });

  describe('Rule 4: Запрет беспомощных фраз ("Не знаю", "Не могу помочь")', () => {
    test('Заменяет "Не знаю, как это исправить" на согласование с разработчиками', () => {
      const input = 'Не знаю, как это исправить в данный момент.';
      const output = applyStopWordFilters(input);
      assert.match(output, /Согласую с разработчиками и вернусь с решением/);
      assert.doesNotMatch(output, /не знаю/i);
    });

    test('Заменяет "Не знаю" на "Уточню у команды"', () => {
      const input = 'Не знаю точных параметров контроллера.';
      const output = applyStopWordFilters(input);
      assert.match(output, /Уточню у команды/);
      assert.doesNotMatch(output, /не знаю/i);
    });

    test('Заменяет "Не могу помочь" на уточнение у команды', () => {
      const input = 'К сожалению, не могу помочь с кастомным скриптом.';
      const output = applyStopWordFilters(input);
      assert.match(output, /уточню у команды и вернусь с ответом/i);
      assert.doesNotMatch(output, /не могу помочь/i);
    });
  });

  describe('Rule 5: Запрет тупиковых фраз ("Сложно", "Невозможно")', () => {
    test('Заменяет "Это невозможно исправить" на доработку в обновлениях', () => {
      const input = 'Это невозможно исправить без изменения архитектуры.';
      const output = applyStopWordFilters(input);
      assert.match(output, /Доработаем функционал в следующих обновлениях/);
      assert.doesNotMatch(output, /невозможно исправить/i);
    });

    test('Заменяет "Это невозможно сделать" на альтернативное решение', () => {
      const input = 'Это невозможно сделать с текущей лицензией.';
      const output = applyStopWordFilters(input);
      assert.match(output, /Предлагаю альтернативное решение/);
      assert.doesNotMatch(output, /невозможно сделать/i);
    });
  });

  describe('Rule 6: Запрет нагнетания срочности ("Срочно")', () => {
    test('Заменяет "Срочно обновите лицензию!" на конструктивную фразу', () => {
      const input = 'Срочно обновите лицензию!';
      const output = applyStopWordFilters(input);
      assert.match(output, /Рекомендуем в первую очередь обновить лицензию/);
      assert.doesNotMatch(output, /срочно/i);
    });

    test('Заменяет "Срочно обновите" на "Рекомендуем в первую очередь обновить"', () => {
      const input = 'Срочно обновите проект на сервере.';
      const output = applyStopWordFilters(input);
      assert.match(output, /Рекомендуем в первую очередь обновить проект/);
      assert.doesNotMatch(output, /срочно/i);
    });
  });

  describe('Rule 7: Запрет технического сленга ("крашится", "глючит")', () => {
    test('Заменяет "Сервер крашится" на профессиональную формулировку', () => {
      const input = 'Сервер крашится при запуске скрипта.';
      const output = applyStopWordFilters(input);
      assert.match(output, /На сервере происходит незапланированное завершение работы/);
      assert.doesNotMatch(output, /крашится/i);
    });

    test('Заменяет "глючит" / "глючат" на "работает некорректно"', () => {
      const input = 'Интерфейс часто глючит, а виджеты глючат при свайпе.';
      const output = applyStopWordFilters(input);
      assert.match(output, /работает некорректно/);
      assert.match(output, /работают некорректно/);
      assert.doesNotMatch(output, /глючит|глючат/i);
    });
  });

  describe('Rule 8: Запрет "К сожалению" в начале фразы', () => {
    test('Заменяет "К сожалению, это баг" на благодарность и передачу команде', () => {
      const input = 'К сожалению, это баг в версии 1.4.';
      const output = applyStopWordFilters(input);
      assert.match(output, /Благодарим за информацию! Передадим команде на исправление/);
      assert.doesNotMatch(output, /к сожалению/i);
    });

    test('Заменяет "К сожалению," в начале предложения на позитивное начало', () => {
      const input = 'К сожалению, на данный момент данные не сохранились.';
      const output = applyStopWordFilters(input);
      assert.match(output, /Благодарим за обращение!/);
      assert.doesNotMatch(output, /к сожалению/i);
    });
  });

  describe('Rule 9: Запрет споров с клиентом ("Вы меня не поняли", "Вы не правы")', () => {
    test('Заменяет "Вы меня не поняли" на "Позвольте пояснить подробнее"', () => {
      const input = 'Вы меня не поняли, я имел в виду настройки шлюза.';
      const output = applyStopWordFilters(input);
      assert.match(output, /Позвольте пояснить подробнее/);
      assert.doesNotMatch(output, /вы меня не поняли/i);
    });

    test('Заменяет "Вы не правы" на "Давайте уточним детали"', () => {
      const input = 'Вы не правы, протокол работает иначе.';
      const output = applyStopWordFilters(input);
      assert.match(output, /Давайте уточним детали/);
      assert.doesNotMatch(output, /вы не правы/i);
    });
  });

  describe('Rule 10: Запрет отсылок к справке ("Читайте инструкцию")', () => {
    test('Заменяет "Читайте инструкцию" на дружелюбное предложение разобрать вместе', () => {
      const input = 'Читайте инструкцию на странице 12.';
      const output = applyStopWordFilters(input);
      assert.match(output, /Делюсь ссылкой на пошаговую инструкцию и готов помочь с каждым шагом:/);
      assert.doesNotMatch(output, /читайте инструкцию/i);
    });

    test('Заменяет "Это написано в справке" на ссылку на материал', () => {
      const input = 'Это написано в справке к модулю.';
      const output = applyStopWordFilters(input);
      assert.match(output, /Делюсь ссылкой на справочный материал/);
      assert.doesNotMatch(output, /это написано в справке/i);
    });
  });

  describe('Rule 11: Запрет упрёков о прошлых ответах ("Как я уже говорил")', () => {
    test('Заменяет "Как я уже говорил" на "Продублирую:"', () => {
      const input = 'Как я уже говорил, перепроверьте токен.';
      const output = applyStopWordFilters(input);
      assert.match(output, /Продублирую: перепроверьте токен/);
      assert.doesNotMatch(output, /как я уже говорил/i);
    });

    test('Заменяет "Я уже писал вам, нажмите..." на вежливое напоминание', () => {
      const input = 'Я уже писал вам, нажмите красную кнопку для сброса.';
      const output = applyStopWordFilters(input);
      assert.match(output, /Продублирую: нажмите красную кнопку для сброса\./);
      assert.doesNotMatch(output, /я уже писал/i);
    });
  });

  describe('Rule 12: Запрет отказа по зоне ответственности', () => {
    test('Заменяет "Это не наша зона ответственности" на содействие', () => {
      const input = 'Это не наша зона ответственности, настраивайте роутер сами.';
      const output = applyStopWordFilters(input);
      assert.match(output, /Сориентирую, какие шаги можно предпринять дальше/);
      assert.doesNotMatch(output, /это не наша зона ответственности/i);
    });

    test('Заменяет "Мы этим не занимаемся" на содействие', () => {
      const input = 'Мы этим не занимаемся в рамках базовой поддержки.';
      const output = applyStopWordFilters(input);
      assert.match(output, /Сориентирую, какие шаги можно предпринять дальше/);
      assert.doesNotMatch(output, /мы этим не занимаемся/i);
    });
  });

  describe('Правила «Как правильно» (Обвинения & Негатив)', () => {
    test('Устраняет прямое обвинение "Вы неправильно настроили драйвер"', () => {
      const input = 'Вы неправильно настроили драйвер при установке.';
      const output = applyStopWordFilters(input);
      assert.match(output, /Проверим настройки драйвера вместе/);
      assert.doesNotMatch(output, /вы неправильно настроили/i);
    });

    test('Устраняет формулировки "Ваша ошибка" и "Ошибка пользователя"', () => {
      const input = 'Ваша ошибка заключается в неверном IP. Это ошибка пользователя.';
      const output = applyStopWordFilters(input);
      assert.doesNotMatch(output, /ваша ошибка|ошибка пользователя/i);
      assert.match(output, /нестандартное поведение/i);
      assert.match(output, /особенность настройки/i);
    });
  });

  describe('Техническая целостность (Кодовые блоки и идентификаторы)', () => {
    test('Не модифицирует код внутри обратных кавычек `...`', () => {
      const input = 'Обратите внимание на вызов `const bug = true;` и `throw new Error("Проблема");` в скрипте.';
      const output = applyStopWordFilters(input);
      assert.match(output, /`const bug = true;`/);
      assert.match(output, /`throw new Error\("Проблема"\);`/);
    });

    test('Не модифицирует многострочные блоки кода ```...```', () => {
      const codeBlock = '```javascript\nfunction handleBug() {\n  return "проблема";\n}\n```';
      const input = `Вот пример функции:\n${codeBlock}\nВы должны его протестировать.`;
      const output = applyStopWordFilters(input);
      assert.ok(output.includes(codeBlock), 'Кодовый блок должен остаться неизменным');
      assert.match(output, /Рекомендуем его протестировать/);
      assert.doesNotMatch(output, /вы должны/i);
    });
  });

  describe('Интеграция с конвейером подготовки клиентского ответа', () => {
    test('sanitizeCustomerDraft применяет applyStopWordFilters', () => {
      const rawDraft = ':::writing\nУ вас проблема с базой данных. Вы должны срочно обновить проект.\n:::';
      const sanitized = sanitizeCustomerDraft(rawDraft);
      assert.doesNotMatch(sanitized, /:::/);
      assert.doesNotMatch(sanitized, /проблема с/i);
      assert.doesNotMatch(sanitized, /вы должны/i);
      assert.doesNotMatch(sanitized, /срочно/i);
      assert.match(sanitized, /Разберём ситуацию с базой данных/);
    });

    test('formatCustomerDraft применяет стоп-слова и сохраняет номер тикета', () => {
      const rawDraft = 'По обращению #123-456789. К сожалению, у вас возникла проблема с панелью. Вы должны перезагрузить сервер.';
      const formatted = formatCustomerDraft(rawDraft, '123-456789', true);
      assert.match(formatted, /#123-456789/);
      assert.doesNotMatch(formatted, /к сожалению/i);
      assert.doesNotMatch(formatted, /проблема с/i);
      assert.doesNotMatch(formatted, /вы должны/i);
      assert.match(formatted, /Предлагаем выполнить перезагрузку сервера/);
    });
  });

});
