# Free-entry: вайтлист после нормализации имени

**Дата:** 2026-08-19  
**Статус:** Утверждён к написанию плана реализации  
**Ветка:** `staging` (crmparserv2)  
**Связанные спеки:**  
`2026-07-28-tony-free-entry-name-design.md` (нормализация имени — в силе; пункт про классификацию **заменяется** этой спекой),  
`2026-08-04-free-entry-duplicate-identity-design.md` (суффиксы дублей и match по `twenty_id` — без изменений)

## Проблема

После `normalizeFreeEntryItem` имя свободной записи становится текстом комментария Tony. Классификатор смотрит уже на это имя.

Пример: заказ Tony `169120`.

| Этап | Имя | Класс |
|---|---|---|
| HTML Tony | `БРЕНДИНГ свободная запись ( КОМЕНТАРИЙ ОБЯЗАТЕЛЕН )` | матч вайтлиста `брендинг` |
| После нормализации | `на тележку по смете` | `unclassified` |

В UI: «Ключевое слово» нет, «B Twenty: 1 из 3» — строка не авто-eligible.

Это следствие правила из спеки 2026-07-28: классифицировать только по новому `name`, без «всегда брендинг». Правило неверно для каталожной свободной записи: исходный шаблон и есть брендинг.

## Цель

Любая позиция, у которой **исходное** Tony-имя содержит подстроку `свободная запись` (case-insensitive):

1. Имя по-прежнему нормализуется из комментария (как сейчас).
2. Классификация всегда `keyword_match` (вайтлист), confidence `1.0`.
3. В LLM классификатор эта позиция **не** уходит.
4. Остальные поля и disambiguate (` (#2)`) без изменений.

На примере 169120: в парсере `на тележку по смете`, класс **«Ключевое слово»**, строка eligible для Twenty.

## Не в scope (v1)

- One-shot repair уже сохранённых `unclassified` free-entry. Они починятся при следующем реальном репарсе заказа (смена `content_hash` / ручной reparse).
- Схема SQLite: флаг `isFreeEntry` в БД не храним.
- Изменение tip-rules: по-прежнему матч по новому `name`.
- Изменение детекта: тот же `/свободная запись/i`, не сужаем до слова «брендинг» в шаблоне.
- Product stream keywords: отдельный матч по новому имени не добавляем (см. ниже fallback).

## Выбранный подход

**A. Флаг на in-memory item + force `keyword_match` в `classifyByKeywords`.**

- `normalizeFreeEntryItem`: если имя матчит `/свободная запись/i`, вернуть `{ ...item, isFreeEntry: true }` (плюс текущая подмена `name`/`comment`).
- `disambiguateDuplicateNames` уже спредит item — флаг сохранится.
- `classifyByKeywords`: если `item.isFreeEntry` → сразу `keyword_match` / `1.0`, ключевые слова по новому имени не смотрим.
- `classifyItems`: такие позиции не попадут в `unclassified` → LLM их не увидит.
- INSERT в `deal_items` перечисляет колонки явно — лишний флаг в БД не пишется.

Отклонены:

- **B.** Классифицировать по старому шаблону, потом менять имя — нужно менять порядок во всех вызовах; выбранное правило «всегда вайтлист», а не «если шаблон сам матчится».
- **C.** Ключевые слова и по шаблону, и по комментарию — комментарий вроде «на тележку по смете» всё равно не матчится, без флага снова LLM.

## Поток данных

```
Tony HTML
  → parseTonyOrder              # сырой name = шаблон, comment = комментарий
  → buildTonyItems
       normalizeFreeEntryItem   # name = comment, isFreeEntry = true
       disambiguateDuplicateNames
  → classifyByKeywords          # isFreeEntry → keyword_match
  → classifyByLlm               # только оставшиеся unclassified
  → deal_items + Twenty sync
```

Пайплайны без изменений вызовов: `parser`, `import-by-booking`, `attach-tony-booking`, `historical-export` (там `classifyByKeywords(buildTonyItems(...))` — тот же force).

## Product stream

`classifyProductStream` по-прежнему смотрит на новое имя. Если комментарий не содержит MK/декор/брендинг-ключей:

- `resolveItemProductStream` видит `keyword_match` + не blacklist → fallback **`BRANDING`**.

Это достаточный минимум («как вайтлист»). Отдельный force stream в v1 не делаем.

Blacklist / `sync_override` работают как у любой `keyword_match` позиции (по новому `name`).

## Идемпотентность и репарс

Флаг вычисляется каждый раз из сырого HTML (`parseTonyOrder` не меняется). Повторный парс с тем же Tony-снимком снова ставит `keyword_match`.

Уже лежащие в SQLite `unclassified` с именем-комментарием **не** обновятся, пока `tonyContentHash` не изменится или оператор не запустит reparse. Для 169120 после выкладки нужен reparse этого заказа.

## Тесты

1. `normalizeFreeEntryItem`: free-entry + comment → `isFreeEntry === true`, `name` = comment.
2. Обычная позиция → флага нет / `isFreeEntry` не true.
3. `classifyByKeywords`: `{ name: 'на тележку по смете', isFreeEntry: true }` + keywords без этого текста → `keyword_match`.
4. Без флага то же имя → `unclassified`.
5. `classifyItems` / `classifyByKeywords` после `buildTonyItems` на двух free-entry: оба `keyword_match`, имена из комментариев (и `#2` если комментарии одинаковые).

## Критерий готовности

На заказе вроде 169120 после репарса:

- имя = `на тележку по смете`;
- классификация = **Ключевое слово** (`keyword_match`);
- позиция в eligible для Twenty (если не blacklist / не `exclude`).
