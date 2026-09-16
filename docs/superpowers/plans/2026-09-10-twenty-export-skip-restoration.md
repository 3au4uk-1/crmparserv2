# Twenty Export Skip Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Twenty Excel export omits restoration-list positions by default; checkbox «включая реставрацию» includes them.

**Architecture:** Reuse `isRestorationItem(name, loadRestorationList(db))` (chip «Р»). `mapLineItemToRow` skips matches unless `includeRestoration`. Job + UI mirror `includeCancelled`.

**Tech Stack:** crmparserv2 backend Vitest, Express `/api/export/twenty`, `ExportTwenty.jsx`.

**Spec:** `docs/superpowers/specs/2026-09-10-deal-stage-filter-unit-amounts-export-design.md` §3

## Global Constraints

- Match parser `restoration_items` only — not `restavraciyaPechati`, not `tip === RESTAVRACIYA`.
- Default `includeRestoration = false` (including old clients that omit the field).
- Empty restoration list: skip-step matches nobody.
- If `loadRestorationList` throws, job status `failed`, no file.
- Deals sheet is built from remaining rows; expenses still attach once per deal.

## File structure

- Modify: `backend/src/services/twenty-export.js` — `mapLineItemToRow`, `runTwentyExport`
- Modify: `backend/tests/twenty-export.test.js`
- Modify: `backend/src/services/export-jobs.js` — persist flag
- Modify: `backend/src/routes/export-twenty.js`
- Modify: `backend/tests/export-twenty-routes.test.js`
- Modify: `frontend/src/pages/ExportTwenty.jsx`

---

### Task 1: Skip restoration rows in `mapLineItemToRow`

**Files:**
- Modify: `backend/src/services/twenty-export.js`
- Modify: `backend/tests/twenty-export.test.js`

**Interfaces:**
- Consumes: `isRestorationItem(name, restorationList)` from `./restoration.js`
- Produces: `mapLineItemToRow(lineItem, { from, to, includeCancelled, includeRestoration, restorationList })` returns `null` when restoration match and `includeRestoration !== true`.

- [ ] **Step 1: Write the failing tests**

In `describe('mapLineItemToRow')` in `backend/tests/twenty-export.test.js`:

```js
const restorationList = [{ id: 1, pattern: 'баннер', matchType: 'substring' }];

it('skips restoration match by default', () => {
  expect(
    mapLineItemToRow(base, {
      from: '2026-06-01',
      to: '2026-06-30',
      includeCancelled: false,
      restorationList,
    }),
  ).toBeNull();
});

it('includes restoration when includeRestoration is true', () => {
  expect(
    mapLineItemToRow(base, {
      from: '2026-06-01',
      to: '2026-06-30',
      includeCancelled: false,
      includeRestoration: true,
      restorationList,
    }),
  ).not.toBeNull();
});

it('does not skip when restoration list is empty', () => {
  expect(
    mapLineItemToRow(base, {
      from: '2026-06-01',
      to: '2026-06-30',
      includeCancelled: false,
      restorationList: [],
    }),
  ).not.toBeNull();
});
```

