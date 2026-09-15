# Ускорение парсинга Tony: probe `updated_at` + конкурентность 8 — дизайн

**Дата:** 2026-09-15  
**Статус:** Утверждён к написанию плана реализации  
**Репозиторий:** `crmparserv2`  
**Связанные спеки:** `2026-06-20-parsing-optimization-design.md`, `2026-06-21-parse-schedule-optimization-design.md`, `2026-09-14-twenty-sync-speed-design.md`

## Проблема

Прод, weekday-fast 15.09.2026 12:00 МСК (`2026-09-15..2026-09-22`):

| Фаза | Время | Факт |
|------|-------|------|
| Prefetch Tony/календарь | **777 с** | `FETCH_CONCURRENCY=2`, 190 событий |
| Apply SQLite | **~1 с** | |
| Twenty (14 сделок) | **~5 с** | уже ускорен |
| Печатный лист | ~5 мин | квота Google Sheets, **не в этой работе** |

`content_hash` отсекает запись, но **после** полной загрузки: страница `orders_edit` (~0.8–1.1 МБ) + 8 категорий + склад. Из 190 заказов изменились 11. 179 скачали целиком, чтобы узнать, что ничего не менялось.

`FETCH_CONCURRENCY=2` на проде — июльский троттл «не мешать Twenty». Twenty больше не узкое место.

HAR брони `158490` (`crm.apihide.com.har`, 197 запросов браузера):

- Парсеру из них нужны страница + `order_products_list` × 8 + `order_sklad_list`.
- Рядом есть **`POST /ajax/order_get_info.php`** (~47 КБ, ~0.9 с): JSON с `timestamps.updated_at`, датами, адресом, суммой и кратким списком позиций (**без комментариев, скидки, категории, work_time**).
- `get_order_data.php` ещё беднее (неполный набор позиций, без комментариев) — не источник истины.
- Кэша нет: `Cache-Control: no-store`, ETag/Last-Modified пустые.

Полностью заменить HTML-парсинг JSON нельзя: свободная запись живёт в комментарии строки таблицы.

## Цели

- Типичный weekday-fast (~190 событий, мало изменений): prefetch **≤ 2 мин** после выкладки; ориентир **&lt; 1 мин**, если skip-rate высокий и conc=8.
- Не качать страницу и 9 таблиц, если `timestamps.updated_at` совпал с сохранённым для уже существующей Tony-сделки.
- Не менять смысл сверки: `content_hash`, комментарии, free-entry, reconcile, отмены по календарю/титулу, Twenty post-parse.
- Поднять пул запросов: **`FETCH_CONCURRENCY` default и прод = 8** (июльский `2` больше не нужен).

## Не в scope

- Печатный лист / квота Google Sheets.
- Пропуск `cal_description.php` (платежи и контакт календаря живут отдельно от Tony stamp).
- Замена HTML-парсера на `offers_summary` / `get_order_data`.
- Probe в `import-by-booking` и `attach-tony-booking` (единичный заказ, всегда полный fetch).
- Legacy `PARSE_PIPELINE=legacy`.
- Параллельный SQLite apply.
- Смена формулы `content_hash`.

## Подход

Выбран **дешёвый probe + полный HTML только если штамп новый + conc=8**.

Отклонено:

- Только поднять conc до 8: время упадёт (~3–4×), **объём** запросов/трафика тот же.
- Парсить позиции из `order_get_info.offers_summary`: нет комментариев → ломает свободную запись.
- `order_products_sum.php` как fingerprint: ~900 мс на вызов, нет дат/адреса, хуже `get_info`.

```
prefetch (parallel, FETCH_CONCURRENCY=8)
  на каждый booking:
    POST /ajax/order_get_info.php
    если deleted/404/нет тела → как сейчас (нет записи в tonyOrders)
    если data_source=tony и deals.tony_updated_at === timestamps.updated_at
         → не качать orders_edit и таблицы
    иначе → fetchTonyOrderHtml как сейчас, parseTonyOrder, запомнить stamp
  cal_description — как сейчас, на каждое событие
        ↓
apply (sequential)
  нет tonyOrders[booking] + existing Tony → сохранить тело, обновить только платежи календаря
  есть parsed order → content_hash как сейчас; всегда записать tony_updated_at
        ↓
post-parse Twenty — без изменений
```

## Компоненты

| Файл | Изменение |
|------|-----------|
| `backend/src/config.js`, `.env.example`, `docker-compose.yml` | `FETCH_CONCURRENCY` default **8**; `TONY_UNCHANGED_PROBE` default **true** |
| `backend/src/db/schema.sql`, `migrate.js` | колонка `deals.tony_updated_at TEXT` |
| `backend/src/services/tony-client.js` | `fetchTonyOrderInfo(bookingNumber, { run })` |
| `backend/src/services/tony-unchanged.js` | чистая `shouldSkipTonyFullFetch`, `loadTonyUpdatedAtMap(db)` |
| `backend/src/services/parser.js` | probe в parallel prefetch; persist stamp в apply |
| `ops/perf/crmparser-throttle.md` | пометить `FETCH_CONCURRENCY=2` как устаревшее для Tony |

`fetchTonyOrderHtml` не меняет контракт для import/attach.

## Probe `order_get_info`

`POST {TONY_BASE_URL}/ajax/order_get_info.php`  
`Content-Type: application/x-www-form-urlencoded`  
тело: `order_id=<bookingNumber>`  
те же куки/заголовки, что у остальных Tony AJAX; тот же `run`/`withRetry`.

