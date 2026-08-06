# Own-activity harvest + the latest-row-per-tweet read layer

- **Status:** planned 2026-08-06 · not started
- **Goal fit:** Goal 2 (track metrics over time on every published post). XR.1 (`1d9f79b`) stopped the daily pass paying to read replies; this is what replaces that data at $0 — and with a longitudinal curve the retired once-only snapshot never had.
- **Cost impact:** **$0.** Every read here is SQL over rows the DOM already scraped for free. Nothing on any path in this plan can reach `xFetch`. It only *removes* the last reason to turn XR.1's knob back off.
- **Invariants touched:** §7.11 (null = unknown — an unset self-handle yields an empty result, never a guess); §7.12 (no derived-state tables — the dedup is a read-time regroup, not a materialized "latest" table); §7.19 (stats gates — every cell n≥20); §7.13 (sync SQLite — no `await` in a txn, no JS `Date` in raw `sql`); §7.24 (background is the single session-storage writer); §7.30 (smoke script, $0 default). **§8:** nothing DOM-scraped may write `mentions` — this plan writes to no table at all.
- **Codemap sections relevant:** §3 (`routes/harvest.ts`, `routes/playbook.ts`, `playbook.ts`, `settings/registry.ts`), §4 (`harvestRuns`/`harvestRows`, `cannonTargets`), §5 (`harvester.ts`, `Harvest.tsx`, `Playbook.tsx`, `shared/harvest.ts`), §7 (patterns above), §9 (test/smoke map), §10 (the "new measurement" recipe).

## Why / what changes for the user

Today the daily number that the two-week test in `x-growth-plan-v3.md` §8 hangs on — **impressions per reply** — is computed by hand, in an ad-hoc SQL session, over one manually-triggered harvest run. After this plan it is on the Playbook tab as four gated tables (parent band, latency, crowding, arm), refreshed by a two-click harvest the user runs once or twice a day, with the day's headline number on the Today brief where they already look.

The mechanism that makes it possible is unglamorous and is the actual deliverable: **`harvest_rows` has no dedup.** Repeated captures of the same tweet are stored as separate rows on purpose (that *is* the longitudinal curve), so every consumer must reduce to one row per `tweet_id` — and today nothing does, which is why re-harvesting the same day twice would silently double every total. This plan ships that reduction once, in the correct direction, with the direction named.

## Design

**Data: no new table, no migration, no column.** `harvest_rows` already carries everything — `views`/`likes`/`comments` on my reply, `orig_views`/`orig_comments`/`orig_time`/`orig_handle` on its parent, `tweet_time` on mine. The journal stays FREE from `0027`.

**One new setting.** The server has no idea what my X handle is (`SELF_X_USER_ID` is a numeric id; `account_snapshots` stores no username). New group `identity`, one knob:

| key | type | default | scope |
|---|---|---|---|
| `x.identity.selfHandle` | `string` | `''` | `mirrored` |

Mirrored because the panel's harvest preset prefills from it too. **Unset ⇒ every loader in this plan returns its empty shape** (`totalMeasured: 0`, no cells) — never a guess, never someone else's corpus (§7.11).

**Pure logic** — `src/x/playbook.ts`, following the §10 recipe and the `buildTimelineFunnel` exemplar:

```ts
export interface OwnReplyRow {
  tweetId: string;
  views: number; likes: number; comments: number;
  tweetTimeMs: number | null;
  parentHandle: string | null; parentText: string | null;
  parentViews: number | null; parentComments: number | null; parentTimeMs: number | null;
}
export interface OwnReplyPerformance {
  totalMeasured: number;         // deduped rows in window
  totalViews: number;
  viewsPerReply: number | null;  // the ladder number; null under the gate
  bands: OwnReplyBandCell[];     // <1k / 1k-10k / 10k-50k / 50k-200k / 200k+ / unknown
  latency: OwnReplyLatencyCell[];// <15m / 15-60m / 1-6h / 6-24h / >24h / unknown
  crowding: OwnReplyCrowdCell[]; // <10 / 10-50 / 50-200 / 200+ / unknown
  arms: OwnReplyArmCell[];       // roster-ja / roster-en / off-roster-nonlatin / off-roster-en / unknown
}
export function buildOwnReplyPerformance(
  rows: OwnReplyRow[], rosterByHandle: Map<string, string | null>, minN = DEFAULT_MIN_CELL_N,
): OwnReplyPerformance
```

