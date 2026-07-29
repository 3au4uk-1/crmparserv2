# Settings direction switcher + «Не наше» lists

**Дата:** 2026-07-29  
**Статус:** Утверждён к написанию плана реализации  
**Репозитории:** `crmparserv2` (staging), `BrandingTwentyView`

## Проблема

1. Вкладка **Парсинг** после группировки по направлениям всё ещё длинная: до блока «Декор и МК» нужно долго скроллить.
2. Нужна категория **«не наше»**: позиции не участвуют в марже (сумма обнуляется). Список свой для каждого направления. В TwentyView уже есть меню списков позиции (блеклист, реставрация, …) — туда нужна такая же кнопка.

## Цель

1. Сегментированный переключатель направлений наверху вкладки «Парсинг»: видно только выбранное направление.
2. Два независимых списка паттернов «Не наше» (брендинг / декор-МК): матч → синк в Twenty с **суммой 0 ₽** (как реставрация).
3. В TwentyView: действие в меню списков позиции на соответствующей доске.

## Не в scope (v1)

- Новое CRM-поле Twenty на `dealLineItem` (только list-status + amount 0).
- Связь с tipDetail `NE_NASHI` («Не наши» у плёнки/рест.) — **не трогаем**, механики независимы.
- Три отдельных списка (брендинг / декор / МК) — нет: для декор+МК один список направления.
- Автосмена tip / tipDetail при добавлении в «не наше».

## Решения (зафиксировано)

| Тема | Выбор |
|------|--------|
| UX направлений | Сегмент A/B, рендер только выбранного блока |
| Модель «не наше» | Список паттернов как restoration → amount 0 |
| Списки | Два: branding и decor_mk |
| TwentyView | Кнопка в `LineItemListMenu` / `LINE_ITEM_LIST_ACTIONS` |
| tipDetail `NE_NASHI` | Без изменений |

## Подход реализации

**Зеркало реставрации:** отдельные таблицы + CRUD + обнуление в `computeLineItemTotal` + list API для TwentyView.

Отклонены: одна таблица с `direction`; tip-rule с новым tip.

---

## 1. Settings UI (`crmparserv2`)

Файл: `frontend/src/pages/Settings.jsx`

### Переключатель

Наверху вкладки `parsing`:

```
[ Брендинг и производство ]  [ Декор и МК ]
```

- `useState<'branding' | 'decor_mk'>('branding')`
- Рендер только выбранного `DirectionGroup`
- Ниже всегда: «Расписание парсинга», «Режим апрува»

### Секции «Не наше»

| Направление | Порядок внутри группы |
|-------------|------------------------|
| Брендинг и производство | keywords → blacklist → **Не наше (брендинг)** → restoration → tip-zones |
| Декор и МК | decor KW → mk KW → decor BL → mk BL → **Не наше (декор/МК)** |

UI формы — как у реставрации (паттерн, exact/substring, чипы удаления).

Описание секции: позиции из списка синкаются с суммой 0 ₽; tipDetail «Не наши» не затрагивается.

---

## 2. Backend (`crmparserv2`)

### Схема

Две таблицы по образцу `restoration_items`:

- `ne_nashe_branding_items`
- `ne_nashe_decor_mk_items`

Поля: `id`, `pattern`, `match_type` (`exact`|`substring`), `source_name`, timestamps / unique как у restoration.

Миграция в `backend/src/db/migrate.js`.

### Сервисы

Модули по аналогии с `restoration.js` / `decor-blacklist.js`:

- `find*Match` / `is*` / `load*` / `create*` / `delete*`
- `normalizePattern` из blacklist

### Сумма

В `computeLineItemTotal` (и согласованно в enrichment):

```
if (restoration OR neNasheBranding OR neNasheDecorMk) → 0
```

Позиция остаётся **eligible** для Twenty (как restoration), уходит с amount 0.

### API

- Settings CRUD routes (GET/POST/DELETE) для обоих списков — зеркало restoration/blacklist.
- Twenty list API:
  - list names: `ne_nashe_branding`, `ne_nashe_decor_mk`
  - list-status flags: `neNasheBrandingMatch`, `neNasheDecorMkMatch`
- `pattern-lists-cache` / `enrichDealItems` / `twenty-line-item-api` — прокинуть оба списка.

---

## 3. TwentyView (`BrandingTwentyView`)

- `src/deals-board/api/crmparser.ts` — расширить `ListName` и status-типы.
- `src/deals-board/line-item-list-actions.ts`:
  - branding board: `{ list: 'ne_nashe_branding', label: 'В не наше', shortLabel: 'НН', … }`
  - decor_mk board: `{ list: 'ne_nashe_decor_mk', label: 'В не наше', shortLabel: 'НН', … }`
- Обновить `filterActionsForBoardStream` и тесты.
- Logic-function / proxy list-status — прокинуть новые флаги (как для restoration).

После изменений app: sync (`yarn twenty apply`) на целевой стенд при выкладке.

---

## Поток данных

```
Settings / TwentyView menu
  → CRUD ne_nashe_*_items
  → parse/sync: match by name
  → computeLineItemTotal → 0
  → Twenty dealLineItem.amount = 0
  → list-status → active chip in LineItemListMenu
```

## Критерии готовности

1. На «Парсинг» переключатель показывает только одно направление без длинного скролла между блоками.
2. Добавление паттерна в «Не наше (брендинг)» обнуляет сумму матчующих позиций при синке.
3. То же для «Не наше (декор/МК)» независимо.
4. На доске Реализация / МК и Декор в меню позиции есть «В не наше»; после добавления флаг активен в list-status.
5. tipDetail `NE_NASHI` и списки «не наше» не влияют друг на друга.
