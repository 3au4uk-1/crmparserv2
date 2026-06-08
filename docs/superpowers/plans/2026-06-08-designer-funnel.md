# Designer Funnel (Twenty CRM) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a designer Kanban funnel in Twenty CRM that shows only deals with a non-empty `dizayn` status, grouped by design stages, accessible via a sidebar item **Дизайн**.

**Architecture:** No code changes — configure Twenty CRM via MCP (`user-twenty`). Create a filtered KANBAN view on the existing `opportunity` object, grouped by `dizayn`, then pin it in workspace navigation. Same records as the main funnel; drag-and-drop updates `dizayn`.

**Tech Stack:** Twenty CRM workspace (MCP `user-twenty`), tools: `create_view`, `create_view_filter`, `create_many_view_fields`, `create_navigation_menu_item`, `find_many_opportunities`, `update_one_opportunity`, `get_view_query_parameters`, `navigate_app`.

**Spec:** `docs/superpowers/specs/2026-06-08-designer-funnel-design.md`

---

## Workspace Constants

| Constant | Value |
|----------|-------|
| Object | `opportunity` (Сделки) |
| Object metadata ID | `806bcba5-5967-477f-a989-06afd3ea1d24` |
| Design field `dizayn` metadata ID | `be72d60f-13c8-450e-97bf-f947291f46b4` |
| Reference view (By Stage) | `5a704b48-3909-470a-90ff-371116222fdd` |
| Calendar nav position | `2.5` → designer nav at `2.6` |
| Test deal ID | `0ac186e8-2e71-49c2-8e1b-ad3319f80f64` |

### Card field metadata IDs

| Field | metadata ID |
|-------|-------------|
| `name` | `69acfafb-b530-41af-a1a8-67bd53f858e8` |
| `amount` | `b01d2233-4f5d-4546-a88b-010fc376f101` |
| `closeDate` | `0b965158-b133-4016-975e-fdc804e640fe` |
| `pointOfContact` | `21ffe616-d134-4395-9db1-87fb43cf985e` |
| `tonyLink` | `4188be4f-ae82-4449-8d73-1ba284afe868` |
| `stage` | `66d8f1af-34e2-4982-985a-0e6cec3992c9` |

---

### Task 1: Preflight — confirm field and no duplicate view

**Tools:** `get_field_metadata`, `get_views`

- [ ] **Step 1: Verify `dizayn` field options**

```json
execute_tool("get_field_metadata", {
  "objectMetadataId": "806bcba5-5967-477f-a989-06afd3ea1d24",
  "limit": 100
})
```

Expected: field `dizayn` has exactly 5 options — NUZHEN, RAZRABOTKA, PROVERKA, PRAVKI, GOTOVO (no NE_NUZHEN).

- [ ] **Step 2: Check no existing «Дизайн» view**

```json
execute_tool("get_views", {})
```

Expected: no KANBAN view named «Дизайн» on `806bcba5-5967-477f-a989-06afd3ea1d24`. If one exists, skip Task 2 creation and use existing view ID.

---

### Task 2: Create Kanban view «Дизайн»

**Tools:** `create_view`

- [ ] **Step 1: Create the view**

```json
execute_tool("create_view", {
  "name": "Дизайн",
  "objectNameSingular": "opportunity",
  "type": "KANBAN",
  "icon": "IconPencilHeart",
  "visibility": "WORKSPACE",
  "mainGroupByFieldName": "dizayn",
  "fieldNames": ["name", "amount", "closeDate", "pointOfContact", "tonyLink", "stage"]
})
```

Expected: response contains new `viewId` (save as `DESIGN_VIEW_ID`).

- [ ] **Step 2: Verify view fields if `fieldNames` did not apply**

```json
execute_tool("get_view_fields", { "viewId": "DESIGN_VIEW_ID" })
```

Expected: 6 visible fields — name, amount, closeDate, pointOfContact, tonyLink, stage.

If fewer than 6, run Task 3 fallback.

---

### Task 3: Configure card fields (fallback if Task 2 incomplete)

**Tools:** `create_many_view_fields`

Skip if Task 2 already created all 6 fields.

- [ ] **Step 1: Add missing view fields**

```json
execute_tool("create_many_view_fields", {
  "viewFields": [
    { "viewId": "DESIGN_VIEW_ID", "fieldMetadataId": "69acfafb-b530-41af-a1a8-67bd53f858e8", "isVisible": true, "size": 150, "position": 0 },
    { "viewId": "DESIGN_VIEW_ID", "fieldMetadataId": "b01d2233-4f5d-4546-a88b-010fc376f101", "isVisible": true, "size": 150, "position": 1 },
    { "viewId": "DESIGN_VIEW_ID", "fieldMetadataId": "0b965158-b133-4016-975e-fdc804e640fe", "isVisible": true, "size": 150, "position": 2 },
    { "viewId": "DESIGN_VIEW_ID", "fieldMetadataId": "21ffe616-d134-4395-9db1-87fb43cf985e", "isVisible": true, "size": 150, "position": 3 },
    { "viewId": "DESIGN_VIEW_ID", "fieldMetadataId": "4188be4f-ae82-4449-8d73-1ba284afe868", "isVisible": true, "size": 100, "position": 4 },
    { "viewId": "DESIGN_VIEW_ID", "fieldMetadataId": "66d8f1af-34e2-4982-985a-0e6cec3992c9", "isVisible": true, "size": 150, "position": 5 }
  ]
})
```

