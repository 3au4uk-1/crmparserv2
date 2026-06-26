# Историческая выгрузка сделок в Excel — дизайн

**Дата:** 2026-06-26  
**Статус:** Утверждён к написанию плана реализации

## Контекст и проблема

В проекте `crmparserv2` обычный парсинг (`runParsing`) работает только **вперёд от сегодня**:
`normalizeParseRange()` не даёт выбрать прошлые даты. Результат парсинга сохраняется в SQLite и проходит
воронку одобрения / синхронизации с Twenty CRM.

Пользователю нужен **отчёт за произвольный прошлый период** по сделкам брендинга. Эти сделки **сейчас
отсутствуют в локальной БД** — их нужно получить из календаря CRM (и Tony при наличии брони), отфильтровать
по ключевым словам и выдать в Excel. Данные **не должны сохраняться** в парсере и **не должны попадать**
в одобрение или Twenty.

## Цель и нецели

**Цель:** отдельная страница «Выгрузка», на которой пользователь задаёт период (и опционально компанию),
запускает фоновую задачу, видит прогресс и скачивает `.xlsx` с двумя листами.

**Нецели:**

- Не записываем сделки и позиции в таблицы `deals` / `deal_items`.
- Не вызываем `syncDealToTwenty`, `processAutoApprovals`, отмену в Twenty.
- Не используем LLM-классификацию (только `classifyByKeywords`).
- Не дублируем UI страницы «Сделки» — отдельный маршрут `/export`.
- Не фильтруем по `approval_status` (сделки вне воронки одобрения).

## Требования (сводка из brainstorming)

| Параметр | Решение |
|----------|---------|
| Источник данных | Календарь CRM (+ Tony для броней), on-demand |
| Хранение | Только in-memory на время задачи; файл во временной папке |
| Период дат | Любой, включая прошлое; без clamp «не раньше сегодня» |
| Критерий сделки | ≥1 позиция `keyword_match`, не в blacklist |
| Позиции в Excel | Только `keyword_match` без blacklist |
| Фильтр компании | Опционально по `company_code` |
| UI | Отдельная страница `/export`, фоновая задача с прогрессом |
| Язык | Заголовки колонок и имя файла на русском |
| Имя файла | `сделки_YYYY-MM-DD_YYYY-MM-DD.xlsx` |

## Выбранный подход

**Подход B (утверждён):** фоновая задача с polling статуса и скачиванием готового файла.

Альтернативы, отклонённые:

- **Синхронная выгрузка** — риск HTTP-таймаута на больших периодах.
- **Чтение из SQLite** — не подходит: исторические сделки не распарсены.
- **Обычный `runParsing` за прошлый период** — пишет в БД и запускает Twenty/одобрение.

## Архитектура

```
frontend/src/pages/Export.jsx
    POST /api/export              → { jobId }
    GET  /api/export/:jobId       → статус + прогресс (poll 2s)
    GET  /api/export/:jobId/file  → .xlsx

backend/src/routes/export.js
backend/src/services/export-jobs.js      — реестр задач, temp-файлы
backend/src/services/historical-export.js — парсинг in-memory + exceljs
backend/src/utils/crm-dates.js           — normalizeExportRange()
```

### Поток данных

```
1. authenticate CRM (+ Tony если настроен)
2. fetchEvents(from, to)                    — без ограничения на прошлое
3. для каждого события in-range:
     fetchEventData / prefetchAll
     desiredDealKeys → сборка сделок в памяти (Tony приоритетнее календаря)
     classifyByKeywords
     отбор позиций: keyword_match && !isBlacklisted
     отбор сделок: ≥1 подходящая позиция
     фильтр company_code (если задан)
4. exceljs → data/exports/<jobId>.xlsx
5. статус → completed
```

### Блокировка CRM

Расширить `parsing-lock.js` до общего lock «CRM-операция в процессе» (или переиспользовать тот же flag):
парсинг и выгрузка **взаимоисключающие**. При занятом lock → `409 Conflict`.

### Временные файлы

- Директория: `data/exports/`
- Имя: `<jobId>.xlsx`
- Удаление: после успешного скачивания **или** через 1 час (TTL при старте сервера / периодическая очистка)

### In-memory сделка (без БД)

Структура для генерации Excel:

```js
{
  exportId: 'crmEventId#booking',  // или '#cal'
  title, company_code, manager_name,
  start_date, budget,
  items: [{ name, price, quantity, sum }]
}
```

`exportId` используется как «ID сделки» на листе «Позиции».

## API

### `POST /api/export`

**Body:** `{ from: "YYYY-MM-DD", to: "YYYY-MM-DD", company?: "ПРО" }`

**Ответ `201`:** `{ jobId: "uuid" }`

**Ошибки:**

