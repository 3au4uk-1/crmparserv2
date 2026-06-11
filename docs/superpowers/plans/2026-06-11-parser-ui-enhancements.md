# Parser UI Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename Twenty `closeDate` to «Дата мероприятия» (label only), sync date+arrival time into `closeDate`, load companies from DB, add mobile-responsive Deals UI, and column sorting.

**Architecture:** Data/sync changes in backend helpers (`buildCloseDate`, dynamic `parseDealTitle`, deals API sort whitelist). Frontend gets responsive shell + `DealCard` below `md` breakpoint. Twenty metadata updated once via MCP `update_field_metadata` without changing GraphQL field names.

**Tech Stack:** Node.js 20, Express, better-sqlite3, Vitest; React 18, Vite, TanStack Query, Tailwind CSS v4; Twenty CRM via MCP `user-twenty`.

**Spec:** `docs/superpowers/specs/2026-06-11-parser-ui-enhancements-design.md`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `backend/src/utils/crm-dates.js` | `buildCloseDate(deal)` — date + arrival time in Moscow TZ |
| `backend/src/services/twenty-opportunity.js` | Use `buildCloseDate` for `closeDate` |
| `backend/src/services/companies.js` | `loadCompanyCodes(db)` |
| `backend/src/services/title-parser.js` | `parseDealTitle(title, knownCodes)` |
| `backend/src/services/parser.js` | Pass DB company codes to title parser |
| `backend/src/routes/deals.js` | `sortBy` / `sortDir` query params |
| `backend/tests/crm-dates.test.js` | `buildCloseDate` cases |
| `backend/tests/twenty-opportunity.test.js` | Updated `closeDate` expectations |
| `backend/tests/title-parser.test.js` | Dynamic known codes + БС example |
| `backend/tests/deals-sort.test.js` | Sort API integration tests |
| `frontend/src/utils/dates.js` | `formatEventDate(date, arrivalTime)` |
| `frontend/src/api.js` | `useCreateCompany` mutation |
| `frontend/src/pages/Deals.jsx` | Sort state, dynamic company filter, responsive layout |
| `frontend/src/components/DealRow.jsx` | «Дата мероприятия» column |
| `frontend/src/components/DealCard.jsx` | Mobile deal card (new) |
| `frontend/src/App.jsx` | Hamburger nav `< md` |
| `frontend/src/pages/Settings.jsx` | Add-company form |

---

### Task 1: `buildCloseDate` helper

**Files:**
- Modify: `backend/src/utils/crm-dates.js`
- Modify: `backend/tests/crm-dates.test.js`

- [ ] **Step 1: Write failing tests**

Add to `backend/tests/crm-dates.test.js`:

```js
import { buildCloseDate } from '../src/utils/crm-dates.js';

describe('buildCloseDate', () => {
  it('combines start_date and arrival_time with Moscow offset', () => {
    const result = buildCloseDate({
      start_date: '2026-06-10T00:00:00+03:00',
      arrival_time: '09:00',
    });
    expect(result).toBe('2026-06-10T09:00:00+03:00');
  });

  it('uses midnight when arrival_time missing', () => {
    const result = buildCloseDate({ start_date: '2026-06-10' });
    expect(result).toBe('2026-06-10T00:00:00+03:00');
  });

  it('falls back to end_date then ignores invalid time', () => {
    const result = buildCloseDate({
      end_date: '2026-06-11',
      arrival_time: 'not-a-time',
    });
    expect(result).toBe('2026-06-11T00:00:00+03:00');
  });

  it('returns ISO string when no dates on deal', () => {
    const result = buildCloseDate({});
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- crm-dates.test.js`
Expected: FAIL — `buildCloseDate` is not exported

- [ ] **Step 3: Implement `buildCloseDate`**

Add to `backend/src/utils/crm-dates.js`:

