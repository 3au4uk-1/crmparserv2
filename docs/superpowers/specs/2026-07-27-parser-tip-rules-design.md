# Wave — Parser tip_rules (keyword → tip + tipDetail)

Date: 2026-07-27  
Status: approved (conversation)  
Repo: `crmparserv2`  
Scope: unified tip classification on line-item sync + Settings UI  
Out of scope: Sheets cost sync, blacklist/restoration amount side-effects, TwentyView board UI, aligning board `tip-from-name` with tipDetail

## Goals

1. Map product-name keywords to Twenty **Категория** (`tip`) + **Уточнение** (`tipDetail`) in one place.
2. Cover Подряд (with contractor detail), Баннера, Производство, Плёнка — not only PODRYAD/BANNERA tip-only lists.
3. Keep blacklist (exclude) and restoration (0₽) as separate mechanisms.

## Decisions locked

| # | Decision |
|---|----------|
| 1 | Approach: **unified `tip_rules` table** (not cloning more list tables). |
| 2 | On sync match: **always overwrite** both `tip` and `tipDetail` (parser is source of truth). |
| 3 | On **no match**: **do not touch** `tip` / `tipDetail` in Twenty. |
| 4 | Default when rule has empty `tip_detail`: `PLENKA` → `NASHI`; `BANNERA` → `KTO_EDET`; others → leave tipDetail unset. |
| 5 | Migrate existing `podryad_items` / `banner_items` into `tip_rules`; Settings zones filter by `tip`. |
| 6 | Match types: `exact` \| `substring` (same as today). First win: `priority ASC`, then `created_at ASC`. |
| 7 | Validate `tipDetail` against the same tip→detail matrix as TwentyView (`TIP_DETAIL_BY_TIP`). |

## Data model

```sql
CREATE TABLE tip_rules (
  id INTEGER PRIMARY KEY,
  pattern TEXT NOT NULL,
  match_type TEXT NOT NULL CHECK (match_type IN ('exact', 'substring')),
  tip TEXT NOT NULL,
  tip_detail TEXT,
  priority INTEGER NOT NULL DEFAULT 100,
  source_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (pattern, match_type, tip, tip_detail)
);
```

Allowed `tip` values (v1): `PODRYAD`, `BANNERA`, `PROIZVODSTVO`, `PLENKA`, `RESTAVRACIYA`  
(optional later: `NE_NASHE` if needed as tip rather than tipDetail).

### Migration

1. Create `tip_rules`.
2. Copy `podryad_items` → `tip=PODRYAD`, `tip_detail=NULL`, `priority=100`.
3. Copy `banner_items` → `tip=BANNERA`, `tip_detail=NULL`, `priority=100`.
4. Insert seed rows if no equivalent pattern already exists (see Seeds).
5. Stop using `podryad_items` / `banner_items` in sync path. Drop or leave unused until a follow-up cleanup.

Keep `blacklist_items` and `restoration_items` unchanged.

## Resolver

In `buildLineItemFields` (create + update):

1. `loadTipRules(db)` once per sync batch.
2. `findTipRuleMatch(itemName, rules)` → first match.
3. If match:
   - `fields.tip = rule.tip`
   - `fields.tipDetail = resolveTipDetail(rule)` where:
     - if `rule.tip_detail` set and valid for tip → use it
     - else if tip is `PLENKA` → `NASHI`
     - else if tip is `BANNERA` → `KTO_EDET`
     - else **omit** `tipDetail` from the GraphQL input (do not clear an existing Twenty value unless a default/explicit detail applies)
4. If no match: do not set `tip` / `tipDetail` on the GraphQL input.

Priority of former lists is replaced by explicit `priority` + insertion order. Default seed priorities: more specific contractor/production patterns at **50**; broad migrated podryad/banner at **100**.

## Seeds (substring unless noted)

| pattern | tip | tipDetail | priority |
|---------|-----|-----------|----------|
| `клише` | PODRYAD | KUVALDIN_KLISHE | 50 |
| `монета` | PODRYAD | KUVALDIN_KLISHE | 50 |
| `сукно` | PODRYAD | LIZA_SUKNO | 50 |
| `ролл-ап` | PROIZVODSTVO | ROLL_UP | 50 |
| `роллап` | PROIZVODSTVO | ROLL_UP | 50 |
| `поп-ап` | PROIZVODSTVO | POP_UP | 50 |
| `попап` | PROIZVODSTVO | POP_UP | 50 |
| `промо-стойк` | PROIZVODSTVO | PROMO_STOYKA | 50 |
| `оклейк` | PLENKA | NASHI | 50 |

Normalization: reuse `normalizePattern` from blacklist (casefold + trim).

## Settings UI

Tab **Парсинг** — replace standalone Подряд / Баннера sections with tip_rules zones:

| Zone label | tip filter | tipDetail options |
|------------|------------|-------------------|
| Подряд | PODRYAD | GLAV_PRINT, PASHA_VINDER, ZARYA, LIZA_SUKNO, KUVALDIN_KLISHE, SVOE + empty |
| Баннера | BANNERA | KTO_EDET, YURA, MAGA, TOPILSKIY + empty |
| Производство | PROIZVODSTVO | ROLL_UP, POP_UP, PROMO_STOYKA, PROIZVODSTVO_DRUGOE + empty |
| Плёнка | PLENKA | NASHI, NE_NASHI + empty |
| Рест. плёнка | RESTAVRACIYA | NASHI, NE_NASHI + empty |

Row: pattern, match type, tipDetail select, delete. Add form scoped to zone tip. CRUD triggers existing `scheduleListChangeResync()`.

## API

- `GET /api/tip-rules?tip=` — list (optional filter)
- `POST /api/tip-rules` — `{ pattern, matchType, tip, tipDetail?, priority?, sourceName? }`
- `DELETE /api/tip-rules/:id`

Deprecate `/api/podryad` and `/api/banner` after UI switch (or thin adapters reading/writing tip_rules for one release).

Share tipDetail option lists in a small shared module (mirror TwentyView constants; do not import TwentyView package).

## TwentyView interaction

- No board UI changes required for this wave.
- Parser sync is authoritative on match.
- Board `inferTipFromName` / `planTipFromName` unchanged for now (tip only, no tipDetail). Follow-up: align needles + defaults to avoid fighting parser after manual rename.

## Rollout

1. SQLite migrate + seeds + unit tests (matcher, defaults, no-match leave-alone).
2. Wire `twenty-line-item` create/update.
3. Settings UI + API.
4. Local: apply Twenty app if needed; resync sample deal; verify tip+tipDetail in CRM.
5. Prod deploy crmparserv2; optional bulk-resync.

## Tests

- Match priority / first-win
- Defaults PLENKA→NASHI, BANNERA→KTO_EDET
- Explicit tipDetail wins over default
- Invalid tipDetail for tip rejected on create
- No match → fields omit tip/tipDetail
- Migration copies podryad/banner rows
- Seed idempotent (no duplicate patterns)

## Access notes

Local implementable without prod Sheets. Needs: running crmparserv2 + Twenty with `tipDetail` field applied; `TWENTY_API_*` for E2E. Prod deploy rights for ship.
