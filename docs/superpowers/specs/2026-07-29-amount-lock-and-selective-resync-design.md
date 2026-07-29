# Синк суммы позиции/сделки + защита от перезаписи

**Дата:** 2026-07-29  
**Статус:** Утверждён к написанию плана реализации  
**Репозитории:** `crmparserv2`, `BrandingTwentyView`

## Проблема

1. Сумму позиции можно править в TwentyView, но парсер об этом не узнаёт — при ресинке (если стадия позволяет) сумма снова берётся из Tony.
2. Сумма сделки (`opportunity.amount`) пересчитывается парсером из позиций; после ручной правки позиции сделка может остаться со старым итогом.
3. Нужна защита проделанной работы в Twenty: ручная сумма не должна затираться, но **даты** и **отмены** должны доезжать из источника.

## Цель

1. Правка `dealLineItem.amount` в TwentyView → запись в парсер с **закреплением** → пересчёт `opportunity.amount`.
2. Закреплённая сумма не перетирается данными Tony/календаря.
3. Всегда ресинкать: даты мероприятия/отгрузки; `OTMENA` на сделке и на позиции (даже при защите).

## Решения (зафиксировано)

| Тема | Выбор |
|------|--------|
| Что правим | Позиция + автопересчёт сделки (C) |
| Закрепление | Любая ручная правка суммы → `amount_locked` (независимо от стадии) |
| Отмена | Всегда синкать `OTMENA` на deal и line item (A) |
| Архитектура | Write-back в парсер + lock; не «только Twenty» |

## Не в scope (v1)

- Кнопка «снять закрепление» / UI-бейдж «сумма закреплена»
- Ручная правка `opportunity.amount` минуя позиции
- Webhook на все поля Twenty
- Изменение правил stage-protection для comment/tip/quantity (кроме исключений дат/OTMENA)

---

## Текущее состояние

- TwentyView: `CurrencyAmountCell` пишет `amount` в Twenty.
- Парсер: `computeLineItemTotal` / `computeDealItemsTotal` → `opportunity.amount` при синке.
- Stage-protection: стадии ≠ `NOVYY`/`null` не попадают в `toUpdate`/`toDelete` полей из Tony.
- Ne-nashe / restoration: сумма позиции = 0.

---

## Модель данных (crmparserv2)

На `deal_items`:

| Колонка | Смысл |
|---------|--------|
| `amount_locked` | `0`/`1` — сумма закреплена вручную |
| Сумма | Хранится в существующих `sum` / `price` (+ `quantity_num` как сейчас); после write-back выставляются так, чтобы `computeLineItemTotal` давал нужный рубль |

Миграция в `migrate.js`.

---

## Write-back из TwentyView

```
TwentyView: PATCH dealLineItem.amount
  → (after success) POST crmparser /api/twenty/line-items/:twentyId/amount
       { amountRub }
  → deal_items: amount_locked=1, обновить sum/price
  → пересчитать opportunity.amount в Twenty = Σ eligible line totals
```

**Реализация UI:** хук после обновления amount (расширение `run-after-line-item-update` или отдельный путь в `CurrencyAmountCell` / `useUpdateRecord`), через существующий crmparser proxy (как list-actions).

**Ошибки:**

| Ситуация | Поведение |
|----------|-----------|
| Позиция не найдена в парсере (`twenty_id` нет) | 404; сумма в Twenty уже сохранена; opportunity пересчёт — по line items в Twenty (GraphQL), без записи в парсер |
| Позиция в ne-nashe / restoration | 400 с понятным текстом; write-back запрещён |
| Прокси/парсер недоступен | Ошибка в UI; сумма в Twenty остаётся; оператор может повторить |

Повторная правка суммы обновляет locked-значение (`amount_locked` остаётся 1).

---

## Защита при репарсе / ресинке

### Сумма

| `amount_locked` | Поведение |
|-----------------|-----------|
| `0` | Как сейчас: Tony/calendar → amount позиции → вклад в сумму сделки |
| `1` | Не перезаписывать amount из источника; в sync уходит locked total |

### Stage-protection (без изменений по умолчанию)

Позиции со стадией ≠ `Новый`/`null` не обновляются и не удаляются полями Tony **кроме** каналов ниже.

### Всегда ресинкать

1. **Даты opportunity:** load date/time, event begin/end, dismantle/work time (из Tony).
2. **Отмена сделки:** источник → `opportunity.stage = OTMENA` (через `cancelDealInTwenty` / аналог), даже если позиции locked.
3. **Отмена позиции:** → `dealLineItem.stage = OTMENA` отдельным update (не полный Tony field-sync), даже при protected stage / amount_locked.

### Не ресинкать при lock / protected stage

amount (если locked), quantity, comment, tip — по текущим правилам защиты.

### Пересчёт суммы сделки

После write-back и при обычном sync:

`opportunity.amount = Σ computeLineItemTotal(eligible items)`  
где locked позиции дают locked сумму; ne-nashe/restoration → 0.

---

## Компоненты

### crmparserv2

- Миграция `amount_locked`
- `POST /api/twenty/line-items/:id/amount` (+ auth как у остальных twenty routes)
- `computeLineItemTotal` / sync path: уважать lock
- При replace deal items из Tony: не затирать sum/price locked строк (или восстанавливать lock после replace — предпочтительно **preserve locked fields** в `replaceDealItems…`)
- Отдельный путь sync OTMENA для line items + даты opportunity

### BrandingTwentyView

- После успешного update `amount` → вызов proxy write-back
- Пересчёт/обновление opportunity amount (через парсер response или локальный patch opportunity)
- Сообщение об ошибке write-back

---

## Поток данных

```
[Оператор правит сумму в TwentyView]
        │
        ▼
  Twenty dealLineItem.amount
        │
        ▼
  crmparser write-back → amount_locked=1
        │
        ▼
  opportunity.amount = Σ positions
        │
[Позже: re-parse Tony]
        │
        ├─ amount_locked → keep amount
        ├─ dates → always update opportunity
        └─ cancel → always OTMENA (deal + line item)
```

---

## Тесты

1. Write-back выставляет lock и сумму; `computeLineItemTotal` возвращает locked.
2. Re-parse не меняет locked amount; меняет даты opportunity.
3. OTMENA пробивает stage-protection.
4. Ne-nashe/restoration → write-back 400.
5. Unknown twenty_id → 404 без падения UI-сценария (контракт API).

## Критерий готовности

- Правка суммы позиции в TwentyView отражается в парсере и в сумме сделки.
- Повторный парсинг не откатывает закреплённую сумму.
- Даты и отмены продолжают обновляться.
- tipDetail / ne-nashe механики не ломаются.
