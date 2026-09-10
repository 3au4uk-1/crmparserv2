# Deal Stage Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the deals board, «Стадия» filters `opportunity.stage`; «Стадия позиции» remains a separate line-item stage filter.

**Architecture:** Split `DealBoardFilters.stages` into `opportunityStages` (GraphQL `opportunity.stage in`) and `lineItemStages` (existing REST/client line-item filter). FilterBar gets two builder fields. Saved `lineItem.stage` clauses are not rewritten.

**Tech Stack:** TwentyView (`yarn test:unit`), TypeScript, GraphQL opportunity filter, existing FilterClause model.

**Spec:** `docs/superpowers/specs/2026-09-10-deal-stage-filter-unit-amounts-export-design.md` §1

## Global Constraints

- Do not change scoreboard, `syncDealStage`, BrandingTeamApp, or line-item stage enums.
- Do not migrate saved view clauses from `lineItem.stage` to `deal.stage`.
- `migrateLegacyFilters` must still map array `filters.stages` → `lineItem.stage`.
- REST `LineItemQueryFilters.stages` stays line-item stages; never pass deal stages there.
- Chip labels: deal stage uses `getOpportunityStageLabel`; line-item stage uses `getStageLabel`.

## File structure

- Modify: `src/deals-board/types.ts` — add `opportunityStages` / `lineItemStages`
- Modify: `src/deals-board/filter-model/clauses-to-deal-board-filters.ts`
- Modify: `src/deals-board/filter-model/format-clause-label.ts`
- Modify: `src/deals-board/utils/search.ts` — GraphQL `stage in`
- Modify: `src/deals-board/FilterBar.tsx` — two builder fields
- Modify: `src/deals-board/DealsBoard.tsx` — `lineItemQueryFilters` from `lineItemStages`
- Modify: `src/deals-board/api/opportunities.ts` — same mapping on legacy fetch
- Modify: `src/deals-board/filter-model/filter-session-bridge.ts` — QuickFilters `stages` ← `lineItemStages`

---

### Task 1: Split filter model (`opportunityStages` vs `lineItemStages`)

**Files:**
- Modify: `src/deals-board/types.ts`
- Modify: `src/deals-board/filter-model/clauses-to-deal-board-filters.ts`
- Modify: `src/deals-board/filter-model/clauses-to-deal-board-filters.test.ts`
- Modify: `src/deals-board/filter-model/format-clause-label.ts`
- Create: `src/deals-board/filter-model/format-clause-label.test.ts`
- Modify: `src/deals-board/filter-model/filter-session-bridge.ts`

**Interfaces:**
- Consumes: `FilterClause` `{ level, field, operator, value }`
- Produces: `DealBoardFilters.opportunityStages?: OpportunityStage[]`, `DealBoardFilters.lineItemStages?: LineItemStage[]`. Stop populating `stages` from clauses.

- [ ] **Step 1: Write the failing tests**

In `clauses-to-deal-board-filters.test.ts` change the line-item stage example to expect `lineItemStages` (not `stages`), and add:

```ts
it('maps deal stage in-clause to opportunityStages', () => {
  const clauses: FilterClause[] = [
    { id: '1', level: 'deal', field: 'stage', operator: 'in', value: ['V_RABOTE', 'OTCHET_STAS'] },
  ];
  expect(clausesToDealBoardFilters(clauses)).toEqual({
    opportunityStages: ['V_RABOTE', 'OTCHET_STAS'],
    lineItemStages: undefined,
    stages: undefined,
    types: undefined,
    companyIds: undefined,
    oplata: 'all',
  });
});
```

Update every existing test that expected `stages: ['NOVYY', …]` from a `lineItem` clause to `lineItemStages` and `stages: undefined`.