Every cell carries `n`, `avgYield`, `totalViews`, `sharePct`, `avgParentViews`, and `sufficient` (`n >= minN`); an insufficient cell reports its counts and **nulls its averages**, the `OutcomeCell` discipline already used across this file.

**The read layer** — `src/x/routes/playbook.ts`, new exported `loadOwnReplyPerformance(minN, windowDays)`:

```sql
select tweet_id, max(captured_at) …, views, likes, comments, tweet_time,
       orig_handle, orig_views, orig_comments, orig_time
from harvest_rows
where mode = 'replies' and handle = :selfHandle and tweet_time >= :since
group by tweet_id
```

`max(captured_at)` + bare columns is SQLite's bare-column rule — every bare column comes from the matching input row — the same idiom `loadTimelineFunnel` already uses. **The direction is the whole point and it is the OPPOSITE of that function's:** `loadTimelineFunnel` takes `min(captured_at)` because the band that mattered is the one at first sighting; this takes `max(captured_at)` because the number that matters is the freshest view count. Two consumers of one table, two directions, both correct. Neither may be "unified".

The window is on `tweet_time` (when I posted), not `captured_at` (when I scraped) — otherwise a fresh harvest of old replies re-dates them into the window.

**Arm classification is post-hoc and derived, not stamped.** 0 of 98 harvested replies matched a `reply_drafts` row (all hand-typed outside the pipeline), so arm attribution cannot come from the drafting path and never will. Instead: `orig_handle ∈ cannon_targets` (joined in the loader) × `detectScript(orig_text)` from `src/shared/language.ts` → the five arm cells above. That reads the §8 A/B/C experiment off rows that were already free.

**Harvest side** — a new `HarvestScope` value `'recent'` = a rolling **48-hour** window instead of a local calendar day. The existing `today`/`yesterday` scopes build local-midnight windows (`dayWindow` in `harvester.ts`), and the DB buckets UTC, so on UTC+3 a `yesterday` run covers 21:00–21:00 UTC and clips three hours off every UTC day. A 48h rolling window covers both UTC days completely with overlap — and **the overlap is free**, because re-capture is the feature and the read layer dedups it. Plus a one-click **"My replies"** preset in `Harvest.tsx` that sets `handle = x.identity.selfHandle`, `mode = 'replies'`, `scope = 'recent'`.

**Measurement of the measurement:** `scripts/smoke-own-harvest.ts`, $0, no `--live` flag (nothing here can spend).

## Decisions taken