Успех: HTTP 200, JSON `{ success: true, data: { timestamps: { updated_at, created_at }, deleted, ... } }`.

Интерпретация:

| Ответ | Поведение |
|-------|-----------|
| 404 / redirect notfound | как `fetchTonyOrderHtml` → null: не класть в `tonyOrders` |
| `data.deleted === true` | то же, что notfound |
| `success: false` / нет `data` | ошибка заказа: лог, не класть в `tonyOrders` (как сетевой fail HTML) |
| redirect login | throw session expired (как сейчас) |
| 429 / 5xx / сеть | `withRetry`, затем как fail заказа |
| есть `timestamps.updated_at` | строка **как пришла** (без нормализации TZ); сравнивать с SQLite `===` |

`shouldSkipTonyFullFetch` возвращает true только если **все** условия:

- `TONY_UNCHANGED_PROBE` включён;
- probe успешен, не deleted/notfound;
- в карте есть stamp для этого booking;
- `data_source` этой сделки `'tony'`;
- `existingStamp === probe.updatedAt`.

Иначе полный HTML. Новая бронь, пустой stamp после миграции, calendar-сделка с номером в титуле — всегда полный fetch.

Пропуск HTML = **не класть** booking в `tonyOrders`. `applyEvent` уже в ветке «нет Tony-заказа + existing `data_source=tony`» не затирает тело и обновляет платежи календаря. Это тот же путь, что при временном 404.

## Persist `tony_updated_at`

Писать stamp **каждый раз**, когда полный HTML реально скачали и заказ распарсили (в т.ч. когда `content_hash` совпал — менеджер открыл бронь, штамп прыгнул, позиции те же). Иначе skip никогда не стабилизируется.

На create/update Tony-сделки — в том же `INSERT`/`UPDATE`.  
На hash-match после полного fetch — отдельный `UPDATE deals SET tony_updated_at = ? WHERE id = ?`.  
На prefetch-skip — колонку не трогать (уже верная).

## Конкурентность

| Где | Было | Станет |
|-----|------|--------|
| `config.fetchConcurrency` / compose default | 4 | **8** |
| Прод Dokploy env `FETCH_CONCURRENCY` | 2 (throttle 2026-07-31) | **8** |
| `TONY_UNCHANGED_PROBE` | нет | **true** (выкл: `false` / `0` / `no`) |

`TONY_REQUEST_DELAY_MS` по-прежнему только для legacy.

Откат: `TONY_UNCHANGED_PROBE=false` и/или `FETCH_CONCURRENCY=4`. При 429 Tony — backoff уже есть; снизить conc до 4.

## Ошибки

- Probe упал, HTML не трогаем: как сегодняшний fail `fetchTonyOrderHtml` — нет записи в карте, существующая Tony-сделка жива. Не эскалировать в 10 тяжёлых запросов.
- HTML упал после успешного probe: нет записи в карте (не писать новый stamp).
- Пустой `items` после HTML: как сейчас (warn, skip update), stamp **не** писать.

## Наблюдаемость

Один итог prefetch:

```text
[parse] prefetch done {"events":N,"ms":N,"tony_probe":N,"tony_skip":N,"tony_full":N,"tony_probe_fail":N,"concurrency":8}
```

- `tony_skip` — HTML не качали из-за совпадения stamp.  
- `tony_full` — качали страницу+таблицы.  
- `tony_probe` — успешные get_info.  
- `tony_probe_fail` — ошибки/retry exhaustion.

Цель на втором часовом прогоне после выкладки: `tony_skip` ≈ skipped deals (порядок 170+ из 190), `ms` ≪ 777000. Если `tony_skip=0` при `tony_probe≈190` — `get_info` сам двигает `updated_at` или stamp не пишется; выключить probe env, не откатывать conc=8.

## Тесты (Vitest, без живого Tony)

- `fetchTonyOrderInfo`: 200 + `updated_at`; 404 → notfound; `deleted: true`; login redirect throw; HTML fetch не вызывается из info.
- `shouldSkipTonyFullFetch`: true только на точном совпадении stamp + tony; false для новой брони, calendar, пустого stamp, выключенного флага, notfound.
- Prefetch: при skip `orders_edit` / `order_products_list` не вызываются; календарное описание вызывается; `tonyOrders` без этого booking.
- Prefetch: stamp другой → HTML как сейчас, parsed items с комментарием из таблицы.
- Apply: полный fetch + тот же content_hash → `tony_updated_at` обновлён, items не переписываются.
- Apply: skip (нет order) + existing tony → тело/items без изменений.
- Equivalence-тест prefetch без probe (флаг false) остаётся зелёным.
- Конфиг: default conc 8, probe true.

## Выкладка

1. Код + `FETCH_CONCURRENCY=8` + `TONY_UNCHANGED_PROBE=true` на прод.  
2. Первый weekday-fast: `tony_skip` может быть 0 (колонка пустая) — ожидаемо; `ms` уже ниже за счёт conc=8.  
3. Второй прогон: смотреть `tony_skip` / `ms`.  
4. Откат probe: env false, без отката колонки.

## Критерий готовности

Юнит-тесты зелёные. На проде второй hourly fast: prefetch заметно меньше 777 с, skip-rate ненулевой **или** явное решение выключить probe после лога `tony_skip=0`. Смысл сделок (позиции, комментарии, даты, Twenty) совпадает с прогоном без skip.
