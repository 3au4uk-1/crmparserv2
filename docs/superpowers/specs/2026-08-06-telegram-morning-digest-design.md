# Telegram morning digest (завтра / послезавтра)

**Date:** 2026-08-06  
**Status:** Approved for planning  
**Scope:** crmparserv2 Telegram bot + Twenty opportunities / deal line items  
**Related:** `2026-07-30-telegram-okleyka-send-design.md` (chat map, Bot API, hooks)

## Problem

Утром нужно быстро пройти день по Twenty: сколько готово / не готово и где дыры, без открытия доски. Сейчас сводка есть только в UI (пресеты «Завтра» / «Послезавтра»), в Telegram — нет.

## Goals / non-goals

| In (v1) | Out (v1) |
|---------|----------|
| Утренний push 09:00 Europe/Moscow: два сообщения (ЗАВТРА, ПОСЛЕЗАВТРА) | R3 (застряло в печати), R4 (−превью/−время) |
| Команды `/завтра`, `/послезавтра` | Сводка по типам (формат B), кнопка «полн» |
| Шапка ✔️/❌ + блок рисков со скором | Дублирование на deals-board UI |
| Чат через `telegram_chat_map.digest.morning` | Изменение стадий / данных в Twenty |

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| Delivery | Cron 09:00 MSK **и** bot commands |
| Days | Завтра и послезавтра по `loadDate` (локальный день, `Europe/Moscow`), как пресеты доски |
| Morning send | **Два** отдельных сообщения |
| Morning chat | `telegram_chat_map` key `digest.morning` |
| Commands reply | В чат, откуда вызвали команду |
| Cancelled | Opportunity `OTMENA` и line items `OTMENA` **нигде не считаем** |
| Deal ✔️ | Opportunity `stage === GOTOVO` («Готово») |
| Deal ❌ | Любая другая (не отменённая) сделка дня |
| Position ready | Line item `stage === GOTOVO` |
| Risk rules | R0 + R1 + R2 + scoring R5; **не** R3/R4 |
| Risk sort | По скору ↓, tie-break сумма ↓ |
| Risk list | Top **7**, остальное `… +N` |
| Amounts in header | Сумма `opportunity.amount` по группе ✔️/❌ |
| Builder host | crmparser (читаем Twenty, шлём Bot API) |

## Message format

```
ЗАВТРА DD.MM · {N} сделок / {M} позиций
✔️ {a} сделок / {b} позиций · ₽…
❌ {c} сделок / {d} позиций · ₽…

⚠ РИСКИ:
• {компания}/{менеджер}/{№} · {готово}/{всего} · ₽… · {метки}
…
```

- Заголовок дня: `ЗАВТРА` или `ПОСЛЕЗАВТРА` + дата `DD.MM`.
- `N = a + c`, `M = b + d` (только неотменённые сделки / позиции).
- ✔️ позиции = неотменённые позиции сделок со `stage === GOTOVO`.
- ❌ позиции = неотменённые позиции остальных сделок дня.
- ₽ форматировать компактно (как на доске: тысячи/`к`, без лишних знаков).
- Если рисков нет: `⚠ РИСКИ:` и строка `нет` (или блок опустить — предпочтение: одна строка `нет`, чтобы было видно, что расчёт прошёл).

### Risk line label

`{companyName}/{manager}/{bookingNo}` — сегменты через `/`; пустые сегменты **пропускать** (не писать `undefined`).

- `companyName` — из opportunity / related company.
- `manager`, `bookingNo` — из `opportunity.name` (tony-style `префикс/даты/менеджер/номер/…`); если парсинг не уверен — лучше короткий `name` или `№` без выдуманных полей.

Метки через ` · `:

| Правило | Текст метки |
|---------|-------------|
| R0 | `риск` |
| R1 | `крупный готов не полностью` |
| R2 | `0 готово` (если сработал только R2; если ещё R0 — достаточно `риск`, плюс R2 можно не дублировать смыслом; **v1:** всегда добавлять сработавшие метки: R0→`риск`, R1→`крупный…`, R2→`0 готово`) |

## Risk logic

### Position readiness on a deal

Пусть `items` = line items сделки с `stage !== OTMENA`.

- `total = items.length`
- `ready = count(stage === GOTOVO)`
- если `total === 0` → сделку **не** считаем в рисках (и желательно не в шапке позиций; сделка без позиций всё же может попасть в ❌ по stage opportunity)
- `pct = ready / total`