1. **Playbook tab, not Radar or Harvest** (user answer). It follows the §10 recipe exactly and is the only surface with room for four tables. The daily headline (`61.6 views/reply`) additionally goes to the Today brief as one fact, because that is where the number is read every day.
2. **A settings knob for the self handle, not a schema column.** `getMe()` already returns `username` free on the daily pass and could stamp a new `account_snapshots` column — always correct, never mistyped. Rejected anyway: it needs migration `0027` and a fresh install would wait until 03:00 UTC for the panel preset to work, to save a single-user system from typing their own handle once. Schema churn loses.
3. **New group `identity`, not a knob smuggled into `people`/`display`.** Requires a `GROUP_LABELS` entry + render-order slot + the group-list assertion in `registry.test.ts`. That is the documented cost of a group and it is worth paying to keep the key greppable.
4. **Latest-per-tweet, and it does NOT replace `loadTimelineFunnel`'s earliest-per-tweet.** No shared "dedup helper" that takes a direction flag — a flag is exactly how someone later passes the wrong one. Two call sites, two explicit SQL aggregates, each with the comment saying why.
5. **The existing Playbook "Reply latency" section stays.** It measures age-at-DRAFT over `reply_drafts` and is starved (0/98). The new one measures age-at-POST over every harvested reply. Different denominator, different provenance, different question — the plan adds an instrument, it does not fix the old one, and the new section's title says "harvested" so the two are never read as one number.
6. **`recent` = 48h fixed, not a knob.** It exists to make UTC-day coverage unconditional for any viewer timezone; a tunable would reintroduce the clipping it fixes.
7. **`cannon_targets` rescoring is NOT in this plan.** All 9 roster rows have `score = NULL`/`sample_n = 0` not because the write-back is broken but because **`POST /cannon/rescore` has never been called** — the route is correct and the Radar → Cannon view already has a Rescore button (`Radar.tsx:1212`). One click, no code. It is listed under "Out of scope" so no implementer goes looking for a bug.

## Done when

1. Running the "My replies" preset twice in one day, then loading the Playbook tab, shows `totalMeasured` equal to the number of **distinct** replies — not double — and the four tables render with gate markers on cells under n=20.
2. `GET /x/playbook` returns `ownReplyPerformance` with `viewsPerReply` matching a hand-run `SELECT` over the same window, and the Today brief shows the same number for the day.
3. With `x.identity.selfHandle` unset, every new surface renders its empty state and no query returns another handle's rows.
4. `bun scripts/smoke-own-harvest.ts` passes, $0, and cleans up its fixture run.
5. `/cost/daily` shows no new X spend on any day this feature is exercised.

---

## Task 1: `identity` settings group + the self-handle knob  [parallel-ok]
**Depends on:** none
**Session budget:** ~120 lines, 3 files

**Read first:** codemap header + §7 "Settings platform" bullet; `src/x/settings/registry.ts` L19–46 (`SettingDef`), L1061–1080 (`GROUP_LABELS`), the `WORKERS` array tail (the XR.1 boolean knob is the newest exemplar); `src/x/settings/registry.test.ts` L200–230.

**Edit:**
- `src/x/settings/registry.ts` — new `IDENTITY: SettingDef[]` with the single knob; push into `SETTINGS_REGISTRY`; `GROUP_LABELS.identity = 'Identity'`; place it FIRST in the render order (it is the "who am I" group).
- `src/x/settings/registry.test.ts` — extend the group-order and per-group key assertions.
- `docs/settings-tab.md` — one row in the group table.

**How:** `type: 'string'`, `default: ''`, `scope: 'mirrored'`. The description must carry the why: *"Your X handle without the @. The server has no other way to know it (`SELF_X_USER_ID` is a numeric id). Unset means every own-activity read answers empty rather than guessing."* Do NOT add validation beyond the registry's `not_a_string` — a handle regex here would be a second owner of a rule `parseIngestRow` already has, and a refused save is worse than a typo the user can see. `SettingRow` already renders `string` → text input (§5), and `mirrored` reaches the panel through the existing blob with no wiring.

**Tests:** `registry.test.ts` — the group appears with exactly one key; `settingsRegistry.validate` accepts `''` and a handle, rejects a number; `scope === 'mirrored'`; the mirrored-set assertion count moves 32 → 33.

