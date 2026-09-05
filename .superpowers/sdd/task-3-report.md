# Task 3 Report: Bot copy texts and opportunity booking match

**Date:** 2026-09-05  
**Branch:** `feat/telegram-bot-work-requests`  
**Commit:** `4b82dd6` — feat: work-request bot copy and opportunity booking match

## Summary

Pure helpers for inbound: refusal/accepted/create-failed copy strings, and Opportunity matching by 6-digit booking (whole-number regex) or exact deal name. GraphQL search is a thin wrapper via existing `assertGqlSuccess`; `pickMatchedOpportunity` stays pure. TDD: RED (modules missing) → GREEN (5/5 pass). No Telegram send.

## TDD Evidence

### RED (Step 2)

Command: `cd backend && npm test -- tests/telegram-work-request-copy.test.js tests/telegram-work-request-match-deal.test.js`

```
Error: Cannot find module '../src/telegram/work-requests/copy.js'
Error: Cannot find module '../src/telegram/work-requests/match-deal.js'
 Test Files  2 failed (2)
      Tests  no tests
```

### GREEN (Step 4)

```
 Test Files  2 passed (2)
      Tests  5 passed (5)
```

## Files Changed

| File | Change |
|------|--------|
| `backend/src/telegram/work-requests/copy.js` | Refusal/accepted/create-failed text builders |
| `backend/src/telegram/work-requests/match-deal.js` | Booking match, GraphQL search, `matchOpportunity` |
| `backend/tests/telegram-work-request-copy.test.js` | 2 copy tests per brief |
| `backend/tests/telegram-work-request-match-deal.test.js` | 3 pickMatchedOpportunity tests per brief |

## Exported API

### copy.js

| Export | Purpose |
|--------|---------|
| `REFUSAL_NEW_MESSAGE` | Fixed last line for all refusals |
| `buildRefusalText(missing)` | Bulleted list + blank line + `REFUSAL_NEW_MESSAGE` |
| `buildAcceptedText(requestNumber)` | `Запрос #N принят. Ответ появится в этом сообщении.` |
| `buildCreateFailedText()` | Twenty create failure message |

### match-deal.js

| Export | Purpose |
|--------|---------|
| `bookingInName(name, booking)` | `(^|\D)booking(\D|$)` — booking as own number |
| `pickMatchedOpportunity(nodes, { booking, dealName })` | Pure filter; exactly one match or null |
| `searchOpportunitiesByBooking(gql, booking)` | ilike `%booking%`, first 30 |
| `matchOpportunity({ gql, booking, dealName })` | No gql → null; gql errors propagate |

## Self-Review

### Correctness
- `123456` matches node `a` but not `1234567` in `b` (whole-number boundary).
- Duplicate booking in two names → null (no ambiguous link).
- `matchOpportunity` without gql returns null; request still creatable without link.
- Deal name search uses `eq` filter; post-filter via `pickMatchedOpportunity`.

### Not covered in brief tests
- `bookingInName`, `buildCreateFailedText`, `searchOpportunitiesByBooking`, `matchOpportunity` — implemented, untested here; inbound integration later.

### Risks / notes for later tasks
- ilike `%123456%` may return many nodes; disambiguation relies on `pickMatchedOpportunity` only.
- No unit test that gql errors propagate from `matchOpportunity` (caller must catch for `buildCreateFailedText`).

## Commit

```
4b82dd6 feat: work-request bot copy and opportunity booking match
```

## Review Fixes (2026-09-05)

Addressed Important findings from Task 3 review.

### Changes
- `bookingInName`: returns false unless `booking` matches `/^\d{6}$/` before token regex.
- `searchOpportunitiesByBooking` / `matchOpportunity`: call `assertHttpSuccess` + `assertGqlSuccess` via shared `assertTwentyResponse` — HTTP 500 no longer treated as empty results.
- Tests: 5-digit/7-digit booking rejected; gql mock with status 500 throws for search and match.

### Test output

Command: `cd backend && npm test -- tests/telegram-work-request-copy.test.js tests/telegram-work-request-match-deal.test.js`

```
 Test Files  2 passed (2)
      Tests  8 passed (8)
```

### Commit

```
ad79601 fix: validate 6-digit booking and assert HTTP on opportunity search
```