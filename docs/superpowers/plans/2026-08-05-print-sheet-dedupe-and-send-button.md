# Print sheet dedupe + send button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop duplicate print-sheet rows (mutex + claim-before-write) and make «Отправить в печать» the only export trigger, while keeping StageSelect `V_PECHATI` independent.

**Architecture:** Add `printSheetExportRequested` on `dealLineItem`. Pending export = requested + `V_PECHATI` + date/time + empty session. Claim session (and clear requested) before Sheets write; roll back on failure. Process-local mutex with dirty re-run. TwentyView print modal button sets the flag only.

**Tech Stack:** Node.js (crmparserv2 vitest), Twenty GraphQL, twenty-sdk fields (BrandingTwentyView), React SheetQueuePanel.

**Spec:** `docs/superpowers/specs/2026-08-05-print-sheet-dedupe-and-send-button-design.md`

## Global Constraints

- Stage `V_PECHATI` alone must never enqueue Sheets.
- Button must not change `stage`.
- Freza modal: no send button.
- All new UUIDs must be UUID v4.
- Do not clean existing duplicate Google Sheet rows in this work.
- Deploy order: Twenty field → crmparser → TwentyView UI (old auto-export breaks intentionally after parser deploy).

---

## File Map

| File | Responsibility |
|------|----------------|
| `BrandingTwentyView/src/constants/universal-identifiers.ts` | UUID for new field |
| `BrandingTwentyView/src/fields/print-sheet-export-requested.field.ts` | App field definition |
| `crmparserv2/backend/src/services/print-sheet-export-twenty.js` | Pending filter, claim/rollback/row-meta patches, GraphQL fields |
| `crmparserv2/backend/src/services/print-sheet-cycle.js` | Claim → write → row meta; rollback; optional normalize empty session |
| `crmparserv2/backend/src/services/print-sheet-cron.js` | Mutex wrapper + cycle result logging |
| `crmparserv2/backend/src/services/twenty-sync.js` | Use same locked refresh entry (if exported from cron module) |
| `BrandingTwentyView/src/deals-board/editors/SheetQueuePanel.tsx` | Send button + states |
| `BrandingTwentyView/src/deals-board/editors/PrintPanelChip.tsx` | `enableSendToPrint` |
| `BrandingTwentyView/src/deals-board/editors/SheetQueuePanel.send.test.tsx` (or `.test.ts`) | UI unit tests |
| `crmparserv2/backend/tests/print-sheet-export-twenty.test.js` | Patch + pending query tests |
| `crmparserv2/backend/tests/print-sheet-cycle.test.js` | Claim-before-write + rollback |
| `crmparserv2/backend/tests/print-sheet-cron.test.js` | Mutex + logging |

---

### Task 1: Twenty field `printSheetExportRequested`

**Files:**
- Modify: `BrandingTwentyView/src/constants/universal-identifiers.ts`
- Create: `BrandingTwentyView/src/fields/print-sheet-export-requested.field.ts`
- Also create field on production Twenty via MCP `create_field_metadata` if app apply does not target prod in this session (same API name)

**Interfaces:**
- Produces: field API name `printSheetExportRequested` (BOOLEAN, default false)
- Produces: constant `DEAL_LINE_ITEM_PRINT_SHEET_EXPORT_REQUESTED_FIELD_UNIVERSAL_IDENTIFIER = 'b7e4c1a2-9f3d-4a6e-8c2b-1d5e7f9a0b3c'`

- [ ] **Step 1: Add universal identifier**

Append to `universal-identifiers.ts`:

```ts
export const DEAL_LINE_ITEM_PRINT_SHEET_EXPORT_REQUESTED_FIELD_UNIVERSAL_IDENTIFIER =
  'b7e4c1a2-9f3d-4a6e-8c2b-1d5e7f9a0b3c';
```

- [ ] **Step 2: Create field file**

`src/fields/print-sheet-export-requested.field.ts`:

