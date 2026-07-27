# Task 4 Report: Apply tip rules in line-item fields

## Status

**DONE**

## Summary

Updated `buildLineItemFields` to classify line items with `findTipRuleMatch` and derive optional details with `resolveTipDetail`. The options object now accepts `tipRules = []`; unmatched items omit both `tip` and `tipDetail`.

## TDD Evidence

### RED

`npm test -- twenty-line-item.test.js` failed on the two matching cases because `tip` was `undefined` instead of `PODRYAD` or `BANNERA`.

### GREEN

- Focused: 2 test files passed, 20 tests passed.
- Full backend suite: 74 test files passed, 437 tests passed.

## Files Changed

- `backend/src/services/twenty-line-item.js`
- `backend/tests/twenty-line-item.test.js`
- `.superpowers/sdd/task-4-report.md`

## Implementation Notes

- Removed `isPodryadItem` and `isBannerItem` imports and usage from the line-item builder.
- A matching rule always writes `tip`.
- `tipDetail` is written only when `resolveTipDetail` returns a non-null value.
- Tests cover explicit PODRYAD detail, the BANNERA default detail, and no-match omission.

## Commit

`feat(tip-rules): write tip and tipDetail on Twenty line-item sync`

## Concerns

None.
