# Маппинг позиций Tony → Twenty CRM — дизайн

**Дата:** 2026-06-20  
**Статус:** Утверждён к написанию плана реализации  
**Связанные спеки:** `2026-06-19-tony-order-source-design.md`, `2026-06-05-twenty-sync-design.md`

## Контекст и проблема

Tony содержит для каждой позиции заказа поля: комментарий, количество, цена, скидка, к2д, расход, итого.
Сейчас в Twenty уходит только название, сырая цена из поля «цена» и количество как текст (например «3 шт.»).
Комментарий не парсится и не синкается; итого (`data-sum`) парсится, но отбрасывается при сохранении и синке.

**Желаемое поведение для Tony-позиций:**

| Twenty | Источник | Правило |
|--------|----------|---------|
| Комментарий | Tony `.custom_text_value` | как есть |
| Количество | Tony `.orders_custom_edit` | **число** (NUMBER), без «шт.» |
| Цена (`amount`) | Tony `data-sum` / количество | **итого / количество** — эффективная цена после всех коэффициентов, не сырая «цена» |
| Сумма сделки | Σ итого по позициям | `amount` на Opportunity = сумма `sum` по позициям |

Календарные fallback-позиции (сделки без Tony) остаются без изменений.

## Текущее состояние кода

- `tony-parser.js` — парсит `name`, `price`, `quantity`, `discount`, `sum`, `category`; **не парсит comment**
- `tony-mapping.js` → `buildTonyItems()` — отбрасывает `sum` и `comment`
- `deal_items` — колонки: `name`, `price`, `quantity` (TEXT), `discount`; нет `comment`, `sum`
- `twenty-line-item.js` — `quantity` как String, `amount` из `item.price`
- `twenty-opportunity.js` / `twenty-sync.js` — budget = Σ (`price × parseQuantity(quantity)`)
- Twenty `dealLineItem` — поля `name`, `quantity` (TEXT, напр. «1 шт.»), `amount` (Currency); **поля комментария нет**

## Решения пользователя (утверждено)

1. Создать новое поле **«Комментарий»** (`kommentariy`, TEXT) на `dealLineItem` в Twenty
2. Количество хранить как **NUMBER** — новое поле `kolichestvo` (существующее `quantity` TEXT не меняем — legacy/calendar)
3. Сумма сделки = **Σ итого** (`sum`) по Tony-позициям
4. Область: Tony — полная логика; calendar fallback — как сейчас
5. **Существующие позиции в Twenty обновлять** при синке (create и update)

## Выбранный подход

**Подход A — сквозное расширение пайплайна** с новым NUMBER-полем в Twenty (элемент подхода C для quantity).

Альтернативы отклонены:

- *Пересчёт только на синке без БД* — `sum`/`comment` теряются при повторном синке из локальной БД
- *Два поля quantity без расширения БД* — дублирование без сохранения данных локально

## Маппинг полей

| Tony | Локальная БД (`deal_items`) | Twenty (`dealLineItem`) |
|------|----------------------------|-------------------------|
| `.custom_text_value` | `comment` TEXT | `kommentariy` TEXT *(новое)* |
| `.orders_custom_edit` | `quantity` TEXT + `quantity_num` REAL | `kolichestvo` NUMBER *(новое)* |
| `data-sum` | `sum` REAL | `amount` = `sum / quantity_num` |
| `data-price` | `price` REAL *(храним, не синкаем в amount)* | — |
| name | `name` | `name` |

### Формула цены

```
quantityNum = parseQuantity(quantity)  // минимум 1
effectivePrice = sum / quantityNum
amountMicros = round(effectivePrice * 1_000_000)
```

**Примеры:**

- Баннер: sum=23760, qty=9 → amount = **2640** ₽/шт.
- Ролл-ап со скидкой 10%: sum=14400, qty=1 → amount = **14400** ₽/шт. (скидка уже в `sum`)

### Сумма сделки (Opportunity)

- Tony-сделки (`data_source === 'tony'`): `brandingBudget = Σ item.sum`
- Calendar fallback: `Σ (price × parseQuantity(quantity))` — без изменений

