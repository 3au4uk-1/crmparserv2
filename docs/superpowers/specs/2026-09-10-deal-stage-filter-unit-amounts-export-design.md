# Фильтр стадии сделки, цена за шт, выгрузка без реставрации

**Дата:** 2026-09-10  
**Статус:** Утверждён к написанию плана реализации  
**Репозитории:** `BrandingTwentyView`, `crmparserv2`  
**Подход:** исправить семантику полей и фильтров; без новой колонки «Итого»; без массового пересчёта старых сделок

## Проблема

1. На доске «Реализация» фильтр «Стадия» смотрит на **позицию** (`dealLineItem.stage`), а не на сделку (`opportunity.stage`). Стадии сделки (Новый, В работе, Готово, Отчёт Стас, ДУБЛЬ, Отмена) в этом фильтре не участвуют. GraphQL-запрос сделок по `opportunity.stage` не строится.
2. `dealLineItem.amount` — цена за 1 шт, но парсер при синке считает её итогом строки и пишет `итог / кол-во` обратно в Twenty. Смена кол-ва 1→2 при цене 6000 даёт 3000. Итог сделки и оборот в тулбаре складывают цены **без** умножения на количество.
3. Выгрузка Twenty (`/export-twenty`) не отсекает позиции из списка реставрации парсера (чип «Р»).

## Цель

1. Основной фильтр «Стадия» = стадия **сделки**; «Стадия позиции» остаётся отдельным пунктом.
2. Цена за шт в Twenty не меняется при смене кол-ва. Итог сделки и оборот = `Σ(цена × кол-во)` по позициям не в `OTMENA`.
3. Выгрузка Twenty по умолчанию не включает позиции из списка реставрации; чекбокс «включая реставрацию» их возвращает.

## Не в scope

- Новая колонка «Итого» / переименование «Сумма» → «Цена».
- Массовый пересчёт уже записанных `opportunity.amount`.
- Скорборд (считает стадии **позиций**).
- BrandingTeamApp.
- Галочка `restavraciyaPechati` и тип `RESTAVRACIYA` как критерий выгрузки.
- Кнопка «снять закрепление суммы» / бейдж лока.
- Ручная правка `opportunity.amount` минуя позиции.

## Решения (зафиксировано)

| Тема | Выбор |
|------|--------|
| Фильтр | B: «Стадия» = сделка; «Стадия позиции» отдельно |
| Колонка «Сумма» | A: остаётся ценой за 1 шт; итоги считаются, не показываются отдельной колонкой |
| Реставрация в выгрузке | A: список парсера `restoration_items` (чип «Р») |
| Чекбокс выгрузки | A: по умолчанию **не** выгружать реставрацию; «включая реставрацию» включает |
| Старые итоги сделок | A: не трогаем; обновятся при следующей правке цены или кол-ва |
| Подход | 1: править семантику, не плодить поля |

---

## 1. Фильтр стадий (BrandingTwentyView)

### Конструктор

| Пункт | Clause | Значения |
|-------|--------|----------|
| **Стадия** | `level: 'deal'`, `field: 'stage'` | `OPPORTUNITY_STAGES`: Новый, В работе, Готово, Отчёт Стас, ДУБЛЬ, Отмена |
| **Стадия позиции** | `level: 'lineItem'`, `field: 'stage'` | `LINE_ITEM_STAGES`: Новый, В печати, Оклейка, В работе, Готово, Отмена |

Сейчас единственный пункт «Стадия» — это `lineItem` + `LINE_ITEM_STAGES`. Его подпись меняется на «Стадия позиции»; новый пункт «Стадия» — сделка.

### Сохранённые виды

Clauses `lineItem` + `stage` **не переписываем**. Они начинают отображаться как «Стадия позиции». Значения вроде «В печати» нельзя честно смапить на стадию сделки.

`migrateLegacyFilters`: массив `filters.stages` без `clauses` по-прежнему даёт `lineItem.stage` (старое значение было стадией позиции).

