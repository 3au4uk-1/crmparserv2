# Ускорение синка сделок в Twenty после парсинга — дизайн

**Дата:** 2026-09-14  
**Статус:** Утверждён к написанию плана реализации  
**Репозитории:** `crmparserv2` (синк), Dokploy compose Twenty (серверный rate limit)  
**Связанные спеки:** `2026-06-09-deal-resync-design.md`, `2026-06-20-parsing-optimization-design.md`, `2026-07-03-bulk-resync-filters-design.md`

## Проблема

Парсинг Tony уже параллельный и занимает минуты. Пост-парсинговый синк в Twenty занимает около часа и упирается в следующий `weekday-fast` (каждый час 9–21 МСК).

Узкое место — не Tony и не SQLite, а запись в Twenty:

1. **Серверный лимит API-ключа Twenty:** `API_RATE_LIMITING_LONG_LIMIT = 100` токенов / 60 с (`Limit reached (100 tokens per 60000 ms)`). Лимит действует на API-ключ, не на UI-сессии пользователей.
2. **Логика синка шлёт лишние мутации.** Identity-diff считает «позиция есть» = `updateDealLineItem`, даже если поля не изменились. Opportunity пишется дважды (полный update, затем list + amount). Печатный лист гоняется после **каждой** сделки в `parser.js` (bulk-resync это уже вынес в конец). Между сделками искусственная пауза 1 с. Позиции пишутся по одной, без `createMany` / `deleteMany` / upsert-пачек.

Клиентский `TWENTY_API_RATE_LIMIT_MAX=40` на проде (июль 2026) — подстраховка парсера, не потолок Twenty. Сам по себе он не объясняет час, если бы мутаций было мало.

## Цели

- Пост-парсинговый синк в Twenty (resync + cancel + restore + auto-approve) укладывается в **≤ 5 минут** после фазы Tony/SQLite на типичном `weekday-fast`.
- Не слать no-op мутации позиций и opportunity.
- Не менять смысл сверки Tony, stage protection, отмены/восстановления, eligibility позиций.
- UI CRM не обязан делить бакет API-ключа с парсером; нагрузка на Postgres/Twenty CPU остаётся разумной за счёт батчей, не за счёт тысяч параллельных одиночных update.

## Не в scope

- Смена формулы `content_hash` / пропуск неизменённых заказов на стороне Tony (это уже есть).
- Смена stage protection, restoration / ne-nashe / tip rules.
- Параллельный apply SQLite.
- Поднятие `API_RATE_LIMITING_SHORT_LIMIT` (и так 100 / 1 с).
- E2E против прод Twenty в CI.
- BrandingTwentyView / BrandingTeamApp (кроме того, что доска начинает видеть свежие данные раньше).

## Подход

Выбран **полевой diff + батчи + умеренный параллелизм + лимит Twenty 800/мин**.

Отклонено:

- Только skip no-op при последовательных сделках — на жирном прогоне не гарантирует 3–5 минут.
- Лимит 2000+ и десятки воркеров без батчей — бьёт Twenty/Postgres, хуже по 429.

## Архитектура

Tony prefetch и SQLite apply не меняются.

```
Tony prefetch (parallel, как сейчас)
        ↓
SQLite apply (sequential, как сейчас)
        ↓
runPostParseTwentySync(queues)
  пул TWENTY_SYNC_CONCURRENCY (default 6)
  общий token-bucket acquireTwentyRateLimitSlot
  общий warehouseCache + in-flight create-by-name
  skipPrintSheetRefresh: true на каждой сделке
        ↓
один runPrintSheetRefresh()  (даже если часть сделок упала)
```

Очереди в одном раннере, в этом порядке: **resync → cancel → restore → auto-approve**, затем печатный лист. Между сделками **нет** `delay(1000)`.

`processAutoApprovals` больше не вызывает `syncDealToTwenty` и не делает delay. Он только отбирает id (`shouldAutoApproveDeal` как сейчас) и отдаёт их четвёртой очередью раннера. Print sheet после этой очереди, не внутри auto-approve.

Тот же раннер используют bulk-resync, decor-mk scan, product-stream backfill, restore-missing (у них уже был skip print sheet per deal + refresh в конце; добавляются пул, батчи, полевой diff). Прогресс bulk-job (`dealsDone`) увеличивается **по завершении** каждой сделки, даже если в полёте несколько.

