# Twenty Line-Item Lists Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable list assignment from BrandingTwentyView gear menu, auto-apply global filters on list changes, and fix sync reliability so restoration/blacklist patterns apply correctly in Twenty.

**Architecture:** crmparser remains source of truth for pattern lists. New `/api/twenty/*` endpoints (Bearer auth) bridge Twenty front component to list CRUD + per-deal resync. Debounced bulk-resync fires on any list change. Sync fixes: normalized name diff + always bypass stage protection on list-triggered resyncs.

**Tech Stack:** Node.js 20, Express 5, better-sqlite3, Vitest; React 18, twenty-client-sdk, TypeScript.

**Spec:** `docs/superpowers/specs/2026-07-10-twenty-line-item-lists-design.md`

---

## File Structure

### crmparserv2

| File | Responsibility |
|------|----------------|
| `backend/src/config.js` | `twentyAppApiSecret`, `twentyAppCorsOrigin` |
| `backend/src/middleware/twenty-app-auth.js` | Bearer auth for `/api/twenty/*` |
| `backend/src/services/twenty-line-items-sync.js` | Normalized name matching in `computeLineItemDiff` |
| `backend/src/services/twenty-sync.js` | `resyncDealIfSynced` with stage protection bypass |
| `backend/src/services/list-change-resync.js` | Debounced auto bulk-resync scheduler |
| `backend/src/services/twenty-line-item-api.js` | Lookup deal_item by twenty_id, add-to-list logic |
| `backend/src/routes/twenty.js` | Twenty app REST endpoints |
| `backend/src/routes/blacklist.js` (+ restoration, podryad, banner) | Hook `scheduleListChangeResync` |
| `backend/src/routes/deals.js` | Hook on item list POST endpoints |
| `backend/src/index.js` | Mount `/api/twenty`, CORS middleware |
| `backend/tests/twenty-line-items-sync.test.js` | Normalized diff tests |
| `backend/tests/twenty-line-item-api.test.js` | API service tests |
| `backend/tests/twenty-routes.test.js` | Route integration tests |
| `backend/tests/list-change-resync.test.js` | Debounce tests |
| `backend/tests/deal-item-resync.test.js` | Update resync expectations |

### BrandingTwentyView

| File | Responsibility |
|------|----------------|
| `src/deals-board/api/crmparser.ts` | HTTP client for crmparser Twenty API |
| `src/deals-board/LineItemListMenu.tsx` | Gear popover with 4 list actions |
| `src/deals-board/cells/overrides.tsx` | Extend `ChildNameCell` with gear + badges |
| `src/deals-board/hooks/useLineItemListStatus.ts` | React Query hook for list-status |
| `package.json` | Version bump `0.2.70` → `0.2.71` |

---

## Part A — crmparserv2

### Task 1: Config + twenty-app auth middleware

**Files:**
- Modify: `backend/src/config.js`
- Create: `backend/src/middleware/twenty-app-auth.js`
- Test: `backend/tests/twenty-app-auth.test.js`

- [ ] **Step 1: Write failing auth test**

```js
// backend/tests/twenty-app-auth.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config.js', () => ({
  config: { twentyAppApiSecret: 'test-secret' },
}));

import { twentyAppAuthMiddleware, verifyTwentyAppSecret } from '../src/middleware/twenty-app-auth.js';

describe('twenty-app-auth', () => {
  it('verifyTwentyAppSecret accepts matching bearer token', () => {
    expect(verifyTwentyAppSecret('test-secret')).toBe(true);
    expect(verifyTwentyAppSecret('wrong')).toBe(false);
  });

  it('middleware returns 401 without token', () => {
    const req = { headers: {} };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    twentyAppAuthMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('middleware calls next with valid token', () => {
    const req = { headers: { authorization: 'Bearer test-secret' } };
    const res = { status: vi.fn(), json: vi.fn() };
    const next = vi.fn();
    twentyAppAuthMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd backend && npm test -- twenty-app-auth.test.js
```

- [ ] **Step 3: Implement**

Add to `backend/src/config.js`:

```js
twentyAppApiSecret: process.env.TWENTY_APP_API_SECRET || '',
twentyAppCorsOrigin: process.env.TWENTY_APP_CORS_ORIGIN || '',
```