### Модель `DealBoardFilters`

Сейчас `stages?: LineItemStage[]` уходит и в REST позиций, и никуда в GraphQL сделок.

Разделить:

- `opportunityStages?: OpportunityStage[]` — из clauses `deal` + `stage`
- `lineItemStages?: LineItemStage[]` — из clauses `lineItem` + `stage`
- Поле `stages` на переходный период: читать как `lineItemStages` только в legacy-ветке `migrateLegacyFilters`. Новые пути (`clausesToDealBoardFilters`, fetch) `stages` как стадию позиции не используют.

### Загрузка данных

**Стадия сделки.** `buildOpportunityFilter` добавляет `{ stage: { in: opportunityStages } }`. Сделка попадает в выборку целиком; позиции не прячутся.

**Стадия позиции.** Как сейчас: REST/клиентский фильтр по `dealLineItem.stage`; сделка видна, если есть ≥1 подходящая позиция; остальные позиции скрыты; «показать все позиции» без изменений.

Оба фильтра можно включить сразу: GraphQL режет сделки, затем позиции режутся как сейчас.

`fetchOpportunities` / prefetch id по поиску: в `LineItemQueryFilters` передавать только `lineItemStages` + `types`, не стадии сделки.

`filterDealsAndLineItems`: по-прежнему только `lineItem`-clauses. Стадия сделки режется GraphQL. Отдельный клиентский matcher по `opportunity.stage` не делаем: realtime и смена стадии идут через существующий refetch списка сделок.

### Вне этой секции

Скорборд, автосорт позиций по стадии, `syncDealStage` — без изменений.

---

## 2. Цена за шт и итоги (оба репо)

### Канон

| Поле | Смысл |
|------|--------|
| `dealLineItem.amount` | Цена за 1 шт (RUB) |
| `dealLineItem.kolichestvo` | Количество |
| Итог строки | Считается: `цена × кол-во` (не хранится отдельным полем в Twenty) |
| `opportunity.amount` | `Σ(цена × кол-во)` по позициям с `stage ≠ OTMENA` |
| Оборот тулбара | Та же формула по видимым позициям, без `OTMENA` |

Кол-во пустое или ≤0 в формуле итога считать как 1 (как `parseQuantityNum` / зарплата).

Реставрация и «не наше» по-прежнему дают 0 вклада в итог сделки на стороне парсера.

### Почему ломается сейчас

Парсер кладёт в Twenty `amount = lineTotal / qty`. Write-back лока пишет введённую цену в `deal_items.sum` как будто это итог строки. Смена кол-ва (ручной sync / ресинк) снова делит «итог» на новое кол-во: 6000 / 2 = 3000.

`sumNonCancelledLineAmountsRub` и тулбар складывают `amount` без `× kolichestvo`.

`upsertManualTwentyLineItem` принимает `amountMicros` как итог и считает `unit = total / qty`.

### Парсер: хранение

На `deal_items` после любой ручной правки цены или кол-ва:

| Колонка | Смысл |
|---------|--------|
| `price` | Цена за 1 шт |
| `quantity` / `quantity_num` | Количество |
| `sum` | Итог строки = `price × qty` |
| `amount_locked` | Цена за шт закреплена; ресинк из Tony/календаря её не затирает |

`lockDealItemAmount(amountRub)`: `amountRub` — цена за шт. Писать `price = amountRub`, `sum = amountRub * qty`, `amount_locked = 1`. Qty брать из `quantity_num` / Twenty / 1.

`computeLineItemTotal` при lock: `price * qty` (то есть актуальный `sum`), не «голое» устаревшее `sum`, если qty уже другое. Практично: при смене qty всегда пересчитывать `sum = price * qty` у locked-строк.