## Изменения по компонентам

### 1. Парсер Tony (`tony-parser.js`)

- Парсить `.custom_text_value` → `comment` (trim, пустая строка → `''`)
- `sum` уже парсится из `data-sum` — без изменений

### 2. Маппинг (`tony-mapping.js`)

- `buildTonyItems()` возвращает: `name`, `price`, `quantity`, `discount`, `sum`, `comment`
- `tonyContentHash()` включает `sum` и `comment` для корректного change-detection

### 3. Локальная БД

Новые колонки через `migrate.js`:

```sql
ALTER TABLE deal_items ADD COLUMN comment TEXT;
ALTER TABLE deal_items ADD COLUMN sum REAL;
ALTER TABLE deal_items ADD COLUMN quantity_num REAL;
```

При сохранении Tony-позиций: `quantity_num = parseQuantity(quantity)`.

Обновить `schema.sql` для новых установок.

### 4. Метаданные Twenty (один раз)

Через Twenty metadata API / MCP:

| Поле | API name | Тип | Label |
|------|----------|-----|-------|
| Комментарий | `kommentariy` | TEXT | Комментарий |
| Количество | `kolichestvo` | NUMBER | Количество |

Существующее поле `quantity` (TEXT) не удаляем и не меняем тип — calendar fallback продолжает его использовать.

### 5. Синк позиций (`twenty-line-item.js`, `twenty-line-items-sync.js`)

Для Tony-сделок (`deal.data_source === 'tony'`):

```js
effectivePrice = sum / Math.max(quantityNum, 1)
input.kolichestvo = quantityNum
input.kommentariy = comment || undefined  // не отправлять пустое
input.amount = { amountMicros, currencyCode: 'RUB' }
// поле quantity (TEXT) не писать
```

`buildLineItemCreateInput` и `buildLineItemUpdateInput` — оба поддерживают новые поля.
Update перезаписывает существующие ~531 позиций при следующем синке соответствующих сделок.

Для calendar fallback — текущее поведение: `quantity` (TEXT), `amount` из `price`.

Функции принимают флаг или объект deal для выбора ветки (Tony vs calendar).

### 6. Сумма сделки (`twenty-opportunity.js`, `twenty-sync.js`)

- Tony: `eligibleAmount = Σ (i.sum || 0)` по eligible items
- Calendar: без изменений

### 7. Тесты

| Файл | Что проверяем |
|------|---------------|
| `tony-parser.test.js` | comment «+ монтаж» из фикстуры |
| `tony-mapping.test.js` | `sum`, `comment` в output; hash включает новые поля |
| `twenty-line-item.test.js` | effectivePrice = sum/qty; NUMBER `kolichestvo`; comment; Tony vs calendar ветки |
| `twenty-opportunity.test.js` / `twenty-sync.test.js` | Tony budget из sum |

## Граничные случаи

| Ситуация | Поведение |
|----------|-----------|
| `quantity` = 0 или пусто | `quantityNum = 1`, `effectivePrice = sum` |
| `sum = 0`, `price > 0` | `effectivePrice = 0` (не fallback на сырую price) |
| Пустой comment | `kommentariy` не отправляем / null |
| Дробное количество (1.5) | `kolichestvo = 1.5`, цена = sum / 1.5 |
| Переименование позиции в Tony | diff по name: старая удаляется, новая создаётся (как сейчас) |
| Calendar item без sum | используется ветка calendar (price × qty) |

## Нецели

- Не переносим в Twenty отдельные поля скидка, к2д, расход — они учтены неявно в `sum`
- Не меняем тип существующего поля `quantity` (TEXT) в Twenty
- Не трогаем warehouse items / классификацию позиций

## Порядок реализации (высокоуровнево)

1. Метаданные Twenty: `kommentariy`, `kolichestvo`
2. Миграция локальной БД
3. Парсер + маппинг + сохранение в `deal_items`
4. `twenty-line-item.js` — Tony/calendar ветки
5. Opportunity amount — sum для Tony
6. Тесты
7. Ручная проверка: синк одной Tony-сделки, сверка полей в Twenty UI
