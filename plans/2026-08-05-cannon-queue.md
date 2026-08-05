# The Cannon Queue — re-target the Radar

- **Status:** planned 2026-08-05 · not started
- **Goal fit:** Goal 4 (Circles / the people layer) — the reply lane. It changes *where* reply effort is spent, using measured return instead of author heat. No new goal, no new tab.
- **Cost impact:** **$0 new recurring, $0 new per-click.** Every new route is pure SQL over rows already captured ($0 DOM harvest / already-billed metrics). The existing `POST /x/replies/curate` (~$0.005–0.015) and `POST /x/replies/generate-batch` (~$0.002–0.01) are unchanged — this plan changes *which* tweets that spend lands on. No new X API read anywhere: author size is deliberately never looked up (§8 third-party user lookup = $0.010, and §2.4 of the growth plan says author size is the wrong axis anyway).
- **Invariants touched:** §7.4 (refuse-before-spend — new routes are $0, guards stay above every existing spend line) · **§7.4a** (the money-gate carve-out is server-decided, sized against the corpus, and stamped into `contextSnapshot.gateBypass`) · **§7.4c** (the client re-decides the roster rule — reproduce the RULE, prove both sides agree on real data) · §7.11 (`score: null` = never scored, **never 0** — 0 is a real verdict, the RC.2 `curation_score` reading) · §7.12 (read-time over stored: the per-sighting cannon score is computed at read time; only the ROSTER score is stored, and the plan says why) · §7.13/13a (one sync txn for the rescore write) · §7.19 (roster scores gated at a sample floor; **queue-metadata bands never become Playbook hot/warm cells**) · §7.20 (static path before `:param` on the new router) · §7.24 (background stays the single buffer writer — the Cannon view filters at display time, it never writes) · §7.26/7.27 (the shared scorer is an IIFE-safe pure module reached through a shim, never forked) · **§7.33/7.34** (the borrowed 5,000 floor and the borrowed median method are validated against OUR corpus before they ship) · §8 (harvest readers MUST filter on `mode`; nothing here touches `mentions`).
- **Codemap sections relevant:** §3.1 (`src/shared/`), §3.3 (`replies/curate.ts`, `people/reciprocity.ts`, `settings/registry.ts`, `settings/bandThresholds.ts`), §3.4 (`radar.ts`, `replies.ts`, `voice.ts`, `harvest.ts`, `people.ts`), §4 (`harvest_rows`, `radar_drafts`, `voice_authors`), §5 (`content.ts`, `shared/radar.ts`, `shared/glance.ts`, `shared/serverSettings.ts`, `sidepanel/Radar.tsx`), §7.4a/4c/11/12/13/19/20/24/26/27/33/34, §8.

---

## Two findings that reshape the brief

Both were verified in the code before this plan was written; the source plan's table
(`x-growth-plan-v3.md` §7) predates them.

**1. `content.ts` already captures parent views + reply count + post age.**
`readTweetSignals` (`extension/src/content.ts:2157`) returns
`TweetSignals {views, replies, ageMin, vpm, bait}` and `recordRadarSighting` stores it
verbatim on every sighting. `cannon_score = views / (replies + 1)` is computable **today**
from every row already in the buffer and every row already in `radar_drafts.signals`.
That row of the source table is a no-op — there is no scrape change in this plan.

**2. `targetBandMinX/MaxX` does not gate a single reply.**
`classifyBand` (`src/shared/replyBand.ts:84`) reads views / replies / age / vpm / bait and
nothing else — it is size-agnostic, so a 200k-follower account's post bands exactly like a
2k one. The 2–10× band feeds `loadTargetHandles()` (`src/x/routes/voice.ts:583`), whose
consumers are: the GT.6 **carve-out** on the band gate's refusal arm, rankmap/glance target
tiers, neglected-target follow-ups, roster-coverage in the Playbook, and the digest.
Raising `targetBandMaxX` past 10 would therefore unblock nothing and would instead turn a
carve-out measured at **14 handles** into "every large account I ever saved is exempt" —
the §7.4a failure, verbatim.

The knob that actually holds the cannon back is `rankSightings`
(`extension/src/shared/radar.ts:218`): it sorts **person tier above band above vpm**, so a
200k-view / 6-reply stranger ranks below every ally. That is the ordering this plan
replaces — inside the Cannon view only.

**Decision (user-confirmed):** `targetBandMinX/MaxX` stay **2/10**. The cannon gets its own
membership set that never enters `loadTargetHandles()`.

---

## Why / what changes for the user

The Radar tab grows a third view — **Queue · Cannon · Clicked**. The Cannon view shows only
tweets worth arbitraging: sorted by `views / (replies + 1)` descending, each row leading with
its score, the parent's age in minutes rendered **red past 15**, and **nothing older than 30
minutes ever visible** — a stale entry costs a reply slot for a 12-view return, so it leaves
the view on its own. The head carries one live counter: *placed today N / T*.