```ts
import { defineField, FieldType } from 'twenty-sdk/define';
import { DEAL_LINE_ITEM_OBJECT_UNIVERSAL_IDENTIFIER } from 'src/constants/crm-objects';
import { DEAL_LINE_ITEM_PRINT_SHEET_EXPORT_REQUESTED_FIELD_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

/** Operator requested Google print-sheet export; cleared on claim by crmparser. */
export default defineField({
  universalIdentifier: DEAL_LINE_ITEM_PRINT_SHEET_EXPORT_REQUESTED_FIELD_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier: DEAL_LINE_ITEM_OBJECT_UNIVERSAL_IDENTIFIER,
  name: 'printSheetExportRequested',
  type: FieldType.BOOLEAN,
  label: 'Запрос в таблицу печати',
  icon: 'IconSend',
  description: 'Internal: set by «Отправить в печать»; crmparser claim clears it',
  defaultValue: false,
});
```

(If `defaultValue` is unsupported by current SDK, omit it and rely on falsey reads.)

- [ ] **Step 3: Apply field to the target workspace**

Local: `yarn twenty apply` from BrandingTwentyView.  
Prod: MCP `create_field_metadata` on `dealLineItem` with name `printSheetExportRequested`, type BOOLEAN, label «Запрос в таблицу печати» — **skip if apply already created it**.

- [ ] **Step 4: Verify**

MCP `find_many_deal_line_items` with `select: ['id', 'printSheetExportRequested']` returns without error.

- [ ] **Step 5: Commit (BrandingTwentyView)**

```bash
git add src/constants/universal-identifiers.ts src/fields/print-sheet-export-requested.field.ts
git commit -m "feat: add printSheetExportRequested field for explicit print send"
```

---

### Task 2: Export Twenty helpers — pending filter + claim patches

**Files:**
- Modify: `crmparserv2/backend/src/services/print-sheet-export-twenty.js`
- Modify: `crmparserv2/backend/tests/print-sheet-export-twenty.test.js`

**Interfaces:**
- Produces:
  - `buildClaimPatch(sessionId)` → `{ printSheetSessionId, printSheetExportRequested: false }`
  - `buildClaimRollbackPatch()` → `{ printSheetSessionId: null, printSheetTabName: null, printSheetRowNumber: null, printSheetExportRequested: true }`
  - `buildRowMetaPatch(tabName, rowNumber)` → `{ printSheetTabName, printSheetRowNumber }`
  - `isEmptyPrintSheetSessionId(value)` → true for `null`/`undefined`/`''`
  - `LIST_PENDING_EXPORT` filter includes `printSheetExportRequested: { eq: true }` and keeps `stage: V_PECHATI` + date/time + session null
- Consumes: existing `V_PECHATI_LINE_ITEM_STAGE`, `updateDealLineItemPrintSheet`

- [ ] **Step 1: Failing tests for patches + pending query**

Add to `print-sheet-export-twenty.test.js`:

```js
import {
  buildClaimPatch,
  buildClaimRollbackPatch,
  buildRowMetaPatch,
  isEmptyPrintSheetSessionId,
  listPendingPrintSheetExport,
} from '../src/services/print-sheet-export-twenty.js';

it('builds claim / rollback / row-meta patches', () => {
  expect(buildClaimPatch('sess-1')).toEqual({
    printSheetSessionId: 'sess-1',
    printSheetExportRequested: false,
  });
  expect(buildClaimRollbackPatch()).toEqual({
    printSheetSessionId: null,
    printSheetTabName: null,
    printSheetRowNumber: null,
    printSheetExportRequested: true,
  });
  expect(buildRowMetaPatch('Август 2026', 42)).toEqual({
    printSheetTabName: 'Август 2026',
    printSheetRowNumber: 42,
  });
});

it('treats null and empty string as empty session', () => {
  expect(isEmptyPrintSheetSessionId(null)).toBe(true);
  expect(isEmptyPrintSheetSessionId('')).toBe(true);
  expect(isEmptyPrintSheetSessionId('uuid')).toBe(false);
});

it('pending query requires printSheetExportRequested and not only stage', async () => {
  const gql = vi.fn().mockResolvedValue({
    data: { data: { dealLineItems: { edges: [] } } },
  });
  await listPendingPrintSheetExport(gql, 10);
  const query = gql.mock.calls[0][0];
  expect(query).toContain('printSheetExportRequested');
  expect(query).toMatch(/eq:\s*true/);
  expect(query).toContain('V_PECHATI');
});
```

