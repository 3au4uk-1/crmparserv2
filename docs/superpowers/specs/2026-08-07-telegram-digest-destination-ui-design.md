# Telegram: separate digest destination from okleyka.send

**Date:** 2026-08-07  
**Status:** Approved for planning  
**Scope:** crmparserv2 Telegram page + chat map + digest commands  
**Related:** `2026-08-06-telegram-morning-digest-design.md`, `2026-08-07-digest-omni-enrichment-design.md`

## Problem

Оклейка (`okleyka.send`) и утренняя сводка должны уходить в **разные** чаты/темы. Бэкенд уже использует отдельный ключ `digest.morning`, но UI редактирует только оклейку; digest упомянут в description. Команды `/завтра` и `/послезавтра` сейчас отвечают в чат вызова. На staging/prod `digest.morning` не задан.

## Goals / non-goals

| In (v1) | Out (v1) |
|---------|----------|
| Отдельная секция UI «Утренняя сводка» (чат + тема + сохранить + тест) | Общий DestinationPicker-рефактор |
| «Оклейка → отправка» только про `okleyka.send` | Отдельный settings-ключ вне `telegram_chat_map` |
| Нормализация `digest.morning` в `mergeChatMapEntry` | Полный дайджест в «Тест» |
| Команды всегда шлют в `digest.morning` | Редактор Omni API key в UI |
| `test-send` с выбором event | |

## Decision

Подход: зеркальная UI-секция + нормализация chat map + команды без override chat из сообщения.

## Data model

`telegram_chat_map` (JSON settings):

| Key | Purpose |
|-----|---------|
| `okleyka.send` | User-bot отправка из Twenty |
| `digest.morning` | Cron 09:00 + `/завтра` / `/послезавтра` |

Значение: `{ chatId: string, threadId?: number }` (или legacy string chatId → normalize).

Сохранение одного ключа не затирает другой (`mergeChatMapEntry`).

## UI (`Telegram.jsx`)

### Оклейка → отправка

- Чат / тема / «Сохранить назначение» / «Тест в чат» → `okleyka.send`
- Description: только оклейка (без digest/Omni)

### Утренняя сводка (новая секция)

- Тот же паттерн → `digest.morning`
- «Тест в чат» → ping в назначение дайджеста
- Description: Omni ops (`digest_omni_api_key` / `OMNI_API_KEY`, model default, fallback `auto`)
- Если назначение пусто — подсказка, что cron и команды не отправят сводку

## Backend

### `mergeChatMapEntry`

Нормализовать `digest.morning` так же, как `okleyka.send` (через существующий `normalizeOkleykaDestination` или общий alias `normalizeChatDestination`).

### Commands (`inbound.js` → `runDigestForDay`)

- Вызов **без** `chatId` / `threadId` из сообщения → destination только из `digest.morning`
- Ошибки / missing dest / no token → короткая ошибка **в чат вызова** (как сейчас при `ok: false`)

### Cron (`runMorningDigests`)

Без изменений поведения (уже `digest.morning`).

### `POST /api/telegram/test-send`

Body optional: `{ event?: 'okleyka.send' | 'digest.morning' }`  
Default: `okleyka.send` (совместимость).

| event | Transport | Text |
|-------|-----------|------|
| `okleyka.send` | user-bot | «Тест из crmparser» |
| `digest.morning` | bot API | «Тест утренней сводки» |

400 если соответствующее назначение не задано.

## Error handling

| Case | Behavior |
|------|----------|
| `digest.morning` missing (cron) | Skip + log (как сейчас) |
| `digest.morning` missing (command) | Error reply in invoking chat |
| Omni fail | Unrelated; digest still sends rule-only text |

## Tests

- `mergeChatMapEntry`: normalize `digest.morning`; preserve sibling `okleyka.send`
- Command path: does not pass message chat into `runDigestForDay`; missing dest → error to invoke chat
- `test-send` with `event=digest.morning` (mocked send)

## Ops after deploy

В UI выбрать **другой** чат/тему для «Утренняя сводка» (не совпадающий с оклейкой). Пока `digest.morning` пуст — cron и команды сводку не отправят.

## Success criteria

1. UI: две секции, независимые назначения.
2. `/завтра` уходит только в `digest.morning`.
3. Оклейка test/send не затрагивает digest destination.
4. Staging/prod можно настроить разные чаты без ручного JSON.
