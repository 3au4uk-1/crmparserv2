# Task 5 Report: Ops note + Telegram UI one-liner

**Status:** DONE

## Summary

Added a one-line ops hint on the Telegram settings page next to the existing `digest.morning` description, documenting Omni configuration keys without exposing secret values.

## Files changed

| File | Change |
|------|--------|
| `frontend/src/pages/Telegram.jsx` | Extended Section «Оклейка → отправка» description with Omni keys: `digest_omni_api_key` / `OMNI_API_KEY`, default model `oc/deepseek-v4-flash-free`, fallback `auto` |

## Commit

`62198a9` — docs(ui): note digest Omni settings keys

## Manual smoke (ops)

Set `OMNI_API_KEY` or `digest_omni_api_key` on staging → `/завтра` → expect `🧠` in digest or silent rule-only fallback.

## Concerns

- None. UI-only documentation; no secrets in repo.