Update existing `buildSessionPatchAfterExport` test only if that helper remains; prefer keeping it as composition of claim+row meta or deprecate in favor of the three new builders (cycle will use new builders).

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd backend && npx vitest run tests/print-sheet-export-twenty.test.js
```

Expected: FAIL — missing exports / query still old filter.

- [ ] **Step 3: Implement helpers + GraphQL**

In `print-sheet-export-twenty.js`:

1. Add `printSheetExportRequested` to `LINE_ITEM_EXPORT_FIELDS`.
2. Change pending filter `and` to:

```js
{ stage: { eq: ${V_PECHATI_LINE_ITEM_STAGE} } }
{ printSheetExportRequested: { eq: true } }
{ printSheetSessionId: { is: NULL } }
{ dataGotovnostiPechati: { is: NOT_NULL } }
{ vremyaGotovnostiPechati: { is: NOT_NULL } }
```

3. Add:

```js
export function isEmptyPrintSheetSessionId(value) {
  return value == null || String(value).trim() === '';
}

export function buildClaimPatch(sessionId) {
  return {
    printSheetSessionId: sessionId,
    printSheetExportRequested: false,
  };
}

export function buildClaimRollbackPatch() {
  return {
    printSheetSessionId: null,
    printSheetTabName: null,
    printSheetRowNumber: null,
    printSheetExportRequested: true,
  };
}

export function buildRowMetaPatch(tabName, rowNumber) {
  return {
    printSheetTabName: tabName,
    printSheetRowNumber: rowNumber,
  };
}
```

Keep `buildSessionPatchAfterExport` as thin wrapper calling claim+row meta merged **or** update all call sites and remove it in Task 3.

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd backend && npx vitest run tests/print-sheet-export-twenty.test.js
```

- [ ] **Step 5: Commit (crmparserv2)**

```bash
git add backend/src/services/print-sheet-export-twenty.js backend/tests/print-sheet-export-twenty.test.js
git commit -m "feat: gate print-sheet export on printSheetExportRequested claim patches"
```

---

### Task 3: Cycle — claim-before-write + rollback

**Files:**
- Modify: `crmparserv2/backend/src/services/print-sheet-cycle.js`
- Modify: `crmparserv2/backend/tests/print-sheet-cycle.test.js`

**Interfaces:**
- Consumes: `buildClaimPatch`, `buildClaimRollbackPatch`, `buildRowMetaPatch`, `newPrintSheetSessionId`, `writePrintSheetRow`, `updateDealLineItemPrintSheet`
- Produces: export loop that claims before write; on write error rolls back

- [ ] **Step 1: Failing cycle tests**

Replace/extend mocks in `print-sheet-cycle.test.js` to export the new builders from the mock of `print-sheet-export-twenty.js`.

```js
it('claims session before writing sheet row', async () => {
  listPendingMock.mockResolvedValue([{ id: 'li-1', name: 'Item', plenka: { markdown: '' } }]);
  listActiveMock.mockResolvedValue([]);
  const order = [];
  updateMock.mockImplementation(async () => { order.push('update'); });
  appendMock.mockImplementation(async () => {
    order.push('write');
    return { rowNumber: 10 };
  });

  await runPrintSheetCycle(gql);

  expect(order.indexOf('update')).toBeLessThan(order.indexOf('write'));
  expect(updateMock).toHaveBeenCalledWith(
    gql,
    'li-1',
    expect.objectContaining({ printSheetSessionId: 'sess-test', printSheetExportRequested: false }),
  );
  expect(updateMock).toHaveBeenCalledWith(
    gql,
    'li-1',
    expect.objectContaining({ printSheetTabName: 'Июнь 2026', printSheetRowNumber: 10 }),
  );
  expect(result.exported).toBe(1);
});

it('rolls back claim and re-requests export when sheet write fails', async () => {
  listPendingMock.mockResolvedValue([{ id: 'li-1', plenka: { markdown: '' } }]);
  listActiveMock.mockResolvedValue([]);
  appendMock.mockRejectedValue(new Error('quota'));

  const result = await runPrintSheetCycle(gql);

  expect(result.exported).toBe(0);
  expect(updateMock).toHaveBeenCalledWith(
    gql,
    'li-1',
    expect.objectContaining({
      printSheetSessionId: null,
      printSheetExportRequested: true,
    }),
  );
});
```

