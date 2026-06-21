# Parse Schedule Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single configurable cron with a fixed, time-aware parse schedule (weekday fast/deep, night-light, weekend tiers) and shared parsing mutex.

**Architecture:** A new `parse-schedule.js` module resolves which tier applies at each 15-minute cron tick (with per-hour deduplication). `crm-dates.js` computes date ranges per tier. `parsing-lock.js` shares the in-progress flag between the API route and scheduler. Settings UI drops the cron field.

**Tech Stack:** Node.js (ESM), node-cron, vitest. Spec: `docs/superpowers/specs/2026-06-21-parse-schedule-optimization-design.md`.

---

## File Structure

- **Create** `backend/src/services/parsing-lock.js` — shared `isParsingInProgress` / `tryAcquireParsingLock` / `releaseParsingLock`.
- **Create** `backend/src/services/parse-schedule.js` — tier rules, `resolveParseTier`, `markParseSlotExecuted`, test reset helper.
- **Create** `backend/tests/parse-schedule.test.js` — tier resolution, dedup, range integration.
- **Create** `backend/tests/parsing-lock.test.js` — lock acquire/release semantics.
- **Create** `backend/tests/scheduler.test.js` — cron expression, tier dispatch, mutex skip (mocked `runParsing`).
- **Modify** `backend/src/utils/crm-dates.js` — add `getParseRangeForTier`.
- **Modify** `backend/tests/crm-dates.test.js` — range tests per tier.
- **Modify** `backend/src/services/scheduler.js` — 15-min tick + tier resolver (remove `parse_schedule` setting).
- **Modify** `backend/src/routes/parsing.js` — use `parsing-lock.js`.
- **Modify** `backend/src/routes/settings.js` — remove `parse_schedule` validation and `restartScheduler` hook.
- **Modify** `frontend/src/pages/Settings.jsx` — replace cron input with static schedule summary.

---

## Task 1: Tier date ranges (`getParseRangeForTier`)

**Files:**
- Modify: `backend/src/utils/crm-dates.js`
- Test: `backend/tests/crm-dates.test.js`

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/crm-dates.test.js`:

```js
import {
  buildCloseDate,
  getDefaultParseRange,
  getMinParseStart,
  getParseRangeForTier,
  normalizeParseRange,
  parseEventDate,
  toInputDate,
} from '../src/utils/crm-dates.js';