Create `format-clause-label.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatFilterClauseLabel } from './format-clause-label';

describe('formatFilterClauseLabel', () => {
  it('labels deal stage as Стадия with opportunity captions', () => {
    expect(
      formatFilterClauseLabel({
        id: '1',
        level: 'deal',
        field: 'stage',
        operator: 'in',
        value: ['OTCHET_STAS', 'DUBL'],
      }),
    ).toBe('Стадия: Отчёт Стас, ДУБЛЬ');
  });

  it('labels lineItem stage as Стадия позиции', () => {
    expect(
      formatFilterClauseLabel({
        id: '1',
        level: 'lineItem',
        field: 'stage',
        operator: 'in',
        value: ['V_PECHATI'],
      }),
    ).toBe('Стадия позиции: В печати');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn test:unit src/deals-board/filter-model/clauses-to-deal-board-filters.test.ts src/deals-board/filter-model/format-clause-label.test.ts`

Expected: FAIL — still maps to `stages`; no «Стадия позиции» label.

- [ ] **Step 3: Implement mapping and labels**

`types.ts` — import `OpportunityStage` and replace `stages?: LineItemStage[]` with:

```ts
opportunityStages?: OpportunityStage[];
lineItemStages?: LineItemStage[];
/** @deprecated Prefer lineItemStages. Only migrateLegacyFilters reads this. */
stages?: LineItemStage[];
```

`clauses-to-deal-board-filters.ts`:

```ts
stages: undefined,
opportunityStages: collectInValues(clauses, 'deal', 'stage') as DealBoardFilters['opportunityStages'],
lineItemStages: collectInValues(clauses, 'lineItem', 'stage') as DealBoardFilters['lineItemStages'],
```

`format-clause-label.ts` — import `getOpportunityStageLabel`. For `clause.field === 'stage'`:

```ts
const fieldLabel = clause.level === 'lineItem' ? 'Стадия позиции' : 'Стадия';
const labelForValue = clause.level === 'deal' ? getOpportunityStageLabel : getStageLabel;
return `${fieldLabel}: ${formatValueList(clause.value, labelForValue)}`;
```

`filter-session-bridge.ts`: `stages: boardFilters.lineItemStages ?? []` in `filterSessionToQuickFilters`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test:unit src/deals-board/filter-model/clauses-to-deal-board-filters.test.ts src/deals-board/filter-model/format-clause-label.test.ts src/deals-board/filter-model/migrate-legacy-filters.test.ts`

Expected: PASS. Legacy migrate still emits `lineItem` + `stage`.

- [ ] **Step 5: Commit**

```bash
git add src/deals-board/types.ts src/deals-board/filter-model
git commit -m "feat: split deal vs line-item stage filter clauses"
```

---

### Task 2: GraphQL opportunity.stage filter

**Files:**
- Modify: `src/deals-board/utils/search.ts`
- Modify: `src/deals-board/utils/search.test.ts`

**Interfaces:**
- Consumes: `DealBoardFilters.opportunityStages`
- Produces: `buildOpportunityFilter` adds `{ stage: { in: opportunityStages } }` inside `and`.

- [ ] **Step 1: Write the failing test**

In `search.test.ts` `describe('buildOpportunityFilter')`:

```ts
it('adds opportunity stage in-filter', () => {
  expect(
    buildOpportunityFilter({ opportunityStages: ['V_RABOTE', 'DUBL'] }),
  ).toEqual({
    and: [{ stage: { in: ['V_RABOTE', 'DUBL'] } }],
  });
});