Expected: success, 6 view fields created.

---

### Task 4: Add filter `dizayn IS_NOT_EMPTY`

**Tools:** `create_view_filter`, `get_view_query_parameters`

- [ ] **Step 1: Create filter**

```json
execute_tool("create_view_filter", {
  "viewId": "DESIGN_VIEW_ID",
  "fieldMetadataId": "be72d60f-13c8-450e-97bf-f947291f46b4",
  "operand": "IS_NOT_EMPTY",
  "value": ""
})
```

Expected: filter created successfully.

- [ ] **Step 2: Verify filter on view**

```json
execute_tool("get_view_query_parameters", { "viewId": "DESIGN_VIEW_ID" })
```

Expected: filter includes `dizayn IS_NOT_EMPTY`; view type KANBAN; groupBy `dizayn`.

---

### Task 5: Add sidebar navigation item

**Tools:** `create_navigation_menu_item`, `list_navigation_menu_items`

- [ ] **Step 1: Create nav item**

```json
execute_tool("create_navigation_menu_item", {
  "type": "VIEW",
  "scope": "workspace",
  "viewId": "DESIGN_VIEW_ID",
  "name": "Дизайн",
  "icon": "IconPencilHeart",
  "color": "jade",
  "position": 2.6
})
```

Expected: navigation item created with label **Дизайн**.

- [ ] **Step 2: Verify nav menu**

```json
execute_tool("list_navigation_menu_items", {})
```

Expected: item with `viewId: DESIGN_VIEW_ID`, position ~2.6, between Сделки and Задачи.

- [ ] **Step 3: Open view in app**

```json
execute_tool("navigate_app", {
  "type": "navigateToView",
  "viewName": "Дизайн"
})
```

Expected: Kanban opens with 5 columns (Нужен → Готово), currently empty.

---

### Task 6: End-to-end verification

**Tools:** `update_one_opportunity`, `find_many_opportunities`, `get_view_query_parameters`

- [ ] **Step 1: Set test deal to «Нужен»**

```json
execute_tool("update_one_opportunity", {
  "id": "0ac186e8-2e71-49c2-8e1b-ad3319f80f64",
  "dizayn": "NUZHEN"
})
```

Expected: `dizayn` = `NUZHEN` in response.

- [ ] **Step 2: Confirm deal matches view filter**

```json
execute_tool("find_many_opportunities", {
  "limit": 10,
  "offset": 0,
  "select": ["name", "dizayn", "stage"],
  "dizayn": { "is": "NOT_NULL" }
})
```

Expected: count ≥ 1, includes test deal with `dizayn: "NUZHEN"`.

- [ ] **Step 3: Move deal to «Разработка»**

```json
execute_tool("update_one_opportunity", {
  "id": "0ac186e8-2e71-49c2-8e1b-ad3319f80f64",
  "dizayn": "RAZRABOTKA"
})
```

Expected: `dizayn` = `RAZRABOTKA`.

- [ ] **Step 4: Clear design status — deal leaves funnel**

```json
execute_tool("update_one_opportunity", {
  "id": "0ac186e8-2e71-49c2-8e1b-ad3319f80f64",
  "dizayn": null
})
```

Note: if `null` is rejected by API, use UI or check whether a dedicated clear field syntax exists. Expected: `dizayn` is empty/null; `find_many_opportunities` with `dizayn: { is: "NOT_NULL" }` no longer returns this deal.

- [ ] **Step 5: Manual UI check**

Open sidebar **Дизайн** in Twenty CRM:
- 5 kanban columns in order: Нужен, Разработка, Проверка, Правки, Готово
- Cards show name, amount, closeDate, contact, Tony link, stage
- Dragging a card between columns updates `dizayn`

---

### Task 7: Commit plan document

**Files:**
- Create: `docs/superpowers/plans/2026-06-08-designer-funnel.md`

- [ ] **Step 1: Commit**

```bash
cd "C:\Users\Василий\Documents\projects\crmparserv2"
git add docs/superpowers/plans/2026-06-08-designer-funnel.md
git commit -m "docs: add designer funnel implementation plan for Twenty CRM."
```

Expected: commit succeeds, working tree clean.

---

## Spec Coverage Checklist

| Spec requirement | Task |
|------------------|------|
| KANBAN on opportunity | Task 2 |
| Group by `dizayn` | Task 2 |
| Filter `dizayn IS_NOT_EMPTY` | Task 4 |
| Card fields (6 fields) | Task 2 / Task 3 |
| Sidebar item «Дизайн» | Task 5 |
| Drag updates `dizayn` | Task 6 Step 5 (manual) |
| Verification checklist | Task 6 |