Behind it, a **cannon roster**: 15–25 handles you camp, each carrying a score computed at $0
from posts already in `harvest_rows` — `median(views) / (median(comments) + 1)` over their
last ~30 posts — refreshed on a click, so the Sunday "drop anything below 5,000" review is a
sort. A fresh post by a roster account enters the queue **even when the band classifier
passes on it** (band `'cannon'`, the GT.8 `'roster'` arm's worked precedent), and a roster
handle is the one carve-out on the reply band gate's refusal arm.

Nothing about the existing Queue changes: it keeps its 24h TTL, its tier-first ranking and
the reciprocity lane. The Cannon is a second reading of the same buffer.

---

## Design

### Data

One new table (`src/x/db/schema.ts`, migration `0026`, DDL-only, no seed):

```sql
CREATE TABLE cannon_targets (
  handle          text PRIMARY KEY,          -- lowercased, no '@'
  display_name    text,
  language        text,                      -- null = English; the arm this handle belongs to
  score           real,                      -- median_views / (median_comments + 1); NULL = never scored
  median_views    real,
  median_comments real,
  sample_n        integer NOT NULL DEFAULT 0,
  scored_at       integer,                   -- ms; NULL until the first rescore
  active          integer NOT NULL DEFAULT 1,-- 1 = camped, 0 = bench (§9 "keep 5 bench candidates")
  notes           text,
  added_at        integer NOT NULL,
  updated_at      integer NOT NULL
);
CREATE INDEX cannon_targets_active_score_idx ON cannon_targets (active, score);
```

`score` is **stored**, not read-time, and that is a deliberate §7.12 exception: it is a
weekly-cadence aggregate over a 30-post window per handle, it must be *comparable across a
review session* (a score that drifts between two reads of the same list is not a review),
and `scored_at` is what makes staleness legible. The per-**sighting** score stays read-time
and is stored nowhere.

`radar_drafts.band` widens to accept `'cannon'` — **no migration** (free-text column, the
RU.8 `'manual'` / GT.8 `'roster'` precedent).

### Pure logic

- **`src/shared/cannon.ts`** (NEW, dependency-free, inlined into the content IIFE §7.26; the
  `replyBand.ts` twin): `CannonThresholds {scoreMin, maxAgeMin, redAgeMin, placedTarget}`,
  `CANNON` defaults, `cannonScore(signals) = views / (replies + 1)`,
  `isCannonEligible(signals, t)`, `cannonAgeTone(ageMin, t) → 'ok' | 'red'`.
  Reached from the extension through the shim `extension/src/cannon.ts` (§7.27).
- **`src/x/settings/cannonThresholds.ts`** (NEW, the `settings/bandThresholds.ts` twin): the
  one place `x.cannon.*` override rows become the `CannonThresholds` argument.
- **`src/x/cannon/roster.ts`** (NEW, pure — `connections.ts`/`monitor.ts` house style: no db,
  no clock, no `Math.random`): `median(xs)`, `CANNON_SAMPLE_POSTS = 30`,
  `CANNON_MIN_SAMPLE`, `scoreAuthor(rows, maxPosts) → {score, medianViews, medianComments,
  sampleN} | null` (null under the sample gate, §7.19), `rankCannonTargets(rows)`.
- **`extension/src/shared/radar.ts`** grows `'cannon'` in `RadarBand` plus the pure
  `cannonQueue(sightings, nowMs, t) → {rows: CannonRow[], hidden: number}` — score-desc,
  30-minute cutoff on the *displayed* age, filtering only (§7.24).

### Routes (all $0, all always-mounted, all static paths — §7.20)

`src/x/routes/cannon.ts` (NEW, mounted next to `voiceRouter` in `src/x/index.ts`):

| Method / path | Semantics |
|---|---|
| `GET /x/cannon/targets?active=` | `{floor, targets: CannonTarget[]}` — score desc, nulls last; each row + `staleDays` + `belowFloor` |
| `POST /x/cannon/targets` | `{handle, displayName?, language?, notes?, active?}` → 201; fill-only upsert. 400 `invalid_handle` / `invalid_language` / `invalid_notes` |
| `PATCH /x/cannon/targets/:handle` | `{active?, language?, notes?, displayName?}` → 200. 400 `empty_patch`, 404 `not_found` |
| `DELETE /x/cannon/targets/:handle` | 204 (hard delete — a dropped target is not history) |
| `POST /x/cannon/rescore` | `{handles?}` → `{scored, skipped:[{handle, reason:'insufficient_sample'}], sampleWindowDays}`. One grouped read over `harvest_rows`, one sync txn write |
| `GET /x/cannon/candidates?limit=&minSample=` | Authors in `harvest_rows` who are **not** already targets, scored the same way, score desc — the discovery list |

Extended, not new:
- `GET /x/people/glance` — each entry gains `isCannon: boolean` (the client needs roster
  membership at capture time; the affinity/rankmap backfill pattern).
- `POST /x/replies/generate` — the refusal arm gains a second carve-out beside
  `isReciprocityHandleSafe`: `isCannonHandleSafe(handle)` stamping
  `ctx.gateBypass = 'cannon'` (§7.4a).
- `GET /x/radar/placed-today?tzOffsetMin=` (NEW, on the always-mounted radar router) →
  `{dayKey, placed, target}` — the counter, $0, mirroring `brief.ts`'s `postedDraftRows`
  predicate exactly (`replyDrafts.status='posted'` within the local day). Placed on the
  radar router, **not** on `repliesRouter`, because that one is LLM-gated (§7.22) and the
  counter must survive a keyless install.

### Extension

- `content.ts::applyBand` gains a **cannon arm before the roster arm**: fresh
  (`ageMin ≤ maxAgeMin`) **and** (score ≥ `scoreMin` **or** the author is on the roster) →
  `recordRadarSighting(article, 'cannon', sig)`. Gate order is the perf contract (free
  checks first, the one `findPermalink` the roster arm already pays).
- `shared/glance.ts` gains `isCannonPerson(entry)` — the client twin of
  `isCannonHandleSafe`, with reciprocal twin comments (§7.4c).
- `sidepanel/Radar.tsx` gains the third `.radar-tab`, the Cannon list (score, red age, the
  counter), a cannon-aware draft button and a roster block.
- `shared/serverSettings.ts` gains `ServerConfig.cannon: CannonThresholds`, defaulting to
  the shim's `CANNON` — never a re-typed copy of the numbers (the `BAND` precedent).

### Measurement

No new table, no new column, no Playbook section in this plan. The cohort is already
joinable read-time (§7.12): `radar_drafts.band = 'cannon'` → `reply_draft_id` →
`reply_drafts.posted_tweet_id` → `metrics_snapshots`, so *"do cannon replies out-earn the
rest"* is one `POST /x/data/query` once ≥20 cannon replies are posted. The daily instrument
is the `placed today N / T` counter; the weekly one is `views per placed reply` from the
harvest, exactly as §8 of the growth plan specifies.

---

## Decisions taken

1. **`targetBandMinX/MaxX` stay 2/10** (user-confirmed). Raising them would unblock nothing
   (finding 2) and would blow out the §7.4a carve-out, neglected-target nags, rankmap tiers,
   roster coverage and the digest. The cannon gets `cannon_targets` — a set that never
   enters `loadTargetHandles()`. **Do not "fix" this later by widening the doctrine knob.**
2. **A stored `cannon_targets` table, harvest-scored** (user-confirmed), over a read-time-only
   candidates list or a flag on `voice_authors`. Reasons: a review session needs stable
   numbers and a `scored_at` stamp; the camped 15–25 must be pinnable with a bench; and
   `voice_authors` is the swipe-file roster — mixing the two would force every `voice.ts`
   reader to start filtering.
3. **A third view inside the Radar tab** (user-confirmed), not a new tab and not a global
   re-sort. The literal "expire everything at 30 minutes" would evict the GT.8 roster lane
   and every ⊕ pin — rows that exist precisely because they are *not* time-critical.
4. **`'cannon'` is a band (a capture reason), the score is not.** Band answers "how did this
   row get into the buffer" — needed because a cannon-worthy post can classify `null` (3
   minutes old, 40 views) or `skip` (150 replies). Cannon *membership of the view* is
   derived from `signals` at read time, so a tweet the classifier already called `hot` shows
   up in the Cannon view without being re-banded. Both, and neither is redundant.
5. **The 30-minute cutoff is display-time filtering, never a buffer write.** The background
   stays the single writer (§7.24); the row survives in the main Queue under its own 24h TTL.
6. **`'cannon'` never becomes a Playbook band cell.** `POST /radar/drafts/:tweetId/confirm`
   coerces it to `null` in the rebuilt `contextSnapshot.signals.band`, exactly as it already
   does for `'manual'` (§7.19). Three queue-metadata bands now, one rule.
7. **The 5,000 floor is validated against our corpus before it ships** (§7.33). It is a
   number measured on someone else's 1,000 replies. Task 1 replays it over our own
   `harvest_rows` and ships the measured value if 5,000 proves inert or universal — a
   threshold nothing ever crosses looks identical to a working feature.
8. **The reply language rides on the rendered VALUE, never on a template** (the JD.1
   `UNTRUSTED_CONTEXT_MARKER` precedent). `reply prompt.md` ↔ `REPLY_PROMPT_TEMPLATE` stay
   byte-identical and the anti-drift slice does not move.
9. **No X API call is added.** Author follower counts are never fetched: they cost $0.010
   each and §2.4 of the source plan measured author size as nearly uncorrelated with yield.
10. **The counter's target is the doctrine/commitment number, not a hardcoded 18.** Active
    `replies` commitment `dailyTarget` if present, else `doctrine.replyTargetMax` (20 today).
    A second owner of that number is how the quest and the counter start disagreeing.

---

## Done when

