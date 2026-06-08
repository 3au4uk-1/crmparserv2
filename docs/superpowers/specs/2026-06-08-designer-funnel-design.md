# Designer Funnel (Twenty CRM) — Design Spec

**Date:** 2026-06-08  
**Status:** Approved

## Problem

Designers need their own pipeline view in Twenty CRM, similar to the main Opportunities kanban (`By Stage`), but showing only deals where the custom **Дизайн** field is filled in. Managers work in the general funnel; designers need a focused view without duplicate records or manual filtering.

## Goals

- Kanban funnel for designers on the same **Сделки** (Opportunity) object.
- Show deals only when `dizayn` is not empty.
- Group columns by design status (`dizayn`), not sales stage (`stage`).
- Separate sidebar navigation item **Дизайн** for quick access.
- Drag-and-drop between columns updates `dizayn` on the same record visible in both funnels.

## Non-Goals

- Creating a separate custom object or duplicating deal data.
- Role-based access control (all workspace members see the view).
- Workflows or automation for status transitions.
- Hiding deals with status «Готово» (they remain visible while `dizayn` is set).

---

## Current State

| Item | Value |
|------|-------|
| Object | Opportunity (`opportunity`), label **Сделки** |
| Main funnel | View **By Stage** — KANBAN grouped by `stage` |
| Design field | `dizayn` (SELECT), label **Дизайн** |
| Design statuses | Нужен → Разработка → Проверка → Правки → Готово |
| Removed option | «Не нужен» (`NE_NUZHEN`) — no longer in field options |
| Filter rule | `dizayn IS_NOT_EMPTY` |

---

## Architecture

```
Manager in general funnel (By Stage)
        │
        │  sets dizayn = Нужен / Разработка / ...
        ▼
Same Opportunity record
        │
        │  filter: dizayn IS_NOT_EMPTY
        ▼
Designer funnel (Kanban by dizayn)
        │
        │  designer drags cards between columns
        ▼
dizayn updated → visible in both funnels
```

- One object, one set of records, two views.
- No data duplication; changes are immediately reflected everywhere.

---

## Approach (Selected)

**Filtered Kanban view + navigation menu item** (recommended over separate object or table-only view).

| Approach | Verdict |
|----------|---------|
| Filtered Kanban + nav item | **Selected** — minimal setup, native drag-and-drop |
| Separate custom object | Rejected — duplication and sync overhead |
| Table view with filter | Rejected — not a funnel, no stage drag-and-drop |

---

## View Configuration

### Kanban view «Дизайн»

| Parameter | Value |
|-----------|-------|
| Object | `opportunity` |
| Type | `KANBAN` |
| Group by | `dizayn` |
| Icon | `IconPencilHeart` |
| Visibility | `WORKSPACE` |

### Filter

| Field | Operand | Value |
|-------|---------|-------|
| `dizayn` (`be72d60f-13c8-450e-97bf-f947291f46b4`) | `IS_NOT_EMPTY` | `""` |

### Kanban columns (in order)

1. Нужен (`NUZHEN`)
2. Разработка (`RAZRABOTKA`)
3. Проверка (`PROVERKA`)
4. Правки (`PRAVKI`)
5. Готово (`GOTOVO`)

### Card fields

Same as main funnel **By Stage**, plus sales context for the designer:

| Field | Purpose |
|-------|---------|
| `name` | Deal name |
| `amount` | Deal amount |
| `closeDate` | Close / deadline date |
| `pointOfContact` | Contact person |
| `tonyLink` | Link to Tony CRM |
| `stage` | Position in general sales funnel |

---

## Navigation

| Parameter | Value |
|-----------|-------|
| Label | **Дизайн** |
| Type | `VIEW` (same pattern as **Календарь**) |
| Icon | `IconPencilHeart` |
| Position | After Сделки / Календарь (~2.6) |
| Target | New Kanban view ID |

---

## Behavior

| Action | Result |
|--------|--------|
| Manager sets `dizayn` in general funnel | Deal appears in designer funnel |
| Designer drags card to another column | `dizayn` updates on the record |
| Designer moves to «Готово» | Deal stays in funnel (field not empty) |
| Manager clears `dizayn` | Deal disappears from designer funnel |
| Legacy `NE_NUZHEN` values (if any remain) | Still visible until field is cleared |

---

## Edge Cases

- Empty `dizayn`: deal excluded from designer funnel.
- All 20 current deals have empty `dizayn`: funnel is empty until managers assign design status.
- No custom error handling required — standard Twenty view/filter/kanban behavior.

---

## Verification

1. Set `dizayn = Нужен` on a test deal → appears in **Дизайн** column «Нужен».
2. Drag to «Разработка» → `dizayn` updates to `RAZRABOTKA`.
3. Clear `dizayn` → deal removed from designer funnel.
4. Sidebar item **Дизайн** opens the Kanban view.
5. `stage` on card reflects position in general funnel.

---

## Implementation Steps (High Level)

1. Create KANBAN view «Дизайн» on `opportunity` with `mainGroupByFieldName: dizayn`.
2. Add view filter `dizayn IS_NOT_EMPTY`.
3. Configure card fields: name, amount, closeDate, pointOfContact, tonyLink, stage.
4. Create navigation menu item **Дизайн** pointing to the view.
5. Run verification checklist above.
