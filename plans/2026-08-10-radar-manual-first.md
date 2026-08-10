# Radar manual-first — handpicked queue + an armed sweep with explicit admission rules

- **Status:** planned 2026-08-10 · **Task 1 (RS.1) SHIPPED 2026-08-10** — the sweep core, the `sweep` registry group (registry recount after RS.1: **17 groups / 79 knobs / 44 mirrored**) and the extension mirror. · **Task 2 (RS.2) SHIPPED 2026-08-10** — the sixth band `'sweep'` end to end (buffer → batch wire → `radar_drafts` → confirm-coerced to `null`) plus `likes`/`verified` on the sighting. · **Task 3 (RS.3) SHIPPED 2026-08-10** — the behaviour change: capture is manual by default, the three armed arms replace the three ambient ones, `readVerified` is the new DOM half, `ROSTER_MAX_AGE_MIN` and the `isCannonEligible` capture path are deleted. · **Task 4 (RS.4) SHIPPED 2026-08-10** — the Radar tab can arm a sweep: a `.radar-sweep` row in all three views (Start/Stop, a three-shape state line with a live countdown, and a second `SettingsGear` over the eleven `x.sweep.*` knobs off the section's one editor), plus the two-state Queue empty copy. One helper extracted with tests: `sweepMinutesLeft`. **Risk 7's sharp edge is closed — the feature is now usable end to end from the panel; the on-page chip (Task 5) is the remaining "sweeping unaware" gap.** Tasks 5–6 open.
- **Goal fit:** Goal 4 (Circles / the people layer) — the Radar is the reply-target queue. This does not add a goal, it takes control of one that currently fills itself.
- **Cost impact:** **$0 to build and $0 to run.** No X call, no LLM call, no table, no migration. Recurring cost *falls*: a smaller queue means `Draft replies` / `Curate & draft` batch fewer tweets per click (~$0.002–0.01 per call today, unchanged per call, fewer rows in it).
- **Invariants touched:** §7.4 (refuse-before-spend, applied here as gate ORDER inside `applyBand` — free checks before the one DOM read); §7.11 (null = unknown — and why the verified gate deliberately reads unknown as *fail*); §7.19 (every threshold below is an opening guess, recalibrate at a stated n, never by feel); §7.24 (background stays the single writer of the **buffer**; the sweep switch is config, not buffer — the `passiveCapture` precedent); §7.26 (new shared modules must inline into the content IIFE — no deps); §7.27 (one parser: the sweep predicate has ONE home shared by registry and page); §7.33 (a borrowed threshold is replayed before it ships — here every default is restated from BAND with its provenance, not imported).
- **Codemap sections relevant:** §3.1 (`src/shared/`), §3.3 (`settings/registry.ts`, `settings/cannonThresholds.ts`), §3.4 (`routes/radar.ts`), §5 (`content.ts`, `shared/radar.ts`, `shared/serverSettings.ts`, `sidepanel/Radar.tsx`), §7.4/7.11/7.19/7.24/7.26/7.27, §9 (smoke conventions), §10 (recipes).

## Why / what changes for the user

Today the Radar fills itself: three ambient arms (`hot`/`warm` band verdicts, the Cannon score-or-camped arm, the circle arm) push tweets into the queue on every scroll, and the only way to shape that is twelve band knobs that encode someone else's model of "worth replying to". After this ships the **default is manual**: nothing enters the queue except tweets you ⊕ by hand, and the ⊕ stays lit on tweets already queued so a scroll-back is legible. A **Start sweep** button in the Radar header arms ambient capture for a bounded session — scroll, capture, **Stop sweep**, scroll on, arm it again — with a small chip on x.com so you can never sweep unaware. What the sweep admits is yours, stated as numbers: min/max impressions, min/max likes, min/max replies, verified-author-only, and a max tweet age.

Nothing about *replying* changes: drafting, the Cannon view, curate, the humanizer, the manual paste (§7.28) are all untouched. This is a valve on the intake.

## Design

**Nothing on the server changes except the settings catalog.** No table, no column, no migration, no route. `radar_drafts.band` is already a nullable `text` column, so a sixth band value costs nothing there.

```
src/shared/radarSweep.ts        NEW  canonical: SweepConfig, SWEEP defaults, passesSweep,
                                     sweepNeedsVerified, sweep-session helpers. Pure,
                                     dependency-free (IIFE-safe, §7.26).
extension/src/radarSweep.ts     NEW  bare re-export shim (top level, §5 rule) + tsconfig entry
src/x/settings/registry.ts      +11  new `sweep` group, ALL `mirrored`, defaults = SWEEP
extension/src/shared/serverSettings.ts  readSweep() + ServerConfig.sweep + SERVER_DEFAULTS.sweep
extension/src/shared/verified.ts NEW  the DOM half: readVerified(article) -> boolean | null
extension/src/shared/radar.ts   RadarBand widens to +'sweep'; RadarSighting gains likes?/verified?
src/x/routes/radar.ts           band unions widen; QUEUE_META_BANDS gains 'sweep'
extension/src/content.ts        the capture rewrite + the on-page chip + the ⊕ queued state
extension/src/sidepanel/Radar.tsx  Start/Stop sweep, countdown, second SettingsGear
```

### The admission rule (the whole feature, in one place)

`passesSweep(candidate, cfg)` — pure, in `src/shared/radarSweep.ts`:

```ts
interface SweepCandidate { views: number; likes: number; replies: number; ageMin: number; verified: boolean | null }
interface SweepConfig {
  minViews: number; maxViews: number;      // a MAX of 0 means "no ceiling"
  minLikes: number; maxLikes: number;      // a MIN of 0 is naturally no floor
  minReplies: number; maxReplies: number;
  maxAgeMin: number;                       // always enforced, including on bypass arms
  verifiedOnly: boolean;
  campedBypass: boolean;                   // camped cannon accounts skip the METRIC gates
  circleBypass: boolean;                   // circle/CRM accounts skip the METRIC gates
  autoStopMin: number;                     // session length; not an admission field
}
```

`SWEEP` (the shipped defaults, all opening guesses — §7.19):

| key | default | provenance |
|---|---|---|
| `x.sweep.minViews` | 300 | the number `BAND.bigViews` uses. **Restated, not imported** — the sweep must be tunable without moving the classifier that draws the border. |
| `x.sweep.maxViews` | 0 (none) | |
| `x.sweep.minLikes` | 0 | |
| `x.sweep.maxLikes` | 0 (none) | |
| `x.sweep.minReplies` | 0 | |
| `x.sweep.maxReplies` | 40 | the number `BAND.earlyReplies` uses — "still near the top of the thread". |
| `x.sweep.maxAgeMin` | 60 | opening guess. `CANNON.maxAgeMin` is 30 and is about a *slot*; this is about a *feed session*. |
| `x.sweep.verifiedOnly` | `false` | ships off. The monetization pivot argues for `true` (Premium viewers are the only ones that count), but a filter that defaults ON and silently empties on a selector drift is the worse failure. The knob description carries the argument. |
| `x.sweep.campedBypass` | `true` | user decision — a camped account's 3-minute-old post has no numbers yet, and camping adjacent Premium niches is the pivot's own prescription. |
| `x.sweep.circleBypass` | `false` | user decision — the CRM arm (GT.8) survives as a switch, off. |
| `x.sweep.autoStopMin` | 30 | user decision — the sweep expires on its own. |

Order inside `passesSweep`, and it is a **perf contract**, not style: `applyBand` re-runs on every mutation burst, so the numeric comparisons (already in hand) decide first and the DOM read for `verified` is paid only when `sweepNeedsVerified(cfg)` is true. `verified: null` under `verifiedOnly: true` is a **fail**. That is deliberately the opposite direction from §7.11's "null is not no": this is a gate, and admitting on unknown would silently defeat the filter, whereas failing on unknown surfaces a drifted selector as an empty queue you can see.

### The sweep session

One `chrome.storage.local` key, `radar:sweep`, holding `{ startedAt: string, expiresAt: string }` (absent = manual). **Expiry is evaluated at read time** by the pure `sweepActiveAt(raw, nowMs)` — no timer owns the truth, so a page that was asleep past the expiry cannot capture one tweet on wake. The panel writes the key (a control, like `passiveCapture` in `sidepanel/storage.ts`); §7.24's single-writer rule is about the sightings *buffer*, and this is not it.

### Capture, after

`applyBand` keeps its first half byte-for-byte — `readTweetCapture` → `classifyBand` → `data-stratus-band` border/dim — and keeps `recordPassiveHarvest(article)` at the tail. **The band border and the HV.2 corpus feed are not gated by the sweep and must not become gated**: the border is how you decide what to ⊕, and the corpus is the Playbook funnel's denominator (a gated one would make `buildTimelineFunnel` measure your button-pressing instead of your timeline).

Only the middle — the three capture arms — changes:

```
if (sig && sweepActive) {
  if (passesSweep(cand, cfg))                          -> record(band hot/warm if the classifier said so, else 'sweep')
  else if (cfg.campedBypass && isCampedSighting(...))  -> record('cannon')
  else if (cfg.circleBypass && isRosterSighting(...))  -> record('roster')
}
```

Three consequences to state up front, because each looks like a bug to a later reader:

1. **`isCannonEligible` stops being a capture rule.** Its score half is redundant once the filters own the numbers. It stays a *display* rule — `cannonQueue()`'s read-time half still surfaces any queued row above `scoreMin` in the Cannon view, so nothing is lost.
2. **`ROSTER_MAX_AGE_MIN` (24h) is deleted.** One age rule, `x.sweep.maxAgeMin`, applies to every arm including the bypasses — "max age of tweet" was asked for as universal, and it is also the flood control that constant was doing.
3. **Bypass arms keep their existing bands** (`'cannon'`, `'roster'`), so the Cannon view's membership and `BAND_LABEL` keep meaning. Only the filter arm emits the new `'sweep'`.

### The sixth band

`RadarBand` gains `'sweep'` — the CQ.4 checklist, exactly: `bandStickiness('sweep') = 1` (a real reason, the hot/warm rung), `bandWeight('sweep') = 0` (the main Queue is tier-first; a filter admission must not outrank a hot verdict), `isRadarSighting` accepts it, `BAND_LABEL` gains `sweep: 'swept'` with a `title` (the GT.8/CQ.5 rule: a band whose reason isn't visible in the numbers carries its reason in a tooltip), the server's `RadarBatchTweet` / `RadarDraftInsert` unions widen, and **`QUEUE_META_BANDS` gains `'sweep'`** so the confirm endpoint coerces it to `null` in the rebuilt `contextSnapshot` — a capture reason must never land in a Playbook hot/warm cell (§7.19).

`POST /x/replies/generate-batch` **does not band-gate** (verified: the gate at `routes/replies.ts:310` is on `/replies/generate` only, which is why `manual` pins with zero signals draft today). Swept rows draft without a carve-out. Do not add one.

### Measurement

Deliberately **no new Playbook section.** A queue-origin × outcome cell is a pure builder + loader + tab section + types — a full session — and under the monetization pivot replies are the lowest-value lane in the repo; the build hour is worth more spent elsewhere. What the feature ships instead is *attribution that already answers the question in SQL*, at $0, through the explorer or `x_query`:

```sql
-- did manual-first change what I actually reply to?
SELECT band, COUNT(*) drafted,
       SUM(CASE WHEN status IN ('clicked') THEN 1 ELSE 0 END) worked
FROM radar_drafts WHERE created_at > (strftime('%s','now')-30*86400)*1000
GROUP BY band ORDER BY drafted DESC;
```

Recalibrate the sweep defaults from that at **n ≥ 100 swept rows**, never earlier and never by feel (§7.19).

## Decisions taken

1. **Manual is the default state, not a mode you select.** Absent `radar:sweep` key = manual. A fresh install, a cleared profile and an expired session all land in the same state, and it is the safe one.
2. **The filters are the *only* rule for unknown accounts.** The band classifier keeps drawing the border and keeps gating `/replies/generate`, but it no longer decides admission. A classifier veto the user can't see would contradict the entire point of the feature.
3. **Camped cannon accounts bypass the metric gates; the circle arm does not** (user decision). Both are booleans in the same group; `campedBypass` ships ON, `circleBypass` ships OFF. Neither bypasses `maxAgeMin`.
4. **The sweep auto-stops** (user decision) after `x.sweep.autoStopMin` (default 30). Expiry is read-time, not timer-owned.
5. **On-page: a "sweeping" chip and a persistent ⊕ queued state** (user decision). No on-page filter editing — the numbers live in the panel gear and in Settings → Tuning.
6. **Filters live in the settings registry, mirrored, not in `chrome.storage.local`.** They get the whole editing discipline for free (`useSettingsEditor`, `SettingRow`/`Slider`, reset dots, refusal codes), they survive an extension reinstall, and the mirror path into the content script already exists and already has its listener. The `x.display.*` caps are the precedent for a mirrored knob with no server consumer.
7. **The canonical defaults live in `src/shared/radarSweep.ts`, imported by the registry** — the `CANNON` rule, so the registry can never become a second calibration.
8. **The sweep does not gate the band border or the HV.2 passive harvest.** Different jobs; one is how you decide, one is the funnel's denominator.
9. **"Sweep", not "passive harvest".** `passiveHarvest` / `PASSIVE_HARVEST_KEY` / `recordPassiveHarvest` already mean the HV.2 corpus feed to `POST /x/harvest/passive`. Reusing that word here would collide with a shipped, documented subsystem. Every new symbol says *sweep*, and the module headers say why.
10. **No new Playbook cell** — see Measurement.

## Done when

1. With no `radar:sweep` key set, a full scroll of x.com/home adds **zero** rows to the Radar queue, while the band border/dim still renders and `POST /x/harvest/passive` still receives rows.
2. Clicking ⊕ on a tweet queues it and the ⊕ stays lit on that tweet after scrolling away and back.
3. **Start sweep** in the Radar header arms capture, an on-page chip appears, only tweets satisfying the configured min/max/verified/age conditions enter the queue, **Stop sweep** ends it, and a second Start works in the same session.
4. Leaving the sweep running past `autoStopMin` stops it on its own; the panel says so and the chip is gone.
5. A tweet admitted by the sweep with no classifier verdict shows the `swept` chip; confirming its draft writes a `reply_drafts` row whose `contextSnapshot.signals.band` is `null`.
6. `bun scripts/smoke-radar-sweep.ts` passes at $0, `bun test` + `bun run typecheck` + `bun run lint` green, `cd extension && bun run build` green.

---

## Task 1: the sweep core — pure predicate, registry group, mirror  [parallel-ok with Task 2]
**Depends on:** none
**Session budget:** ~380 lines incl. tests, 7 files (all small)

**Read first:**
- codemap header + §3.1, §3.3 (the `settings/registry.ts` row), §5 (the `serverSettings.ts` paragraph), §7.19/7.26/7.27
- `src/shared/cannon.ts` — **the exemplar for this whole task**: a pure, dependency-free constant + predicate whose defaults the registry imports rather than retypes
- `src/x/settings/registry.ts:626-683` (the `CANNON_KNOBS` block) and the group-shape assertions in `src/x/settings/registry.test.ts`
- `extension/src/shared/serverSettings.ts` (whole file — 238 lines; `readCannon` is the shape to copy)
- `extension/tsconfig.app.json` (the `include` array — count it, it holds **ten** entries today; §5 says nine and is stale)

**Edit:**
- `src/shared/radarSweep.ts` — NEW. `SweepConfig`, `SWEEP`, `SweepCandidate`, `passesSweep`, `sweepNeedsVerified`, `SWEEP_STATE_KEY = 'radar:sweep'`, `SweepSession { startedAt: string; expiresAt: string }`, `startSweepSession(nowMs, cfg) -> SweepSession`, `sweepActiveAt(raw: unknown, nowMs) -> SweepSession | null`.
- `src/shared/radarSweep.test.ts` — NEW.
- `extension/src/radarSweep.ts` — NEW, bare re-export shim at the top level (§5: a shim that only re-exports goes at `extension/src/`, not under `shared/`).
- `extension/tsconfig.app.json` — add `"../src/shared/radarSweep.ts"` to `include` (making eleven).
- `src/x/settings/registry.ts` — new `SWEEP_KNOBS: SettingDef[]`, group id `sweep`, keys `x.sweep.*`, **all eleven `scope: 'mirrored'`**, defaults spread from `SWEEP` (never retyped). Insert the group between `radar` and `cannon` in the render order.
- `src/x/settings/registry.test.ts` — extend.
- `extension/src/shared/serverSettings.ts` — `ServerConfig.sweep: SweepConfig`, `SERVER_DEFAULTS.sweep = SWEEP` (imported through the shim, like `CANNON`), `readSweep(blob)` with the same per-key fallback discipline as `readBand`/`readCannon`, wired into `readServerConfig`.

**How:**
- Copy `src/shared/cannon.ts`'s header discipline: state the model, state that every number is an opening guess with its provenance (the table in this plan's Design goes in the header), and state that the module never reads a store — the config arrives as an ARGUMENT on both sides of the wire.
- **`0` on a `max*` field means "no ceiling"** and there is no other sentinel. Say it in the type doc and in each knob description. `min*` needs no sentinel (`>= 0` is vacuous).
- `passesSweep` order: `views` → `likes` → `replies` → `ageMin` → `verified`. `verified: null` fails when `verifiedOnly` is true. Add the comment explaining the deliberate inversion of §7.11 here (a gate, not a bucket).
- `sweepNeedsVerified(cfg)` is one line (`cfg.verifiedOnly`) and exists so the caller can skip a DOM read; do not inline it at the call site or the perf contract stops being reviewable.
- `sweepActiveAt` is lenient like `readServerConfig`: anything that isn't `{startedAt, expiresAt}` with a parseable future `expiresAt` returns `null` (= manual). Never throws.
- Registry: three of the eleven are `boolean` (`verifiedOnly`, `campedBypass`, `circleBypass`) — `x.workers.discoveryExcludeReplies` is the existing boolean exemplar. Ranges: views/likes/replies `min: 0, max: 1_000_000`; `maxAgeMin` `1..1440`; `autoStopMin` `1..240`. Every description ends with the §7.19 line ("An opening guess — recalibrate at n ≥ 100 swept rows, never by feel").
- Do **not** import `BAND` into `radarSweep.ts`. The two default sets share numbers today and must be free to diverge (Decision 6/§7.33) — the header names where each came from instead.

**Tests:**
- `src/shared/radarSweep.test.ts`: each gate on **both sides of its boundary** (exactly `minViews` passes, one under fails; exactly `maxViews` passes, one over fails) — the `cannon.test.ts` discipline; `0` on every max means unlimited; `verified: null` passes when `verifiedOnly` is false and fails when true; `verified: false` fails under `verifiedOnly`; `sweepNeedsVerified` both ways; `sweepActiveAt` (absent, malformed, non-object, expired to the millisecond, active), `startSweepSession` honouring `autoStopMin`.
- `src/x/settings/registry.test.ts`: the group is **exactly** `keyof SweepConfig` (the `band`/`cannon` group-shape precedent — this is what stops a knob being half-exposed), every default deep-equals `SWEEP`, all eleven are `mirrored`, the boolean knobs validate, out-of-range refusals.
- No test asserts the total knob count in a way that hardcodes 68 — if one exists, update it to the recounted number.

**Done when:**
- [x] `GET /x/settings` shows a `sweep` group of eleven knobs; `GET /x/settings/values?scope=mirrored` carries all eleven `x.sweep.*` keys  ← verified in-process against the registry: the group renders between `radar` and `cannon`, all eleven mirrored, values = `SWEEP`
- [x] `readServerConfig({})` returns `SWEEP` for `.sweep`; a blob with one corrupt sweep key keeps the other ten
- [x] `bun test` (2331 pass) + `bun run typecheck` + `bun run lint` green; `cd extension && bun run build` green
- [x] Committed: `feat(radar): RS.1 the sweep predicate — one pure rule, eleven mirrored knobs`

**Shipped note (for Task 6's codemap recount):** registry is now **17 groups / 79 knobs / 44 mirrored** — measured, not carried forward. `readBoolean` is new in `serverSettings.ts` (the mirror's first boolean keys). The `maxAgeMin` knob is the ONE maximum with no `0 = no ceiling` sentinel: it is always enforced and its registry floor is 1, and both the predicate and its knob description say so.

**Cost note:** $0. No route, no call, no table.

---

## Task 2: widen the sighting for the sweep — the sixth band + likes/verified  [parallel-ok with Task 1]
**Depends on:** none
**Session budget:** ~200 lines incl. tests, 6 files

**Read first:**
- codemap header + §5 (`shared/radar.ts` in the `src/shared/` row) + §3.4 (the `radar.ts` route row) + §7.19
- `extension/src/shared/radar.ts:16-52` (the band doc block + `bandStickiness`) and `:229-267` (`bandWeight`, `rankSightings`) and `:443-461` (`isRadarSighting`)
- `src/x/routes/radar.ts:52-95` (the two band unions + `QUEUE_META_BANDS`) and `:315-335` (the coercion in the confirm endpoint)
- `extension/src/sidepanel/Radar.tsx:1443-1449` (`BAND_LABEL`) and the `ROSTER_BAND_TITLE` pattern near the band chip render (~line 960)
- The CQ.4 entry in the codemap header — this task is the same widening, one value later; follow its checklist rather than inventing one

**Edit:**
- `extension/src/shared/radar.ts` — `RadarBand` += `'sweep'`; `bandStickiness('sweep') = 1`; `bandWeight('sweep') = 0`; `isRadarSighting` accepts it; extend the band doc block with what `'sweep'` means. Add `RadarSighting.likes?: number` and `RadarSighting.verified?: boolean`, merged in `mergeSightings` on the same terms as `reply`/`draftId` (incoming wins if present, previous survives a metric-less re-sighting).
- `extension/src/shared/types.ts` — `BatchReplyTweet.band` union widens (it forwards the sighting's band to `draftReplies`).
- `src/x/routes/radar.ts` — `RadarBatchTweet.band` and `RadarDraftInsert.band` unions widen; `QUEUE_META_BANDS` gains `'sweep'`.
- `extension/src/sidepanel/Radar.tsx` — `BAND_LABEL.sweep = 'swept'` + a title constant beside `ROSTER_BAND_TITLE` ("your sweep filters admitted this one — the band classifier had no opinion").
- `extension/src/shared/radar.test.ts` + `src/x/routes/radar.test.ts` — extend.

**How:**
- `'sweep'` sits on the **hot/warm stickiness rung** (a real reason to be queued) but at **weight 0** in `rankSightings` (the main Queue is tier-first and a filter admission must not outrank a hot verdict) — the exact split `'cannon'` already has, and the comment should point at it rather than restate the reasoning.
- `QUEUE_META_BANDS` is the load-bearing line: `PostSignals['band']` is `Band | null` and cannot hold `'sweep'`, so a missed entry there would put a capture reason into a Playbook band cell (§7.19). CQ.4 shipped a live fix for exactly this class of miss (`'roster'` had never been coerced).
- `likes`/`verified` are **extension-only** — they are not sent on the batch-draft wire and there is no column for them. They exist so the queue card can show why a row is there. Do not add them to `TweetSignals`: that type is a server-shared module stored inside `radar_drafts.signals` and `reply_drafts.contextSnapshot`, and widening it would touch the band gate, the playbook funnel and every stored snapshot.
- `exactOptionalPropertyTypes` is on: rebuild without the key rather than assigning `undefined` (the `stampTiers` pattern at `radar.ts:218`).

**Tests:**
- `radar.test.ts`: a `'sweep'` sighting survives `isRadarSighting`/`coerceSightings`; a `'sweep'` row is not demoted by a `'roster'` re-sighting and *is* replaced by a fresher `'hot'` one; `rankSightings` puts a `hot` row above a `sweep` row at equal tier and a `manual` pin above both; `likes`/`verified` survive a metric-less re-sighting and are absent (not `undefined`) when never set.
- `src/x/routes/radar.test.ts`: a `radar_drafts` row stored with `band: 'sweep'` confirms to a `reply_drafts` row whose `contextSnapshot.signals.band` is `null` (**read the row back from the DB** — `persistRadarDrafts`-class writes are best-effort, so a green call proves nothing, RC.5's lesson).

**Done when:**
- [x] A `'sweep'` band round-trips buffer → batch wire → `radar_drafts` → confirm, and lands as `band: null` in the reply snapshot
- [x] `BAND_LABEL` is exhaustive again (the `Record<RadarSighting['band'], string>` type forces it)
- [x] `bun test` (2339 pass) + `bun run typecheck` + `bun run lint` green; `cd extension && bun run build` green
- [x] Committed: `feat(radar): RS.2 the sixth band — 'sweep' end to end, plus likes/verified on the sighting`

**Shipped note (for Task 6's docs-sync + Task 3's author):** the plan's file list was **two files short of the round-trip**, both found by following the wire rather than the list. (1) **`src/x/routes/replies.ts::ACCEPTED_BATCH_BANDS`** — the runtime validator behind `POST /x/replies/generate-batch`, whose own comment says it mirrors `RadarBatchTweet['band']`; the union is a compile-time type and this Set is what actually refuses, so widening only the type would have made every swept row fail `invalid_tweet_band_i` at draft time — the whole queue under manual-first. (2) **`extension/src/sidepanel/styles.css`** — the chip renders `radar-band-${s.band}`, so a sixth band with no rule paints only the base pill; `.radar-band-sweep` is muted like `.radar-band-roster` (neither is a claim about the tweet) but **dashed**, because the rule that admitted it is one the user can change. Also: there is no `ROSTER_BAND_TITLE` constant to sit beside — the tooltips are inline entries in `BAND_TITLE`, and `sweep` follows that (a named const declared after `BAND_TITLE` would be a TDZ throw at module load).

**Cost note:** $0.

---

## Task 3: manual-first capture in the content script
**Depends on:** Task 1, Task 2
**Session budget:** ~320 lines incl. tests, 5 files. **This is the behaviour change.**

**Read first:**
- codemap header + §5 (`content.ts` row — the `applyBand`/CQ.4/HV.2 paragraphs) + §7.4/7.11/7.24/7.26
- `extension/src/content.ts:2163-2294` (thresholds init, `readTweetSignals`, `isRosterSighting`, `isCannonSighting`, `applyBand`) — **the whole edit lives here**
- `extension/src/content.ts:2725-2775` (`recordRadarSighting`/`flushRadar`) and `:2876-2900` (`initPassiveCaptureSetting` — the key-listener pattern to copy for the sweep state)
- `extension/src/shared/metricsAria.ts` (whole file, 95 lines — `likes` is already parsed and currently discarded)
- `extension/src/shared/notifications.ts` header (the structural-selector discipline for a DOM reader X owns) and `extension/src/shared/userCell.test.ts` (the happy-dom fixture shape)
- `src/shared/radarSweep.ts` as shipped by Task 1

**Edit:**
- `extension/src/shared/verified.ts` — NEW. `readVerified(article: Element): boolean | null` + the exported selector constants.
- `extension/src/shared/verified.test.ts` — NEW, happy-dom fixtures.
- `extension/src/content.ts`:
  - `readTweetCapture(article): { sig: TweetSignals; likes: number } | null` — the ONE aria parse; `readTweetSignals` becomes a two-line wrapper over it so every existing caller is byte-equivalent.
  - rename `initBandThresholds` → `initMirroredConfig`, resolving `bandThresholds`, `cannonCfg` and the new `sweepCfg` from the one `readServerConfig` read and the one listener (it is already documented as "one read and one listener serve both" — this makes it three).
  - `initSweepState()` — module-level `let sweepSession: SweepSession | null`, one `chrome.storage.local.get(SWEEP_STATE_KEY)` + one `onChanged` listener, resolved through `sweepActiveAt` on **every** read so an expired session can never capture.
  - replace `isCannonSighting` with `isCampedSighting(article, sig, glance)` — `sig.ageMin <= sweepCfg.maxAgeMin` → `findPermalink` → `isCannonPerson(entry)`. Delete the `isCannonEligible` capture path (it stays a display rule in `cannonQueue`).
  - `isRosterSighting` takes its age bound from `sweepCfg.maxAgeMin`; **delete `ROSTER_MAX_AGE_MIN`**.
  - `applyBand` — the three-arm block from the Design section. First half (border/dim) and tail (`recordPassiveHarvest`) unchanged.
  - `recordRadarSighting` gains an optional extras arg carrying `likes`/`verified` onto the sighting.
- `extension/src/shared/radar.test.ts` if the extras arg needs a shape assertion.

**How:**
- **Gate order is the perf contract and the review surface.** `applyBand` re-runs on every mutation burst. Order: `sweepActiveAt` (a cached object compare + one `Date.parse`) → the numeric gates → `findPermalink` (the one query `applyPersonChips` already pays) → `readVerified` **only if `sweepNeedsVerified(sweepCfg)`**. Do not hoist the verified read.
- `readVerified` matches **structurally and by an ordered selector list**, not by localized text: `[data-testid="User-Name"] svg[data-testid="icon-verified"]` first, then `[data-testid="User-Name"] svg[aria-label*="erified" i]`. Returns `null` when the `User-Name` block itself is absent (nothing to read — §7.11) and `false` when the block is there and no badge matched. Every structural assumption is a named constant at the top of the file, the `activeTimes.ts` rule: **X owns this markup and it will drift.**
- The verified selector is the one thing in this plan that cannot be proven by a unit test. The fixtures pin the parser; the *selector* is browser-verified (Task 6). The failure mode is chosen to be loud: with `verifiedOnly` on, a drift yields an empty queue, not a silently unfiltered one.
- **Do not gate `recordPassiveHarvest`** on the sweep, and leave the `data-stratus-band` write alone. Put a comment saying so at both sites — this is the first thing a later reader will "tidy up".
- Nothing here writes the sightings buffer directly; capture still goes `recordRadarSighting` → `flushRadar` → background (§7.24).

**Tests:**
- `verified.test.ts` (happy-dom): badge present via `data-testid`, badge present via `aria-label` only, no badge → `false`, no `User-Name` block → `null`, a badge sitting outside the name block (a quoted tweet's author) must **not** count for the outer article.
- `radarSweep.test.ts` (from Task 1) already covers the predicate; add one integration-shaped case here only if the extras plumbing needs it.
- `content.ts` itself stays untested by convention (§5) — the behaviour is proven by Task 6's browser pass.

**Done when:**
- [x] With no `radar:sweep` key, scrolling x.com/home adds zero Radar rows; the border/dim still renders and `/x/harvest/passive` still receives batches ← by construction: every `recordRadarSighting` call in `applyBand` now sits inside `if (cap && sig && sweepIsArmed())`, and `sweepIsArmed()` is false for an absent key; the `data-stratus-band` write and the `recordPassiveHarvest(article)` tail are outside that block, each with a comment saying they must stay outside. **On-page proof is Task 6's browser pass** (`content.ts` is untested by convention, §5).
- [x] With the key set by hand to an active session, only tweets satisfying the filters enter, carrying `'sweep'` (or `hot`/`warm` when the classifier agreed) ← the arm is `passesSweep(candidate, sweepCfg)` (Task 1's suite owns the boundaries) and the band is `band === 'hot' || band === 'warm' ? band : 'sweep'`
- [x] An expired session captures nothing without any timer having fired ← `sweepIsArmed()` re-resolves the stored session through `sweepActiveAt(…, Date.now())` on **every** call; nothing schedules a timer
- [x] `bun test` (2346 server across 124 files + 547 extension across 33) + `bun run typecheck` + `bun run lint` green; `cd extension && bun run build` green
- [x] Committed: `feat(radar): RS.3 manual by default — capture only while the sweep is armed`

**Shipped note (for Task 4's author and Task 6's docs-sync):**
1. **`cannonCfg` is GONE from `content.ts`, not carried into `initMirroredConfig`.** The plan listed it as one of the three blobs the renamed initializer resolves, but after the two edits it prescribes — `isCampedSighting` takes its age bound from `sweepCfg.maxAgeMin`, and the `isCannonEligible` score path is deleted — **nothing on the page reads `x.cannon.*` any more**, so keeping it would have been a mirrored blob with no reader. `initMirroredConfig` resolves `band` + `sweep` from the one read and the one listener; the `CannonThresholds` type import and the `isCannonEligible` value import left `content.ts` with it. The `x.cannon.*` knobs are unaffected — they are the server's `cannonQueue` display rule, which is where CQ.4's score half now lives alone.
2. **The aria-label half of `readVerified` is not locale-proof and a fixture says so.** `svg[aria-label*="erified" i]` covers case, not language: a Romanian "Cont verificat" does not carry the substring. `[data-testid="icon-verified"]` is the load-bearing selector and the fallback only buys a testid rename on an English UI. A test pins the Romanian case as `false` rather than hiding it — under `verifiedOnly` that is a refusal, the direction the whole filter is built to fail in. **Task 6's browser pass is the only thing that can prove the primary selector**, and if it admits nothing at all on a `verifiedOnly: true` scroll, this is the line to look at.
3. **`readVerified` scopes to the FIRST `User-Name` block, not to a descendant selector.** The plan's `[data-testid="User-Name"] svg[data-testid="icon-verified"]` composed against the whole article would match a **quoted tweet's** verified author and vouch for the outer post. Two fixtures pin both directions.
4. **`RADAR_TTL_MS`'s comment in `shared/radar.ts` was stale on arrival** — it justified 24h as "the same 24h `ROSTER_MAX_AGE_MIN` uses", and that constant is deleted here. Rewritten to stand on its own: how long a captured row stays workable is not how fresh a tweet must be to be captured (now `x.sweep.maxAgeMin`, default 60).
5. **`recordRadarSighting`'s extras arg takes `verified?: boolean | null` and omits `null`.** `RadarSighting.verified` is `boolean` under `exactOptionalPropertyTypes`, and "unread badge" is not a claim either way — so the key is built in only for a real `boolean`, and a metric-less re-sighting keeps what an earlier one captured (`mergeSightings`, RS.2). No new assertion was needed in `radar.test.ts`: Task 2's suite already owns that shape.

**Cost note:** $0. Strictly reduces what reaches the batch drafter.

---

## Task 4: the Start/Stop control in the Radar tab
**Depends on:** Task 3
**Session budget:** ~260 lines, 3 files

**Read first:**
- codemap header + §5 (`sidepanel/Radar.tsx` row, `settingsEditor.ts`, `SettingsGear.tsx`)
- `extension/src/sidepanel/Radar.tsx:254-340` (the panel shell + state) and `:640-748` (the `Section actions` block, the tab strip, the `radar-humanize` label — **the sweep row goes directly under the tab strip, above that label**)
- `extension/src/sidepanel/storage.ts` (the panel-writes-chrome.storage.local pattern; the sweep key is written the same way, and §7.24 does not apply — it governs the buffer)
- `extension/src/sidepanel/styles.css:1094-1130` (`.radar-tabs` / `.radar-humanize` — the neighbours to match)

**Edit:**
- `extension/src/sidepanel/Radar.tsx` — a `.radar-sweep` row: the Start/Stop button, a state line, and a **second** `SettingsGear` over the eleven `x.sweep.*` keys off the section's existing `useSettingsEditor` (one editor per tab — do not create a second).
- `extension/src/sidepanel/styles.css` — `.radar-sweep*` rules using `--strat-*` tokens only (§7 design tokens); no new colour literals.
- `extension/src/sidepanel/Radar.tsx` empty-state copy for the Queue view when manual and empty.

**How:**
- State: read `SWEEP_STATE_KEY` on mount + a `chrome.storage.onChanged` listener; resolve through `sweepActiveAt(raw, Date.now())` on every render. While active, a **1 s `setInterval` for the countdown only** — the interval must not be what decides `active`, or a backgrounded panel would keep the row lit past expiry. Clear it on unmount and when the session ends.
- Start writes `startSweepSession(Date.now(), cfg)` using the *current* mirrored `autoStopMin`; Stop removes the key. Both are `chrome.storage.local` writes, optimistic, and the `onChanged` listener is what confirms.
- State line, three shapes: `Manual — only ⊕ pins enter the queue` / `Sweeping · 24m left` / `Sweep ended — nothing new is being captured`. The third renders for `SWEEP_ENDED_NOTICE_MS` (60 s) after an expiry the panel observed, then falls back to the first: an auto-stop the user never saw is the failure the countdown exists to prevent.
- The gear's `note` states the ownership split explicitly, the `GROUP_NOTE` discipline: *these numbers decide what a sweep admits; the twelve Reply-band thresholds in Settings → Tuning still draw the on-page border and still gate a single reply draft, and they no longer decide what enters the queue.* Without that line the band group reads as dead.
- The row renders in **all three views** (the sweep is global) — unlike `radar-humanize`, which is queue-only because it decorates a pick.

**Tests:** no new pure module, so no new suite (the ME.4 precedent). If any date/label helper is extracted, it goes in `radarSweep.ts` with tests there.

**Done when:**
- [x] Start → the row reads `Sweeping · Nm left` and the count decrements; Stop → back to manual; Start again works in the same panel session ← by construction: Start writes `startSweepSession(Date.now(), server.sweep)` to `radar:sweep`, the label is `sweepMinutesLeft(sweep, Date.now())` (new, tested — ceil, floored at 0), the 1 s interval only bumps a tick counter, and Stop `remove`s the key and clears the ended-notice flag so it reads Manual. Nothing about Start is once-per-mount. **Interaction proof is Task 6's browser pass** (`dist/sidepanel.js` carries `Start sweep`/`Stop sweep`, `m left`, the manual and ended lines, and `x.sweep.autoStopMin`; the chunk carries `radar:sweep`, `sweepActiveAt`, `sweepMinutesLeft`, `startSweepSession`).
- [x] Letting the timer run out flips the row to the ended notice without a reload ← `sweeping` is `sweepActiveAt(sweepRaw, Date.now()) !== null` **resolved on every render**, never held in state; the interval exists only to cause those renders, and a no-dep effect records the active→inactive transition into `endedAt`. A throttled panel therefore flips on its next render rather than staying lit — and the notice's own expiry is likewise a render-time comparison, not a trusted timeout.
- [x] The gear edits all eleven knobs and a refused value shows its code on the row (the `useSettingsEditor` path) ← a second `SettingsGear` over `SWEEP_KEYS` (all eleven, `x.sweep.*`) fed by the section's **existing** editor; `GearPopover` already renders `editor.rowErrors[key]` per row. No second `useSettingsEditor` was created.
- [x] `bun test` (2349 server across 124 files + 547 extension across 33) + `bun run typecheck` + `bun run lint` green; `cd extension && bun run build` green
- [x] Committed: `feat(radar): RS.4 start/stop the sweep, with the filters one click away`

**Shipped note (for Task 5's author and Task 6's docs-sync):**
1. **One helper was extracted, exactly as the Tests line allowed: `sweepMinutesLeft(session, nowMs)` in `src/shared/radarSweep.ts`, with its own tests** (suite 2346 → 2349). It rounds **up** — a 30-minute sweep must read "30m left" the instant it is armed, not "29m" — and floors at 0 so an expiry observed between the resolve and the label can never print a negative. It takes a resolved `SweepSession`, not the raw stored value, so a *label* is structurally incapable of being what decides whether a sweep is live. Task 5's chip should read its remaining minutes through this same function.
2. **The ended notice is suppressed for a stop the user pressed.** `stopSweep` clears the `sawSweepActive` ref before removing the key, so only an expiry the panel *watched* produces "Sweep ended". A panel opened *after* an expiry shows plain Manual and no notice — correct, and worth knowing before someone "fixes" it: the notice exists to catch an auto-stop mid-session, not to report history. The stale key is deliberately left in storage rather than cleaned up on mount (both readers resolve at read time, and a write on mount is a write nobody asked for).
3. **Both writes are optimistic with a real rollback, not a fire-and-forget.** A failed `set` puts the row back to Manual; a failed `remove` puts it back to **Sweeping** and says the sweep is still armed — because the page is still capturing, and a row claiming a stop that did not happen is the one lie this control cannot afford.
4. **`.radar-sweep-btn.armed` uses `--strat-ok`, not `--strat-accent`.** It sits one row under `.radar-tab.active`, which is accent-tinted; armed means "a thing is running", not "a tab is selected", and the two must not be confusable at a glance. The ended state is `--strat-warn`, not `--strat-danger`: nothing broke, capture simply did what it was armed to do. No new colour literal — every rule is `--strat-*`.
5. **The Queue empty state is now two states**, because "manual and empty" is the default state of a *working* install while "sweeping and empty" is the sentence that sends you to the ⚙ — and it is the one that surfaces a drifted `readVerified` selector under `verifiedOnly: true` (Task 3's shipped note 2). Never collapse them back into one line.

**Cost note:** $0.

---

## Task 5: on-page — the sweeping chip and a ⊕ that remembers
**Depends on:** Task 3 (Task 4 recommended first so the chip has a producer)
**Session budget:** ~220 lines, 1–2 files

**Read first:**
- codemap header + §5 (`content.ts` — the `attachRadarAddButton`/`onRadarAddClick` RU.8 paragraph, `OVERLAY_TOKENS` UI.16, `makeActButton`/`setActLabel` UI.18)
- `extension/src/content.ts:2777-2864` (the ⊕ button, whole block) and `:3632-3660` (`scan`)
- `extension/src/shared/radar.ts:120-131` (`RADAR_SIGHTINGS_KEY`, `RADAR_TTL_MS`) and `coerceSightings`

**Edit:**
- `extension/src/content.ts`:
  - `syncSweepChip()` called from `scan()` — one `div.stratus-sweep-chip` on `document.body`, `position: fixed`, rendered only while `sweepActiveAt` is truthy, click → removes `SWEEP_STATE_KEY` (stopping the sweep from the page). One `setTimeout` armed at `expiresAt` so the chip disappears on a quiet page without waiting for the next mutation burst.
  - a module-level `queuedIds: Set<string>` fed by one `chrome.storage.local.get(RADAR_SIGHTINGS_KEY)` + an `onChanged` listener, read through `coerceSightings` (**read-only** — the content script must never write the buffer, §7.24).
  - `syncRadarAddStates()` from `scan()` — walks the rendered `.stratus-radar-add` buttons, sets `data-state="queued"` when the article's tweetId is in the set, guarded by a `data-sig` skip so a scan that changes nothing writes no DOM (the `applyPersonChips` discipline).
  - `onRadarAddClick`'s 1.5 s revert calls `syncRadarAddStates()` instead of hard-setting `idle`, so an added tweet settles into `queued` rather than flashing back to empty.
  - CSS for both, inside `injectStyles`, `var(--stratus-*)` only — extend `OVERLAY_TOKENS` if a tone is missing rather than pasting a hex (§7 overlay tokens).

**How:**
- The chip is deliberately small and out of the way (bottom-left is free on x.com at every width; the compose FAB owns bottom-right). It carries the remaining minutes so the page alone answers "how long have I been sweeping".
- `queuedIds` is derived state and can be stale by one flush window — that is fine for an affordance and is **not** a reason to poll. A dismissed row leaves the buffer, so the ⊕ correctly goes back to idle.
- Do not add filter editing, a count badge, or a Start control to the chip. Stopping from the page is one click and reversible; starting from the page would need the filters visible to be honest.

**Tests:** none new (`content.ts` is browser-verified by convention). If a preview/label helper appears, it goes in a `shared/` module with a suite, the `variantChips.ts` precedent.

**Done when:**
- [x] The chip appears on Start, shows the remaining minutes, stops the sweep on click, and disappears at expiry on an idle page ← by construction: the `SWEEP_STATE_KEY` `onChanged` listener now calls `syncSweepChip()` (so a panel Start/Stop lands on the page immediately, not on the next mutation burst), the label is `sweepMinutesLeft(session, now)` through the RS.4 helper, the click `remove`s the key, and one `setTimeout` armed at `expiresAt + 250ms` re-syncs on a quiet page. **Interaction proof is Task 6's browser pass** (`dist/content.js` carries `stratus-sweep-chip` ×3, `Sweeping · `, `m left`, `stratus-sweep-pulse`).
- [x] ⊕ on a queued tweet renders lit after scrolling away and back, and returns to idle when the row is cleared from the panel ← `syncRadarAddStates()` from `scan()` (which is what re-runs on scroll-back) over a read-only `queuedIds` mirror fed by one `chrome.storage.local.get(RADAR_SIGHTINGS_KEY)` + an `onChanged` listener; a dismiss rewrites that key, so the ⊕ returns to idle on the same event. `dist/content.js` carries `radar:sightings` and `Already in the Radar queue`.
- [x] `cd extension && bun run build` green; `bun test` (2349 server across 124 files + 547 extension across 33 — **unchanged, no new suite: `content.ts` is browser-verified by convention and no helper was extracted**) + `bun run typecheck` + `bun run lint` green
- [x] Committed: `feat(radar): RS.5 the sweeping chip and a ⊕ that remembers`

**Shipped note (for Task 6's docs-sync):**
1. **The queued mirror is pruned at READ time, with the panel's own `pruneStale`.** Both existing readers (`background.ts`, `Radar.tsx`) prune what they read; a page that skipped it would light a ⊕ for a row the panel had already aged out, and the two surfaces would disagree about the same buffer. Read-only in both directions — §7.24's single writer is untouched.
2. **The tweetId is re-derived per scan, never cached on the button.** `radarAddHandled` keys off the action ROW, and X recycles rows as it virtualises the timeline, so a remembered id would eventually light the ⊕ on somebody else's post. One extra `findPermalink` per rendered radar button per scan, inside the budget `applyBand`/`applyPersonChips` already pay per article; a `data-sig` skip means an unchanged scan writes no DOM.
3. **`queued` is icon-only** — it joins the `saved`/`added`/`done` lit-face rule but a second rule hides its `ACT_LABEL`, because a standing fact must not widen 20 action rows the way a 1.5 s status report can. The name lives in `title`/`aria-label` (`Already in the Radar queue`).
4. **The 1.5 s revert clears `data-state` *and* `data-sig` before re-syncing.** `syncRadarAddStates` skips buttons reading `added` (so a storage event 200 ms after the click can't cut the confirmation flash short), which means the revert has to release that hold explicitly — otherwise the button would be frozen on its optimistic face until the next id change.
5. **The chip is hot-toned at rest and danger-toned on hover** — armed is "a thing is running" (the same reading RS.4's `--strat-ok` armed button takes), and the hover states what the click does. No new overlay token was needed; every rule is `var(--stratus-*)`. The pulse dot is disabled under `prefers-reduced-motion`.
6. **A failed stop says "still sweeping", it does not vanish.** `chrome.storage.local.remove` rejecting leaves the key — and therefore the capture arm — armed, so the chip re-renders its live countdown rather than reporting a stop that did not happen (RS.4's shipped note 3, on the page side).

**Cost note:** $0.

---

## Task 6 (final): smoke + docs-sync
**Depends on:** all prior.
**Session budget:** ~300 lines, mostly the smoke script

- [ ] `scripts/smoke-radar-sweep.ts` — mounts `settings` + `radar` in-process over the **REAL DB**, **$0, and no `--live` flag — the absence is the finding** (D171c answered a fifth time: nothing on any path in this feature reaches `xFetch` or `askLLM`, so a flag would advertise a paid claim that does not exist; `smoke-own-harvest.ts` is the precedent, `smoke-cannon.ts` is the counter-example). Steps:
  - (a) the registry: the `sweep` group is exactly `keyof SweepConfig`, defaults deep-equal `SWEEP`, all eleven `mirrored`, one out-of-range PATCH refused by code — with **snapshot/restore of any pre-existing override rows** (the `smoke-humanizer.ts` sentinel discipline, so a crashed prior run's values are never adopted as the baseline).
  - (b) `GET /x/settings/values?scope=mirrored` carries all eleven keys — the only end-to-end proof the page will actually receive them.
  - (c) `passesSweep` over a boundary matrix incl. `maxViews: 0` and the `verified: null` refusal.
  - (d) a `radar_drafts` row inserted with `band: 'sweep'`, confirmed, then **read back from the DB** to assert `contextSnapshot.signals.band === null` (RC.5: a best-effort write needs a read-back, not a green call). Cleans up its own rows.
- [ ] `docs/PHASE-HISTORY.md` — the RS phase entry (what shipped, 2026-08-10, $0, the three "looks like a bug" consequences from the Design section).
- [ ] `docs/radar-tab.md` — manual as the default state, Start/Stop, the eleven knobs and what each admits, the chip, the lit ⊕, and the sentence that keeps the band group legible: the twelve `x.band.*` thresholds still draw the border and still gate `/replies/generate`; they no longer decide what enters the queue.
- [ ] `docs/settings-tab.md` — the new `sweep` group in Tuning.
- [ ] `CIRCLES-PLAN.md` — status line (the Radar is C0/C4 territory).
- [ ] `CLAUDE.md` — **only if a guardrail changed.** It did not; leave it. (State that explicitly in the commit body so the next session does not re-check.)
- [ ] `.claude/skills/plan-feature/references/codemap.md` — re-stamp the header and update §3.1 (`src/shared/radarSweep.ts`), §3.3 (registry: **17 groups / 79 knobs / 44 mirrored — recount, do not carry these forward from this plan**), §3.4 (`routes/radar.ts` band unions + `QUEUE_META_BANDS`), §5 (`content.ts` capture arms, `shared/radar.ts` sixth band, `shared/verified.ts`, `serverSettings.ts`, `Radar.tsx`, and **fix the stale "NINE shared files in `include`" sentence — count the array**), §9 (suite counts + the 38th smoke script).
- [ ] **Browser pass, by hand, and it is the only proof of the DOM half** (`content.ts` is untested by convention): on a real x.com/home scroll — manual captures nothing; Start captures only what the filters allow; `verifiedOnly: true` admits a verified author's post and refuses an unverified one *in the same scroll* (this is the selector check — if it admits nothing at all, `readVerified` has drifted); the chip appears and stops the sweep; a queued tweet's ⊕ stays lit after scroll-back; expiry ends capture. Record the result in the phase entry.

## Out of scope (do NOT build)

- **A queue-origin Playbook section.** Named and refused in Decision 10; the SQL in Measurement answers it at $0.
- **Any change to `TweetSignals`.** It is stored inside `radar_drafts.signals` and `reply_drafts.contextSnapshot` and read by the band gate and the timeline funnel. `likes`/`verified` ride on the extension-side sighting only.
- **A band gate on `/replies/generate-batch`.** It has never had one (that is why `manual` pins draft), and adding one would refuse the swept rows this feature exists to produce.
- **Gating the band border/dim or `recordPassiveHarvest` on the sweep.** Both are explicitly out; each has a comment at its site saying why.
- **Filter editing, a start control, or a capture counter on the on-page chip.**
- **Retiring the `x.band.*` group.** Twelve knobs stop deciding admission and keep two other jobs. Deleting them would silently change the on-page border and the single-reply money gate.
- **A `SubTabs` migration of the hand-rolled `.radar-tab` strip.** Refused at CQ.5 for the same reason: a styling rewrite of three existing views does not belong in a commit that adds a control.
- **Server-side sweep state, or any route.** The sweep is a page/panel session; nothing on the server needs to know it happened.

## Risks / watch items

1. **The verified selector is the one unprovable piece.** `[data-testid="icon-verified"]` is X's markup and X owns it; the fixtures pin the parser, not reality. Mitigated by direction — a drift under `verifiedOnly: true` yields a visibly empty queue — and by the Task 6 browser pass, which must see *both* an admit and a refuse in one scroll. If it ever reads `false` universally, the two-selector list is where to look first.
2. **Every default is an opening guess** (§7.19), including the two lifted from `BAND`'s numbers. `minViews: 300` was calibrated for "will my reply be seen", which the monetization pivot says is no longer the currency — the right floor for *follower conversion in adjacent niches* is unmeasured. Recalibrate at **n ≥ 100 swept rows** from the SQL in Measurement, never from a session's impression.
3. **`verifiedOnly` ships OFF against the strategy's own argument.** The pivot says only Premium viewers count; the counter-argument is that a default-ON filter with a drift-prone selector fails silently on day one. Flip it after the browser pass proves the selector, not before.
4. **The queue will get much smaller, and that is the feature.** Expect `Curate & draft` to stop rendering most days (it only appears once the fresh queue outgrows `curatedCount`, default 25). That is correct — curation exists to thin a queue you did not choose. Do not "fix" it by lowering `curatedCount`.
5. **Two `SettingsGear`s in one `Section`** is new for this repo. If it reads cluttered, the resolution is to move the drafting gear into the Section header's overflow, not to merge the two note strings into one unreadable paragraph.
6. **`autoStopMin: 30` is a guess about attention span,** not a measurement. The honest signal that it is wrong is pressing Start more than twice in one sitting.
7. **Rollback, per stage.** Stopping after Task 1 leaves eleven inert knobs; after Task 2, a band value nothing emits — both harmless and shippable. Stopping after Task 3 is the sharp edge: capture is manual-only with **no UI to arm a sweep**, which is a coherent product but a narrower one than intended, so Task 4 should not be left for another day. At runtime, nothing needs a code change to undo: an armed sweep with every `max*` at 0 and every `min*` at 0 admits everything the old classifier-less path would, and deleting the `radar:sweep` key returns to manual instantly.