Wire `buildClaimPatch` / `buildClaimRollbackPatch` / `buildRowMetaPatch` in the vi.mock factory (real implementations inline in mock is fine).

- [ ] **Step 2: Run — expect FAIL**

```bash
cd backend && npx vitest run tests/print-sheet-cycle.test.js
```

- [ ] **Step 3: Implement cycle export loop**

Replace export loop body with:

```js
for (const lineItem of pending) {
  const sessionId = newPrintSheetSessionId();
  try {
    await updateDealLineItemPrintSheet(gql, lineItem.id, buildClaimPatch(sessionId));
    const rowValues = buildPrintSheetRowValues(lineItem, { workspaceMemberById });
    const { rowNumber } = await writePrintSheetRow(tabName, rowValues);
    await updateDealLineItemPrintSheet(gql, lineItem.id, buildRowMetaPatch(tabName, rowNumber));
    exported += 1;
  } catch (err) {
    console.error(`[print-sheet] export failed for ${lineItem.id}:`, err.message);
    try {
      await updateDealLineItemPrintSheet(gql, lineItem.id, buildClaimRollbackPatch());
    } catch (rollbackErr) {
      console.error(`[print-sheet] claim rollback failed for ${lineItem.id}:`, rollbackErr.message);
    }
  }
}
```

Keep read-back + session-clear phases unchanged (`stage !== V_PECHATI` → `buildSessionClearPatch()`).

- [ ] **Step 4: Run — expect PASS**

```bash
cd backend && npx vitest run tests/print-sheet-cycle.test.js
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/print-sheet-cycle.js backend/tests/print-sheet-cycle.test.js
git commit -m "fix: claim print-sheet session before Sheets write to prevent dupes"
```

---

### Task 4: Mutex + cron logging

**Files:**
- Modify: `crmparserv2/backend/src/services/print-sheet-cron.js`
- Modify: `crmparserv2/backend/tests/print-sheet-cron.test.js`
- Modify: `crmparserv2/backend/src/services/twenty-sync.js` — call locked entry from cron module instead of raw `runPrintSheetCycle` if not already going through `runPrintSheetRefresh`

**Interfaces:**
- Produces: `runPrintSheetRefresh` is single-flight; overlapping calls set dirty and trigger one follow-up run; logs `{ exported, readbackUpdated, sessionsCleared }`

- [ ] **Step 1: Failing mutex test**

In `print-sheet-cron.test.js`:

```js
it('skips overlapping refresh and runs once more when dirty', async () => {
  config.printSheetId = 'sheet-id';
  config.googleServiceAccountEmail = 'service@test.local';
  config.googleServiceAccountPrivateKey = 'private-key';

  let release;
  runPrintSheetCycleMock.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = () => resolve({ exported: 0, readbackUpdated: 0, sessionsCleared: 0 });
      }),
  );

  const first = runPrintSheetRefresh();
  const second = runPrintSheetRefresh();
  await Promise.resolve();
  expect(runPrintSheetCycleMock).toHaveBeenCalledTimes(1);

  release();
  await first;
  await second;
  // dirty re-run
  expect(runPrintSheetCycleMock).toHaveBeenCalledTimes(2);
});

it('logs cycle result', async () => {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  // ... configure + mock cycle result { exported: 1, readbackUpdated: 2, sessionsCleared: 0 }
  await runPrintSheetRefresh();
  expect(logSpy).toHaveBeenCalledWith(
    expect.stringContaining('[print-sheet]'),
    expect.anything(),
  );
  // or single-arg: expect.stringMatching(/exported.:1/)
  logSpy.mockRestore();
});
```

Adjust assertion to match the exact log format you implement (e.g. `console.log('[print-sheet] cycle done', result)`).

- [ ] **Step 2: Run — expect FAIL**

```bash
cd backend && npx vitest run tests/print-sheet-cron.test.js
```

- [ ] **Step 3: Implement mutex in `print-sheet-cron.js`**

