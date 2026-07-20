# Выгрузка заказов из Twenty в Excel — дизайн

**Дата:** 2026-07-20  
**Статус:** Утверждён к написанию плана реализации

## Контекст и проблема

В `crmparserv2` уже есть историческая Excel-выгрузка (`/export`) из календаря CRM (+ Tony). Она **не читает
Twenty** и не отражает актуальные стадии, ссылки на макеты и ручные правки позиций в CRM.

Пользователю нужна выгрузка заказов **за произвольный период дат** в формате, близком к производственной
таблице брендинга, с данными из **Twenty CRM** как источника правды после синхронизации.

## Цель и нецели

**Цель:** отдельная страница админки, на которой задаётся период (и опция «включая отмены»), запускается
фоновая задача, скачивается `.xlsx`: одна строка = одна позиция заказа из Twenty.

**Нецели:**

- Не менять календарную выгрузку `/export` и её контракт.
- Не писать в SQLite `deals` / `deal_items` и не запускать sync/approval.
- Не выгружать в Google Sheets (это print-sheet export).
- Не копировать цветное оформление и разделители дат из производственной таблицы.
- Не добавлять фильтр по компании в v1.
- Не выгружать из локальной БД как основной источник (только Twenty GraphQL).

## Требования (сводка из brainstorming)

| Параметр | Решение |
|----------|---------|
| Источник | Twenty GraphQL: `dealLineItems` + nested `opportunity` |
| Гранулярность | Одна строка = одна позиция (`dealLineItem`) |
| Период | `from`–`to` включительно |
| Дата строки / фильтр | `opportunity.closeDate`, если пусто — `loadDate`; без обеих дат — skip |
| Статус | `dealLineItem.stage`, если пусто — `opportunity.stage`; русская подпись |
| Отмены | По умолчанию исключать эффективный статус `OTMENA`; чекбокс включает |
| Комментарий | `kommentariy`, если пусто — `kommentariyDlyaPechati` |
| Цена | Две колонки: цена за ед. + сумма позиции (цена × количество) |
| Формат Excel | Один лист, русские заголовки, без цветов/разделителей |
| UI | Отдельная страница `/export-twenty` |
| Имя файла | `twenty_заказы_YYYY-MM-DD_YYYY-MM-DD.xlsx` |

## Выбранный подход

**Подход 1 (утверждён):** отдельная страница + сервис поверх Twenty GraphQL + job/Excel по паттерну
исторической выгрузки.

Альтернативы, отклонённые:

- **Переключатель на `/export`** — смешивает два источника; пользователь явно выбрал отдельную страницу.
- **SQLite + догрузка из Twenty** — теряются ручные позиции и актуальные поля, только частично синхронизированные сделки.

## Архитектура

```
frontend/src/pages/ExportTwenty.jsx
    POST /api/export/twenty              → { jobId }
    GET  /api/export/twenty/:jobId       → статус + прогресс
    GET  /api/export/twenty/:jobId/file  → .xlsx
    GET  /api/export/twenty/active       → активная задача (опционально)

backend/src/routes/export-twenty.js      — или расширение routes с отдельным префиксом
backend/src/services/twenty-export.js    — GraphQL fetch + row mapping + exceljs
backend/src/services/export-jobs.js      — переиспользовать реестр задач / TTL файлов
                                           (отдельный namespace ключей job, без parsing-lock)
```

### Поток данных

```
1. validate range + Twenty credentials
2. paginated GraphQL: все dealLineItems (поля + opportunity { name, closeDate, loadDate, stage, tonyLink, bitrixLink })
   — в v1 фильтр по дате и отменам **в памяти** после fetch (проще, чем полагаться на nested filter GraphQL).
     При росте объёма можно сузить запрос filter'ом по opportunity позже.
3. для каждой позиции:
     effectiveDate = closeDate || loadDate
     skip если нет effectiveDate
     skip если вне [from, to]
     effectiveStage = lineItem.stage || opportunity.stage
     skip если !includeCancelled && effectiveStage === OTMENA
4. sort: date ASC, opportunity.name, lineItem.name
5. exceljs → data/exports/<jobId>.xlsx
6. status → completed
```

### Блокировка

Календарная выгрузка и парсинг используют `parsing-lock`. Twenty-выгрузка **не** занимает этот lock и
**не** блокируется им: источник другой (Twenty API), конфликта с CRM calendar auth нет.

Одновременно допускается одна активная Twenty-export job на инстанс (как у calendar export) — повторный
`POST` при `queued`/`running` → `409`.

### Временные файлы

Как у исторической выгрузки: `data/exports/<jobId>.xlsx`, TTL ~1 час / удаление после скачивания.

## API

Все маршруты под `appAuthMiddleware`.

Маршруты монтируются как **отдельный префикс** `/api/export/twenty`, чтобы не конфликтовать с
существующим `GET /api/export/:jobId` (иначе `twenty` воспримется как `jobId`). Либо регистрировать
статические пути `/export/twenty*` **выше** `/:jobId` в том же роутере.

### `POST /api/export/twenty`