`base.name` is `'Баннер'`, which substring-matches `'баннер'` after `normalizePattern`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- backend/tests/twenty-export.test.js`

Working directory: `crmparserv2/backend`.

Expected: FAIL — restoration rows still mapped.

- [ ] **Step 3: Implement skip**

Import:

```js
import { isRestorationItem } from './restoration.js';
```

Change signature:

```js
export function mapLineItemToRow(lineItem, {
  from,
  to,
  includeCancelled = false,
  includeRestoration = false,
  restorationList = [],
}) {
```

After the cancelled skip, before unit/qty:

```js
if (!includeRestoration && isRestorationItem(lineItem?.name, restorationList)) {
  return null;
}
```

`buildRowsFromLineItems` already forwards `options` into `mapLineItemToRow` — keep that.

- [ ] **Step 4: Run tests**

Run: `npm test -- backend/tests/twenty-export.test.js`

Expected: PASS for the new cases; existing mapping tests still pass (default empty list).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/twenty-export.js backend/tests/twenty-export.test.js
git commit -m "feat: skip restoration positions in Twenty export rows"
```

---

### Task 2: Job, route, and load restoration list

**Files:**
- Modify: `backend/src/services/export-jobs.js`
- Modify: `backend/src/services/twenty-export.js` (`runTwentyExport`)
- Modify: `backend/src/routes/export-twenty.js`
- Modify: `backend/tests/export-twenty-routes.test.js`
- Modify: `backend/tests/export-jobs.test.js` if it snapshots job fields

**Interfaces:**
- Consumes: `loadRestorationList(db)` from `./restoration.js`, `getDb()`
- Produces: job field `includeRestoration: boolean`. `runTwentyExport(jobId, { …, includeRestoration })` loads the list; on load error sets job `failed`.

- [ ] **Step 1: Write the failing route test**

In `export-twenty-routes.test.js`:

```js
it('POST stores includeRestoration default false', async () => {
  const res = await request(createApp())
    .post('/api/export/twenty')
    .send({ from: '2026-06-01', to: '2026-06-30' });
  expect(res.status).toBe(201);
  const job = getExportJob(res.body.jobId);
  expect(job.includeRestoration).toBe(false);
});

it('POST stores includeRestoration true', async () => {
  const res = await request(createApp())
    .post('/api/export/twenty')
    .send({
      from: '2026-06-01',
      to: '2026-06-30',
      includeRestoration: true,
    });
  expect(res.status).toBe(201);
  expect(getExportJob(res.body.jobId).includeRestoration).toBe(true);
  expect(runTwentyExportMock).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ includeRestoration: true }),
  );
});
```

In `twenty-export.test.js`, extend an existing `runTwentyExport` test (the ones that already mock gql). Pass `loadRestorationListFn: () => { throw new Error('db down'); }` and assert the job `status` is `failed` and `error` is a non-empty string.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- backend/tests/export-twenty-routes.test.js`

Expected: FAIL — `includeRestoration` undefined.

- [ ] **Step 3: Implement**

`createExportJob` add `includeRestoration = false` to the destructuring and store `includeRestoration: kind === 'twenty' ? Boolean(includeRestoration) : undefined`.

Route POST: read `includeRestoration = false` from body, pass into `createExportJob` and `runTwentyExport`.

`runTwentyExport` extra args `{ includeRestoration = false }`. After credentials, before/while mapping:

```js
let restorationList = [];
if (!includeRestoration) {
  const { getDb } = await import('../db/connection.js');
  const { loadRestorationList } = await import('./restoration.js');
  restorationList = loadRestorationList(getDb());
}
```

Prefer static imports at top of `twenty-export.js` instead of dynamic import:

```js
import { getDb } from '../db/connection.js';
import { loadRestorationList } from './restoration.js';
```

Then:

```js
const restorationList = includeRestoration ? [] : loadRestorationList(getDb());
const rows = buildRowsFromLineItems(lineItems, {
  from,
  to,
  includeCancelled,
  includeRestoration,
  restorationList,
});
```

If `loadRestorationList` throws, the existing `catch` already sets job `failed` — keep that. Do not write a file.

Inject `getDb` / `loadRestorationList` via optional deps on `runTwentyExport` for the failure test:

```js
export async function runTwentyExport(
  jobId,
  { from, to, includeCancelled = false, includeRestoration = false, columns, includeDealsSheet = false },
  {
    gqlFn = gql,
    requireTwentyConfigFn = requireTwentyConfig,
    getDbFn = getDb,
    loadRestorationListFn = loadRestorationList,
  } = {},
)
```

- [ ] **Step 4: Run tests**

Run: `npm test -- backend/tests/export-twenty-routes.test.js backend/tests/twenty-export.test.js backend/tests/export-jobs.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/export-jobs.js backend/src/services/twenty-export.js backend/src/routes/export-twenty.js backend/tests
git commit -m "feat: Twenty export job flag to include restoration"
```

---

### Task 3: Admin UI checkbox

**Files:**
- Modify: `frontend/src/pages/ExportTwenty.jsx`

**Interfaces:**
- Consumes: job `includeRestoration`; POST body `{ includeRestoration }`
- Produces: checkbox «включая реставрацию», default off, `localStorage` key `export-twenty-include-restoration`

- [ ] **Step 1: No frontend unit test file exists for this page — add a focused assertion via route tests (done in Task 2). For UI, implement against the existing cancelled checkbox.**

- [ ] **Step 2: Confirm cancelled checkbox block**

Open `frontend/src/pages/ExportTwenty.jsx` around the `includeCancelled` label. The restoration checkbox is a sibling, not a new form.

- [ ] **Step 3: Implement**

```js
const RESTORATION_STORAGE_KEY = 'export-twenty-include-restoration';
```

State:

```js
const [includeRestoration, setIncludeRestoration] = useState(() =>
  Boolean(readStoredJson(RESTORATION_STORAGE_KEY)),
);
```

Persist like deals sheet:

```js
useEffect(() => {
  localStorage.setItem(RESTORATION_STORAGE_KEY, JSON.stringify(includeRestoration));
}, [includeRestoration]);
```

When restoring `activeJob`, `setIncludeRestoration(Boolean(activeJob.includeRestoration))`.

Submit:

```js
startExport.mutate(
  { from, to, includeCancelled, includeRestoration, includeDealsSheet, columns: selectedColumns },
  …
);
```

Checkbox, immediately after cancelled:

```jsx
<label className="flex items-center gap-2 pb-2 text-sm text-ink-muted">
  <input
    type="checkbox"
    checked={includeRestoration}
    onChange={(e) => setIncludeRestoration(e.target.checked)}
  />
  включая реставрацию
</label>
```

Default unchecked if localStorage empty.

- [ ] **Step 4: Manual check**

Open `/export-twenty`. Confirm the new checkbox is off by default, next to «включая отмены». No automated frontend test required.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/ExportTwenty.jsx
git commit -m "feat: Twenty export checkbox to include restoration"
```