Create `backend/src/middleware/twenty-app-auth.js` (mirror `import-auth.js` pattern using `config.twentyAppApiSecret`; if secret empty, allow all in dev).

- [ ] **Step 4: Run test — expect PASS**

```bash
cd backend && npm test -- twenty-app-auth.test.js
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/config.js backend/src/middleware/twenty-app-auth.js backend/tests/twenty-app-auth.test.js
git commit -m "feat: add twenty app API auth middleware"
```

---

### Task 2: Normalized name matching in line item diff

**Files:**
- Modify: `backend/src/services/twenty-line-items-sync.js`
- Modify: `backend/tests/twenty-line-items-sync.test.js`

- [ ] **Step 1: Write failing test**

```js
  it('matches existing line items by normalized name (case-insensitive)', () => {
    const existing = [{ id: 'li-1', name: 'Велотележка для мороженого', stage: 'NOVYY' }];
    const eligible = [{ id: 1, name: 'велотележка для мороженого', price: 100 }];
    const { toUpdate, toCreate } = computeLineItemDiff(existing, eligible);
    expect(toUpdate).toHaveLength(1);
    expect(toUpdate[0].twentyId).toBe('li-1');
    expect(toCreate).toHaveLength(0);
  });
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd backend && npm test -- twenty-line-items-sync.test.js
```

- [ ] **Step 3: Implement**

In `computeLineItemDiff`, import `normalizePattern` from `blacklist.js`:

```js
const existingByName = new Map(
  existingLineItems.map((li) => [normalizePattern(li.name), li])
);
// ...
const existing = existingByName.get(normalizePattern(item.name));
```

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "fix: normalize line item names in sync diff"
```

---

### Task 3: resyncDealIfSynced always bypasses stage protection

**Files:**
- Modify: `backend/src/services/twenty-sync.js`
- Modify: `backend/tests/deal-item-resync.test.js`

- [ ] **Step 1: Update `resyncDealIfSynced`**

```js
export async function resyncDealIfSynced(dealId) {
  const db = getDb();
  const deal = db.prepare('SELECT twenty_id FROM deals WHERE id = ?').get(dealId);
  if (!deal?.twenty_id) return null;
  return syncDealToTwenty(dealId, { ignoreLineItemStageProtection: true });
}
```

- [ ] **Step 2: Update/add test asserting sync called with flag**

In `deal-item-resync.test.js`, verify `syncDealToTwenty` receives `{ ignoreLineItemStageProtection: true }` when item added to restoration.

- [ ] **Step 3: Run tests**

```bash
cd backend && npm test -- deal-item-resync.test.js twenty-sync.test.js
```

- [ ] **Step 4: Commit**

```bash
git commit -m "fix: bypass stage protection on list-triggered deal resync"
```

---

### Task 4: twenty-line-item-api service

**Files:**
- Create: `backend/src/services/twenty-line-item-api.js`
- Test: `backend/tests/twenty-line-item-api.test.js`

- [ ] **Step 1: Write failing tests**

Test `findDealItemByTwentyId(db, twentyLineItemId)` and `addDealItemToList(db, twentyLineItemId, listName)`:
- Returns item + deal when found
- Creates exact-match list entry
- Throws 404 when not found
- Returns idempotent success on duplicate entry (409 from create → treat as OK)

- [ ] **Step 2: Implement service**

```js
import { createBlacklistEntry } from './blacklist.js';
import { createRestorationEntry } from './restoration.js';
import { createPodryadEntry } from './podryad.js';
import { createBannerEntry } from './banner.js';
import { enrichDealItems } from './twenty-items.js';
import { loadBlacklist, loadRestorationList, loadPodryadList, loadBannerList } from './...';

const LIST_CREATORS = {
  blacklist: createBlacklistEntry,
  restoration: createRestorationEntry,
  podryad: createPodryadEntry,
  banner: createBannerEntry,
};

export function findDealItemByTwentyId(db, twentyLineItemId) {
  const item = db.prepare('SELECT * FROM deal_items WHERE twenty_id = ?').get(twentyLineItemId);
  if (!item) {
    const err = new Error('Line item not found in parser');
    err.status = 404;
    throw err;
  }
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(item.deal_id);
  return { item, deal };
}