**Done when:**
- [ ] `GET /x/settings` returns an `identity` group rendering ahead of `doctrine`
- [ ] The registry group/mirror assertions are updated, not deleted
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(settings): identity group + x.identity.selfHandle`

**Cost note:** $0.

---

## Task 2: the pure own-reply builders
**Depends on:** none  [parallel-ok with Task 1]
**Session budget:** ~380 lines incl. tests, 2 files

**Read first:** codemap §7 rule 19 (gates) + §10 recipe; `src/x/playbook.ts` L23–110 (`DEFAULT_MIN_CELL_N`, `OutcomeCell`, `buildAngleEffectiveness` as the cell-shape exemplar), L960–1010 (`buildTimelineFunnel` — the dedup/gate exemplar), L635–680 (`buildLatencyEffectiveness` — the bucket exemplar); `src/shared/language.ts` L230–290 (`detectScript`, `resolveLanguageProfile`).

**Edit:**
- `src/x/playbook.ts` — append the `OwnReplyRow` / `OwnReplyPerformance` types, the bucket constants, and `buildOwnReplyPerformance`.
- `src/x/playbook.test.ts` — a new `own reply performance` describe.

**How:** Pure, no DB, no clock beyond what the caller passes. Bucket edges, taken verbatim from `x-growth-plan-v3.md` §2.2/§2.3/§2.4 so the tables are comparable with the reference corpus:
- parent band: `<1k`, `1k-10k`, `10k-50k`, `50k-200k`, `200k+`, `unknown` (`parentViews === null`)
- latency `(tweetTimeMs - parentTimeMs)/60000`: `<15m`, `15-60m`, `1-6h`, `6-24h`, `>24h`, `unknown` (either timestamp null)
- crowding `parentComments`: `<10`, `10-50`, `50-200`, `200+`, `unknown`
- arm: `roster-ja` / `roster-en` (`parentHandle` in `rosterByHandle`, split by that map's language value) · `off-roster-nonlatin` / `off-roster-en` (`detectScript(parentText)` — pass the parent text in on `OwnReplyRow`) · `unknown`

**`unknown` is always its own bucket and never folded into a neighbour (§7.11)** — a null parent means the scrape missed it, which is a different fact from "small parent". `sharePct` is computed against `totalViews` across ALL cells including insufficient ones, because a share that excluded them would not sum to 100. `viewsPerReply` is `null` when `totalMeasured < minN`. Do NOT import anything from `routes/` or `db/` here.

**Tests:** every bucket boundary on both sides (999/1000, 14/15 min, 9/10 replies); a null parent landing in `unknown` for all three axes; the gate — a 19-row cell reports `n` and `sufficient:false` with null averages, a 20-row cell reports averages; `sharePct` summing to 100 across mixed sufficiency; empty input returning the empty shape rather than throwing.

**Done when:**
- [ ] The four cell arrays render from a hand-built fixture matching the numbers in `x-growth-plan-v3.md` §2.2
- [ ] Boundary + gate + null cases covered
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(playbook): own-reply band/latency/crowding/arm builders`

**Cost note:** $0 — pure module, cannot reach `xFetch`.

---

## Task 3: the latest-per-tweet loader + `GET /x/playbook` wiring
**Depends on:** Tasks 1, 2
**Session budget:** ~250 lines incl. tests, 2 files

**Read first:** `src/x/routes/playbook.ts` L455–500 (`loadTimelineFunnel` — the exemplar AND the direction contrast), L680–700 (the response assembly); `src/x/routes/harvest.ts` L392–430 (the `harvest_rows` aggregate idiom); `src/x/routes/cannon.ts` L317–345 (reading `cannon_targets` by handle).

**Edit:**
- `src/x/routes/playbook.ts` — `loadOwnReplyPerformance(minN, windowDays)`; add `ownReplyPerformance` to the GET response.
- `src/x/routes/playbook.test.ts` — a route-suite block.

**How:** Read `x.identity.selfHandle` **at request time** via `getSetting` (the money-knob discipline generalized — a handle edited in Settings must move this list on the next read). Empty/blank ⇒ return `buildOwnReplyPerformance([], new Map(), minN)` immediately, before any query.