- `400` — невалидные/отсутствующие даты, `from > to`
- `409` — парсинг или другая выгрузка уже выполняется

### `GET /api/export/:jobId`

**Ответ:**

```json
{
  "jobId": "...",
  "status": "queued|running|completed|failed",
  "from": "2025-01-01",
  "to": "2025-03-31",
  "company": "ПРО",
  "progress": {
    "eventsTotal": 120,
    "eventsDone": 45,
    "dealsMatched": 12
  },
  "error": null,
  "createdAt": "...",
  "completedAt": null
}
```

### `GET /api/export/:jobId/file`

- `200` — `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`,  
  `Content-Disposition: attachment; filename="сделки_....xlsx"`
- `404` — задача не найдена или ещё не `completed`
- `410` — файл уже удалён по TTL (опционально)

### `GET /api/export/active` (опционально)

Возвращает активную (`queued`/`running`) задачу текущего инстанса — для восстановления UI после перезагрузки
страницы. Одна активная задача на инстанс достаточно.

Все маршруты под `appAuthMiddleware`, как остальные `/api/*`.

## Excel

### Лист «Сделки»

Одна строка на сделку. Сортировка: `start_date` DESC.

| Колонка | Источник |
|---------|----------|
| Дата начала | `start_date` → `DD.MM.YYYY` |
| Название | `title` |
| Компания | `company_code` |
| Менеджер | `manager_name` |
| Бюджет | `budget` |

Колонка «Статус одобрения» **не включается** — сделки вне воронки.

### Лист «Позиции»

Только `keyword_match` без blacklist. Сортировка: `exportId`, затем имя позиции.

| Колонка | Источник |
|---------|----------|
| ID сделки | `exportId` |
| Название сделки | `title` |
| Позиция | `name` |
| Цена | `price` |
| Количество | `quantity` |
| Сумма | `sum` |

Первая строка каждого листа — жирные русские заголовки, автоширина колонок.

### Пустой результат

Если после фильтрации сделок нет → статус `completed`, файл с пустыми листами (только заголовки) **или**
`failed` с сообщением «За выбранный период сделок не найдено».  
**Решение:** `completed` + пустые листи с заголовками; UI показывает предупреждение перед скачиванием.

## Frontend (`/export`)

- Форма: дата от, дата до (обязательные), компания (select, опционально)
- Кнопка «Запустить выгрузку» → `POST /api/export`
- Прогресс: «Обработано N из M событий, найдено K сделок»
- По `completed` — кнопка «Скачать Excel»
- По `failed` — текст ошибки
- Poll `GET /api/export/:jobId` каждые 2 с через React Query (`refetchInterval`)
- Пункт навигации «Выгрузка» в `App.jsx`

## Переиспользование кода

Из `parser.js`:

- `fetchEvents`, `fetchEventData`, `prefetchAll` (если `parsePipeline === 'parallel'`)
- `authenticate` из `auth.js`, `tonyLogin` из `tony-auth.js`

Из `tony-reconcile.js`:

- `desiredDealKeys` (без `planEventReconciliation` — БД не нужна)

Из `tony-mapping.js`, `html-parser.js`, `title-parser.js`:

- `buildTonyDealFields`, `buildTonyItems`, `parseDealDescription`, `parseDealTitle`

Из `classifier.js`:

- `classifyByKeywords` (не `classifyItems`)

Из `blacklist.js`:

- `loadBlacklist`, `isBlacklisted`

Новое:

- `buildExportDeals(event, eventId, data, keywords, blacklist)` — чистая функция, зеркалит ветки Tony/календарь
  из `applyEvent`, но без SQL
- `normalizeExportRange(from, to)` — как `normalizeParseRange`, **без** clamp к `getMinParseStart`

## Зависимости

- `exceljs` в `backend/package.json`

## Обработка ошибок

| Ситуация | Поведение |
|----------|-----------|
| CRM auth failed | `failed`, сообщение в `error` |
| Tony недоступен | fallback на календарь (как в парсере) |
| Событие без описания | пропуск, счётчик `eventsDone`++ |
| Lock занят | `409` на POST |
| Сервер перезапущен mid-job | задача теряется (in-memory); UI показывает «задача не найдена» |

## Тестирование

1. `normalizeExportRange` — прошлые даты не обрезаются.
2. `buildExportDeals` — Tony vs календарь, keyword_match, blacklist exclusion.
3. `export-jobs` — lifecycle queued → running → completed.
4. Lock — export отклоняется при активном парсинге и наоборот.
5. Excel — заголовки на русском, два листа, корректное число строк.

## Будущая работа (вне scope)

- Персистентные задачи в SQLite (переживают рестарт).
- Лимит максимального периода за один запуск.
- Email-уведомление по готовности.