```js
let cycleInFlight = null;
let cycleDirty = false;

export async function runPrintSheetRefresh() {
  if (
    !config.printSheetId ||
    !config.googleServiceAccountEmail ||
    !config.googleServiceAccountPrivateKey
  ) {
    return;
  }

  if (cycleInFlight) {
    cycleDirty = true;
    return cycleInFlight;
  }

  let gql;
  try {
    const twenty = requireTwentyConfig();
    gql = createTwentyGqlClient(twenty.apiUrl, twenty.apiToken);
  } catch {
    return;
  }

  cycleInFlight = (async () => {
    try {
      do {
        cycleDirty = false;
        const result = await runPrintSheetCycle(gql);
        console.log('[print-sheet] cycle done', result);
      } while (cycleDirty);
    } finally {
      cycleInFlight = null;
    }
  })();

  return cycleInFlight;
}
```

Ensure `twenty-sync.js` `refreshPrintSheetAfterSync` and `runPrintSheetRefresh` import from `print-sheet-cron.js` (or a tiny `print-sheet-lock.js`) so sync and cron share the same mutex — **do not** call `runPrintSheetCycle` directly from sync.

Today `twenty-sync.js` imports `runPrintSheetCycle` directly — change both helpers to use `runPrintSheetRefresh` from cron (watch circular imports: cron must not import twenty-sync). Prefer moving mutex+refresh into `print-sheet-cycle.js` or new `print-sheet-runner.js` if circular dependency appears.

Recommended structure to avoid cycles:

- Create `backend/src/services/print-sheet-runner.js` with mutex + `runPrintSheetRefresh`
- `print-sheet-cron.js` schedules `runPrintSheetRefresh`
- `twenty-sync.js` imports `runPrintSheetRefresh` from runner

- [ ] **Step 4: Run related tests PASS**

```bash
cd backend && npx vitest run tests/print-sheet-cron.test.js tests/twenty-sync.test.js
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/print-sheet-cron.js backend/src/services/print-sheet-runner.js backend/src/services/twenty-sync.js backend/tests/print-sheet-cron.test.js
git commit -m "fix: single-flight print-sheet cycle with dirty re-run and logging"
```

---

### Task 5: TwentyView — «Отправить в печать» button

**Files:**
- Modify: `BrandingTwentyView/src/deals-board/editors/SheetQueuePanel.tsx`
- Modify: `BrandingTwentyView/src/deals-board/editors/PrintPanelChip.tsx`
- Create: `BrandingTwentyView/src/deals-board/editors/SheetQueuePanel.send.test.ts` (pure helpers) and/or component test if the repo already tests panels similarly

**Interfaces:**
- Produces: prop `enableSendToPrint?: boolean` on `SheetQueuePanel`
- Produces: helper `getPrintSendUiState({ date, time, requested, sessionId, stage })` → `'need_datetime' | 'ready' | 'need_stage' | 'sending' | 'queued'`
- Consumes: `useUpdateLineItem`, fields `printSheetExportRequested`, `printSheetSessionId`, `stage`

- [ ] **Step 1: Failing unit tests for send UI state**

Create `SheetQueuePanel.send.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getPrintSendUiState, isEmptyPrintSession } from './print-send-state';

describe('getPrintSendUiState', () => {
  it('needs datetime when date or time missing', () => {
    expect(
      getPrintSendUiState({ date: '', time: '10:00', requested: false, sessionId: null, stage: 'V_PECHATI' }),
    ).toBe('need_datetime');
  });

  it('ready when date+time and not requested and no session', () => {
    expect(
      getPrintSendUiState({
        date: '2026-08-05',
        time: '10:00',
        requested: false,
        sessionId: null,
        stage: 'NOVYY',
      }),
    ).toBe('ready');
  });

  it('need_stage when requested but not V_PECHATI', () => {
    expect(
      getPrintSendUiState({
        date: '2026-08-05',
        time: '10:00',
        requested: true,
        sessionId: null,
        stage: 'NOVYY',
      }),
    ).toBe('need_stage');
  });

  it('sending when requested + V_PECHATI + no session', () => {
    expect(
      getPrintSendUiState({
        date: '2026-08-05',
        time: '10:00',
        requested: true,
        sessionId: '',
        stage: 'V_PECHATI',
      }),
    ).toBe('sending');
  });

  it('queued when session present', () => {
    expect(
      getPrintSendUiState({
        date: '2026-08-05',
        time: '10:00',
        requested: false,
        sessionId: 'sess',
        stage: 'V_PECHATI',
      }),
    ).toBe('queued');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
yarn test:unit src/deals-board/editors/SheetQueuePanel.send.test.ts
```