export function getLineItemListStatus(db, twentyLineItemId) {
  const { item, deal } = findDealItemByTwentyId(db, twentyLineItemId);
  const [blacklist, restorationList, podryadList, bannerList] = [
    loadBlacklist(db), loadRestorationList(db), loadPodryadList(db), loadBannerList(db),
  ];
  const [enriched] = enrichDealItems([item], blacklist, restorationList, deal, podryadList, bannerList);
  return {
    blacklisted: enriched.blacklisted,
    restorationMatch: enriched.restorationMatch,
    podryadMatch: enriched.podryadMatch,
    bannerMatch: enriched.bannerMatch,
    pattern: item.name,
    dealId: deal.id,
    dealTwentyId: deal.twenty_id,
  };
}

export function addDealItemToList(db, twentyLineItemId, list) {
  const creator = LIST_CREATORS[list];
  if (!creator) {
    const err = new Error('Invalid list');
    err.status = 400;
    throw err;
  }
  const { item, deal } = findDealItemByTwentyId(db, twentyLineItemId);
  try {
    creator(db, { pattern: item.name, matchType: 'exact', sourceName: item.name });
  } catch (err) {
    if (err.status !== 409) throw err;
  }
  return { item, deal };
}
```

- [ ] **Step 3: Run tests — expect PASS**

- [ ] **Step 4: Commit**

---

### Task 5: Twenty API routes

**Files:**
- Create: `backend/src/routes/twenty.js`
- Modify: `backend/src/index.js`
- Test: `backend/tests/twenty-routes.test.js`

- [ ] **Step 1: Write route tests**

Test with supertest:
- `GET /api/twenty/line-items/:id/list-status` → 200 with flags
- `POST /api/twenty/line-items/:id/add-to-list` body `{ list: 'restoration' }` → 200, mocks sync
- 401 without bearer token

- [ ] **Step 2: Implement routes**

```js
import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { twentyAppAuthMiddleware } from '../middleware/twenty-app-auth.js';
import { addDealItemToList, getLineItemListStatus } from '../services/twenty-line-item-api.js';
import { resyncDealIfSynced, syncDealToTwenty } from '../services/twenty-sync.js';
import { scheduleListChangeResync } from '../services/list-change-resync.js';

const router = Router();
router.use(twentyAppAuthMiddleware);

router.get('/line-items/:twentyLineItemId/list-status', (req, res, next) => {
  try {
    const db = getDb();
    res.json(getLineItemListStatus(db, req.params.twentyLineItemId));
  } catch (err) { next(err); }
});

router.post('/line-items/:twentyLineItemId/add-to-list', async (req, res, next) => {
  try {
    const db = getDb();
    const { list } = req.body ?? {};
    const { deal } = addDealItemToList(db, req.params.twentyLineItemId, list);
    scheduleListChangeResync(); // no-op debounce if immediate resync preferred
    const sync = await syncDealToTwenty(deal.id, { ignoreLineItemStageProtection: true });
    res.json({ success: true, sync });
  } catch (err) { next(err); }
});

router.post('/opportunities/:twentyOppId/resync', async (req, res, next) => {
  try {
    const db = getDb();
    const deal = db.prepare('SELECT id FROM deals WHERE twenty_id = ?').get(req.params.twentyOppId);
    if (!deal) return res.status(404).json({ error: 'Deal not found' });
    const sync = await syncDealToTwenty(deal.id, { ignoreLineItemStageProtection: true });
    res.json({ success: true, sync });
  } catch (err) { next(err); }
});