```js
const ARRIVAL_TIME_RE = /^(\d{1,2}):(\d{2})$/;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function calendarPartsFromDeal(deal) {
  const raw = deal.start_date || deal.end_date;
  if (!raw) return null;
  const parsed = parseEventDate(raw);
  if (!parsed) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CRM_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(parsed);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return { year: get('year'), month: get('month'), day: get('day') };
}

export function buildCloseDate(deal) {
  const parts = calendarPartsFromDeal(deal);
  if (!parts) return new Date().toISOString();

  const { year, month, day } = parts;
  let hour = 0;
  let minute = 0;

  const match = deal.arrival_time?.trim().match(ARRIVAL_TIME_RE);
  if (match) {
    hour = Number(match[1]);
    minute = Number(match[2]);
    if (hour > 23 || minute > 59) {
      hour = 0;
      minute = 0;
    }
  }

  return `${year}-${month}-${day}T${pad2(hour)}:${pad2(minute)}:00${crmOffsetSuffix()}`;
}
```

- [ ] **Step 4: Run tests**

Run: `cd backend && npm test -- crm-dates.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/crm-dates.js backend/tests/crm-dates.test.js
git commit -m "feat: add buildCloseDate for Twenty closeDate sync"
```

---

### Task 2: Wire `buildCloseDate` into Twenty opportunity input

**Files:**
- Modify: `backend/src/services/twenty-opportunity.js`
- Modify: `backend/tests/twenty-opportunity.test.js`

- [ ] **Step 1: Update failing test expectation**

In `backend/tests/twenty-opportunity.test.js`, change:

```js
expect(input.closeDate).toBe('2026-06-10');
```

to:

```js
expect(input.closeDate).toBe('2026-06-10T09:00:00+03:00');
```

Add test for deal without arrival time:

```js
it('closeDate at midnight when no arrival_time', () => {
  const input = buildOpportunityInput(
    { ...deal, arrival_time: null },
    items,
    { includeStage: false }
  );
  expect(input.closeDate).toBe('2026-06-10T00:00:00+03:00');
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `cd backend && npm test -- twenty-opportunity.test.js`
Expected: FAIL on `closeDate` assertion

- [ ] **Step 3: Update `buildOpportunityInput`**

In `backend/src/services/twenty-opportunity.js`:

```js
import { buildCloseDate } from '../utils/crm-dates.js';
```

Replace line:

```js
closeDate: deal.start_date || deal.end_date || new Date().toISOString(),
```

with:

```js
closeDate: buildCloseDate(deal),
```

Keep `arrivalTime` block unchanged.

- [ ] **Step 4: Run tests**

Run: `cd backend && npm test -- twenty-opportunity.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/twenty-opportunity.js backend/tests/twenty-opportunity.test.js
git commit -m "feat: sync event date and arrival time into Twenty closeDate"
```

---

### Task 3: Dynamic company codes from database

**Files:**
- Create: `backend/src/services/companies.js`
- Modify: `backend/src/services/title-parser.js`
- Modify: `backend/src/services/parser.js`
- Modify: `backend/tests/title-parser.test.js`

- [ ] **Step 1: Write failing test for dynamic codes**

In `backend/tests/title-parser.test.js`, add:

```js
it('accepts company from dynamic knownCodes list', () => {
  const result = parseDealTitle('БС/06.06/ВЫСТАВКА/Радченкова', ['ПРО', 'БС']);
  expect(result.companyCode).toBe('БС');
  expect(result.parseError).toBe(false);
});