1. The Radar tab shows **Queue · Cannon · Clicked**; the Cannon view lists only rows whose
   `views/(replies+1)` clears the floor or that were captured on the cannon arm, sorted by
   score desc, each showing `score · views · replies · Nm` with the age red past `redAgeMin`,
   and **a row whose displayed age passes 30 minutes is gone from that view** (verified by
   advancing the clock in a unit test and by one browser pass).
2. `POST /x/cannon/rescore` scores every roster handle from `harvest_rows` at $0;
   `GET /x/cannon/targets` returns them score-desc with `belowFloor` flagged, and a handle
   under the sample gate reads **`score: null`, never `0`**.
3. Browsing a roster account's profile queues their fresh posts **even when `classifyBand`
   returns `null`/`skip`** (band `'cannon'`), and that band never reaches a Playbook hot/warm
   cell — asserted on the confirm endpoint's coercion.
4. The Cannon head shows `placed today N / T` from `GET /x/radar/placed-today`, and N
   increments after a pick without a page reload.
5. `GET /x/niche` still reports `targetBandMinX: 2, targetBandMaxX: 10` and
   `GET /x/voice/targets` returns the same roster it did before this plan.
6. `bun scripts/smoke-cannon.ts` is green at $0 and cleans up after itself; `bun test`,
   `bun run typecheck`, `bun run lint` and `cd extension && bun run build` are green.

---

## Task 1: The shared cannon scorer + the `x.cannon.*` knobs
**Depends on:** none
**Session budget:** ~300 lines, 7 files (2 new source, 1 new shim, 1 new test, 3 edits)