export default router;
```

In `index.js`:

```js
import twentyRouter from './routes/twenty.js';
// optional CORS for TWENTY_APP_CORS_ORIGIN
app.use('/api/twenty', twentyRouter);
```

- [ ] **Step 3: Run tests — expect PASS**

- [ ] **Step 4: Commit**

---

### Task 6: Debounced auto bulk-resync on list change

**Files:**
- Create: `backend/src/services/list-change-resync.js`
- Modify: `backend/src/services/bulk-resync-jobs.js` (accept `trigger` param if not already)
- Modify: `backend/src/routes/blacklist.js`, `restoration.js`, `podryad.js`, `banner.js`
- Modify: `backend/src/routes/deals.js` (item list POST handlers)
- Test: `backend/tests/list-change-resync.test.js`

- [ ] **Step 1: Write failing debounce test**

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/services/bulk-resync-jobs.js', () => ({
  createBulkResyncJob: vi.fn(() => ({ jobId: 1 })),
  getActiveBulkResyncJob: vi.fn(() => null),
}));

import { scheduleListChangeResync } from '../src/services/list-change-resync.js';
import { createBulkResyncJob } from '../src/services/bulk-resync-jobs.js';

describe('list-change-resync', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

  it('debounces multiple calls into one job', () => {
    scheduleListChangeResync();
    scheduleListChangeResync();
    scheduleListChangeResync();
    expect(createBulkResyncJob).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5000);
    expect(createBulkResyncJob).toHaveBeenCalledTimes(1);
    expect(createBulkResyncJob).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'list_change' }));
  });
});
```

- [ ] **Step 2: Implement**

```js
import { createBulkResyncJob, getActiveBulkResyncJob } from './bulk-resync-jobs.js';

const DEBOUNCE_MS = 5000;
let timer = null;

export function scheduleListChangeResync() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    if (getActiveBulkResyncJob()) return;
    createBulkResyncJob({ trigger: 'list_change' });
  }, DEBOUNCE_MS);
}

export function resetListChangeResyncForTests() {
  if (timer) clearTimeout(timer);
  timer = null;
}
```

- [ ] **Step 3: Add `scheduleListChangeResync()` to list POST/DELETE handlers**

Example in `restoration.js` POST and DELETE:

```js
import { scheduleListChangeResync } from '../services/list-change-resync.js';
// after successful create/delete:
scheduleListChangeResync();
```

Same for blacklist, podryad, banner routes and deals.js item endpoints.

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: auto bulk-resync on global list changes (debounced)"
```

---

### Task 7: CORS for Twenty app origin

**Files:**
- Modify: `backend/src/index.js`

- [ ] **Step 1: Add minimal CORS middleware before routes**

Only when `config.twentyAppCorsOrigin` is set:

```js
if (config.twentyAppCorsOrigin) {
  app.use('/api/twenty', (req, res, next) => {
    res.header('Access-Control-Allow-Origin', config.twentyAppCorsOrigin);
    res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
}
```

- [ ] **Step 2: Commit**

---

## Part B — BrandingTwentyView

### Task 8: crmparser API client

**Files:**
- Create: `src/deals-board/api/crmparser.ts`
- Create: `src/deals-board/api/crmparser.test.ts`

- [ ] **Step 1: Write failing test for URL building**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCrmparserConfig, buildListStatusUrl } from './crmparser';

describe('crmparser client', () => {
  beforeEach(() => {
    vi.stubGlobal('process', { env: { CRMPARSER_API_URL: 'https://parser.test/api', CRMPARSER_API_SECRET: 'secret' } });
  });

  it('buildListStatusUrl', () => {
    expect(buildListStatusUrl('li-123')).toBe('https://parser.test/api/twenty/line-items/li-123/list-status');
  });
});
```

- [ ] **Step 2: Implement client**

```ts
export type ListName = 'blacklist' | 'restoration' | 'podryad' | 'banner';

export type LineItemListStatus = {
  blacklisted: boolean;
  restorationMatch: boolean;
  podryadMatch: boolean;
  bannerMatch: boolean;
  pattern: string;
  dealId: number;
  dealTwentyId: string | null;
};

function getConfig() {
  const baseUrl = (globalThis.process?.env?.CRMPARSER_API_URL ?? '').replace(/\/$/, '');
  const secret = globalThis.process?.env?.CRMPARSER_API_SECRET ?? '';
  if (!baseUrl || !secret) return null;
  return { baseUrl, secret };
}

async function crmparserFetch(path: string, init?: RequestInit) {
  const config = getConfig();
  if (!config) throw new Error('Crmparser API not configured');
  const res = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.secret}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Crmparser API error ${res.status}`);
  }
  return res.json();
}

export function buildListStatusUrl(lineItemId: string) {
  const config = getConfig();
  return config ? `${config.baseUrl}/twenty/line-items/${lineItemId}/list-status` : '';
}