Ручной синк одной сделки из UI парсера **не** идёт через пост-парс раннер: `skipPrintSheetRefresh` остаётся `false` (печатный лист после этой сделки, как сейчас).

## Лимиты

| Где | Переменная | Было | Станет |
|-----|------------|------|--------|
| Twenty compose (`twenty-server`) | `API_RATE_LIMITING_LONG_LIMIT` | 100 (дефолт) | **800** |
| Twenty compose | `API_RATE_LIMITING_LONG_TTL_IN_MS` | 60000 | без изменений |
| crmparser | `TWENTY_API_RATE_LIMIT_MAX` | 40 на проде / 95 в репо | **720** |
| crmparser | `TWENTY_API_RATE_LIMIT_WINDOW_MS` | 60000 | без изменений |
| crmparser | `TWENTY_SYNC_CONCURRENCY` | нет (1 + delay 1 с) | **6** |

Выкладка: сначала лимит Twenty, затем парсер с новым кодом. Откат Twenty: вернуть `100`; парсер с 720 будет сам ждать слот и ретраить 429.

`FETCH_CONCURRENCY` и `TONY_REQUEST_DELAY_MS` не трогаем.

## Компоненты

| Файл | Изменение |
|------|-----------|
| `backend/src/services/post-parse-twenty-sync.js` | новый раннер: пул, кэши, очереди, финальный print sheet, лог итогов |
| `backend/src/services/parser.js` | пост-парс циклы заменяются вызовом раннера; без delay и без print sheet per deal |
| `backend/src/services/auto-approve.js` | только отбор id (`shouldAutoApproveDeal`); синк и delay убираются — очередь раннера |
| `backend/src/services/twenty-sync.js` | один `updateOpportunity`; убрать `updateOpportunityAmountFromLineItems` как второй list+update; `skipPrintSheetRefresh` для раннера |
| `backend/src/services/twenty-line-items-sync.js` | полевой skip; батчи create/delete/upsert |
| `backend/src/config.js`, `.env.example`, compose парсера | `TWENTY_SYNC_CONCURRENCY`, новый дефолт `TWENTY_API_RATE_LIMIT_MAX=720` |
| bulk-resync / decor-mk / restore-missing / product-stream-backfill | delay 1 с убрать; гонять сделки через тот же пул |
| Dokploy Twenty | `API_RATE_LIMITING_LONG_LIMIT=800` |

Существующий `fetch-pool.js` переиспользуем для пула синка (не плодить второй семафор). Token-bucket остаётся глобальным в `twenty-rate-limit.js`.

## Полевой diff

Identity и stage protection **как сейчас** (`computeLineItemDiff`: twenty_id → имя; protected stage → `preserved`, не update/delete).

После identity появляется фильтр `lineItemFieldsEqual(existing, desired)`:

Пишем update, только если отличается хотя бы одно поле, которое `buildLineItemUpdateInput` реально отправляет:

- `kolichestvo`
- `amount.amountMicros` (равенство целых micros, без допуска)
- `istochnik`
- `productStream` — после той же нормализации, что при записи (`sortProductStreams` / coerce)
- `kommentariy` — сравниваем и пишем, только если локальный комментарий **непустой** (пустой по-прежнему не затирает Twenty)
- `tip` / `tipDetail` — если правило тип сработало; если не сработало, эти поля не входят в payload и не сравниваются

**Stage не сравниваем и не пишем** на обычном resync (cancel/restore пишут stage своими батчами).

List позиций должен запросить поля, нужные для сравнения: текущий набор плюс `kommentariy`, `tip`, `tipDetail`.

No-op сделка: нет create/update/delete **и** opportunity совпала с Twenty → ноль мутаций. Чтение: один GraphQL-документ с двумя root — opportunity по id и `dealLineItems` по `opportunityId` (2 ≤ `GRAPHQL_MAX_ROOT_RESOLVERS`).

Opportunity считаем неизменной, если совпадают поля из `buildOpportunityInput` (без `stage` на update): имя, даты/времена, amount micros, companyId, pointOfContactId, ссылки Tony/Bitrix. Сумму после изменившихся позиций считаем **в памяти** (apply diff к listed items + payload creates/updates − deletes + preserved), без второго list.

Create-путь: `createOpportunity` сразу с amount из локальных позиций; пачка `createDealLineItems`; второй amount-update нет, если пачка успешна.