`buildLineItemFields`: в Twenty `amount` = цена за шт (`price` / `sum/qty` только как вывод той же цены). **Нельзя** брать за итог locked `sum`, посчитанный при старом qty, и делить на новый qty, если `price` уже хранит цену.

`upsertManualTwentyLineItem`: `amountMicros` = цена за шт. `price = unit`, `sum = unit * qty`.

### Парсер → Twenty (ресинк)

| Ситуация | `dealLineItem.amount` | `kolichestvo` |
|----------|----------------------|---------------|
| Unlock, первый create | цена = итог источника / qty источника | qty источника |
| Unlock, update из источника | как сейчас из Tony/календаря, но в `amount` всегда **цена за шт**, не итог | qty источника, если стадия позволяет |
| `amount_locked` | не трогать `amount` | qty из парсера, если стадия позволяет; ручной write-back кол-ва обновляет `quantity_num` в SQLite, но **не** ставит `amount_locked` |

После sync и после write-back: `opportunity.amount = Σ(unit × qty)` по eligible позициям, без `OTMENA`. Хелпер `sumNonCancelledLineAmountsRub` обязан умножать на `kolichestvo` (в GraphQL-листинге для пересчёта поле `kolichestvo` должно запрашиваться).

Одноразовый job пересчёта всех сделок **не запускаем**. Формулу в `opportunity-amount-recalc` всё равно поправить: если job когда-либо снова включат, он не должен повторять ошибку «сумма без кол-ва». Сам прогон по базе в этой задаче не делаем.

### TwentyView

1. Колонка «Сумма» по-прежнему редактирует `amount` как цену за шт. Write-back как сейчас, но парсер сохраняет цену в `price`.
2. Смена `kolichestvo`: **не** патчить `dealLineItem.amount`. После успешного save — `POST /api/twenty/line-items/:id/quantity` `{ kolichestvo }` (рядом с amount write-back): обновить `quantity` / `quantity_num`; если `amount_locked`, пересчитать `sum = price × qty` и не трогать `price`; если не locked — только qty, лок не ставить. Затем пересчёт `opportunity.amount`. Ручные позиции: тот же контракт через существующий upsert, но `amountMicros` = цена за шт.
3. Тулбар: `Σ(unit × qty)` без отмен.
4. Зарплата и Excel-выгрузка уже умножают — не ломать.

Позиция не найдена в парсере (404): кол-во/цена в Twenty уже сохранены; итог сделки пересчитать по line items в Twenty (`unit × qty`), без записи в SQLite.

Реставрация / «не наше»: лок цены по-прежнему 400.

### Ошибки

| Ситуация | Поведение |
|----------|-----------|
| Невалидная цена | Алерт, не сохраняем (как сейчас) |
| Write-back цены/кол-ва недоступен | Значение в Twenty остаётся; ошибка в UI |
| Lock реставрации / не наше | 400, текст как сейчас |

---

## 3. Выгрузка Twenty без реставрации (crmparserv2)

### Критерий

Позиция считается реставрацией, если `isRestorationItem(name, restorationList)` — тот же список и матчинг, что чип «Р» / «В реставрацию». Не `restavraciyaPechati`, не `tip === RESTAVRACIYA`.

Список грузить из SQLite (`loadRestorationList`) на стороне job. Twenty GraphQL `restorationMatch` не отдаёт.

### UI (`ExportTwenty.jsx`)

- Чекбокс «включая реставрацию», по умолчанию **выкл**.
- Рядом с «включая отмены».
- `localStorage`, по аналогии с листом сделок.
- В `POST /api/export/twenty` поле `includeRestoration` (default `false`).
- Активная job восстанавливает значение флага в форму.

### Job / `mapLineItemToRow`

Порядок skip (после даты):

1. Нет эффективной даты / вне диапазона — skip.
2. Отмена и `includeCancelled === false` — skip.
3. Реставрация и `includeRestoration === false` — skip.

`includeRestoration === true` — шаг 3 не применяется.