// inside describe('crm-dates'):
  it('getParseRangeForTier weekday-fast ends +4 days', () => {
    const now = new Date('2026-06-19T10:00:00+03:00');
    const range = getParseRangeForTier('weekday-fast', now);
    expect(range.startDate).toBe('2026-06-19');
    expect(range.endDate).toBe('2026-06-23');
  });

  it('getParseRangeForTier weekday-deep ends +14 days', () => {
    const now = new Date('2026-06-19T22:00:00+03:00');
    const range = getParseRangeForTier('weekday-deep', now);
    expect(range.endDate).toBe('2026-07-03');
  });

  it('getParseRangeForTier night-light ends +2 days', () => {
    const now = new Date('2026-06-19T02:00:00+03:00');
    const range = getParseRangeForTier('night-light', now);
    expect(range.endDate).toBe('2026-06-21');
  });

  it('getParseRangeForTier weekend ends +7 days', () => {
    const now = new Date('2026-06-20T14:00:00+03:00');
    const range = getParseRangeForTier('weekend', now);
    expect(range.endDate).toBe('2026-06-27');
  });

  it('getParseRangeForTier start is never before today', () => {
    const now = new Date('2026-06-19T10:00:00+03:00');
    const range = getParseRangeForTier('weekday-fast', now);
    expect(range.start).toBe(getMinParseStart(now));
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix backend -- crm-dates`
Expected: FAIL with `getParseRangeForTier is not a function` or export missing.

- [ ] **Step 3: Implement `getParseRangeForTier`**

Add to `backend/src/utils/crm-dates.js` after `getDefaultParseRange`:

```js
const TIER_DAY_OFFSET = {
  'weekday-fast': 4,
  'weekday-deep': 14,
  'night-light': 2,
  weekend: 7,
};

/** Parse window for a schedule tier: today → today+N days (CRM timezone). */
export function getParseRangeForTier(tier, now = new Date()) {
  const dayOffset = TIER_DAY_OFFSET[tier];
  if (dayOffset == null) {
    throw new Error(`Unknown parse tier: ${tier}`);
  }
  const { year, month, day } = getCrmCalendarDate(now);
  const start = getMinParseStart(now);
  const end = new Date(year, month - 1, day + dayOffset, 23, 59, 59);
  const endFormatted = formatCrmDateTime(end);
  return {
    start,
    end: endFormatted,
    startDate: toInputDate(start),
    endDate: toInputDate(endFormatted),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --prefix backend -- crm-dates`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/crm-dates.js backend/tests/crm-dates.test.js
git commit -m "feat: add getParseRangeForTier for schedule tiers"
```

---

## Task 2: Parse schedule resolver

**Files:**
- Create: `backend/src/services/parse-schedule.js`
- Test: `backend/tests/parse-schedule.test.js`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/parse-schedule.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveParseTier,
  markParseSlotExecuted,
  resetParseScheduleState,
} from '../src/services/parse-schedule.js';
import { getParseRangeForTier } from '../src/utils/crm-dates.js';

describe('resolveParseTier', () => {
  beforeEach(() => {
    resetParseScheduleState();
  });

  it('returns weekday-fast on Fri 10:00 MSK', () => {
    expect(resolveParseTier(new Date('2026-06-19T10:00:00+03:00'))).toBe('weekday-fast');
  });

  it('returns weekday-fast on Fri 21:00 MSK', () => {
    expect(resolveParseTier(new Date('2026-06-19T21:00:00+03:00'))).toBe('weekday-fast');
  });

  it('returns weekday-deep on Fri 22:00 MSK', () => {
    expect(resolveParseTier(new Date('2026-06-19T22:00:00+03:00'))).toBe('weekday-deep');
  });

  it('returns night-light on Fri 02:00 MSK', () => {
    expect(resolveParseTier(new Date('2026-06-19T02:00:00+03:00'))).toBe('night-light');
  });

  it('returns null on Fri 03:00 MSK (quiet hours)', () => {
    expect(resolveParseTier(new Date('2026-06-19T03:00:00+03:00'))).toBeNull();
  });

  it('returns weekend on Sat 02:00 MSK (beats night-light)', () => {
    expect(resolveParseTier(new Date('2026-06-20T02:00:00+03:00'))).toBe('weekend');
  });

  it('returns weekend on Sat 14:00 MSK', () => {
    expect(resolveParseTier(new Date('2026-06-20T14:00:00+03:00'))).toBe('weekend');
  });

  it('returns null on Sun 23:00 MSK (off weekend slot)', () => {
    expect(resolveParseTier(new Date('2026-06-21T23:00:00+03:00'))).toBeNull();
  });

  it('deduplicates within the same hour slot', () => {
    const now = new Date('2026-06-19T10:05:00+03:00');
    expect(resolveParseTier(now)).toBe('weekday-fast');
    markParseSlotExecuted('weekday-fast', now);
    expect(resolveParseTier(new Date('2026-06-19T10:20:00+03:00'))).toBeNull();
  });

  it('allows the next hour slot', () => {
    const ten = new Date('2026-06-19T10:00:00+03:00');
    markParseSlotExecuted('weekday-fast', ten);
    expect(resolveParseTier(new Date('2026-06-19T11:00:00+03:00'))).toBe('weekday-fast');
  });
});

describe('getParseRangeForTier integration', () => {
  it('weekday-fast range matches +4 day offset', () => {
    const range = getParseRangeForTier('weekday-fast', new Date('2026-06-19T10:00:00+03:00'));
    expect(range.endDate).toBe('2026-06-23');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix backend -- parse-schedule`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `parse-schedule.js`**

Create `backend/src/services/parse-schedule.js`:

```js
import { CRM_TIMEZONE } from '../utils/crm-dates.js';

export const PARSE_TIERS = ['weekday-deep', 'weekend', 'weekday-fast', 'night-light'];

const WEEKEND_SLOTS = new Set([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22]);

const executedSlots = new Set();

function getCrmTimeParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CRM_TIMEZONE,
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(now);

  const get = (type) => parts.find((p) => p.type === type)?.value;
  return {
    weekday: get('weekday'),
    hour: Number(get('hour')),
  };
}

function slotKey(tier, now) {
  const dateParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CRM_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const { hour } = getCrmTimeParts(now);
  return `${tier}:${dateParts}:${hour}`;
}

function pickTier(now) {
  const { weekday, hour } = getCrmTimeParts(now);
  const isWeekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(weekday);
  const isWeekend = ['Sat', 'Sun'].includes(weekday);
  const matches = [];

  if (isWeekday && hour === 22) matches.push('weekday-deep');
  if (isWeekend && WEEKEND_SLOTS.has(hour)) matches.push('weekend');
  if (isWeekday && hour >= 9 && hour <= 21) matches.push('weekday-fast');
  if (hour === 2) matches.push('night-light');

  for (const tier of PARSE_TIERS) {
    if (matches.includes(tier)) return tier;
  }
  return null;
}

/** Returns tier to run now, or null if quiet / already executed this hour. */
export function resolveParseTier(now = new Date()) {
  const tier = pickTier(now);
  if (!tier) return null;
  if (executedSlots.has(slotKey(tier, now))) return null;
  return tier;
}

export function markParseSlotExecuted(tier, now = new Date()) {
  executedSlots.add(slotKey(tier, now));
}

/** Test-only: clear dedup state. */
export function resetParseScheduleState() {
  executedSlots.clear();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --prefix backend -- parse-schedule`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/parse-schedule.js backend/tests/parse-schedule.test.js
git commit -m "feat: add time-aware parse schedule resolver"
```

---

## Task 3: Shared parsing lock

**Files:**
- Create: `backend/src/services/parsing-lock.js`
- Modify: `backend/src/routes/parsing.js`
- Test: `backend/tests/parsing-lock.test.js`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/parsing-lock.test.js`:

```js
import { describe, it, expect, afterEach } from 'vitest';
import {
  isParsingInProgress,
  tryAcquireParsingLock,
  releaseParsingLock,
} from '../src/services/parsing-lock.js';

describe('parsing-lock', () => {
  afterEach(() => {
    releaseParsingLock();
  });

  it('starts unlocked', () => {
    expect(isParsingInProgress()).toBe(false);
  });

  it('tryAcquire succeeds once, fails while held', () => {
    expect(tryAcquireParsingLock()).toBe(true);
    expect(isParsingInProgress()).toBe(true);
    expect(tryAcquireParsingLock()).toBe(false);
  });

  it('release allows re-acquire', () => {
    tryAcquireParsingLock();
    releaseParsingLock();
    expect(isParsingInProgress()).toBe(false);
    expect(tryAcquireParsingLock()).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix backend -- parsing-lock`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement lock module and wire parsing route**

Create `backend/src/services/parsing-lock.js`:

```js
let parsingInProgress = false;

export function isParsingInProgress() {
  return parsingInProgress;
}

export function tryAcquireParsingLock() {
  if (parsingInProgress) return false;
  parsingInProgress = true;
  return true;
}

export function releaseParsingLock() {
  parsingInProgress = false;
}
```

Replace `backend/src/routes/parsing.js` top section:

```js
import {
  isParsingInProgress,
  tryAcquireParsingLock,
  releaseParsingLock,
} from '../services/parsing-lock.js';

// remove: let parsingInProgress = false;

router.post('/run', async (req, res, next) => {
  if (!tryAcquireParsingLock()) {
    return res.status(409).json({ error: 'Parsing already in progress' });
  }

  try {
    const { startDate, endDate } = req.body;
    const { start, end } = normalizeParseRange(startDate, endDate);
    const result = await runParsing(start, end);
    res.json(result);
  } catch (err) {
    next(err);
  } finally {
    releaseParsingLock();
  }
});

router.get('/status', (req, res) => {
  res.json({ inProgress: isParsingInProgress() });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --prefix backend -- parsing-lock`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/parsing-lock.js backend/src/routes/parsing.js backend/tests/parsing-lock.test.js
git commit -m "feat: share parsing lock between API and scheduler"
```

---

## Task 4: Rewrite scheduler

**Files:**
- Modify: `backend/src/services/scheduler.js`
- Create: `backend/tests/scheduler.test.js`

- [ ] **Step 1: Write the failing scheduler tests**

Create `backend/tests/scheduler.test.js`:

```js
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CRM_TIMEZONE } from '../src/utils/crm-dates.js';

const scheduleMock = vi.fn();
const stopMock = vi.fn();
const runParsingMock = vi.fn();
const resolveParseTierMock = vi.fn();
const markParseSlotExecutedMock = vi.fn();
const getParseRangeForTierMock = vi.fn();
const isParsingInProgressMock = vi.fn();
const tryAcquireParsingLockMock = vi.fn();
const releaseParsingLockMock = vi.fn();

vi.mock('node-cron', () => ({
  default: {
    schedule: (...args) => scheduleMock(...args),
    validate: () => true,
  },
}));

vi.mock('../src/services/parser.js', () => ({
  runParsing: (...args) => runParsingMock(...args),
}));

vi.mock('../src/services/parse-schedule.js', () => ({
  resolveParseTier: (...args) => resolveParseTierMock(...args),
  markParseSlotExecuted: (...args) => markParseSlotExecutedMock(...args),
}));

vi.mock('../src/utils/crm-dates.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getParseRangeForTier: (...args) => getParseRangeForTierMock(...args),
  };
});

vi.mock('../src/services/parsing-lock.js', () => ({
  isParsingInProgress: (...args) => isParsingInProgressMock(...args),
  tryAcquireParsingLock: (...args) => tryAcquireParsingLockMock(...args),
  releaseParsingLock: (...args) => releaseParsingLockMock(...args),
}));

import { initScheduler, tickScheduler } from '../src/services/scheduler.js';

describe('scheduler', () => {
  beforeEach(() => {
    scheduleMock.mockReset();
    stopMock.mockReset();
    runParsingMock.mockReset();
    resolveParseTierMock.mockReset();
    markParseSlotExecutedMock.mockReset();
    getParseRangeForTierMock.mockReset();
    isParsingInProgressMock.mockReset();
    tryAcquireParsingLockMock.mockReset();
    releaseParsingLockMock.mockReset();

    scheduleMock.mockReturnValue({ stop: stopMock });
    runParsingMock.mockResolvedValue({});
    getParseRangeForTierMock.mockReturnValue({
      start: '2026-06-19T00:00:00+03:00',
      end: '2026-06-23T23:59:59+03:00',
    });
    tryAcquireParsingLockMock.mockReturnValue(true);
  });

  it('registers */15 cron in CRM timezone', () => {
    initScheduler();
    expect(scheduleMock).toHaveBeenCalledTimes(1);
    const [expression, , options] = scheduleMock.mock.calls[0];
    expect(expression).toBe('*/15 * * * *');
    expect(options).toEqual({ timezone: CRM_TIMEZONE });
  });

  it('runs parsing when tier resolves and lock acquired', async () => {
    resolveParseTierMock.mockReturnValue('weekday-fast');
    await tickScheduler(new Date('2026-06-19T10:00:00+03:00'));

    expect(getParseRangeForTierMock).toHaveBeenCalledWith('weekday-fast', expect.any(Date));
    expect(runParsingMock).toHaveBeenCalledWith(
      '2026-06-19T00:00:00+03:00',
      '2026-06-23T23:59:59+03:00'
    );
    expect(markParseSlotExecutedMock).toHaveBeenCalledWith('weekday-fast', expect.any(Date));
    expect(releaseParsingLockMock).toHaveBeenCalled();
  });

  it('skips when no tier', async () => {
    resolveParseTierMock.mockReturnValue(null);
    await tickScheduler(new Date('2026-06-19T03:00:00+03:00'));
    expect(runParsingMock).not.toHaveBeenCalled();
    expect(tryAcquireParsingLockMock).not.toHaveBeenCalled();
  });

  it('skips when lock not acquired', async () => {
    resolveParseTierMock.mockReturnValue('weekday-fast');
    tryAcquireParsingLockMock.mockReturnValue(false);
    await tickScheduler(new Date('2026-06-19T10:00:00+03:00'));
    expect(runParsingMock).not.toHaveBeenCalled();
    expect(markParseSlotExecutedMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix backend -- scheduler.test`
Expected: FAIL — `tickScheduler` not exported / module errors.

- [ ] **Step 3: Rewrite `scheduler.js`**

Replace `backend/src/services/scheduler.js` with:

```js
import cron from 'node-cron';
import { runParsing } from './parser.js';
import { resolveParseTier, markParseSlotExecuted } from './parse-schedule.js';
import {
  tryAcquireParsingLock,
  releaseParsingLock,
} from './parsing-lock.js';
import { CRM_TIMEZONE, getParseRangeForTier, toInputDate } from '../utils/crm-dates.js';

let scheduledTask = null;

export async function tickScheduler(now = new Date()) {
  const tier = resolveParseTier(now);
  if (!tier) return;

  if (!tryAcquireParsingLock()) {
    console.log(`[scheduler] skipped tier=${tier} (parsing in progress)`);
    return;
  }

  const { start, end } = getParseRangeForTier(tier, now);
  console.log(
    `[scheduler] tier=${tier} range=${toInputDate(start)}..${toInputDate(end)}`
  );

  try {
    markParseSlotExecuted(tier, now);
    await runParsing(start, end);
    console.log(`[scheduler] tier=${tier} completed`);
  } catch (err) {
    console.error(`[scheduler] tier=${tier} failed:`, err.message);
  } finally {
    releaseParsingLock();
  }
}

export function initScheduler() {
  if (scheduledTask) {
    scheduledTask.stop();
  }

  scheduledTask = cron.schedule(
    '*/15 * * * *',
    () => {
      tickScheduler().catch((err) => {
        console.error('[scheduler] tick error:', err.message);
      });
    },
    { timezone: CRM_TIMEZONE }
  );

  console.log(`Scheduler initialized: */15 * * * * (${CRM_TIMEZONE})`);
}

export function restartScheduler() {
  initScheduler();
}
```

Note: `markParseSlotExecuted` is called **before** `runParsing` so a slow run does not cause duplicate ticks in the same hour to start a second parse. If `runParsing` throws, the slot stays marked (no retry until next hour) — acceptable per spec («не догоняем»).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --prefix backend -- scheduler.test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/scheduler.js backend/tests/scheduler.test.js
git commit -m "feat: replace cron setting with time-aware scheduler tiers"
```

---

## Task 5: Remove parse_schedule from settings API

**Files:**
- Modify: `backend/src/routes/settings.js`

- [ ] **Step 1: Remove cron validation and scheduler restart**

In `backend/src/routes/settings.js`:

- Remove `import cron from 'node-cron';`
- Remove `import { restartScheduler } from '../services/scheduler.js';`
- Delete the entire `if (req.params.key === 'parse_schedule') { ... }` validation block (lines 78–85).
- Delete the `if (req.params.key === 'parse_schedule') { restartScheduler(); }` block (lines 89–91).

The generic `PUT /:key` handler should only check `reserved` keys and save.

- [ ] **Step 2: Run full backend tests**

Run: `npm test --prefix backend`
Expected: all PASS

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/settings.js
git commit -m "chore: drop parse_schedule setting from API"
```

---

## Task 6: Update Settings UI

**Files:**
- Modify: `frontend/src/pages/Settings.jsx`

- [ ] **Step 1: Remove cron state and input; add static schedule section**

Remove state and effects:

```js
// DELETE these lines:
const [parseSchedule, setParseSchedule] = useState('0 18 * * *');
const [parseScheduleFocused, setParseScheduleFocused] = useState(false);
const [parseScheduleError, setParseScheduleError] = useState('');

useEffect(() => {
  if (!parseScheduleFocused && settings?.parse_schedule != null) {
    setParseSchedule(settings.parse_schedule || '0 18 * * *');
  }
}, [settings?.parse_schedule, parseScheduleFocused]);
```

Replace the `<Section title="Расписание парсинга">` block with:

```jsx
          <Section
            title="Расписание парсинга"
            description="Автообновление зашито в сервер. Ручной парсинг — на странице «Парсинг»."
          >
            <ul className="text-sm text-ink-muted space-y-1.5 max-w-lg list-disc pl-5">
              <li>Будни 9:00–21:00 — каждый час, +4 дня</li>
              <li>Будни 22:00 — +14 дней</li>
              <li>Каждый день 2:00 — +2 дня (ночной лёгкий прогон)</li>
              <li>Выходные — каждые 2 часа, +7 дней</li>
              <li>22:00–9:00 (кроме 2:00) — без автообновлений</li>
            </ul>
          </Section>
```

- [ ] **Step 2: Verify frontend builds**

Run: `npm run build --prefix frontend`
Expected: build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Settings.jsx
git commit -m "ui: show fixed parse schedule instead of cron field"
```

---

## Task 7: Final verification

- [ ] **Step 1: Run all backend tests**

Run: `npm test --prefix backend`
Expected: all tests PASS

- [ ] **Step 2: Update spec status**

In `docs/superpowers/specs/2026-06-21-parse-schedule-optimization-design.md`, change status line to:

```markdown
**Статус:** Утверждён, реализован по плану `2026-06-21-parse-schedule-optimization.md`
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-06-21-parse-schedule-optimization-design.md
git commit -m "docs: mark parse schedule spec as implemented"
```

---

## Spec Self-Review (plan vs spec)

| Spec requirement | Plan task |
|------------------|-----------|
| Tier rules table | Task 2 `pickTier` |
| 15-min cron tick | Task 4 `*/15 * * * *` |
| Per-hour dedup | Task 2 `executedSlots` + Task 4 `markParseSlotExecuted` |
| `getParseRangeForTier` | Task 1 |
| Shared mutex | Task 3 + Task 4 |
| Skip when busy, no catch-up | Task 4 `tryAcquireParsingLock` |
| Remove `parse_schedule` UI/API | Tasks 5–6 |
| Logging | Task 4 `console.log` lines |
| Unit tests from spec table | Task 2 |
| Manual parse unchanged | Task 3 keeps `/run` behavior |

No placeholders; all code blocks are complete.