it('parseError when code not in knownCodes', () => {
  const result = parseDealTitle('БС/06.06/Иванов', ['ПРО', 'АРТ']);
  expect(result.parseError).toBe(true);
});
```

Update existing tests to pass default known codes where needed, OR change signature default:

```js
const DEFAULT_KNOWN = ['ПРО', 'АРТ', 'АРЕНДА'];
export function parseDealTitle(title, knownCodes = DEFAULT_KNOWN) {
```

- [ ] **Step 2: Run test**

Run: `cd backend && npm test -- title-parser.test.js`
Expected: FAIL on БС test

- [ ] **Step 3: Implement**

Create `backend/src/services/companies.js`:

```js
export function loadCompanyCodes(db) {
  return db.prepare('SELECT code FROM companies ORDER BY code').all().map((r) => r.code);
}
```

Update `backend/src/services/title-parser.js` — remove `KNOWN_COMPANIES` constant; use `knownCodes` parameter:

```js
const DEFAULT_KNOWN = ['ПРО', 'АРТ', 'АРЕНДА'];

export function parseDealTitle(title, knownCodes = DEFAULT_KNOWN) {
  // ...
  const isKnownCompany = knownCodes.includes(companyCode);
  return {
    companyCode,
    managerName,
    tonyOrderId: extractTonyOrderId(title),
    parseError: !isKnownCompany,
    rawTitle: title,
  };
}
```

In `backend/src/services/parser.js`, after `const db = getDb();` inside `runParsing`:

```js
import { loadCompanyCodes } from './companies.js';
// inside runParsing, after db is available:
const knownCodes = loadCompanyCodes(db);
```

Before event loop, and change:

```js
const titleInfo = parseDealTitle(event.title || '', knownCodes);
```

- [ ] **Step 4: Run tests**

Run: `cd backend && npm test -- title-parser.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/companies.js backend/src/services/title-parser.js backend/src/services/parser.js backend/tests/title-parser.test.js
git commit -m "feat: load company codes from database for title parsing"
```

---

### Task 4: Dynamic company filter on Deals page

**Files:**
- Modify: `frontend/src/pages/Deals.jsx`

- [ ] **Step 1: Replace hardcoded company options**

Add import:

```js
import { useCompanies } from '../api';
```

Inside component:

```js
const { data: companies } = useCompanies();
```

Replace company `<select>` options:

```jsx
<option value="">Все компании</option>
{(companies || []).map((c) => (
  <option key={c.id} value={c.code}>{c.code}</option>
))}
```

- [ ] **Step 2: Manual check**

Run frontend dev server, open `/deals`, confirm dropdown lists DB companies.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Deals.jsx
git commit -m "feat: populate deals company filter from API"
```

---

### Task 5: Add company form in Settings

**Files:**
- Modify: `frontend/src/api.js`
- Modify: `frontend/src/pages/Settings.jsx`

- [ ] **Step 1: Add `useCreateCompany` hook**

In `frontend/src/api.js`:

```js
export function useCreateCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.post('/settings/companies', body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['companies'] }),
  });
}
```

- [ ] **Step 2: Add form UI**

In `Settings.jsx` «Справочник компаний» section, above the table:

```jsx
const createCompany = useCreateCompany();
const [newCompanyCode, setNewCompanyCode] = useState('');
const [newCompanyName, setNewCompanyName] = useState('');

function addCompany() {
  const code = newCompanyCode.trim();
  const full_name = newCompanyName.trim();
  if (!code || !full_name) return;
  createCompany.mutate(
    { code, full_name },
    {
      onSuccess: () => {
        setNewCompanyCode('');
        setNewCompanyName('');
      },
    }
  );
}
```

Form markup:

```jsx
<div className="flex flex-wrap gap-2 mb-3">
  <input
    value={newCompanyCode}
    onChange={(e) => setNewCompanyCode(e.target.value)}
    placeholder="Код (ПРО)"
    className="border border-gray-300 rounded-md px-3 py-1.5 text-sm font-mono w-28"
  />
  <input
    value={newCompanyName}
    onChange={(e) => setNewCompanyName(e.target.value)}
    placeholder="Полное название"
    className="border border-gray-300 rounded-md px-3 py-1.5 text-sm flex-1 min-w-[12rem]"
  />
  <button
    type="button"
    onClick={addCompany}
    disabled={createCompany.isPending}
    className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50"
  >
    Добавить
  </button>
</div>
```

- [ ] **Step 3: Manual check**

Add `БС` / `Brand Service` in Settings; confirm it appears in Deals filter.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api.js frontend/src/pages/Settings.jsx
git commit -m "feat: add company creation form in settings"
```

---

### Task 6: Deals API column sorting

**Files:**
- Modify: `backend/src/routes/deals.js`
- Create: `backend/tests/deals-sort.test.js`

- [ ] **Step 1: Write failing sort test**

Create `backend/tests/deals-sort.test.js` using in-memory pattern from existing tests (import app or test helper). Minimal approach — unit-test sort clause builder if no HTTP test harness exists.

Extract sort helper in `deals.js`:

```js
const SORT_COLUMNS = {
  start_date: 'd.start_date',
  title: 'd.title',
  company_code: 'd.company_code',
  manager_name: 'd.manager_name',
  budget: 'CAST(d.budget AS REAL)',
  approval_status: 'd.approval_status',
};

export function buildDealsOrderClause(sortBy, sortDir) {
  const column = SORT_COLUMNS[sortBy] || SORT_COLUMNS.start_date;
  const dir = sortDir === 'asc' ? 'ASC' : 'DESC';
  if (sortBy === 'budget') {
    return `ORDER BY (d.budget IS NULL), ${column} ${dir}`;
  }
  return `ORDER BY ${column} ${dir}`;
}
```

Test:

```js
import { describe, it, expect } from 'vitest';
import { buildDealsOrderClause } from '../src/routes/deals.js';

describe('buildDealsOrderClause', () => {
  it('defaults to start_date desc', () => {
    expect(buildDealsOrderClause(undefined, undefined)).toBe('ORDER BY d.start_date DESC');
  });
  it('sorts budget numerically', () => {
    expect(buildDealsOrderClause('budget', 'asc')).toContain('CAST(d.budget AS REAL)');
    expect(buildDealsOrderClause('budget', 'asc')).toContain('d.budget IS NULL');
  });
  it('falls back for unknown sortBy', () => {
    expect(buildDealsOrderClause('DROP TABLE', 'asc')).toBe('ORDER BY d.start_date ASC');
  });
});
```

- [ ] **Step 2: Run test**

Run: `cd backend && npm test -- deals-sort.test.js`
Expected: FAIL — export not found

- [ ] **Step 3: Wire into GET /deals**

In `router.get('/')`:

```js
const { sortBy, sortDir } = req.query;
const orderClause = buildDealsOrderClause(sortBy, sortDir);
```

Replace static `ORDER BY d.start_date DESC` with template:

```js
SELECT d.* FROM deals d WHERE ${where} ${orderClause} LIMIT ? OFFSET ?
```

Export `buildDealsOrderClause` for tests.

- [ ] **Step 4: Run tests**

Run: `cd backend && npm test -- deals-sort.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/deals.js backend/tests/deals-sort.test.js
git commit -m "feat: add sortBy and sortDir to deals list API"
```

---

### Task 7: Sortable table headers + event date display

**Files:**
- Modify: `frontend/src/utils/dates.js`
- Modify: `frontend/src/pages/Deals.jsx`
- Modify: `frontend/src/components/DealRow.jsx`

- [ ] **Step 1: Add `formatEventDate`**

In `frontend/src/utils/dates.js`:

```js
export function formatEventDate(date, arrivalTime) {
  const datePart = formatDate(date);
  if (!datePart) return '';
  if (!arrivalTime?.trim()) return datePart;
  return `${datePart} ${arrivalTime.trim()}`;
}
```

- [ ] **Step 2: Add sort state and headers in Deals.jsx**

```js
const [sort, setSort] = useState({ sortBy: 'start_date', sortDir: 'desc' });

const { data, isLoading } = useDeals({
  ...filters,
  ...sort,
  limit: PAGE_SIZE,
  offset: page * PAGE_SIZE,
});

function toggleSort(column) {
  setSort((prev) => {
    if (prev.sortBy !== column) return { sortBy: column, sortDir: 'desc' };
    return { sortBy: column, sortDir: prev.sortDir === 'desc' ? 'asc' : 'desc' };
  });
  setPage(0);
  setSelectedIds(new Set());
}

function SortableTh({ column, label }) {
  const active = sort.sortBy === column;
  const arrow = active ? (sort.sortDir === 'asc' ? ' ↑' : ' ↓') : '';
  return (
    <th className="p-3">
      <button
        type="button"
        onClick={() => toggleSort(column)}
        className="uppercase text-xs text-gray-500 hover:text-gray-800 font-normal"
      >
        {label}{arrow}
      </button>
    </th>
  );
}
```

Replace static `<th>` for sortable columns with `SortableTh` (`start_date` → «Дата мероприятия», `title`, `company_code`, `manager_name`, `budget`, `approval_status`). Leave checkbox, Twenty, actions as plain `<th>`.

- [ ] **Step 3: Update DealRow date cell**

```js
import { formatEventDate } from '../utils/dates';
// ...
<td className="p-3 text-sm">{formatEventDate(deal.start_date, deal.arrival_time)}</td>
```

- [ ] **Step 4: Manual check**

Click column headers; verify network requests include `sortBy` / `sortDir` and order changes.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/utils/dates.js frontend/src/pages/Deals.jsx frontend/src/components/DealRow.jsx
git commit -m "feat: sortable deal columns and event date display"
```

---

### Task 8: Mobile `DealCard` component

**Files:**
- Create: `frontend/src/components/DealCard.jsx`
- Modify: `frontend/src/pages/Deals.jsx`

- [ ] **Step 1: Create DealCard**

Create `frontend/src/components/DealCard.jsx` — mirror `DealRow` actions (approve, reject, resync, delete, expand with `DealItems`). Structure:

```jsx
export default function DealCard({ deal, selected, onSelect }) {
  const [expanded, setExpanded] = useState(false);
  // same hooks as DealRow
  return (
    <div className="border-b border-gray-100 p-3">
      <div className="flex gap-2 items-start" onClick={() => setExpanded(!expanded)}>
        <input type="checkbox" ... onClick={(e) => e.stopPropagation()} />
        <div className="flex-1 min-w-0">
          <div className="flex justify-between gap-2">
            <span className="text-sm text-gray-600">{formatEventDate(deal.start_date, deal.arrival_time)}</span>
            <StatusBadge status={deal.approval_status} />
          </div>
          <p className="text-sm font-medium truncate">{deal.title}</p>
          <p className="text-xs text-gray-500">{deal.company_code} · {deal.manager_name}</p>
        </div>
      </div>
      {/* action buttons + expanded DealItems — copy from DealRow */}
    </div>
  );
}
```

- [ ] **Step 2: Responsive layout in Deals.jsx**

Wrap table:

```jsx
<div className="hidden md:block bg-white rounded-lg border ...">
  <table>...</table>
</div>
<div className="md:hidden bg-white rounded-lg border border-gray-200 overflow-hidden">
  {deals.map((deal) => (
    <DealCard key={deal.id} deal={deal} selected={selectedIds.has(deal.id)} onSelect={toggleSelect} />
  ))}
</div>
```

Keep loading/empty states for both blocks.

- [ ] **Step 3: Manual check at 375px width**

Cards visible; table hidden. Expand card shows items.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/DealCard.jsx frontend/src/pages/Deals.jsx
git commit -m "feat: mobile deal cards on small screens"
```

---

### Task 9: Responsive app shell

**Files:**
- Modify: `frontend/src/App.jsx`

- [ ] **Step 1: Add mobile nav state**

```js
const [navOpen, setNavOpen] = useState(false);
```

- [ ] **Step 2: Replace layout**

```jsx
<div className="flex h-screen bg-gray-50">
  {/* Desktop sidebar */}
  <aside className="hidden md:flex w-56 bg-white border-r ...">...</aside>

  <div className="flex-1 flex flex-col min-w-0">
    <header className="md:hidden flex items-center justify-between p-3 bg-white border-b border-gray-200">
      <div>
        <h1 className="text-base font-semibold text-gray-800">CRM Parser</h1>
        <p className="text-xs text-gray-500">Отдел брендинга</p>
      </div>
      <button
        type="button"
        onClick={() => setNavOpen(true)}
        className="p-2 rounded-md text-gray-600 hover:bg-gray-100"
        aria-label="Меню"
      >
        ☰
      </button>
    </header>

    {navOpen && (
      <div className="md:hidden fixed inset-0 z-50">
        <button className="absolute inset-0 bg-black/30" onClick={() => setNavOpen(false)} aria-label="Закрыть" />
        <aside className="relative w-56 h-full bg-white p-2">
          {/* same navItems NavLinks; onClick={() => setNavOpen(false)} */}
        </aside>
      </div>
    )}

    <main className="flex-1 overflow-auto p-4 md:p-6">...</main>
  </div>
</div>
```

- [ ] **Step 3: Manual check**

375px: hamburger opens drawer; desktop unchanged.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "feat: responsive mobile navigation drawer"
```

---

### Task 10: Twenty metadata — rename Close date label via MCP

**Files:** None in repo (Twenty workspace configuration)

- [ ] **Step 1: Load metadata skill**

MCP `user-twenty`: `load_skills` with `["metadata-building"]`.

- [ ] **Step 2: Get Opportunity field metadata**

`learn_tools` → `get_object_metadata` for `opportunity`.
Confirm field `closeDate` id `0b965158-b133-4016-975e-fdc804e640fe`.

- [ ] **Step 3: Update label only**

`update_field_metadata`:

```json
{
  "id": "0b965158-b133-4016-975e-fdc804e640fe",
  "label": "Дата мероприятия"
}
```

Do **not** rename API name `closeDate`.

- [ ] **Step 4: Verify sync with datetime**

If `updateOpportunity` fails on datetime `closeDate`, update field type to `DATE_TIME` via same MCP tool, then re-run:

`cd backend && npm test -- twenty-opportunity.test.js`

- [ ] **Step 5: Manual verification in Twenty UI**

Open Opportunity record — field shows «Дата мероприятия» with date+time after re-sync.

- [ ] **Step 6: Document in commit message or ops note**

No code commit required unless type change documented in spec; optional README note skipped per YAGNI.

---

### Task 11: Full test suite + spec doc commit

**Files:**
- Modify: `docs/superpowers/specs/2026-06-11-parser-ui-enhancements-design.md` (if not committed)

- [ ] **Step 1: Run all backend tests**

Run: `cd backend && npm test`
Expected: all PASS

- [ ] **Step 2: Build frontend**

Run: `cd frontend && npm run build`
Expected: build succeeds

- [ ] **Step 3: Commit any pending spec updates**

```bash
git add docs/superpowers/specs/2026-06-11-parser-ui-enhancements-design.md docs/superpowers/plans/2026-06-11-parser-ui-enhancements.md
git commit -m "docs: add parser UI enhancements implementation plan"
```

---

## Spec Coverage Checklist

| Spec requirement | Task |
|------------------|------|
| `buildCloseDate` + Moscow TZ | Task 1 |
| `closeDate` in Twenty sync, keep `arrivalTime` | Task 2 |
| Rename Twenty label via MCP | Task 10 |
| Dynamic companies in parser | Task 3 |
| Dynamic company filter | Task 4 |
| Add company in Settings | Task 5 |
| API sorting | Task 6 |
| Sortable headers | Task 7 |
| «Дата мероприятия» in UI | Task 7 |
| Mobile cards | Task 8 |
| Mobile nav | Task 9 |

---

## Rollout

1. Task 10 (Twenty label) can run before or after backend deploy.
2. Deploy parser; re-sync or wait for parse to refresh `closeDate` values.
3. Add new company codes in Settings before parsing deals with those prefixes.
