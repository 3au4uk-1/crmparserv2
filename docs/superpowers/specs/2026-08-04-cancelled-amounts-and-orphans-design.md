# Cancelled amounts + orphans audit — Design Spec

**Дата:** 2026-08-04  
**Статус:** Approved  
**Репозитории:** `crmparserv2` (парсер), `BrandingTwentyView` (analytics UI)

## Проблема

1. **Суммы отменённых** всё ещё живут в финансовых полях Twenty: у позиций в `OTMENA` ненулевой `amount`, а `opportunity.amount` часто включает эти суммы (парсер считает Σ без фильтра по stage).
2. **Доверие к Twenty как SoT** требует, чтобы `opportunity.amount` = актуальная сумма заказа по неотменённым позициям.
3. **Orphans** — позиции без сделки и связанные дыры данных — нужно инвентаризировать и понять причины, не обязательно чистить в v1.

## Решения (зафиксировано)

| Тема | Выбор |
|------|--------|
| Scope учёта | **C:** UI + `opportunity.amount` без отменённых + обнуление `amount` у позиций при переходе в `OTMENA` |
| Restore суммы | **A:** со следующего Tony/парсер-синка (без snapshot amount) |
| One-shot сейчас | **C:** только пересчёт `opportunity.amount`; mass-zero `OTMENA` amount — отдельный шаг |
| Orphans | **A+B:** полный отчёт + идеи; в коде — fix `stage` на create |
| Подход | Парсер = SoT по суммам сделки + точечный stage-fix |

## 1. Правило истины для сумм

```
opportunity.amount = Σ computeLineItemTotal(item)
  for item in lineItems where item.stage !== 'OTMENA'
```

- Позиции со `stage = null` **включаются** (как в текущей analytics).
- Сохраняются существующие zero-rules: restoration / ne-nashe / `amount_locked`.
- Orphans без `opportunityId` **не** входят ни в одну сделку (и не должны попадать в Σ opportunity).

### Прод (парсер)

| Событие | Поведение |
|---------|-----------|
| Sync / amount-lock / repair amount | Пересчитать `opportunity.amount` по правилу выше |
| Cancel позиции → `OTMENA` (cancel сделки или аналог) | `lineItem.amount → 0`, затем пересчёт opportunity |
| Restore позиции из `OTMENA` | Stage из snapshot (уже есть); **amount не восстанавливать** — следующий sync |

### One-shot v1

- Флаг settings (по аналогии с `free_entry_duplicate_repair_v1`), stale `running` 6h.
- Для каждой opportunity: `expected = Σ(non-OTMENA)`; если отличается от текущего `amount` → update.
- **Не** мутировать `amount` у позиций `OTMENA` в этом прогоне.
- Soft per-deal / hard abort на auth/network.

### UI (`BrandingTwentyView` analytics)

- Оборот уже: позиции с `stage !== 'OTMENA'`.
- Добить: **не** включать opportunities со `stage === 'OTMENA'` в `dealCount` и в сумму расходов (`rashod*`).

## 2. Stage на create

**Причина:** `buildLineItemFields` не пишет `stage` → в CRM ~1766 позиций с `stage = null` (в т.ч. свежие PARSER).

**Fix:** при **create** line item писать `stage: 'NOVYY'`.  
**Update** по-прежнему **не** шлёт `stage` (защита ручных стадий).

Совместимо с stage-protection: `NOVYY` и `null` оба deletable; `NOVYY` — канонический default.

**Вне v1:** backfill существующих `null` → `NOVYY`.

## 3. Orphans — инвентаризация (без мутаций)

Снимок Twenty на 2026-08-04:

| Класс | Определение | Масштаб | Причина | Идеи (позже) |
|-------|-------------|---------|---------|--------------|
| **A** | `opportunityId IS NULL` | **367**, Σ amount ≈ **6,11 млн ₽**, `istochnik` null | Старый импорт / обрыв связи / создание без сделки; кластеры по `createdAt` (много 2026-06-23) | Soft-delete или архивный view; исключить из любых Σ; не показывать на доске |
| **B** | Есть opportunity, нет match в Tony, stage protected | per-deal | Убрали из заказа; cancel/restore; name-collapse (до free-entry fix) | Оставить; zero amount если `OTMENA`; не удалять protected |
| **C** | `stage = null`, есть opportunity | ~**1766** (PARSER ≈ 1384) | Create без stage | Fix create (этот проект); optional backfill |

Список класса A: `docs/superpowers/specs/2026-08-04-orphan-line-items-class-a.csv` — **300** самых новых из **367** (снимок 2026-08-04). Остальные **67** — кластер `createdAt` ≈ `2026-06-23T16:46–16:49Z` (массовый импорт без opportunity); перевыгрузить через MCP `opportunityId is NULL` при необходимости.

## 4. Вне scope v1

- Массовое обнуление amount у уже существующих `OTMENA`-позиций
- Delete / reattach orphans класса A
- Backfill `stage: null` → `NOVYY`
- Полное исключение расходов отменённых сверх analytics-фильтра (вариант D)
- Snapshot amount при cancel
- Изменения BrandingTwentyView кроме analytics dealCount/expense

## 5. Acceptance

1. Новая PARSER-позиция создаётся с `stage: NOVYY`.
2. После cancel позиции: её `amount = 0`, `opportunity.amount` = Σ оставшихся non-OTMENA.
3. One-shot: все opportunity.amount совпадают с Σ non-OTMENA (допуск 1 ₽ / micros rounding).
4. Analytics: сделки `OTMENA` не в dealCount и не в expense месяца.
5. Спека/CSV содержат полный список orphans A + идеи по B/C; данные orphans не удалены.

## Связанные спеки

- `2026-06-27-line-item-stage-protection-design.md`
- `2026-08-04-cancel-restore-line-item-snapshot-design.md`
- `2026-08-04-free-entry-duplicate-identity-design.md`
- `2026-07-29-amount-lock-and-selective-resync-design.md`