## Батчи

Лимит Twenty: **60 записей на вызов**. Нарезка строго по 60.

| Операция | Мутация | Замечание |
|----------|---------|-----------|
| create | `createDealLineItems(data: $data)` | Уже используется в сидах TwentyView. `id` мапятся на `toCreate` строго по индексу в пачке (порядок `data` = порядок ответа). Если `length` ответа ≠ `length` пачки — fail сделки, **не** матчим по имени (имена дублируются). |
| delete | `deleteDealLineItems(filter: { id: { in: $ids } })` | Как в `reseed-50-with-comments.js`. |
| update с разными payload | `upsertDealLineItems` с `id` на каждой строке | Не `updateMany(filter, data)`: там одно тело на все id. |
| Fallback update | до **20** aliased `updateDealLineItem` в одном HTTP | Только если на схеме прод/staging нет upsert. 20 = `GRAPHQL_MAX_ROOT_RESOLVERS`. |

Warehouse `findOrCreate` только для **новых** имён (create-ветка). Кэш `Map<name, Promise<id>>` на весь прогон раннера: второй воркер ждёт тот же promise, не создаёт второй Product.

Company/person: если в SQLite уже есть `twenty_id` — без GraphQL (как сейчас). Если нет — serialize-by-key (один in-flight create на code/name), чтобы пул не создал дубликаты.

## Ошибки и гонки

- Пачка упала целиком (сеть, 5xx, бизнес-ошибка GraphQL) → сделка **не** `synced`, пишем `twenty_error`, очередь продолжается. Не считаем частичный успех пачки успехом сделки.
- Пачка отвергнута из‑за размера/схемы (не 429, не 5xx) → fallback нарезки меньше / aliased update. Ошибка одной позиции в fallback = fail этой сделки.
- 429: как сейчас, wait из сообщения + клиентский слот. Пул не растёт.
- 401/403 / Twenty не сконфигурирован: синк этой сделки (и последующих, если конфиг общий) с явной ошибкой, как сейчас.
- Пустой eligible на update: amount 0 + delete незащищённых позиций, opportunity не удаляем.
- SQLite: каждый воркер пишет только свою сделку; нет параллельных write на один `deal_id`.
- Print sheet в конце, даже если были fail.

Retry всей сделки «с нуля» при fail позиции **не делаем**.

## Наблюдаемость

Один итог на прогон (parse / bulk job):

```text
[twenty-sync] post_parse.done {"deals":N,"skipped_noop":N,"gql_count":N,"rate_limited":N,"failed":N,"duration_ms":N}
```

`gql_count` — число HTTP GraphQL (после retry). Цель проверки на проде: `duration_ms ≤ 300000` на weekday-fast. Если больше — сначала `skipped_noop` vs мутации, потом лимит 800.

## Тесты (Vitest, без живого Twenty)

- Полевой skip: identity+protection сохранены; в `toUpdate` только отличающиеся поля; пустой комментарий не в payload; stage не в update payload.
- Батчи: нарезка 60; create/delete/upsert не по одной позиции; разные amount не уходят в один `updateMany`.
- Fallback: нет upsert в клиенте-фейке → aliased update, не больше 20 root за документ.
- No-op: list (opportunity+items) есть, мутаций нет.
- Один `updateOpportunity` после diff (или ноль); второго list+amount нет.
- Пул: при concurrency 2 две сделки стартуют без ожидания завершения первой; одинаковое warehouse-имя — один create.
- Парсер/bulk: нет delay 1 с; `skipPrintSheetRefresh` на каждой сделке; print sheet один раз в конце, в том числе при fail части сделок.
- Rate limit: слот сериализует токены; 429 ретраится.

## Выкладка

1. Twenty prod/staging: `API_RATE_LIMITING_LONG_LIMIT=800`, redeploy `twenty-server`.
2. Парсер: код + `TWENTY_API_RATE_LIMIT_MAX=720` + `TWENTY_SYNC_CONCURRENCY=6`.
3. Один weekday-fast, сверка лога `post_parse.done`.
4. Откат: Twenty `100`, парсер можно оставить — станет медленнее, но корректно.

## Критерий готовности

Юнит-тесты зелёные. На проде пост-парс ≤ 5 минут на типичном часовом окне. Смысл синка (какие позиции/суммы/отмены) совпадает с поведением до изменения, минус исчезнувшие no-op мутации.