Лист «Сделки» строится из **оставшихся** строк. Расходы сделки по-прежнему один раз на первую оставшуюся позицию этой сделки.

Пустой список реставрации: шаг 3 никого не отсекает.

Ошибка загрузки списка: job `failed`, понятное сообщение, файл не отдаём.

### API

Расширить body/status job:

```json
{ "from": "...", "to": "...", "includeCancelled": false, "includeRestoration": false, "includeDealsSheet": false, "columns": [] }
```

Старые клиенты без поля: `includeRestoration = false` (новое поведение по умолчанию — реставрацию не выгружать).

---

## Компоненты

### BrandingTwentyView

- `FilterBar` `BUILDER_FIELDS`
- `clausesToDealBoardFilters`, `migrateLegacyFilters`, типы `DealBoardFilters`
- `buildOpportunityFilter`, `fetchOpportunities` / page-core (не смешивать стадии сделки с REST позиций)
- `BoardToolbar` оборот
- Write-back кол-ва после save `kolichestvo`; `CurrencyAmountCell` без деления цены
- Тесты фильтров и формулы оборота

### crmparserv2

- `lockDealItemAmount`, `computeLineItemTotal`, `buildLineItemFields`, `upsertManualTwentyLineItem`
- `sumNonCancelledLineAmountsRub` / listing для recalc: `× kolichestvo`
- `POST /api/twenty/line-items/:id/quantity`
- `twenty-export.js` + `ExportTwenty.jsx` + job params
- Тесты: lock хранит цену; qty не делит amount; export skip/include restoration

---

## Потоки

```
[Фильтр «Стадия» = В работе]
        → GraphQL opportunities.stage in [V_RABOTE]
        → все позиции этих сделок

[Фильтр «Стадия позиции» = Оклейка]
        → как сейчас: сделки с ≥1 OKLEYKA, лишние позиции скрыты
```

```
[Оператор: цена 6000, кол-во 1→2]
        → PATCH kolichestvo=2, amount не трогать
        → парсер: qty=2; если locked — price=6000, sum=12000; amount в Twenty не менять
        → opportunity.amount += 6000 (было 6000, стало 12000 для этой строки)
```

```
[Выгрузка Twenty, includeRestoration=false]
        → fetch dealLineItems
        → skip без даты / вне периода / OTMENA
        → skip если имя ∈ restoration_items
        → Excel
```

---

## Тесты

1. **Фильтр сделки:** clause `deal.stage` даёт GraphQL `stage in`; позиции не режутся.
2. **Фильтр позиции:** clause `lineItem.stage` скрывает чужие позиции; сделка остаётся при ≥1 match.
3. **Старый вид:** сохранённый `lineItem.stage` живёт как «Стадия позиции»; `V_PECHATI` не превращается в стадию сделки.
4. **Legacy `filters.stages` без clauses:** migrate → `lineItem.stage`.
5. **Кол-во:** 6000 × 1 → qty 2 → amount остаётся 6000; итог сделки 12000.
6. **Lock:** write-back цены пишет `price`, `sum = price * qty`; ресинк не ставит amount = sum/newQty.
7. **Ручная позиция:** `amountMicros` — цена, не итог.
8. **Тулбар:** две позиции 100×2 и 50×1, без отмен → 250.
9. **Отмена:** позиция `OTMENA` не входит в итог сделки и оборот.
10. **Export:** restoration match + флаг выкл → строки нет; флаг вкл → строка есть; пустой список → никто не отсечён по реставрации.

## Критерий готовности

- На доске фильтр «Стадия» показывает сделки по стадии сделки; стадию позиции можно включить отдельно.
- Смена кол-ва не меняет цену за шт; итог сделки и оборот = цена × кол-во.
- Excel Twenty без «включая реставрацию» не содержит позиций из списка реставрации парсера.
- Скорборд и Team App не затронуты. Старые `opportunity.amount` сами не пересчитываются пакетом.
