# Digest risk lines: booking № + CRM links

**Date:** 2026-08-07  
**Status:** Approved for planning  
**Scope:** crmparserv2 Telegram morning digest risk list formatting  
**Related:** `2026-08-06-telegram-morning-digest-design.md`, `2026-08-07-digest-userbot-transport-design.md`

## Problem

Risk lines currently show mostly **company name** (`ProInteractive · 0/3 · …`) because `parseDealNameParts` expects a rigid `prefix/dates/manager/bookingNo` shape, while real Tony opportunity names are irregular. Booking numbers and Tony/Bitrix URLs already exist on opportunities (`tonyLink`, `bitrixLink`). Users need **Tony booking №** as the primary label and clickable **(Twenty | Tony | Bitrix)** links.

## Goals / non-goals

| In (v1) | Out (v1) |
|---------|----------|
| Risk title = Tony booking № (from `tonyLink`, fallback regex on name) | Keep company/manager in title |
| Per-risk link line `(Twenty \| Tony \| Bitrix)` HTML anchors | Inline keyboard buttons |
| Fetch `tonyLink` / `bitrixLink` in digest query | Changing risk scoring / Omni |
| `sendDigestText` with HTML parse mode | Fixing all Tony name formats for manager parse |

## Decision

Approach: enrich fetch + compute with links and robust booking №; change `formatRiskTitle` / `renderDigestMessage`; send with `parseMode: 'html'`.

## Data

Digest opportunity GraphQL adds:

```
tonyLink { primaryLinkUrl }
bitrixLink { primaryLinkUrl }
```

Mapped onto deal/risk:

| Field | Source |
|-------|--------|
| `bookingNo` | Query `id` from `tonyLink.primaryLinkUrl`; else first `\d{5,}` in `name`; else `''` |
| `tonyUrl` | `tonyLink.primaryLinkUrl` |
| `bitrixUrl` | `bitrixLink.primaryLinkUrl` |
| `twentyUrl` | `{origin(twenty_api_url)}/object/opportunity/{opportunityId}` |

`twenty_api_url` may end with `/` or `/graphql` — strip to origin (protocol + host).

## Risk line format

```
• {bookingNoOrFallback} · {ready}/{total} · ₽… · {labels}[ · {reason}]
({Twenty} | {Tony} | {Bitrix})
```

- Second line only if at least one URL exists.
- Each present URL → `<a href="URL">Twenty</a>` (etc.); join with ` | `.
- Escape HTML in plain text segments (`&`, `<`, `>`).
- Fallback title if no booking №: trimmed `name` (escaped) or `—`.

Header block (✔️/❌) unchanged.

## Send

`sendDigestText` passes GramJS `parseMode: 'html'` (or equivalent) so anchors are clickable.

## Tests

- Extract booking № from tony URL and from messy name.
- Build twenty URL from api url variants.
- Render: booking-first title; link line; omit missing links; escape HTML in reason/labels.
- `sendDigestText` called with html parse mode (unit/mock).

## Ops

No new settings. After deploy, `/завтра` or test in `digest.morning` should show № + clickable links.

## Success criteria

1. Risk lines no longer lead with company-only when Tony id exists.
2. Links open Twenty / Tony / Bitrix when URLs present.
3. Scoring / Omni / destination / user-bot transport unchanged.