**Body:** `{ from: "YYYY-MM-DD", to: "YYYY-MM-DD", includeCancelled?: boolean }`

`includeCancelled` по умолчанию `false`.

**Ответ `201`:** `{ jobId: "uuid" }`

**Ошибки:**

- `400` — невалидные даты, `from > to`
- `409` — уже есть активная Twenty-export job
- `503` / `failed` — нет или невалидны credentials Twenty (можно отдать сразу `400`/`503` до создания job)

### `GET /api/export/twenty/:jobId`

```json
{
  "jobId": "...",
  "status": "queued|running|completed|failed",
  "from": "2026-06-01",
  "to": "2026-06-30",
  "includeCancelled": false,
  "progress": {
    "pagesFetched": 3,
    "lineItemsFetched": 240,
    "rowsWritten": 180
  },
  "error": null,
  "createdAt": "...",
  "completedAt": null
}
```

### `GET /api/export/twenty/:jobId/file`

- `200` — `.xlsx`, `Content-Disposition` с русским именем файла
- `404` — нет задачи / ещё не `completed`
- `410` — файл удалён по TTL

### `GET /api/export/twenty/active`

Активная `queued`/`running` задача Twenty-export (для восстановления UI после reload).

## Excel

Один лист (например «Заказы»). Первая строка — жирные русские заголовки, автоширина колонок.
Ссылки — как кликабельные hyperlink в exceljs, если URL непустой.

| Колонка | Источник |
|---------|----------|
| Дата | `closeDate \|\| loadDate` → `DD.MM.YYYY` |
| Название | `opportunity.name` |
| Позиция | `dealLineItem.name` |
| Ссылка на макет | `ssylkaNaMakety` (LINK → primary URL) |
| Комментарий | `kommentariy` → иначе `kommentariyDlyaPechati` |
| Цена за ед. | `dealLineItem.amount` (число; из currency micros как в sync) |
| Сумма позиции | цена за ед. × количество (`kolichestvo`); если кол-во пусто — `null`/пусто |
| Количество | `kolichestvo` |
| Статус | эффективный stage → label из `OPPORTUNITY_STAGE_OPTIONS` (и line-item stages, если отличаются) |
| Ссылка на тони | `tonyLink.primaryLinkUrl` |
| Ссылка на битрикс | `bitrixLink.primaryLinkUrl` |

**Сортировка:** дата ↑, название заказа, название позиции.

**Пустой результат:** `completed` + файл только с заголовками; UI может показать предупреждение.

## Frontend (`/export-twenty`)

- Форма: дата от, дата до; чекбокс «включая отмены» (default off)
- Кнопка «Сформировать» → `POST /api/export/twenty`
- Poll статуса каждые ~2 с
- По `completed` — «Скачать Excel»
- По `failed` — текст ошибки
- Пункт навигации рядом с «Выгрузка» (например «Выгрузка Twenty»)

## Переиспользование кода

- `twenty-gql.js`, `twenty-config.js`, `twenty-rate-limit.js` — запросы и лимиты
- `print-sheet-export-twenty.js` — образец полей `dealLineItems` / nested opportunity / LINK
- `export-jobs.js` — lifecycle job + файлы (расширить namespace или параметром `kind: 'twenty'`)
- `OPPORTUNITY_STAGE_OPTIONS` / `CANCELLED_OPPORTUNITY_STAGE` из `twenty-opportunity.js`
- `exceljs` — как в `historical-export.js` (отдельная функция сборки workbook, другие колонки)

Новое:

- `twenty-export.js` — fetch, filter, map rows, build workbook
- `ExportTwenty.jsx` + route
- `routes/export-twenty.js` (или вложенные пути без конфликта с `/api/export/:jobId`)

## Обработка ошибок

| Ситуация | Поведение |
|----------|-----------|
| Нет Twenty credentials | ошибка до/в начале job, понятное сообщение |
| Невалидный диапазон | `400` |
| Rate-limit / transient GraphQL | retry через `twenty-gql` |
| Фатальная ошибка GraphQL | `failed` + `error` |
| Пустой набор строк | `completed` + Excel только с заголовками |
| Рестарт сервера mid-job | in-memory job теряется; UI «задача не найдена» |
| Параллельно с calendar export / parsing | разрешено |

## Тестирование

1. Выбор даты: closeDate → loadDate → skip без дат; фильтр диапазона.
2. Статус: stage позиции → stage заказа; русские лейблы; `OTMENA` filter on/off.
3. Комментарий: общий → fallback печатный.
4. Сумма позиции = цена × кол-во; пустые/нулевые edge cases.
5. Маппинг колонок / заголовки; пустой результат = только header row.
6. (Опционально) мок GraphQL → файл читается, ожидаемые колонки на месте.

## Будущая работа (вне scope)

- Фильтр по компании / менеджеру.
- Цвета статусов и разделители дат как в производственной таблице.
- Фильтр по `dataGotovnostiPechati`.
- Персистентные jobs в SQLite.
- Кнопка выгрузки из Twenty App / gear menu.