The dedup SQL is the core of the task. Use `max(harvestRows.capturedAt)` with bare columns and `groupBy(harvestRows.tweetId)`. **Write the comment that says this is the opposite of `loadTimelineFunnel`'s `min()` and why** — that comment is the deliverable as much as the code is. Filter `mode = 'replies'` (§8: any new `harvest_rows` consumer MUST filter on `mode`, or the passive `timeline` corpus pollutes it) AND `handle = selfHandle` AND `tweetTime >= since`.

Window on `tweetTime`, default 14 days, accepted as `?ownReplyDays=` clamped `[1, 90]` with a 400 `invalid_own_reply_days` (the `intParam` helper pattern from `routes/harvest.ts`). Load the roster with one `select handle, language from cannon_targets` and build the `Map`. Two queries total, both `$0`.

Do NOT touch `loadTimelineFunnel`, `buildLatencyEffectiveness` or the existing `latencyEffectiveness` field — decision 5.

**Tests:** seed `harvest_rows` in the shared in-memory DB (clean up in `afterAll` — other suites assert medians over shared data): **two captures of the same `tweet_id` with different `views`** asserting `totalMeasured` counts it once and the total uses the LATER views; a row outside the window excluded; a `mode='timeline'` row with the same handle excluded; another handle's replies excluded; the unset-handle path returning the empty shape without querying; `?ownReplyDays=0` and `=91` → 400.