(Adjust script to whatever the repo uses, e.g. `vitest run`.)

- [ ] **Step 3: Implement `print-send-state.ts`**

```ts
export const isEmptyPrintSession = (value: unknown) =>
  value == null || String(value).trim() === '';

export type PrintSendUiState =
  | 'need_datetime'
  | 'ready'
  | 'need_stage'
  | 'sending'
  | 'queued';

export function getPrintSendUiState(input: {
  date: string;
  time: string;
  requested: boolean;
  sessionId: unknown;
  stage: string | null | undefined;
}): PrintSendUiState {
  if (!input.date || !input.time) return 'need_datetime';
  if (!isEmptyPrintSession(input.sessionId)) return 'queued';
  if (input.requested && input.stage !== 'V_PECHATI') return 'need_stage';
  if (input.requested && input.stage === 'V_PECHATI') return 'sending';
  return 'ready';
}
```

- [ ] **Step 4: Wire UI**

`PrintPanelChip.tsx`: pass `enableSendToPrint`.

In `SheetQueuePanel` footer (when `enableSendToPrint`):

- Compute state from `dateValue`, `${hour}:${minute}` or saved time, `item.printSheetExportRequested === true`, `item.printSheetSessionId`, `item.stage`.
- Button label «Отправить в печать»; onClick → `patch({ printSheetExportRequested: true })` only.
- Disabled unless state === `'ready'`.
- Hints:
  - `need_datetime`: «Заполни дату и время»
  - `need_stage`: «Поставь стадию «В печати» — уйдёт в таблицу»
  - `sending`: «Уходит в таблицу…»
  - `queued`: «В очереди печати»
- Replace old readyHint about auto-send on stage.

- [ ] **Step 5: Run unit tests PASS**

```bash
yarn test:unit src/deals-board/editors/SheetQueuePanel.send.test.ts
```

- [ ] **Step 6: Commit (BrandingTwentyView)**

```bash
git add src/deals-board/editors/print-send-state.ts src/deals-board/editors/SheetQueuePanel.send.test.ts src/deals-board/editors/SheetQueuePanel.tsx src/deals-board/editors/PrintPanelChip.tsx
git commit -m "feat: add explicit Send to print button in print modal"
```

- [ ] **Step 7: Sync app**

`yarn twenty apply` (or prod deploy path used for TwentyView). Hard-refresh board UI.

---

### Task 6: Smoke verification

- [ ] **Step 1: crmparser regression**

```bash
cd crmparserv2/backend && npx vitest run tests/print-sheet-*.test.js tests/twenty-sync.test.js
```

Expected: all PASS.

- [ ] **Step 2: Manual / MCP smoke**

1. Position with date+time, stage `NOVYY`, press button → `printSheetExportRequested=true`, no sheet row yet.
2. Set stage `V_PECHATI` → within ~1 min one sheet row; session set; requested false.
3. Do not press button; only set `V_PECHATI` + date/time → **no** new row.
4. Trigger overlapping sync+cron under load → no duplicate rows for one send.

- [ ] **Step 3: Final commits only if leftover docs**

Update `docs/superpowers/specs/2026-06-28-print-sheet-export-design.md` with a one-line note pointing to the new spec (optional, YAGNI — skip unless asked).

---

## Self-review vs spec

| Spec requirement | Task |
|------------------|------|
| Mutex + dirty re-run | Task 4 |
| Claim-before-write + rollback | Task 3 |
| Trigger = `printSheetExportRequested` | Tasks 1–2, 5 |
| Stage gate `V_PECHATI` in pending | Task 2 |
| StageSelect unchanged / button no stage change | Task 5 |
| Cron logging | Task 4 |
| Freza no button | Task 5 (`enableSendToPrint` only on print) |
| Session clear on leave V_PECHATI | Task 3 (unchanged phase) |
| Rollout field → parser → UI | Tasks 1→4→5 |
