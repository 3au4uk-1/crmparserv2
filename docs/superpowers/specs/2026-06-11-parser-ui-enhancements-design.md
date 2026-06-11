# CRM Parser — Event Date, Companies, Mobile UI, Sorting — Design Spec

**Date:** 2026-06-11  
**Status:** Approved

## Problem

Four gaps block day-to-day use of the branding parser:

1. Twenty CRM field `closeDate` is labeled «Close date» and stores only the calendar event date, while «Время приезда» lives in a separate custom field. Users need one «Дата мероприятия» that reflects when the team arrives.
2. New company codes (e.g. `БС`) appear in deal titles but are not recognized because `title-parser.js` hardcodes three codes and the Deals filter dropdown is static.
3. The UI is desktop-only (fixed sidebar, wide table) and is unusable on phones.
4. The deals table has basic filters but no column sorting like Twenty table views.

## Goals

- Rename Twenty `closeDate` label to **«Дата мероприятия»** without changing the GraphQL field name.
- Populate `closeDate` with event date + arrival time; keep syncing `arrivalTime` separately for compatibility.
- Load company codes from the `companies` table everywhere (parser validation, filters, Twenty lookup).
- Allow adding companies in Settings UI (not only via API).
- Responsive layout: card list on mobile, table on desktop for Deals; collapsible nav on small screens.
- Sortable deal columns via API + clickable headers.

## Non-Goals

- Changing Twenty `stage`, designer funnel, or blacklist behaviour.
- Additional filters (manager, budget range, Twenty error flag) — deferred.
- Card layout on desktop (table stays on `≥ md`).
- Migrating historical Twenty records automatically (users re-sync or wait for next parse).

---

## Decisions Summary

| Topic | Decision |
|-------|----------|
| `closeDate` + arrival time | Combine date + `arrival_time` into ISO datetime (`Europe/Moscow`); continue syncing `arrivalTime` field |
| Twenty field rename | Label only → «Дата мероприятия»; API name stays `closeDate` |
| Companies | Dynamic from `companies` table; same parse validation logic (`parseError` if unknown code) |
| Mobile Deals list | Cards `< md`, table `≥ md` |
| Sorting | Column headers: date, title, company, manager, budget, status + existing filters |

---

## Architecture

**Approach:** Layered changes (recommended over monolithic PR or two-phase data/UI split).

```
┌─────────────────────────────────────────────────────────┐
│  Frontend                                                │
│  App shell (responsive nav) │ Deals (table / cards)      │
│  Settings (+ add company)   │ sort state → API query     │
└────────────────────────────┬────────────────────────────┘
                             │ GET /deals?sortBy&sortDir
                             │ useCompanies()
┌────────────────────────────▼────────────────────────────┐
│  Backend                                                 │
│  deals route (sort whitelist) │ companies loader       │
│  title-parser(knownCodes)     │ buildCloseDate()       │
└────────────────────────────┬────────────────────────────┘
                             │ GraphQL closeDate, arrivalTime
┌────────────────────────────▼────────────────────────────┐
│  Twenty CRM (metadata + records)                         │
│  closeDate label «Дата мероприятия» [DATE_TIME if needed]│
└─────────────────────────────────────────────────────────┘
```

---

## 1. Event Date (`closeDate`) + Arrival Time

### Twenty metadata (one-time)

| Action | Detail |
|--------|--------|
| Rename label | `closeDate` → **«Дата мероприятия»** |
| Keep API name | `closeDate` (no parser GraphQL changes) |
| Field type | If `DATE` rejects time component, change to `DATE_TIME` via Twenty field metadata |

Can be done manually in Twenty Settings or via `update_field_metadata` MCP tool.

### `buildCloseDate(deal)` (new helper in `twenty-opportunity.js` or `crm-dates.js`)

| Input | Rule |
|-------|------|
| Base date | `deal.start_date` → else `deal.end_date` → else `new Date()` |
| `arrival_time` | Parse `HH:MM` (24h); append to calendar date in `CRM_TIMEZONE` (`Europe/Moscow`) |
| No valid time | Use `T00:00:00+03:00` on that date |
| Output | ISO 8601 with offset, e.g. `2026-06-10T09:00:00+03:00` |

### `buildOpportunityInput` changes

```js
closeDate: buildCloseDate(deal),
// unchanged:
if (deal.arrival_time) input.arrivalTime = deal.arrival_time;
```

Re-sync and create paths both use `buildOpportunityInput` — existing synced deals get updated `closeDate` on next parse or manual re-sync.

### Parser UI

| Location | Change |
|----------|--------|
| Deals table header | «Дата» → «Дата мероприятия» |
| Deals table / card cell | `formatDate(start_date)` + `arrival_time` when present |
| Deal detail expand | Show arrival time in event block if not already visible |

---

## 2. Dynamic Companies

### Backend

**`loadCompanyCodes(db)`** — `SELECT code FROM companies ORDER BY code`.