**Done when:**
- [ ] Double-capturing a reply does not double its views anywhere in the response
- [ ] `mode`/handle/window filters each proved by an excluded fixture row
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(playbook): latest-per-tweet own-reply loader`

**Cost note:** $0 — two SELECTs over already-scraped rows.

---

## Task 4: the Playbook tab section
**Depends on:** Task 3
**Session budget:** ~230 lines, 3 files

**Read first:** `extension/src/sidepanel/Playbook.tsx` L440–500 (the existing "Reply latency" section — imitate its shape, and note it stays), L1010–1060 (roster coverage, the closest table layout); `extension/src/sidepanel/ui/Section.tsx`; codemap §7 "UI primitives" + "Chip taxonomy".

**Edit:**
- `extension/src/sidepanel/Playbook.tsx` — one `<Section title={\`My replies — harvested (${p.totalMeasured} measured)\`}>` rendering the four tables.
- `extension/src/shared/types.ts` — the `OwnReplyPerformance` response types.
- `docs/playbook-tab.md` — the new section.

**How:** Compose `Section` + the existing `.chip` taxonomy; no new CSS block unless a table genuinely needs one. Lead with the headline `viewsPerReply` (and render `—` when null, i.e. under the gate) because that is the number the §8 test tracks daily. Mark insufficient cells the way the existing sections do rather than hiding them — a hidden cell reads as "no data", which is a different claim than "not enough yet". Title says **"harvested"** so it is never confused with the drafts-based "Reply latency" section directly above it.

**Tests:** none new — `Playbook.tsx` is presentational and this repo does not unit-test tab components (§9); the types change is compile-checked. `cd extension && bun run build` must pass.

**Done when:**
- [ ] The four tables render, with the empty state when `totalMeasured === 0`
- [ ] `cd extension && bun run build` clean
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(panel): harvested own-reply section on the Playbook tab`

**Cost note:** $0.

---

## Task 5: `recent` (48h) scope + the "My replies" harvest preset  [parallel-ok]
**Depends on:** Task 1 (for the prefill only — buildable before it if the preset reads a blank handle)
**Session budget:** ~200 lines incl. tests, 5 files

**Read first:** `extension/src/harvester.ts` L248–300 (`dayWindow`/`scopeWindow`/`windowFor` — the local-day bug lives here); `extension/src/shared/harvest.ts` L11–30, L124–150 (`HarvestScope`, `isHarvestScope`, `parseHarvestForm`); `extension/src/sidepanel/Harvest.tsx` L34–130 (the `SCOPES` sub-tabs + form state); `src/x/routes/harvest.ts` L41–44 (the server `SCOPES` whitelist).

**Edit:**
- `extension/src/shared/harvest.ts` — widen `HarvestScope` with `'recent'`.
- `extension/src/harvester.ts` — `scopeWindow` returns `{startMs: now - 48h, endMs: +Infinity}` for it.
- `extension/src/sidepanel/Harvest.tsx` — a `recent` sub-tab + a "My replies" preset button.
- `src/x/routes/harvest.ts` — add `'recent'` to the server `SCOPES` whitelist.
- `extension/src/shared/harvest.test.ts` — the parse/round-trip cases.

**How:** `scope` is free text in the DB (`harvest_runs.scope`), so this needs **no migration** — but `POST /harvest/runs` validates against its `SCOPES` const and will 400 without the whitelist edit. Do that edit in the same commit or the preset fails at the last step.

`endMs` unbounded matches the existing `since-last` shape, so nothing downstream needs a new branch. **Leave `today`/`yesterday` exactly as they are** — they are correct for scraping someone else's profile, where you think in local days; `recent` exists specifically because the *self* corpus is bucketed in UTC downstream.

The preset sets `handle` from the mirrored `x.identity.selfHandle` (via `useServerSettings()`), `mode='replies'`, `scope='recent'`, and leaves `sendToStratus` on. It must not auto-start a run — the harvester owns the scroll and starting one from a tab switch is how a background scroll surprises the user.

**Tests:** `harvest.test.ts` — `isHarvestScope('recent')`, `parseHarvestForm` round-trip, and a stored form with the old scope set still parsing. `src/x/routes/harvest.test.ts` — `POST /harvest/runs` accepts `scope:'recent'` and still 400s on garbage.

**Done when:**
- [ ] A `recent` run scrapes 48h and its rows land with `scope:'recent'`
- [ ] The preset prefills the handle from the setting and stays inert until clicked
- [ ] `cd extension && bun run build` clean
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(harvest): 48h recent scope + my-replies preset`

**Cost note:** $0 — DOM scrape, no API on any path.

---

## Task 6: the daily number on the Today brief
**Depends on:** Task 3
**Session budget:** ~150 lines incl. tests, 3 files

**Read first:** `src/x/routes/brief.ts` L760–800 (the week/today activity block — where a fact of this shape belongs); `extension/src/sidepanel/Today.tsx` (the corresponding card); codemap §7 rule 19.

**Edit:**
- `src/x/routes/brief.ts` — a `harvestedReplies: {day, n, totalViews, viewsPerReply} | null` fact for the most recent complete local day.
- `extension/src/sidepanel/Today.tsx` — one line in the existing activity card.
- `src/x/routes/brief.test.ts` — the fact present/absent pair.

**How:** Reuse `loadOwnReplyPerformance`'s dedup SQL rather than writing a second aggregate — export a small `latestOwnReplyRows(selfHandle, sinceMs)` from `routes/playbook.ts` in Task 3 and import it here, so there is exactly one place that knows the `max(captured_at)` rule. **`null` when the handle is unset or the day has no harvested rows** — an absent fact must not render as `0.0 views/reply`, which reads as a catastrophic day rather than as "you haven't harvested yet".

This fact is deliberately **not gated at n≥20**: it is one day's raw arithmetic, not a comparative cell, and the whole point is watching it move day to day. Say so in a comment so a later reader does not "fix" it into a gate.

**Tests:** `brief.test.ts` — a seeded day yielding the fact with the right average; no rows ⇒ `null`; handle unset ⇒ `null`.

**Done when:**
- [ ] The Today card shows e.g. `98 replies · 61.6 views/reply` for the last harvested day
- [ ] Absent data renders nothing, not a zero
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(brief): harvested views-per-reply on Today`

**Cost note:** $0.

---

## Task 7 (final): docs-sync + smoke
**Depends on:** all prior.

- [ ] `scripts/smoke-own-harvest.ts` — mounts harvest + playbook + brief in-process over the REAL DB; sets `x.identity.selfHandle` to a fixture handle (snapshot + restore, the `smoke-studio.ts` discipline); creates one `replies` run; posts two batches that **re-capture the same tweet ids with higher view counts**; asserts `totalMeasured` counts each once and the totals use the later capture; asserts the band/latency/crowding/arm cells; asserts the brief fact; deletes its run + rows. **$0, no `--live` flag** — nothing on this path can spend, and inventing one would be theatre.
- [ ] `docs/PHASE-HISTORY.md`: the phase entry (NOT CLAUDE.md — §7 rule 29). It must record the measured motivation: the once-only API snapshot read 4,017 impressions across 108 replies where the re-runnable harvest read 6,033 across 98, and that the dedup direction here is deliberately the opposite of `loadTimelineFunnel`'s.
- [ ] `PLAN.md`: goal-2 status line.
- [ ] `docs/playbook-tab.md`, `docs/harvest-tab.md`, `docs/today-tab.md`, `docs/settings-tab.md` updated.
- [ ] `.claude/skills/plan-feature/references/codemap.md`: §3 (`playbook.ts`, `routes/playbook.ts`, `routes/harvest.ts`, `settings/registry.ts` — registry 67 → 68 knobs, 15 → 16 groups, mirrored 32 → 33), §5 (`harvester.ts`, `Harvest.tsx`, `Playbook.tsx`), §9 (new suites + smoke 35 → 36), §11 update-log entry, header re-stamped.

## Out of scope (do NOT build)

- **Rescoring `cannon_targets`.** The nulls are not a bug — `POST /cannon/rescore` has simply never been called, and `Radar.tsx:1212` already has the button. Do not "fix" the write-back; do not auto-rescore on a timer (the Sunday review is a human decision, per CQ.6).
- **Turning XR.1's knob back off**, or adding any API read to recover reply metrics. That is the thing this plan exists to make unnecessary.
- **A materialized "latest snapshot" table or a view.** §7.12 — the read-time regroup is the design, not a stopgap.
- **Backfilling arm onto `reply_drafts`.** Arm is derived at read time from the roster + parent language; a stored column would be a second owner that goes stale the moment the roster changes.
- **Auto-running the harvest** on a timer, on tab focus, or from the background. The harvester owns the page scroll (§5 `isHarvestActive`); an unattended run is a surprise, not a feature.
- **Touching the existing drafts-based "Reply latency" Playbook section** (decision 5).
- **Repairing pre-TR.1 harvested rows.** Foreign-language rows captured before the un-translation fix store X's machine translation, so `detectScript` on them is wrong. Do not attempt a rewrite — let the window age them out, and note it as a caveat in the section copy.

## Risks / watch items

- **The arm classifier is only as good as the roster.** `cannon_targets` currently holds 9 handles, none Japanese, so `roster-ja` will be empty until the roster grows. The cells will be honest (`unknown` / `off-roster-*` carrying the volume) but the §8 A/B/C decision cannot be read off them until Arm A handles are actually camped. Not a code risk — a data-entry prerequisite, and worth stating in the section copy.
- **`orig_*` completeness is a DOM contract.** All 98 rows in the reference run had a parent, but X's markup drifts (§8) and a sweep that silently stops filling `orig_views` would push every reply into the `unknown` band rather than erroring. Watch the `unknown` share; a jump is a scraper regression, not a behaviour change.
- **n≥20 will bite early.** At ~100 replies/day the band cells clear the gate in a day but the arm cells may not for a week. Expect `—` in places at first; that is the gate working.
- **The 14-day default window is an opening guess**, chosen to match the baseline table in `x-growth-plan-v3.md` §1. Do not retune it by feel — it is a query param, so a different window is a URL, not a code change.
- **Pending live verification:** the browser pass on the `recent` scope (does a 48h window actually terminate on a 100-reply/day account, or does it hit `HARD_STEP_CAP` first?). Park it in `VERIFY-DEBT.md` if the implementing session cannot run it.