**Read first:**
- codemap header + §3.1, §7.19, §7.26, §7.27, §7.33, §7.352 rule (a) (the UI.7 "registry
  defaults ARE the module's constant" rule)
- `src/shared/replyBand.ts` (the whole file — this module is its twin, down to the header
  comment recording where the numbers came from)
- `src/x/settings/bandThresholds.ts` (the server-side resolver twin)
- `src/x/settings/registry.ts` lines 560–605 (the `RADAR` group) and the `BAND` group
  definition + the test that asserts the band group is exactly `keyof BandThresholds`
- `extension/src/shared/serverSettings.ts` lines 1–80 (the `BAND` import comment states
  the rule this task follows)

**Edit:**
- `src/shared/cannon.ts` — NEW. Pure, **zero imports except `type TweetSignals` from
  `./replyBand.ts`** (type-only, erased under `verbatimModuleSyntax`).
- `extension/src/cannon.ts` — NEW. Bare re-export shim (goes at `extension/src/` top level,
  not under `shared/`, because it adds nothing — §5's rule).
- `extension/tsconfig.app.json` — add the new shim to `include` (it lists seven today).
- `src/x/settings/registry.ts` — a `cannon` group, 4 knobs, **all `scope:'mirrored'`**,
  defaults imported from `CANNON` (never retyped).
- `src/x/settings/cannonThresholds.ts` — NEW, `bandThresholds.ts` copied in shape.
- `extension/src/shared/serverSettings.ts` — `ServerConfig.cannon: CannonThresholds` +
  `SERVER_DEFAULTS.cannon = CANNON` from the shim + the `readServerConfig` per-key guard.
- `src/shared/cannon.test.ts` — NEW.

**How:**
- The module surface, exactly:
  ```ts
  export interface CannonThresholds { scoreMin: number; maxAgeMin: number; redAgeMin: number; placedTarget: number }
  export const CANNON: CannonThresholds
  export function cannonScore(s: TweetSignals): number      // views / (replies + 1)
  export function isCannonEligible(s: TweetSignals, t?: CannonThresholds): boolean
  export function cannonAgeTone(ageMin: number, t?: CannonThresholds): 'ok' | 'red'
  ```
  `cannonScore` divides by `replies + 1` — the +1 is the zero-guard *and* the source
  measurement's own formula; do not "improve" it to `max(replies,1)`.
  `isCannonEligible` = `ageMin <= t.maxAgeMin && cannonScore(s) >= t.scoreMin`. It does NOT
  know about roster membership — that half lives in `glance.ts` (Task 4) because this module
  must stay dependency-free for the IIFE.
- **Before the defaults land in the registry, do the §7.33 corpus replay.** This is not
  optional and it is $0: with the `.env` bearer, `POST $STRATUS_BASE_URL/x/data/query`
  (S1 explorer, read-only) with a SELECT over `harvest_rows` filtered
  `mode IN ('timeline','posts')` and `captured_at >= now-30d`, computing
  `views*1.0/(comments+1)` per row, and report: row count, p50/p75/p90/p95/p99, and the
  fraction clearing 5,000. Write the numbers into the module header the way
  `replyBand.ts` and `coach/reach.ts` do. **If under ~2% or over ~50% of rows clear 5,000,
  ship the measured p90 as `scoreMin` instead and say so in the header** — a floor nothing
  crosses is indistinguishable from a broken feature (the SC.6 lesson, §7.33), and a floor
  everything crosses is not a filter. Record the decision either way; a later reader must
  not have to guess whether the number was checked.
- Defaults to start from (all opening guesses, all recalibratable, say so in each
  `description`): `scoreMin: 5000` (subject to the replay above), `maxAgeMin: 30`,
  `redAgeMin: 15`, `placedTarget: 18`. `placedTarget` is display-only — Task 3's counter
  resolves its real target from the commitment/doctrine (decision 10); this knob is the
  Cannon head's *own* stretch number and its description must say which is which.
- Registry group render order: append `cannon` **after `radar`** and before `workers`; the
  group order list in §3.3 of the codemap gets the same insert in the docs task.
- Add the group-shape test in the same file the band-group test lives in: assert
  `settingsByGroup('cannon').map(d => d.key.replace('x.cannon.',''))` sorted equals
  `Object.keys(CANNON)` sorted. §7.352(a) — a half-exposed rule is worse than an unexposed
  one.
- `serverSettings.ts`: import `CANNON` from `'../cannon.ts'` (the shim), the same way it
  imports `BAND` from `'../replyBand.ts'`. **Do not re-type the four numbers here.**

**Tests:** `src/shared/cannon.test.ts` — `cannonScore` on (200491 views, 8 replies) ≈ 22277;
zero replies ⇒ views; zero views ⇒ 0; `isCannonEligible` boundaries (exactly `scoreMin`
passes, exactly `maxAgeMin` passes, one minute past fails); `cannonAgeTone` at exactly
`redAgeMin` reads `'ok'` (strict `>` — mirrors the glance `NEGLECT_DAYS` reading);
threshold argument overrides the default. Plus the registry group-shape assertion.

**Done when:**
- [ ] `GET /x/settings` lists a `cannon` group of 4 mirrored knobs whose values equal `CANNON`
- [ ] The corpus-replay numbers are in the `src/shared/cannon.ts` header, with the shipped
      `scoreMin` justified by them
- [ ] `bun test` + `bun run typecheck` + `bun run lint` + `cd extension && bun run build` green
- [ ] Committed: `feat(cannon): shared cannon scorer + x.cannon.* knobs`

**Cost note:** $0. The corpus replay is the S1 explorer (read-only SQL over already-billed
rows); it cannot reach `xFetch`.

---

## Task 2: `cannon_targets` — table, pure scorer, roster routes
**Depends on:** Task 1 (for `CANNON.scoreMin` as the `belowFloor` floor)
**Session budget:** ~400 lines, 6 files. **Runs alone** — it generates a migration (§ Stack:
migration-generating work never runs in parallel sessions).

**Read first:**
- codemap header + §4 (the `harvest_rows` row: *"any new consumer MUST filter on `mode`"*),
  §7.11, §7.12, §7.13, §7.19, §7.20, §7.33, §7.34
- `src/x/routes/harvest.ts` lines 371–466 (`GET /harvest/affinity`) — the exemplar for the
  grouped read + the TS-side join + `intParam` clamping + the empty-group early return
- `src/x/connections.ts` header + the first 40 lines (the pure-module house style)
- `src/x/db/schema.ts` lines 630–700 (`harvest_rows` columns) and 251 (`following` — the
  nearest table shape: handle PK, fill-only fields, a status-ish flag)
- `src/x/routes/cannon.ts` does not exist yet; `src/x/routes/replyLists.ts` is the CRUD
  shape to imitate (validation order, `empty_patch`, per-field 400 codes)
- CLAUDE.md § Stack (the `db:generate` → **inspect the SQL** rule — drizzle-kit drops seed
  INSERTs; there are none here, so the emitted file must be exactly one `CREATE TABLE` +
  one `CREATE INDEX`)

**Edit:**
- `src/x/db/schema.ts` — `cannonTargets` table per the DDL in Design.
- `src/db/migrations/0026_*.sql` + `_journal.json` — via `bun run db:generate`, then read it.
- `src/x/cannon/roster.ts` — NEW, pure.
- `src/x/routes/cannon.ts` — NEW.
- `src/x/index.ts` — mount `cannonRouter` next to `voiceRouter` (always mounted, $0).
- `src/x/cannon/roster.test.ts` + `src/x/routes/cannon.test.ts` — NEW.

**How:**
- **Pure scorer** (`cannon/roster.ts`), no db and no clock:
  ```ts
  export const CANNON_SAMPLE_POSTS = 30;
  export const CANNON_MIN_SAMPLE = 8;              // opening guess — recalibrate at n>=100 scored handles
  export function median(xs: number[]): number | null;
  export interface AuthorPost { tweetId: string; views: number; comments: number; tweetTime: number | null; capturedAt: number }
  export function scoreAuthor(posts: AuthorPost[], maxPosts?: number):
    { score: number; medianViews: number; medianComments: number; sampleN: number } | null;
  export function rankCannonTargets<T extends { score: number | null }>(rows: T[]): T[];
  ```
  `scoreAuthor`: dedupe by `tweetId` keeping the **latest** `capturedAt` per tweet, sort by
  `tweetTime ?? capturedAt` desc, take `maxPosts`, then
  `score = medianViews / (medianComments + 1)`. Return **`null`** below `CANNON_MIN_SAMPLE`
  (§7.19) — never a number computed on 3 posts.
  **Two method notes that belong in the module header, with their reasoning** (§7.34): (a)
  the medians are taken of views and of comments *separately*, then divided — not the median
  of per-post ratios; that is the formula the source measurement used and mixing the two is
  a different statistic; (b) latest-capture-per-tweet is right *here* and would be wrong in
  `coach/reach.ts` — recaptures on this corpus are scroll-driven, not outcome-selected, so
  the choice only picks a maturer reading of the same tweet, it does not select which tweets
  are read twice. State it; a later reader will otherwise apply SC.8's rule backwards.
  `rankCannonTargets` puts nulls **last**, then score desc, handle asc as the total tiebreak
  (the `connections.ts::rankForUnfollow` discipline — make the sort total).
- **Routes.** Every path here is `$0` and nothing in the file may import `xFetch` or
  `askLLM`. Register `GET /cannon/candidates` **before** any `:handle` route (§7.20 — here
  the segment counts differ so it cannot actually collide, but the file gets the same
  "keep it that way" comment `monitor.ts` carries).
  - Handle normalization: strip a leading `@`, lowercase, validate with the same
    `USERNAME_RE` `routes/replyLists.ts`/`people.ts` use. 400 `invalid_handle`.
  - `POST /cannon/targets` is a **fill-only upsert** (`people/store.ts::upsertPerson`
    discipline): re-adding an existing handle must not blank its score or its `added_at`.
  - `POST /cannon/rescore`: ONE grouped read over `harvest_rows` filtered
    **`mode IN ('posts','timeline')`** (never `'replies'` — those rows are the harvested
    account's *replies*, not their posts, and would score a different thing) and
    `handle IN (targets)`, ordered so the TS side can bucket by handle; then `scoreAuthor`
    per handle; then **one sync txn** (§7.13) writing `score`/`median_*`/`sample_n`/
    `scored_at`/`updated_at`. A handle whose sample is under the gate is written
    `score: null` **and still gets `scored_at` and `sample_n`** — "we looked and there wasn't
    enough" is a different fact from "never scored", and the response reports it under
    `skipped` with `reason: 'insufficient_sample'`. Empty target list → `{scored: 0,
    skipped: []}`, never an `in ()`.
  - `GET /cannon/candidates`: same grouped read but `handle NOT IN (targets)`, `limit`
    clamped 1–50 and `minSample` ≥1 through the `intParam` helper (absent → default,
    out of range → **clamped**, non-positive-integer → 400 — the affinity route's exact
    contract). Return `{limit, minSample, candidates}` score desc.
  - `belowFloor` on every returned target = `score !== null && score < getSetting<number>('x.cannon.scoreMin')`,
    read per request (the money-knob discipline — read at request time, never captured at
    module load).
  - `staleDays` = `null` when `scored_at` is null, else whole days since. §7.11.
- **Inspect the generated SQL.** It must contain exactly one `CREATE TABLE cannon_targets`
  and one `CREATE INDEX`, and touch nothing else. Boot a fresh `:memory:` DB and confirm the
  three `content_pillars` seed rows are still there (the RC.2 read-back discipline).

**Tests:**
- `roster.test.ts`: median of even/odd lengths; `scoreAuthor` under the sample gate → null;
  dedupe keeps the latest capture of a re-captured tweet; `maxPosts` takes the newest;
  zero-comment author scores `medianViews`; `rankCannonTargets` nulls last + total order.
- `cannon.test.ts` (route suite over in-memory SQLite, the `replyLists.test.ts` shape):
  create → list → patch → delete round-trip; `@Handle` normalizes to `handle`; re-POST is
  fill-only (score survives); rescore with seeded `harvest_rows` writes the expected
  medians; a `mode='replies'` row is **not** counted; a handle under the gate lands
  `score: null` + `scored_at` set + appears in `skipped`; `invalid_handle` / `empty_patch` /
  404 on an absent handle; `candidates` excludes existing targets and clamps `limit`.

**Done when:**
- [ ] `POST /x/cannon/targets` then `POST /x/cannon/rescore` produces a scored roster from
      `harvest_rows` alone, with no X API call in the request log
- [ ] A handle with 3 harvested posts reads `score: null`, `sampleN: 3`, and is listed under
      `skipped`
- [ ] The emitted migration is one CREATE TABLE + one CREATE INDEX and a fresh `:memory:`
      boot still reports the 3 `content_pillars` seed rows
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(cannon): cannon_targets roster + harvest-derived scoring routes`

**Cost note:** $0 — pure SQL over DOM-harvested rows. Nothing in `routes/cannon.ts` can
reach `xFetch` or `askLLM`, and that is worth a comment at the top of the file.

---

## Task 3: The three roster consumers — gate carve-out, glance flag, placed-today counter
**Depends on:** Task 2
**Session budget:** ~220 lines, 6 files

**Read first:**
- codemap header + §7.4, **§7.4a** (read it in full — this task is a second instance of it),
  §7.8, §7.11, §7.20, §7.22
- `src/x/people/reciprocity.ts` (the whole file — `isCannonHandleSafe` is its sibling, and
  the twin-comment discipline lives there)
- `src/x/routes/replies.ts` lines 219–248 (the band gate + the GT.6 carve-out it sits beside)
- `src/x/routes/people.ts` lines 208–285 (`GET /people/glance` + the bare-target backfill)
- `src/x/routes/brief.ts` lines 455–460 and 565–582 (`replyTarget` from `loadDoctrine()`;
  the `postedDraftRows` predicate this counter must mirror **exactly**)
- `src/x/routes/radar.ts` (where the counter route mounts — always-mounted, $0)
- `src/x/routes/goals.ts` (`loadCommitmentsWithDebt` — for how "which commitment is active"
  is read; do NOT re-derive it, the GR.9 digest note says why)

**Edit:**
- `src/x/cannon/membership.ts` — NEW: `loadCannonHandles()` (lowercased Set of **active**
  targets), `isCannonHandle(handle)`, `isCannonHandleSafe(handle)` (§7.8 — false on any
  error, so the gate keeps refusing).
- `src/x/routes/replies.ts` — the refusal arm gains the second carve-out.
- `src/x/routes/people.ts` — `GlanceEntry.isCannon` + the backfill for a cannon handle with
  no `people` row.
- `src/x/routes/radar.ts` — `GET /radar/placed-today`.
- `src/x/routes/replies.test.ts` / `people.test.ts` / `radar.test.ts` — cases below.

**How:**
- **Carve-out.** In `routes/replies.ts`, inside the existing `if ((band === null || band ===
  'skip') && !override)` block, after `isReciprocityHandleSafe` fails, try
  `isCannonHandleSafe(ctx.handle)` → `ctx.gateBypass = 'cannon'` and fall through; else the
  same 422. **On the refusal arm only** — a hot/warm post must never pay either lookup
  (§7.4). The stamp value is `'cannon'`, distinct from `'roster'`, because the whole point of
  §7.4a is that the exempted calls stay a cohort you can tell apart later. The batch path is
  untouched (it has no gate).
  **Sizing note the implementer must actually check** (§7.4a's "size the membership rule
  against the real corpus"): the roster is a hand-curated 15–25 handles, so this carve-out
  is structurally small. If `GET /x/cannon/targets` ever returns hundreds, the carve-out has
  become the gate turned off — say so in the code comment.
- **Glance.** `isCannon: boolean` on every entry, sourced from `loadCannonHandles()` added to
  the existing `Promise.all`. A cannon handle with no `people` row gets the same bare
  backfill `isTarget` already has (`stage: 'stranger'`, everything else null/0). This is what
  makes the Task 4 capture arm possible without a second fetch.
- **Counter.** `GET /radar/placed-today?tzOffsetMin=` → `{dayKey, placed, target}`:
  - `placed` = count of `reply_drafts` with `status='posted'` and `updatedAt` in the local
    day. **Mirror `brief.ts`'s predicate literally** — it is the paste-time reading, and two
    spellings of "a placed reply" is how the counter and the quest start disagreeing.
  - `target` = active `replies` commitment's `dailyTarget` if one exists, else
    `loadDoctrine().replyTargetMax`. Decision 10.
  - It is on `radarRouter` (always mounted) and it **writes nothing** — unlike `GET /brief`,
    which upserts a streak and flips goal statuses. That is exactly why the panel may poll
    this one and may not poll that one; put that sentence in the route comment.
  - `?tzOffsetMin=` validated the way `brief.ts` validates it; absent → 0 (UTC).

**Tests:**
- `replies.test.ts`: a `skip`-banded post from a **cannon** handle drafts and its persisted
  `contextSnapshot.gateBypass === 'cannon'`; the same post from an unknown handle still 422s
  `band_gate`; an **inactive** (`active:0`) cannon target does **not** get the carve-out; a
  `hot` post from a cannon handle carries **no** `gateBypass` (the lookup never ran).
- `people.test.ts`: a cannon-only handle appears in the glance map with `isCannon: true` and
  `stage: 'stranger'`; a handle that is both a person and a cannon target keeps its stage.
- `radar.test.ts`: `placed-today` counts only `status='posted'` rows inside the local day
  (seed one yesterday, one today, one `copied`); `target` follows an active commitment and
  falls back to doctrine when there is none; the route writes nothing (assert the `streaks`
  table is still empty after the call — the one-line proof that it is safe to poll).

**Done when:**
- [ ] A reply drafted for a roster handle on a dead-banded post is stamped
      `gateBypass: 'cannon'` and is distinguishable in SQL from a `'roster'` bypass
- [ ] `GET /x/people/glance` carries `isCannon` for roster handles that have no people row
- [ ] `GET /x/radar/placed-today` returns today's placed count and target, and leaves
      `streaks` untouched
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(cannon): band-gate carve-out, glance flag, placed-today counter`

**Cost note:** $0. The carve-out runs only on the refusal arm — it can only ever cause a
call that was about to be refused to proceed, and that call was already the user's click.

---

## Task 4: Capture — the `cannon` band, end to end
**Depends on:** Task 3 (needs `glance.isCannon`)
**Session budget:** ~280 lines, 7 files

**Read first:**
- codemap header + §5 (`content.ts` row: the GT.8 `applyBand` arm and its gate-order note),
  §7.4c, §7.19, §7.24, §7.26, §7.27
- `extension/src/shared/radar.ts` lines 14–38 (the band union + `bandStickiness` and the
  comment explaining the asymmetry), 108–230 (`mergeSightings`, `bandWeight`,
  `rankSightings`), 335–349 (`isRadarSighting`)
- `extension/src/shared/glance.ts` lines 50–90 (`isReciprocityPerson` + its twin comment —
  `isCannonPerson` sits beside it and follows the same rule)
- `extension/src/content.ts` lines 2179–2213 (`ROSTER_MAX_AGE_MIN`, `isRosterSighting`,
  `applyBand`) and 2640–2695 (`recordRadarSighting` / `flushRadar`)
- `src/x/routes/radar.ts` — `RadarBatchTweet` / `RadarDraftInsert` band types and the
  **confirm endpoint's `'manual'` → `null` coercion** (this task adds `'cannon'` to it)
- `src/x/routes/replies.ts` — `parseBatchTweets`' accepted `band` values (RU.8 widened it
  once already)

**Edit:**
- `extension/src/shared/radar.ts` — `RadarBand` += `'cannon'`; `bandStickiness` and
  `bandWeight` arms; `isRadarSighting` guard.
- `extension/src/shared/glance.ts` — `GlanceEntry.isCannon` + `isCannonPerson(entry)`.
- `extension/src/content.ts` — the cannon capture arm + the mirrored `cannon` config reader.
- `src/x/routes/radar.ts` — band type widening + the confirm coercion.
- `src/x/routes/replies.ts` — `parseBatchTweets` accepts `band:'cannon'`.
- `extension/src/shared/radar.test.ts` / `glance.test.ts` / `src/x/routes/radar.test.ts`.

**How:**
- **Stickiness and weight.** `bandStickiness('cannon') = 1` (the same rung as hot/warm — it
  is a real capture reason, unlike `'roster'`), so between a cannon and a hot sighting the
  fresher one wins, which is the pre-existing behaviour for every hot/warm pair.
  `bandWeight('cannon') = 0` — in the **main** Queue a cannon row must not outrank a hot one;
  the cannon ordering lives in the Cannon view and nowhere else. Do not touch
  `rankSightings`' tier-first ordering: that is the reciprocity lane and it is correct there.
- **Capture arm.** In `applyBand`, insert **before** the roster arm:
  ```
  else if (sig && isCannonSighting(article, sig, glance)) recordRadarSighting(article, 'cannon', sig);
  ```
  `isCannonSighting` mirrors `isRosterSighting`'s gate order exactly (the perf contract —
  the free age check first, then the single `findPermalink` that `applyPersonChips` already
  pays): `sig.ageMin <= cannonCfg.maxAgeMin` → `findPermalink` → **`isCannonEligible(sig,
  cannonCfg) || isCannonPerson(glance[handle])`**. The roster half is what makes a
  three-minute-old post with 40 views queue up; the score half is what makes an unknown
  account's 200k/6 post queue up without being on any list.
  The config comes from the mirrored blob the same way `bandThresholds` does
  (`initBandThresholds` is the exemplar — module-level `let`, one read, one
  `chrome.storage.onChanged` listener; baked `SERVER_DEFAULTS.cannon` until it resolves).
- **`isCannonPerson(entry) = entry?.isCannon === true`** — trivial, but it goes in
  `glance.ts` beside `isReciprocityPerson` with the **reciprocal twin comment** naming
  `src/x/cannon/membership.ts::isCannonHandleSafe`, and the server-side function gets the
  matching comment naming this one (§7.4c). Unlike the reciprocity pair there is no
  superset trap here — `isCannon` is the server's own answer, not a proxy — and the comment
  should say *that* explicitly, so nobody later "hardens" it into a stage/target predicate.
  Still do the $0 agreement check once: fetch `GET /x/people/glance` and
  `GET /x/cannon/targets` and diff the key sets.
- **Server coercion.** `POST /radar/drafts/:tweetId/confirm` must coerce `'cannon'` → `null`
  in the rebuilt `contextSnapshot.signals.band`, exactly as it does `'manual'` (§7.19 — a
  queue-metadata band is not a classifier verdict and must never land in a Playbook hot/warm
  cell). Widen the coercion to a set of three rather than adding a third `if`; there are now
  three members of this family (`manual`, `roster`, `cannon`) and a fourth is likely.
  **Check what the existing code does with `'roster'`** — if `'roster'` is not coerced today,
  fix that in this task and say so in the commit body: it is the same class of bug.
- Nothing in the extension writes the buffer directly (§7.24) — the capture goes through the
  existing `recordRadarSighting` → `flushRadar` → background path unchanged.

**Tests:**
- `radar.test.ts` (extension): a `cannon` sighting survives a `hot` re-sight per the
  stickiness rule and vice-versa; eviction under `RADAR_CAP` drops `roster` before `cannon`;
  `isRadarSighting` accepts the new band; `rankSightings` still puts `manual` first and a
  `hot` row above a `cannon` one at equal tier.
- `glance.test.ts`: `isCannonPerson` on present/absent/false entries.
- `src/x/routes/radar.test.ts`: a confirm of a `band:'cannon'` draft persists
  `contextSnapshot.signals.band === null` while the `radar_drafts.band` column keeps
  `'cannon'`.

**Done when:**
- [ ] With a handle on the roster, scrolling their fresh post queues it with band `'cannon'`
      even when `data-stratus-band` is absent (browser check, one pass)
- [ ] A confirmed cannon draft records `signals.band: null` in `reply_drafts.contextSnapshot`
- [ ] `bun test` + `bun run typecheck` + `bun run lint` + `cd extension && bun run build` green
- [ ] Committed: `feat(cannon): capture arm + cannon band end to end`

**Cost note:** $0 — DOM only; the arm can widen what enters the queue but nothing here
initiates a paid call.

---

## Task 5: The Cannon view
**Depends on:** Tasks 1, 3, 4
**Session budget:** ~350 lines, 5 files. `Radar.tsx` is large — read the ranges named below
rather than the whole file.

**Read first:**
- codemap header + §5 (`Radar.tsx` row — read it fully, it is the change history of this
  component), §7.24, §7.352 (the `useSettingsEditor` / one-editor-per-tab rule)
- `extension/src/sidepanel/Radar.tsx` lines 1–60 (imports + `RADAR_KEYS` + the outcome
  types), 180–330 (`RadarSection` state, `sendBatch`, `draftReplies`), 420–555 (the header
  actions + the `.radar-tabs` switch + the view branches), 588–744 (`RadarRow`), 746–819
  (`whyLine`, `displayAgeMin`, `BAND_LABEL`)
- `extension/src/shared/radar.ts` lines 218–290 (`rankSightings`, `splitClicked`,
  `groupQueue`, `partitionForCurate`)
- `extension/src/sidepanel/api.ts` — the `api.replies.curate` entry (the newest client
  method, for shape) and where a `api.radar.*` namespace would go

**Edit:**
- `extension/src/shared/radar.ts` — the pure `cannonQueue`.
- `extension/src/sidepanel/api.ts` — `api.radar.placedToday(settings, {tzOffsetMin})` +
  `PlacedTodayResponse` in `shared/types.ts`.
- `extension/src/sidepanel/Radar.tsx` — the third view.
- `extension/src/sidepanel/styles.css` — `.radar-cannon-*` rules (tokens only, §7.350).
- `extension/src/shared/radar.test.ts` — `cannonQueue` cases.

**How:**
- **Pure first.** In `shared/radar.ts`:
  ```ts
  export interface CannonRow { s: RadarSighting; score: number; ageMin: number; tone: 'ok' | 'red' }
  export function cannonQueue(sightings: RadarSighting[], nowMs: number, t?: CannonThresholds): { rows: CannonRow[]; hidden: number }
  ```
  Membership = `s.band === 'cannon' || cannonScore(s.signals) >= t.scoreMin` (decision 4).
  Age = the existing `displayAgeMin` reading (capture age + time since capture) — **move
  `displayAgeMin` out of `Radar.tsx` into this module** so the view and the cutoff can never
  disagree about how old a row is; the component then imports it. Rows past `t.maxAgeMin` are
  dropped and counted into `hidden`. Sort: score desc, then fresher `lastSeenAt` first.
  Clicked rows are excluded (the caller passes the queue, not the buffer — same contract as
  `groupQueue`).
- **The view.** Add a third `.radar-tab` button (`Cannon (n)`) to the existing hand-rolled
  switch. Do **not** migrate the switch to the `SubTabs` primitive in this task — D7 covers
  *new* surfaces, this one shipped hand-rolled at RD.1, and a styling rewrite mid-plan is
  three unrelated diffs in one commit. Note the migration as out-of-scope (it is, below).
- Row rendering reuses `RadarRow` with one addition: when a `score` prop is present, the
  head leads with a `.radar-cannon-score` chip (`formatCount(Math.round(score))`) and
  `whyLine` renders the age in `.radar-age-red` past `redAgeMin`. **`whyLine` must not grow a
  third branch** — pass the tone in and let the component decide the class. The `BAND_LABEL`
  map gains `cannon: 'cannon'` with a `title` explaining what put it there (the GT.8
  `ROSTER_BAND_TITLE` precedent — a band whose reason isn't visible in the numbers carries
  a tooltip).
- **The counter.** `RadarSection` fetches `api.radar.placedToday` on mount and after every
  pick (`onPick` already fires several best-effort calls; add this one the same way — a
  failure is a `console.warn`, never a broken view). Render in the Cannon view's head:
  `placed today {placed} / {target}`. Optimistic +1 on a pick, reconciled by the refetch.
  **Never poll it on a timer** — it is cheap but the discipline is "a panel does not poll a
  server route", and the mount+pick triggers are enough.
- **Empty states** (the `EmptyState` primitive, always with a second coach line): no rows →
  *"Nothing scoring above N right now — the cannon queue fills from posts under 30 minutes
  old."* / hint naming the roster. If `hidden > 0` and `rows` is empty, say so instead:
  *"N entries aged out past 30 minutes."* — that is the difference between "no targets" and
  "you missed the window", and only one of them is a reason to change the roster.
- **Drafting from the Cannon view.** The `Draft replies` / `Curate & draft` buttons currently
  render only in the queue view; render `Draft replies` in the Cannon view too, sourced from
  the cannon rows that have no reply yet, capped by `radarBatchSize(server)`. **Do not** wire
  `Curate & draft` here: the cannon score already ranked these rows, and paying a second
  model call to re-rank a set that a measurement already ordered is the spend §7.4 refuses.
  Say that in a comment; it is the first thing a later reader will try to add.

**Tests:** `radar.test.ts` — `cannonQueue` drops a row exactly past `maxAgeMin` and counts it
in `hidden`; a `band:'cannon'` row below the score floor is still included (capture reason
membership); a `hot` row above the floor is included without being re-banded; sort is score
desc with the `lastSeenAt` tiebreak; a clicked row never appears; an empty input returns
`{rows: [], hidden: 0}`.

**Done when:**
- [ ] The Radar tab shows three views; Cannon lists score-desc rows with red ages past
      15 min and never shows a row past 30 min (unit-tested + one browser pass)
- [ ] The Cannon head shows `placed today N / T` and N moves after a pick
- [ ] The main Queue's contents, order and empty states are byte-identical to before
- [ ] `bun test` + `bun run typecheck` + `bun run lint` + `cd extension && bun run build` green
- [ ] Committed: `feat(cannon): Cannon view in the Radar tab`

**Cost note:** $0 for the view itself. `Draft replies` from this view costs exactly what it
costs from the Queue (~$0.002–0.01/click, unchanged) — this task changes which rows it sends.

---

## Task 6: The roster block — add, drop, rescore, candidates
**Depends on:** Tasks 2, 5. **Droppable** — the roster is fully workable through the API/MCP
without it; cut this first if the plan runs long.
**Session budget:** ~250 lines, 3 files

**Read first:**
- codemap header + §5 (`ui/` primitives row, `Radar.tsx` row), §7.352/353 (the UI-primitive
  and settings-editing discipline)
- `extension/src/sidepanel/ui/` — `Section`, `EmptyState`, `SubTabs`
- `extension/src/sidepanel/Voice.tsx` or `People.tsx` — the nearest "list + add row + row
  actions" shape already in the panel; imitate the closest one rather than inventing a
  layout
- `extension/src/sidepanel/api.ts` — where `api.cannon.*` goes

**Edit:**
- `extension/src/sidepanel/api.ts` + `shared/types.ts` — `api.cannon.{targets, add, patch,
  remove, rescore, candidates}` and the row types, mirroring the route field for field.
- `extension/src/sidepanel/Radar.tsx` — a collapsible `<details className="radar-roster">`
  block at the foot of the Cannon view.
- `extension/src/sidepanel/styles.css` — `.radar-roster-*`.

**How:**
- The block lists targets score-desc: `@handle · score · nN · scored Nd ago`, `belowFloor`
  rows tinted `warn` (the chip taxonomy, §7.354 — a **lookup in `chips.ts`**, never a sixth
  class family). Actions per row: `bench`/`camp` (PATCH `active`), `drop` (DELETE, behind a
  `confirm()` like the Pillars/Niche deletes).
- One `Rescore` button → `POST /x/cannon/rescore` → reload; the note line reports
  `scored N · M under sample`. **$0 and say so on the button title** — the panel's other
  buttons in this tab spend money, and a user cannot be expected to guess which.
- A `+ add handle` input (normalize client-side to the route's rule so a refusal reads as a
  message, not a bare 400 — the `HumanizerCard` mirror discipline) and, under it, the
  `candidates` list with a one-click `add`.
- No polling, no auto-rescore, no alarm. The weekly review is a human sitting down on
  Sunday; a background refresh would make the numbers change under them mid-review.

**Tests:** none new (panel components are untested by convention here). The api.ts types are
covered by `typecheck`. Verify in the loaded extension and note it in the commit body.

**Done when:**
- [ ] Adding a handle, rescoring and dropping all work from the panel without a page reload
- [ ] `belowFloor` targets are visibly distinguishable in the list
- [ ] `bun run typecheck` + `bun run lint` + `cd extension && bun run build` green
- [ ] Committed: `feat(cannon): roster block in the Cannon view`

**Cost note:** $0.

---

## Task 7: Reply language — a server-stamped clause at the variable tail  [parallel-ok]
**Depends on:** Task 2 (for `cannon_targets.language`). Independent of Tasks 4–6.
**Droppable** — cut this second; Arms B and C of the two-week test are English.
**Session budget:** ~180 lines, 5 files

**Read first:**
- codemap header + §7.14 (byte-sync), §7.15 (variable tail), §7.16 (server-stamped), and the
  **JD.1 provenance note** in §7 (*"rides on the VALUE, never a template"* — the rule this
  task follows so no `.md` and no literal moves)
- `src/x/replies/prompt.ts` — `buildGrokInput` / `buildBatchGrokInput` opts bags and the
  order of the tail blocks (relationship → me → guidance), and the `parseContext` /
  `parseBatchTweets` **whitelist builders** (they must keep refusing a client-sent language)
- `src/x/routes/replies.ts` lines 250–320 (where `ctx.niche` / `ctx.me` are stamped)
- `src/test.test.ts` — the byte-sync and anti-drift assertions this task must leave untouched

**Edit:**
- `src/x/replies/prompt.ts` — `language?: string` in both builders' opts bags; rendered as
  ONE line appended at the tail (after `me`, before `guidance`), absent → **byte-identical
  output to today**.
- `src/x/routes/replies.ts` — both generate paths accept a body `language?` (validated:
  a 1–40 char string, 400 `invalid_language`) and **server-stamp it** onto the builder opts.
  It is a *drafting instruction*, not scraped context, so unlike `relationship`/`me` it may
  come from the request — but it is validated and rendered by the server, never interpolated
  from a client string into a template.
- `extension/src/sidepanel/api.ts` + `Radar.tsx` — the Cannon view's `Draft replies` sends
  `language` when **every** row in the draft set shares one non-null
  `cannon_targets.language`; mixed or unknown → send nothing and say so in the note line
  (*"mixed languages — drafted in English"*). One language per call is the honest shape: the
  batch prompt has one instruction block, and a per-post language would need a template
  change this task exists to avoid.
- `src/x/replies/prompt.test.ts` (or `src/test.test.ts`'s reply section) — the assertions.

**How:**
- The clause is one sentence, rendered from a whitelist-free but length-capped string:
  `Write all variants in ${language}. Match the parent's register in that language; do not
  translate word-for-word from English.` Keep it to one line — it rides at the tail, so it
  varies the cache bucket, and a paragraph there is a paragraph paid for on every call.
- The extension needs the language per handle: the Cannon rows know their handle, and
  `api.cannon.targets` is already loaded by Task 6's block. If Task 6 was cut, load the
  roster once per mount in `RadarSection` instead ($0).

**Tests:** absent `language` renders byte-identically to today (assert against a fixture, the
N.3 equivalence-test discipline); present `language` appends exactly one line at the tail;
`parseContext` / `parseBatchTweets` still **reject** a client-supplied `language` inside the
context/tweet objects (it is a top-level body field, not a context field — the GT.6
whitelist test is the model); `invalid_language` fires before any spend (§7.4).

**Done when:**
- [ ] A batch drafted with `language: 'Japanese'` returns Japanese variants; the same call
      without it is byte-identical to a pre-task call
- [ ] `reply prompt.md`, `REPLY_PROMPT_TEMPLATE` and `REPLY_BATCH_PROMPT_TEMPLATE` are
      unchanged (byte-sync + anti-drift tests untouched and green)
- [ ] `bun test` + `bun run typecheck` + `bun run lint` + `cd extension && bun run build` green
- [ ] Committed: `feat(replies): optional server-stamped reply language`

**Cost note:** One `--live` batch draft (~$0.002–0.01) to confirm the model honors the clause.
Everything else is $0.

---

## Task 8 (final): docs-sync + smoke
**Depends on:** all prior.

- [ ] `scripts/smoke-cannon.ts` — rerunnable, **$0 default**, cleans up after itself. Assert
      end to end: create two `cannon_targets` → seed `harvest_rows` for them (one above the
      sample gate, one below) → `POST /x/cannon/rescore` → **read the rows back** and assert
      `[score, sampleN, scoredAt]` on both (the RC.5 rule: a best-effort or txn write needs a
      READ-BACK, not a green call) → `GET /x/cannon/targets` ordering + `belowFloor` →
      `GET /x/cannon/candidates` excludes the two → `GET /x/radar/placed-today` shape →
      `GET /x/people/glance` carries `isCannon` → delete both targets and confirm the seeded
      harvest rows are untouched. **A `--live` flag only if Task 7 shipped** (one batch draft
      with a language, the only thing here that can reach `askLLM`); if Task 7 was cut, ship
      **no** `--live` flag and say why in the header — the D171c question, answered per
      surface (`smoke-humanizer.ts` is the no-flag precedent, `smoke-radar-curate.ts` the
      flag one).
- [ ] `docs/PHASE-HISTORY.md`: one phase entry — what shipped, the date, the cost ($0 new),
      and the two gotchas (the `targetBandMaxX` finding, and the corpus-measured `scoreMin`).
- [ ] `CIRCLES-PLAN.md`: the cannon lane marked against the reply-lane section.
- [ ] `docs/radar-tab.md`: the third view, the roster block, the 30-minute rule, the counter,
      the `cannon` band and its tooltip, and the note that `Curate & draft` is deliberately
      absent from the Cannon view.
- [ ] `docs/settings-tab.md`: the `cannon` knob group (D180b — each task pays its own doc
      line; if the earlier tasks did, this is a no-op and that is the rule working).
- [ ] `.claude/skills/plan-feature/references/codemap.md`: §3.1 (`shared/cannon.ts`), §3.3
      (`cannon/roster.ts`, `cannon/membership.ts`, `settings/cannonThresholds.ts`, the
      registry group count **14 groups / 66 knobs** — recount, don't assume), §3.4
      (`routes/cannon.ts`, the radar/replies/people route edits), §4 (`cannon_targets`,
      migration `0026`, the `radar_drafts.band` widening), §5 (`content.ts` capture arm,
      `shared/radar.ts`, `shared/glance.ts`, `serverSettings.ts`, `Radar.tsx`, the shim count
      **eight**), §7.4a (the second carve-out instance), §9 (test + smoke counts), plus the
      header re-stamp. **Also note in the header that the codemap was stale at this plan's
      writing** — `297c03c`, `221e50e`, `52b32cb`, `22f12b1` (the radar durability fix, the
      curate-click fix, `shared/replyFocus.ts`, and TR.1's harvester un-translation) landed
      after the `80a2f2b` stamp; `shared/replyFocus.ts` in particular is absent from §5.

## Out of scope (do NOT build)

- **Raising `targetBandMinX/MaxX`.** Decision 1. If a later session "notices" the 2–10× band
  and widens it, this plan's carve-out sizing is void.
- **A Playbook cannon section.** The cohort is joinable read-time (§7.12) and there are zero
  measured cannon replies today; a gated cell over n=0 is a section that says
  `insufficient data` for a month. Revisit at ≥20 posted cannon replies.
- **Auto-rescore on a worker or an alarm.** The weekly refresh is a click. An in-process
  worker for a $0 aggregate over a hand-curated 20-row list is the Redis reflex CLAUDE.md
  warns about.
- **`Curate & draft` in the Cannon view.** Task 5 explains why: paying a model to re-rank a
  set a measurement already ordered.
- **Migrating `.radar-tabs` to the `SubTabs` primitive.** A separate polish diff.
- **Fetching follower counts for cannon targets.** $0.010 per lookup for an axis the source
  measurement found nearly uncorrelated with yield.
- **Auto-following, auto-replying, or any automated posting.** §7.28 and the growth plan's
  own line: the Cannon is one-way — never follow a cannon target.
- **Writing DOM-scraped ids into `mentions`.** The since_id trap (§8).

## Risks / watch items

- **`scoreMin: 5000` is someone else's measurement until Task 1's replay says otherwise.**
  §7.33 exists because a threshold nothing crosses is indistinguishable from a working
  feature. The replay is a required step of Task 1, not a nice-to-have.
- **`CANNON_MIN_SAMPLE = 8` and `CANNON_SAMPLE_POSTS = 30` are opening guesses.** Recalibrate
  once ~20 handles carry scores — never by feel (§ Working style).
- **The roster is only as good as the harvest.** A target you never harvest scores `null`
  forever. The candidates list mitigates it, but the honest failure mode is an empty roster;
  the Cannon view's score-only membership is what keeps the feature useful in that state.
- **The 30-minute cutoff assumes the buffer is fresh.** The capture side runs only while the
  extension sees the page — a session where X isn't open produces an empty Cannon view, and
  that is correct, not a bug. The empty state must not read as an error.
- **The carve-out's size is a standing check, not a one-time one** (§7.4a). If the roster
  grows past ~50 active handles, re-read the sizing note in `routes/replies.ts`.
- **Rollback story, if the plan stalls mid-way.** Every intermediate state is coherent:
  `cannon_targets` is inert until `routes/cannon.ts` mounts (Task 2 lands both together, and
  unmounting the router in `src/x/index.ts` is a one-line revert that leaves the table
  harmless); the `x.cannon.*` knobs are read-only config until Task 4 consumes them; the
  `'cannon'` band degrades safely in an older extension build (`isRadarSighting` rejects the
  unknown value and `coerceSightings` drops those rows — a smaller queue, never a crash);
  and the Cannon view is purely additive to `Radar.tsx`. Tasks 6 and 7 are droppable in that
  order without touching anything already shipped.
- **Browser verification is a real tail.** Tasks 4, 5 and 6 each carry one browser pass that
  cannot be unit-tested (`content.ts` is browser-verified by convention, panel components are
  untested by convention). If any is skipped, record it in `VERIFY-DEBT.md` rather than
  reporting the task done — the RC/HM precedent.