### Inclusion in ⚠

Сделка кандидатом в риски, только если она в группе **❌** (не `GOTOVO` opportunity). Затем:

| Code | Condition | Notes |
|------|-----------|--------|
| **R0** | `pct < 0.30` | Базовый «в зоне риска» |
| **R1** | `amount >= 150_000 RUB` **и** `pct < 1` (есть неотменённая не-GOTOVO позиция) | Порог **₽150 000**; метка «крупный готов не полностью» |
| **R2** | `ready === 0` **и** `total >= 2` | Нулевая готовность при ≥2 позициях |

Попадает в список, если сработало **хотя бы одно** правило.

### Scoring (R5)

Суммировать:

| Points | When |
|--------|------|
| +3 | R0 |
| +2 | R2 |
| +2 | сумма сделки в **топ-25%** сумм среди **❌** сделок этого дня (по `amount`) |
| +1 | R1 |

Сортировка: score ↓, затем amount ↓. В сообщение — первые 7; если кандидатов больше: последней строкой `… +{rest}`.

## Delivery

### Cron

- Expression: `0 9 * * *`, timezone `Europe/Moscow` (`CRM_TIMEZONE`).
- На тике: построить и отправить digest для tomorrow, затем day-after-tomorrow.
- Chat id: `getChatId('digest.morning')` из settings map (как `okleyka.send`).
- Если нет token / chat id — лог + skip (не падать процессу).
- Ошибки Twenty / Bot API — лог; не ретраить бесконечно в том же тике (один attempt на день-сообщение достаточно для v1).

### Commands

- `/завтра`, `/послезавтра` (и при желании алиасы без слэша в webhook handler — только эти две в v1).
- Ответ в **chat_id апдейта** (группа/личка, откуда пришла команда).
- То же тело, что утренний digest для соответствующего дня.

### Settings

- Расширить `telegram_chat_map`: ключ `digest.morning`.
- Settings UI: показать ключ рядом с оклейкой (минимально — то же JSON-редактирование map, если отдельного UI нет).

## Architecture

```
cron 09:00 MSK ──┐
/завтра|/послезавтра ──┼──► digest service (crmparser)
                       │      load opportunities by loadDate
                       │      load line items (exclude OTMENA)
                       │      header + risks + render text
                       └──► Bot API sendMessage
```

Рекомендуемые модули (имена ориентировочные):

| Module | Role |
|--------|------|
| `telegram/digest/compute.js` | Чистые: filter day, ✔️/❌, pct, R0/R1/R2, score, sort |
| `telegram/digest/render.js` | Текст сообщения |
| `telegram/digest/run.js` | Fetch Twenty + send |
| `telegram/digest-cron.js` | node-cron 09:00 |
| inbound webhook / commands | Parse `/завтра`, `/послезавтра` |

Переиспользовать существующие Twenty GraphQL/REST helpers crmparser и `outbound` Bot API, не плодить второй HTTP-клиент Telegram.

## Data dependencies (Twenty)

Per opportunity in day window: `id`, `name`, `stage`, `loadDate`, `amount`, `companyName` (or company relation).  
Per line item: `id`, `opportunityId`, `stage`.

Date window: local calendar day bounds for tomorrow / day-after-tomorrow in `CRM_TIMEZONE`, consistent with deals-board presets.

## Error handling

| Case | Behavior |
|------|----------|
| Empty day | Шапка с нулями; риски `нет` |
| Twenty down | Log; command → короткое «не удалось загрузить»; cron skip |
| Missing digest chat (cron) | Log skip |
| Command in chat without bot | Standard Telegram (no reply) |

## Testing

Unit (no network):

- Day filter + OTMENA exclusion
- ✔️/❌ partition and header sums
- R0 / R1 / R2 edge cases (0 positions, exactly 30%, 150k boundary, 1 position with 0 ready → not R2)
- Score ordering and top-7 + remainder
- Render snapshot (stable money format)

Light integration: cron registers `0 9 * * *` with timezone; command router maps texts to day offsets.

## Success criteria

1. В 09:00 MSK в `digest.morning` приходят два сообщения ожидаемого формата.
2. `/завтра` и `/послезавтра` дают тот же расчёт в чат вызова.
3. Риски совпадают с правилами R0/R1/R2 и сортировкой по скору.
4. Отмены не влияют на счётчики и риски.