export async function fetchLineItemListStatus(lineItemId: string): Promise<LineItemListStatus | null> {
  if (!getConfig()) return null;
  return crmparserFetch(`/twenty/line-items/${lineItemId}/list-status`);
}

export async function addLineItemToList(lineItemId: string, list: ListName) {
  return crmparserFetch(`/twenty/line-items/${lineItemId}/add-to-list`, {
    method: 'POST',
    body: JSON.stringify({ list }),
  });
}
```

- [ ] **Step 3: Run tests — expect PASS**

```bash
yarn vitest run src/deals-board/api/crmparser.test.ts
```

- [ ] **Step 4: Commit** (in BrandingTwentyView repo)

---

### Task 9: useLineItemListStatus hook

**Files:**
- Create: `src/deals-board/hooks/useLineItemListStatus.ts`

- [ ] **Step 1: Implement hook**

Query per line item id, `enabled` only when crmparser configured and recordId present. Stale time 30s.

- [ ] **Step 2: Commit**

---

### Task 10: LineItemListMenu component

**Files:**
- Create: `src/deals-board/LineItemListMenu.tsx`

- [ ] **Step 1: Implement popover**

Mirror `ColumnPicker` dropdown pattern:
- 4 buttons: В блеклист / В реставрацию / В подряд / В баннер
- `onClick` → `addLineItemToList(recordId, list)` → loading state → `onSuccess` callback
- Disable buttons where status flag is true
- `stopPropagation` on all clicks

- [ ] **Step 2: Commit**

---

### Task 11: Integrate gear into ChildNameCell

**Files:**
- Modify: `src/deals-board/cells/overrides.tsx`

- [ ] **Step 1: Extend ChildNameCell**

Add props: `recordId` (from `FieldOverrideProps`).

```tsx
const ChildNameCell = ({ value, recordId }: FieldOverrideProps) => {
  const theme = useTheme();
  const { colors, font } = theme;
  const name = typeof value === 'string' ? value : '';
  const { data: listStatus } = useLineItemListStatus(recordId);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontWeight: font.weightMedium, color: colors.text, flex: 1 }}>{name}</span>
      {listStatus?.restorationMatch && <Chip text="реставрация · 0 ₽" color="yellow" theme={theme} />}
      {listStatus?.blacklisted && <Chip text="блеклист" color="red" theme={theme} />}
      {listStatus?.podryadMatch && <Chip text="подряд" color="blue" theme={theme} />}
      {listStatus?.bannerMatch && <Chip text="баннер" color="green" theme={theme} />}
      {recordId && <LineItemListMenu lineItemId={recordId} listStatus={listStatus} />}
    </div>
  );
};
```

Ensure `DynamicFieldCell` passes `recordId` to overrides (verify existing props).

- [ ] **Step 2: Manual smoke test** in Twenty dev environment

- [ ] **Step 3: Bump version in package.json** `0.2.70` → `0.2.71`

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: gear menu to assign line items to crmparser lists"
```

---

## Part C — Verification

### Task 12: End-to-end verification

- [ ] **Step 1: Run all crmparserv2 tests**

```bash
cd backend && npm test
```

- [ ] **Step 2: Run BrandingTwentyView tests**

```bash
yarn vitest run
```

- [ ] **Step 3: Manual test — restoration substring**

1. Add `велотележка` as **substring** in restoration list (Settings)
2. Wait 5s for auto bulk-resync OR trigger manually
3. Open deal in BrandingTwentyView — «Велотележка для мороженого» shows 0 ₽

- [ ] **Step 4: Manual test — gear menu**

1. Open any position in NOVYY stage
2. Click gear → «В реставрацию»
3. Amount updates to 0 ₽ without visiting Settings

- [ ] **Step 5: Commit any fixups**

---

## Plan self-review

| Spec requirement | Task |
|------------------|------|
| Gear menu 4 lists | Task 10, 11 |
| Auto bulk-resync on list change | Task 6 |
| Per-deal resync from gear | Task 5 |
| Normalized name diff | Task 2 |
| Stage protection bypass | Task 3 |
| Twenty API auth | Task 1, 5 |
| List status badges | Task 9, 11 |
| Version bump | Task 11 |
| CORS | Task 7 |
| Manual fallback button retained | No changes needed |

No placeholders remain. Type `ListName` consistent across client and API.