it('does not treat lineItemStages as opportunity.stage', () => {
  expect(buildOpportunityFilter({ lineItemStages: ['OKLEYKA'] })).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test:unit src/deals-board/utils/search.test.ts`

Expected: FAIL — no `stage` clause.

- [ ] **Step 3: Implement**

In `buildOpportunityFilter` after the companyIds block:

```ts
const opportunityStages = filters.opportunityStages?.filter(Boolean) ?? [];
if (opportunityStages.length > 0) {
  and.push({ stage: { in: opportunityStages } });
}
```

- [ ] **Step 4: Run tests**

Run: `yarn test:unit src/deals-board/utils/search.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/deals-board/utils/search.ts src/deals-board/utils/search.test.ts
git commit -m "feat: filter opportunities by deal stage in GraphQL"
```

---

### Task 3: FilterBar + fetch wiring

**Files:**
- Modify: `src/deals-board/FilterBar.tsx`
- Modify: `src/deals-board/DealsBoard.tsx`
- Modify: `src/deals-board/api/opportunities.ts`

**Interfaces:**
- Consumes: Task 1 `opportunityStages` / `lineItemStages`
- Produces: Builder fields `deal/stage` (OPPORTUNITY_STAGES) and `lineItem/stage` (LINE_ITEM_STAGES). `LineItemQueryFilters.stages` only from `lineItemStages`.

- [ ] **Step 1: Write the failing wiring test**

If `DealsBoard` has no unit test for this mapping, add a tiny helper next to `clausesToDealBoardFilters` usage — or extend `clauses-to-deal-board-filters.test.ts` with the documented fetch mapping (already done in Task 1). Then add an assertion in `src/deals-board/api/opportunities.ts` via existing tests: open `src/deals-board/api/line-items.test.ts` and keep REST `stage[in]` as line-item only.

Add to `clauses-to-deal-board-filters.test.ts`:

```ts
it('keeps deal and line-item stages independent', () => {
  const clauses: FilterClause[] = [
    { id: '1', level: 'deal', field: 'stage', operator: 'in', value: ['NOVYY'] },
    { id: '2', level: 'lineItem', field: 'stage', operator: 'in', value: ['OKLEYKA'] },
  ];
  const result = clausesToDealBoardFilters(clauses);
  expect(result.opportunityStages).toEqual(['NOVYY']);
  expect(result.lineItemStages).toEqual(['OKLEYKA']);
});
```

- [ ] **Step 2: Run it**

Run: `yarn test:unit src/deals-board/filter-model/clauses-to-deal-board-filters.test.ts`

Expected: PASS after Task 1; if not, implement the dual collect in Task 1 first.

- [ ] **Step 3: Wire UI and fetch**

`FilterBar.tsx` — import `OPPORTUNITY_STAGES`. Replace the single stage builder field with:

```ts
{
  level: 'deal',
  field: 'stage',
  label: 'Стадия',
  kind: 'multi-select',
  options: OPPORTUNITY_STAGES,
},
{
  level: 'lineItem',
  field: 'stage',
  label: 'Стадия позиции',
  kind: 'multi-select',
  options: LINE_ITEM_STAGES,
},
```

Keep tip/company/oplata as they are. `upsertClause` already matches on `level + field`, so two `stage` fields do not collide.

`DealsBoard.tsx` `lineItemQueryFilters`:

```ts
mergedFilters.lineItemStages?.length || mergedFilters.types?.length
  ? { stages: mergedFilters.lineItemStages, types: mergedFilters.types }
  : undefined
```

`opportunities.ts` around the `lineItemSearchFilters` block:

```ts
params.filters.lineItemStages?.length || params.filters.types?.length
  ? { stages: params.filters.lineItemStages, types: params.filters.types }
  : undefined
```

Do not pass `opportunityStages` into `LineItemQueryFilters`.

- [ ] **Step 4: Run unit tests**

Run: `yarn test:unit src/deals-board/filter-model src/deals-board/utils/search.test.ts src/deals-board/api/line-items.test.ts src/deals-board/api/opportunities.ts`

Expected: PASS. Fix any `filters.stages` TypeScript errors by switching to `lineItemStages`.

- [ ] **Step 5: Commit**

```bash
git add src/deals-board/FilterBar.tsx src/deals-board/DealsBoard.tsx src/deals-board/api/opportunities.ts
git commit -m "feat: FilterBar deal stage plus position stage"
```