**`parseDealTitle(title, knownCodes)`** — replace hardcoded `KNOWN_COMPANIES`:

- `knownCodes` defaults to `[]` for backward-compatible tests.
- `parseError: true` when first segment not in `knownCodes` (same semantics as today).

**`parser.js`** — before the event loop:

```js
const knownCodes = loadCompanyCodes(db);
// ...
const titleInfo = parseDealTitle(event.title || '', knownCodes);
```

**Twenty sync** — no change; `findOrCreateCompany` already uses `companies` table by code.

### Frontend

| Location | Change |
|----------|--------|
| `Deals.jsx` company filter | Options from `useCompanies()` instead of hardcoded `<option>` |
| `Settings.jsx` | Add form: code + full name → `POST /api/settings/companies` (route already exists) |

### Data

New companies are added only via Settings (or API). No seed migration required beyond existing `INSERT OR IGNORE` in `schema.sql`.

---

## 3. Mobile-Responsive UI

### Breakpoint

Tailwind `md` (768px): mobile below, desktop at and above.

### App shell (`App.jsx`)

| Viewport | Behaviour |
|----------|-----------|
| `< md` | Hide sidebar; top bar with title + hamburger; overlay drawer for nav links |
| `≥ md` | Current fixed `w-56` sidebar |

### Deals page

| Viewport | Behaviour |
|----------|-----------|
| `≥ md` | Existing `<table>` with `DealRow` |
| `< md` | Vertical stack of `DealCard` components |

**`DealCard`** (new, shared actions with `DealRow`):

- Primary line: date + time, status badge
- Title (truncated), company, manager
- Approve / reject / re-sync / delete — same rules as `DealRow`
- Tap expands inline details + `DealItems` (reuse existing component)

Extract shared action handlers or hooks if duplication exceeds ~30 lines; otherwise duplicate minimally for v1.

### Other pages

- **Dashboard:** filter row wraps; stat grid already `grid-cols-2 md:grid-cols-5`
- **Settings / Logs:** horizontal scroll on wide tables; form inputs `w-full` on mobile
- **Login:** centered card, full-width inputs on narrow screens

---

## 4. Column Sorting

### API `GET /deals`

New query parameters:

| Param | Values | Default |
|-------|--------|---------|
| `sortBy` | `start_date`, `title`, `company_code`, `manager_name`, `budget`, `approval_status` | `start_date` |
| `sortDir` | `asc`, `desc` | `desc` |

Implementation:

- Whitelist `sortBy` — reject unknown values with 400 or fall back to default (prefer fallback for robustness).
- `budget`: `ORDER BY CAST(d.budget AS REAL) ASC/DESC NULLS LAST` (SQLite: `NULLS LAST` via `CASE` or `(budget IS NULL), CAST(...)`).
- Combine with existing `status`, `company`, `from`, `to` filters.
- Pagination unchanged (`limit`, `offset`).

### Frontend (`Deals.jsx`)

- State: `sortBy`, `sortDir` alongside existing `filters`.
- Clickable `<th>` with ↑ / ↓ indicator on active column.
- Click cycle: inactive → `desc` → `asc` → (optional) reset to default; v1: toggle `asc`/`desc` only.
- Changing sort resets `page` to 0.
- Pass `sortBy` / `sortDir` to `useDeals()` hook and `api.js` fetch.

### Mobile cards

Same sort order as table (API-driven); no separate mobile sort UI in v1.

---

## Error Handling

| Case | Behaviour |
|------|-----------|
| Invalid `arrival_time` in deal | Ignore time; use midnight on event date |
| Unknown company code in title | `parseError: true` (unchanged); deal still stored with code |
| Invalid `sortBy` in API | Fall back to `start_date` |
| Twenty rejects datetime `closeDate` | Surface in `twenty_error`; document DATE_TIME metadata fix |

---

## Testing

| Area | Tests |
|------|-------|
| `buildCloseDate` | date+time, date only, missing dates, bad time string, Moscow offset |
| `parseDealTitle` | dynamic `knownCodes`, unknown code → `parseError` |
| `GET /deals` | each `sortBy`, `asc`/`desc`, combined with filters, invalid `sortBy` fallback |
| `twenty-opportunity` | update expected `closeDate` to datetime when `arrival_time` set |
| Manual | Deals page at 375px and 1280px; add company in Settings → appears in filter after refresh |

---

## Implementation Order

1. `buildCloseDate` + `buildOpportunityInput` + tests
2. Dynamic companies (backend + title-parser + parser + Deals filter)
3. Settings «add company» form
4. API sorting + frontend sort headers
5. `DealCard` + responsive Deals layout
6. App shell mobile nav
7. Twenty metadata: rename `closeDate` label (and DATE_TIME if needed)

---

## Rollout Notes

- After deploy, run **Пересинхр.** on active deals or wait for auto re-sync after parse to refresh `closeDate` in Twenty.
- Add new company codes in **Настройки → Справочник компаний** before parsing deals with those prefixes.
