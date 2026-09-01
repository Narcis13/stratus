# X ranker port (XR) — the published For You weights as a second, measurable signal

- **Status:** planned 2026-09-02 · not started
- **Goal fit:** Goal 2 (track metrics over time) primarily — it adds an *interpretive* layer over the $0 DOM harvest, and a falsification cell that says whether the layer means anything. Secondarily goal 1 (schedule posts): the Composer gains a pre-publish read grounded in X's own published ranking arithmetic rather than in prose heuristics.
- **Cost impact:** **$0.** No X call, no LLM call, no image call, on any task. Every read is over rows already stored (`harvest_rows`, `voice_tweets`, `chrome.storage.local`). Nothing in this plan can reach `xFetch` or `askLLM`.
- **Invariants touched:** §7.11 (null = unknown — an unobservable head is `null`, never `0`), §7.19 (stats gates n≥20), §7.23a (advisory never refusal), §7.26 (content-script IIFE — zero runtime imports), §7.27 (server/extension shims, never a fork), §7.31 (comments explain why), §7.33 (a ported threshold is validated against OUR corpus before it ships), §7.34 (validate the borrowed METHOD, not just the borrowed number), §8 invariant #1 (URL surcharge is a BILLING fact — the ported `open_link: 0.2` must never be read as license to put a link in post text), §8 invariant #8 (only billed X call is `createPost` — this plan adds no read).
- **Codemap sections relevant:** §3.1 (shared layer + the nine zero-dep siblings), §3.4 (`routes/playbook.ts`, `routes/voice.ts`), §4 (`harvest_rows`, `voice_tweets`; next migration owns **0032**), §5 (extension shims + `tsconfig.app.json` include array, currently twelve), §7.19/§7.26/§7.27/§7.33/§7.34, §9 (tests map).

## Why / what changes for the user

Today the Composer grades a draft with `postCoach` — 29 prose/hygiene rules whose own header concedes writing quality is nearly uncorrelated with impressions. After this plan a second number sits beside it: **C, the ranker score**, computed with X's *published production weights* (`xai-org/x-algorithm`, `home-mixer/params/param.rs`, Aug 13 2026) and a direct port of `ranking_scorer.rs` arithmetic. It answers a different question — not "did I make an own goal" but "what is the For You ranker predisposed to predict from this shape". On x.com, Radar rows gain an **E** chip (the same weights applied to a post's *measured* rates), so a sighting can be read against the ranker rather than against raw likes. And the Playbook gains the cell that decides whether any of it is real: does C, or E, actually separate our own posts by median views?

The honest promise: C ships as **context, never advice**, until that cell has n≥20 per side and a spread. The UI copy says so.

## Design

**Data → pure logic → routes → extension → measurement.**

**Data.** One migration, `0032`, adds four nullable metric columns + one nullable score to `voice_tweets` (`views`, `likes`, `replies`, `reposts`, `ranker_e`) so a swipe-file save can carry what it was scraped with. Nullable = unknown (§7.11); every row written before it stays legal and reads as unscored. No other schema change — own posts and the feed baseline both come out of `harvest_rows`, which already carries `comments`/`reposts`/`likes`/`bookmarks`/`views`.

**Pure logic — two new zero-dep siblings** in `src/shared/`, joining `replyBand`/`cannon`/`radarSweep`/`language`/`humanize`/`postCoach`/`postFormat`/`postCooldown`/`searchQuery`/`judge`:

- `src/shared/xRanker.ts` — **the weight layer and nothing else.** `X_HEADS` (26 published heads, each `{weight, param, provenance, label, observable}`), `X_WEIGHT_SUMS` (built exactly as `ScoringWeights::new` does — note the `cont_*` heads and the mutual boost are *excluded* from `positive_sum`), `NEGATIVE_SCORES_OFFSET = 0.001`, `offsetScore(combined)`, `scoreHeads(headPs) → {raw, combined, contributions}`, `replyWeightFor(ctx)` (5.0 → 20.0 on an original from a mutual), `oonApplies(ctx)`, `diversityMultiplier(k)`, `normalizeScore(raw, baselineRaw)`. Facts only: every constant carries its upstream `param.rs` name.
- `src/shared/xRankerSignals.ts` — **our estimator.** `signalsToHeadPs(...)` maps *our* signal vocabulary (`postCoach` check ids + `postFormat` + a small `DraftFeatures` struct: hasImage/hasVideo/videoSeconds/hasLink/isThreadStarter/isReply/isQuote) onto per-head probabilities. `scoreDraftRanker(text, feats, opts) → {score 0–100, band, contributions, modifiers}` (prospective C) and `scoreMeasured(counts, opts) → {available, score, contributions}` (retrospective E, empirical-Bayes shrunk toward the measured feed rates). Bangermeter's own `contentModifiers` are **not** ported — they are recorded as provenance comments and nothing else (see Decisions).

**Routes.** No new endpoint. `src/x/playbook.ts` gains `buildRankerScoreEffectiveness(rows, minN)` — `buildCoachScoreEffectiveness`'s twin, quartile cells instead of bands — and `src/x/routes/playbook.ts` gains `latestOwnPostRows(selfHandle)` (`latestOwnReplyRows`'s twin over `mode='posts'`) plus one field on the existing `/playbook` response. `src/x/routes/voice.ts::scrapeSave` stamps the new columns when the scrape body carries them.

**Extension.** Two bare re-export shims (`extension/src/xRanker.ts`, `extension/src/xRankerSignals.ts`) → `tsconfig.app.json` `include` goes **twelve → fourteen**. Consumers: `Composer.tsx` (C pill next to the coach pill, `CoachChip.tsx`'s tone vocabulary, no new colour words), `Radar.tsx` (E chip per sighting from `signals.views`/`signals.replies` + `sighting.likes`), `content.ts` (E badge on the swipe-file save affordance, so a hunt on an Outliers search page shows the ranker's reading before you save).

**Measurement.** `buildRankerScoreEffectiveness` over own harvested originals, gated n≥20/side, consumed by `scripts/smoke-x-ranker.ts` rather than by a new panel table (the Playbook panel table is explicitly deferred — see Out of scope). If there is no spread, the number stays context and the smoke script says so in one line.

**Attribution.** Bangermeter is MIT (Copyright (c) 2026 Ryan Lenk). `src/shared/xRanker.ts` carries the copyright + MIT permission notice in its header, and `docs/PHASE-HISTORY.md` names the source. The weight *values* are X's published facts and unprotectable; the arithmetic port is theirs and is credited.

## Decisions taken

1. **Weight layer ported verbatim; estimator layer re-derived from our signals.** (User answer.) Their `contentModifiers` (question ×1.4, bare link ×0.85, bait ×3.0…) overlap `postCoach`'s 29 rules, and shipping both would put two rule vocabularies on one sentence — the exact fork `CoachChip.tsx` and §7.27 exist to prevent. So `xRankerSignals.ts` reads `postCoach` check ids and `postFormat`, and their modifier table survives only as a provenance comment naming what we chose differently and why.
2. **Two numbers in the Composer is intended, and the copy must earn it.** Coach = own-goal floor (prose facts). C = the ranker's predisposition (published weights over estimated probabilities). They answer different questions; the pill labels and the disclaimer say which is which. Neither may sort, gate, block or refuse (§7.23a, SC decision 4).
3. **The falsification cell is not optional and is not last.** (User answer.) §7.33/§7.34 doctrine: a ported number is validated on our corpus before it ships. Task XR.3 recalibrates the feed baseline against our own passive-harvest rows; XR.4 ships the cell. Neither is deferred behind the UI.
4. **Our own baseline, their priors.** `X_OBSERVED_RATES` (the E-score's reference — what a typical *post* does per view) is **measured from our `harvest_rows`** and stamped with sample size + date, replacing Bangermeter's 158-post Aug-13 sample. `X_BASELINE_P` (the C-score's signal-free priors) stays their estimate set, labeled `provenance: 'bangermeter-estimate'` — a measured median is the rate of a typical post *including* whatever signals it carries, so using it as the signal-free base double-counts the average signal. Two numbers, two questions, never merged.
5. **Modifier magnitudes are opening guesses, stated as such.** How far a `postCoach` check moves a head's P is unmeasured. Every one ships as a named constant with `provenance: 'estimate'` and a recalibration trigger (≥100 measured originals), per CLAUDE.md's thresholds rule. The Playbook cell is what will eventually move them; nothing moves them by vibes.
6. **Own-post outcomes come from `harvest_rows`, not `metrics_snapshots`.** Every existing Playbook own-originals cell reads `latestOutcomes` over `metrics_snapshots`, which has been **frozen since 2026-08-12** (invariant #8) and carries no reply/repost counts anyway. The E-score needs likes+replies+reposts+views, which is exactly the `harvest_rows` column set. A new loader, not a widened old one.
7. **Voice/Outliers is served on-page, not in the panel.** `voice_tweets` carries no metrics today and the Outliers tab is a *query compiler* whose results live on x.com — there is no local result list to badge. The surface that actually serves "rank a hunted post by the ranker's arithmetic" is the content script at the save moment, plus the new nullable columns so the reading is kept. This is a widening of the user's "Outliers / Voice rows" answer into the only place it can honestly land, and it is stated here rather than silently narrowed.
8. **`open_link: 0.2` is a reach fact, not a billing fact.** The port proves links are not structurally punished by the ranker. Invariant #1 is about the **$0.20 vs $0.015 API surcharge** and is untouched. `xRankerSignals.ts` carries a comment saying exactly this, because the two facts will otherwise be conflated by the next reader.
9. **Radar's E chip is reported with its own caveat.** `OONRetweetReplyFilter` removes out-of-network replies from For You entirely, so a *reply's* ranker score is close to meaningless. The chip scores the **sighting** (the post being replied to), never the drafted reply, and the tooltip says why.

## Done when

1. `src/shared/xRanker.ts` reproduces `ranking_scorer.rs`: all 26 published weights asserted individually against their `param.rs` parameter names, `offsetScore` squashing any net-negative sum into `[0, 0.000894)`, and `diversityMultiplier(1) === 0.625` / `(2) === 0.4375`.
2. `X_OBSERVED_RATES` carries measured per-post median rates derived from our own `harvest_rows`, stamped with `n`, the mode it came from, and the date — not Bangermeter's sample.
3. Typing a draft in the Composer shows a **C** pill beside the coach pill, computed locally with no fetch per keystroke, and the two never claim to measure the same thing.
4. `GET /x/playbook` returns `rankerScoreEffectiveness` with quartile cells, `sufficient:false` below n≥20, and `spread: null` unless two distinct quartiles clear the gate.
5. `bun scripts/smoke-x-ranker.ts` runs $0, prints the quartile table and one verdict line ("spread N.NNx over n=… / no measurable spread — C stays context"), and cleans up after itself.
6. Browser check: on a Radar queue with sightings, each row shows an **E** chip; on an x.com search page, the swipe-file save affordance shows the post's E reading before saving.

---

## Task XR.1: port the weight layer and the scorer arithmetic  [parallel-ok]
**Depends on:** none
**Session budget:** ~350 lines (module ~200, tests ~150), 3 files

**Read first:**
- codemap header + §3.1 (the zero-dep sibling table) and §7.26/§7.27
- `src/shared/language.ts` — the purest sibling; copy its header discipline (why it is dependency-free, what breaks if an import lands)
- `/Users/narcisbrindusescu/Downloads/bangermeter-main/extension/weights.js` lines 62–200 (the `heads` table, `weightSumMembers`, `rescorers`) and 435–447 (the derived-sums IIFE)
- `/Users/narcisbrindusescu/Downloads/bangermeter-main/extension/scoring.js` lines 380–460 (`replyWeightFor`, `oonApplies`, `diversityMultiplier`, `offsetScore`, `weightedScore`, `normalize`)
- `/Users/narcisbrindusescu/Downloads/bangermeter-main/LICENSE`

**Edit:**
- `src/shared/xRanker.ts` (NEW) — weight layer + arithmetic, pure, zero runtime imports
- `src/shared/xRanker.test.ts` (NEW) — the transcription and arithmetic suite
- nothing else

**How:**
- **Zero imports, value or type** (§7.26) — this file will be inlined into the content IIFE at XR.7. Header comment must say so, in `language.ts`'s voice.
- Header carries the MIT notice: `Ported from Bangermeter (MIT, Copyright (c) 2026 Ryan Lenk) — weights.js + scoring.js. Weight VALUES are X's published production parameters (xai-org/x-algorithm, home-mixer/params/param.rs, sync stamp 2026-08-12T04:09:22Z); the arithmetic is a port of ranking_scorer.rs.`
- Shape (TypeScript, `exactOptionalPropertyTypes` is on):
  ```ts
  export interface XHead { weight: number; param: string; provenance: 'published' | 'config'; label: string; observable: boolean; continuous?: boolean; note?: string }
  export const X_HEADS: Record<XHeadName, XHead>
  export const X_WEIGHT_SUMS: { positive: number; negative: number; total: number }
  export const BIDIRECTIONAL_FOLLOW_REPLY_BOOST = 15.0
  export const NEGATIVE_SCORES_OFFSET = 0.001
  export const OON_WEIGHT_FACTOR = 0.75
  export const AUTHOR_DIVERSITY = { decay: 0.5, floor: 0.25 }
  export function offsetScore(combined: number): number
  export function scoreHeads(headPs: Partial<Record<XHeadName, number | null>>, weights?): {...}
  export function replyWeightFor(ctx: { isMutualFollow?: boolean; isReply?: boolean; isRepost?: boolean }): number
  export function oonApplies(ctx: { inNetwork?: boolean; isReply?: boolean; isRepost?: boolean }): boolean
  export function diversityMultiplier(k: number): number
  export function normalizeScore(raw: number, baselineRaw: number): number
  ```
- **Port the traps, not just the numbers.** Four are load-bearing and each earns a `why` comment (§7.31):
  1. `X_WEIGHT_SUMS` is built from `weightSumMembers`, which **excludes** the `cont_*` heads and the mutual boost — that subset only matters on the negative branch, and getting it wrong silently changes every net-negative post's score.
  2. `scoreHeads` splits terms by the **sign of the term**, not the sign of the weight.
  3. `offsetScore` is bit-faithful, so the deepest negative can land a hair below zero; the `raw > 0` guard belongs in `normalizeScore` (the display boundary), never inside the arithmetic. `Math.pow` of a negative base at a fractional exponent is `NaN`.
  4. `oonApplies` is a **boolean gate** — the 0.75 factor lands exactly once, never squared, and it fires for in-network replies and reposts too (`EnableOonRescoreForInNetworkRepliesRetweets` defaults true).
- **A head with no probability is `null`, never `0`** (§7.11) — `scoreHeads` skips it and it does not appear in `contributions`.
- Ship the five explicitly-zeroed heads (`profile_click`, `dwell`, `quoted_vqv`, `cont_click_dwell_time`, `cont_active_secs_5m_residual_norm`) with `weight: 0` and their notes. They are a finding, not an omission.
- Do **not** port: `blueVerified` (2023-archived), `communityNote` (studies-derived, not an X parameter), `underTheHood`, `ageDecay`, the locale tables, `contentModifiers`, `baselineP`, `observedRates`. The last two arrive in XR.2/XR.3 as ours.
- Do **not** add a settings-registry knob for any of these. They are transcribed facts, not tunables (`language.ts`'s rule: the config arrives as an argument, and here there is no config).

**Tests:** `src/shared/xRanker.test.ts`
- Every one of the 26 heads asserted **individually** — `weight` AND `param` string — so a silent transcription slip fails the suite rather than shipping (their 228-test discipline, and the reason it exists).
- `X_WEIGHT_SUMS.positive` / `.negative` / `.total` against hand-computed values; a test asserting `cont_dwell_time` and the mutual boost are **absent** from the members list.
- `offsetScore(0.4) === 0.401`; a net-negative combined lands in `(0, 0.000894)` and strictly below `offsetScore(0)`.
- `diversityMultiplier(0) === 1`, `(1) === 0.625`, `(2) === 0.4375`, and `(k→∞)` approaches `0.25`.
- `replyWeightFor`: 5.0 by default; 20.0 only when `isMutualFollow && !isReply && !isRepost`; 5.0 for a mutual's reply and a mutual's repost.
- `oonApplies`: true out-of-network; true for an in-network reply; true for an in-network repost; false for an in-network original.
- `scoreHeads` with a `null` p omits the head from `contributions` and from both sums; contributions sort by `|contribution|` descending.
- `normalizeScore` returns `0` (not `NaN`) for a non-positive raw or baseline.

**Done when:**
- [ ] All 26 weights + param names asserted individually and green
- [ ] `grep -c "^import" src/shared/xRanker.ts` returns `0`
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(ranker): port X's published For You weights + ranking_scorer arithmetic (XR.1)`

**Cost note:** $0 — a pure module with no I/O.

---

## Task XR.2: map our signals onto heads — the C and E scores
**Depends on:** XR.1
**Session budget:** ~380 lines (module ~220, tests ~160), 3 files

**Read first:**
- `src/shared/xRanker.ts` (XR.1's output) — the whole file
- `src/shared/postCoach.ts` lines 1–60 and the `CoachCheck` id list (grep `id: '` in that file) — the signal vocabulary you are mapping FROM
- `src/shared/postFormat.ts` — `PostFormat` union + `POST_FORMATS` cascade
- `/Users/narcisbrindusescu/Downloads/bangermeter-main/extension/weights.js` lines 328–420 (`baselineP`, `engagementShrinkage`, `contentModifiers`, `display`) — for the priors and the shrinkage formula ONLY; the modifier table is reference, not source
- `/Users/narcisbrindusescu/Downloads/bangermeter-main/extension/scoring.js` lines 516–600 (`engagementScore`) and 693–790 (`vqvEligible`, `contentScore`)

**Edit:**
- `src/shared/xRankerSignals.ts` (NEW) — our estimator layer
- `src/shared/xRankerSignals.test.ts` (NEW)
- nothing else

**How:**
- Same zero-import contract as XR.1, with **one exception permitted**: `import type` from `./xRanker.ts`, `./postCoach.ts`, `./postFormat.ts` (erased under `verbatimModuleSyntax`) plus the **value** imports from `./xRanker.ts` and `./postFormat.ts`. `cannon.ts` is the precedent for a shared module importing a sibling; both siblings inline together into the IIFE, so this stays legal. **Never** import from `src/x/*` or `src/db/*`.
- Two exported entry points:
  ```ts
  export interface DraftFeatures { hasImage?: boolean; hasVideo?: boolean; videoSeconds?: number | null; hasExternalLink?: boolean; isThreadStarter?: boolean; isReply?: boolean; isQuote?: boolean; isMutualFollow?: boolean; assumeOutOfNetwork?: boolean }
  export function scoreDraftRanker(text: string, feats?: DraftFeatures, opts?: { coach?: CoachResult; lexicon?: CoachLexicon }): RankerDraftResult
  export function scoreMeasured(counts: { likes: number|null; replies: number|null; reposts: number|null; views: number|null }, feats?: DraftFeatures): RankerMeasuredResult
  ```
- **`scoreDraftRanker` accepts a `CoachResult` rather than recomputing it.** The Composer already runs `scoreDraft` on the debounced text; passing it in is what guarantees the two pills grade the same evaluation. When `opts.coach` is absent, call `scoreDraft(text, { lexicon })` internally so a non-Composer caller still works.
- **The mapping is the whole task.** Build `X_MODIFIERS`: an array of `{ id, label, from, applies, factor, provenance: 'estimate', why }` where `from` names a `postCoach` check id (or a `postFormat` value, or a `DraftFeatures` flag) and `applies` names the heads it moves. Anchor each factor on the weight it is exploiting, not on a hunch — e.g. the `question` format moves `reply` and `quote` because both are 5.0, ten times a like; substantive length moves `cont_dwell_time` **up** and `not_dwelled` **down** because at 0.004/sec and −0.02 those are the largest pair of terms an ordinary post carries. Every `why` states the head and its weight.
- **Enable-only heads:** `open_link` scores only with a link, `photo_expand` only with an image, `video_open` only with video, `vqv` only when `videoSeconds > 10` **strictly** (`MIN_VIDEO_DURATION_MS = 10_000`; a 10.000s clip and every GIF earn nothing), `quoted_click` only on a quote. Absent feature ⇒ `null`, not `0` (§7.11).
- **`scoreMeasured`** is the E score: only `favorite`/`reply`/`retweet` are observable, shrunk toward the measured baseline as `p̂ = (count + K·p₀) / (views + K)` with `K = ENGAGEMENT_SHRINKAGE_PSEUDO_VIEWS = 2000`. Returns `{ available: false, reason }` when `views` is null or ≤ 0 — a missing view count is unknown, never a zero-rate post. Compare against a fixed baseline computed at the **base** reply weight with no rescoring, so a mutual-follow post scoring above it is the finding.
- `X_BASELINE_P` ships as their estimate set with `provenance: 'bangermeter-estimate'` and the comment from Decision 4 explaining why it is deliberately NOT the measured median. `X_OBSERVED_RATES` ships in this task as a **placeholder marked `provenance: 'imported-unvalidated'` with a TODO naming XR.3** — XR.3 replaces it with ours in the same shape.
- Carry Decision 8's comment on the `open_link` mapping verbatim in spirit: links are not punished by the ranker; invariant #1 is a billing rule and is untouched.
- Band cut points reuse the score→level shape, but **do not** reuse `CoachBand` names — the C score is a different scale and sharing a vocabulary would invite the two pills to be read as one. Use `RankerBand = 'below' | 'typical' | 'strong'` cut at 40/65 (their `scoreLevel`), `provenance: 'estimate'`.

**Tests:** `src/shared/xRankerSignals.test.ts`
- A signal-free 100-char post scores near the display midpoint (50 ± a stated tolerance) — the calibration anchor the whole scale rests on.
- Each modifier moves the score in its declared direction, asserted one at a time over a fixture that isolates it.
- Enable-only heads: a video at 9s scores no `vqv` and a video at 11s does; a GIF (video with `videoSeconds: null`) scores no `vqv`; a post with no link has `open_link` absent from `contributions`, not zero.
- `isReply: true` takes the ×0.75 factor exactly once (assert against the same draft scored as an original: ratio is 0.75, not 0.5625).
- `scoreMeasured` returns `available: false` with a reason for `views: null` and for `views: 0`.
- `scoreMeasured` shrinkage: a 1-like/10-view post scores below a 100-like/1000-view post despite the higher raw rate.
- A post whose only signals are negative (bait + all-caps at their mapped heads) goes net-negative and normalizes to `0` — the "below every positive post" branch, end to end.

**Done when:**
- [ ] Every `X_MODIFIERS` entry names a `postCoach` check id or `postFormat` value in `from`, and no entry is a transcription of Bangermeter's `contentModifiers`
- [ ] `X_OBSERVED_RATES` is marked `imported-unvalidated` with a TODO naming XR.3
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(ranker): map postCoach/postFormat signals onto ranker heads (XR.2)`

**Cost note:** $0 — pure, no I/O.

---

## Task XR.3: calibrate the feed baseline against our own corpus
**Depends on:** XR.2
**Session budget:** ~200 lines (script ~120, module edit ~40, tests ~40), 3 files

**Read first:**
- codemap §7.33 (a ported threshold is validated against OUR corpus) and §7.34 (validate the borrowed METHOD)
- `src/shared/xRankerSignals.ts` — the `X_OBSERVED_RATES` placeholder
- `src/x/routes/playbook.ts` lines 452–500 (`PASSIVE_HARVEST_MODE = 'timeline'` and the passive-harvest dedup query) — the exemplar for reading the feed corpus
- `/Users/narcisbrindusescu/Downloads/bangermeter-main/calibration/calibrate.js` — the method being validated
- `/Users/narcisbrindusescu/Downloads/bangermeter-main/extension/weights.js` lines 296–328 — the sample caveats that must have twins here
- an existing $0 script for the shape, e.g. any `scripts/smoke-*.ts` with a DB read

**Edit:**
- `scripts/calibrate-ranker.ts` (NEW) — reads `harvest_rows`, prints the constants to paste
- `src/shared/xRankerSignals.ts` — replace `X_OBSERVED_RATES` with the measured set
- `src/shared/xRankerSignals.test.ts` — add the provenance assertions

**How:**
- The script reads `harvest_rows` where `mode = 'timeline'` (the passive harvest of the Home Timeline — our analogue of their feed sample), **deduped to one row per `tweet_id`** (`min(captured_at)`, matching the passive-harvest reader at `routes/playbook.ts:469`) and filtered to `views > 0`.
- **Per-post MEDIAN rate, never pooled.** Pooled (`Σevents / Σviews`) answers "what does a random impression see" and a handful of viral posts dominate it; the score compares one post against a reference *post*. This is §7.34 in miniature — the method is the thing being ported, and the wrong one is a plausible-looking mistake.
- **Apply the maturity cut.** Drop rows whose `tweet_time` is within `MATURITY_HOURS = 48` of the **newest post in the sample**, not of `Date.now()` — a young post is still accruing views, reads ~1.4× high, and clocking against `now` makes the same corpus produce a different answer next week. Report how many were dropped.
- Emit `favorite`, `reply`, `retweet` medians plus `n`, the mode, and the collection date range. If `n < 100`, the script **refuses to emit constants** and says so: below that the medians are noise and the imported set is the more honest placeholder. Print what `n` currently is either way.
- Paste the result into `X_OBSERVED_RATES` with `provenance: 'measured'`, `n`, `source: "harvest_rows mode='timeline'"`, `collected: '<range>'`, and a caveat block that is *ours*, not theirs: one account, our niche, our follower mix; these are not population constants for X.
- If the corpus is under 100 rows today, **leave the imported set in place, change only its provenance label to `'imported-pending-calibration'`, and record the shortfall in the plan's risk list + the smoke script's verdict line.** Shipping a fabricated median would be exactly the failure §7.33 exists to prevent; shipping a labeled import is not.
- The script is rerunnable and read-only (`SELECT` only, no writes, no cleanup needed because it creates nothing).

**Tests:** `src/shared/xRankerSignals.test.ts` additions
- `X_OBSERVED_RATES.provenance` is one of `'measured' | 'imported-pending-calibration'` — never `'imported-unvalidated'` after this task
- when `provenance === 'measured'`, `n >= 100` and `source`/`collected` are non-empty (the assertion that makes the refusal rule enforceable)
- the three rates are all in `(0, 1)`

**Done when:**
- [ ] `bun scripts/calibrate-ranker.ts` runs $0, prints the median table with `n` and the maturity-drop count
- [ ] `X_OBSERVED_RATES` carries either measured values with `n ≥ 100`, or the import with `provenance: 'imported-pending-calibration'` — never an unlabeled number
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(ranker): calibrate the E-score baseline against our own harvest corpus (XR.3)`

**Cost note:** $0 — `SELECT` over `harvest_rows`; nothing on this path can reach `xFetch`.

---

## Task XR.4: the falsification cell — does the score predict our views?
**Depends on:** XR.3
**Session budget:** ~330 lines (playbook ~110, loader ~70, wiring ~20, tests ~130), 4 files

**Read first:**
- `src/x/playbook.ts` lines 905–1005 (`buildCoachScoreEffectiveness` + its header) — the twin you are writing, including *why* the bands are not re-cut locally
- `src/x/playbook.ts` lines 20–70 (`OutcomeCell`, `cellOf`, `median`, `ratio`, `DEFAULT_MIN_CELL_N`) — reuse all of it, add none of it
- `src/x/routes/playbook.ts` lines 545–615 (`latestOwnReplyRows`) — the loader exemplar, especially the dedup and the "window on tweet_time, never captured_at" rule
- `src/x/routes/playbook.ts` lines 790–840 (where the response object is assembled)
- codemap §7.19 (gates), §4 (`harvest_rows` columns)

**Edit:**
- `src/x/playbook.ts` — `RankerScoreCell`, `RankerScoreEffectiveness`, `buildRankerScoreEffectiveness`
- `src/x/routes/playbook.ts` — `latestOwnPostRows(selfHandle)` + one field on the `/playbook` response
- `src/x/playbook.test.ts` — the pure suite
- `src/x/routes/playbook.test.ts` — the route/loader suite

**How:**
- **Population: own harvested ORIGINALS.** `latestOwnPostRows(selfHandle)` is `latestOwnReplyRows`'s twin — `mode = 'posts'`, `handle = normalizeSelfHandle(selfHandle)`, `groupBy(tweetId)` with `max(captured_at)` (latest reading wins for a *published* post's final counts, unlike the passive feed's first-seen). Select `text`, `views`, `likes`, `comments`, `reposts`, `tweetTime`. **Do NOT** widen `loadOriginalPostRows` — it reads `metrics_snapshots`, frozen since 2026-08-12 and carrying no reply/repost counts (Decision 6). Say that in the loader's header.
- `buildRankerScoreEffectiveness(rows, minN = DEFAULT_MIN_CELL_N)` returns:
  ```ts
  { cells: RankerScoreCell[];        // quartiles of the E score, worst→best
    totalPosted: number; totalMeasured: number;
    spread: number | null;           // median views high ÷ low, gated both sides
    spreadQuartiles: { high: number; low: number } | null;
    contentCells: RankerScoreCell[]; // the same rows scored PROSPECTIVELY (C)
    contentSpread: number | null; }
  ```
- **Report C and E separately and never average them.** E is computed from the row's own counts, so "high E ⇒ high views" is partly circular (views is E's denominator, and rate falls as reach rises). C is computed from text alone and is the non-circular question. Both cells ship; the header comment states which one is evidence and which one is a sanity check, in `buildCoachScoreEffectiveness`'s voice.
- Quartile cut points come from the sample itself (`q(scores, .25/.5/.75)`), recomputed per call, and the cell carries its own `[lo, hi]` range so a reader can see what a quartile meant on this corpus. With fewer than 4 distinct scores, emit fewer cells rather than empty ones.
- `spread` is `null` unless **two distinct quartiles each clear `minN`** — and name which two, because on a small corpus the comparison is rarely top-vs-bottom (the `spreadBands` discipline, copied deliberately).
- Wire into the `/playbook` response as `rankerScoreEffectiveness`, beside `coachScoreEffectiveness`, using `getSetting<number>('x.gates.minCellN')` like its neighbours. `selfHandle` comes from the same place `latestOwnReplyRows`'s callers get it.
- Nothing renders it yet (panel table deferred — see Out of scope). The smoke script in XR.8 is its consumer.

**Tests:**
- `src/x/playbook.test.ts`: quartiles partition the rows; a below-gate cell reports `sufficient: false` with a non-null median but a `null` contribution to `spread`; `spread` is `null` when only one quartile clears; `spread` names its pair; an all-null-outcome corpus returns `totalMeasured: 0` and every spread `null`; fewer than 4 distinct scores emits fewer cells and does not throw.
- `src/x/routes/playbook.test.ts`: `latestOwnPostRows` dedups multiple captures of one `tweet_id` to the latest; excludes `mode='replies'` and `mode='timeline'` rows; excludes another handle's rows; returns `[]` for an empty/blank `selfHandle` (the `normalizeSelfHandle` guard); the `/playbook` response carries `rankerScoreEffectiveness`.

**Done when:**
- [ ] `GET /x/playbook` returns `rankerScoreEffectiveness` with gated cells
- [ ] `latestOwnPostRows` reads `harvest_rows`, never `metrics_snapshots`, and its header says why
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(playbook): does the ranker score predict our views? gated quartile cell (XR.4)`

**Cost note:** $0 — two indexed reads over rows already stored.

---

## Task XR.5: shims + the Composer's C pill
**Depends on:** XR.2 (not XR.4 — the Composer needs the score, not the cell)
**Session budget:** ~250 lines, 6 files

**Read first:**
- codemap §5 (the shim rule + the twelve-entry `include` array) and §7.27
- `extension/src/searchQuery.ts` — the bare 4-line re-export shape to copy
- `extension/tsconfig.app.json` — the `include` array
- `extension/src/sidepanel/Composer.tsx` lines 820–880 (the coach block: `coachInput`, `useCoachLexicon`, `scoreDraft`, `coachFixes`) and the JSX that renders the coach pill (grep `COACH_BAND_TONE`)
- `extension/src/sidepanel/CoachChip.tsx` — `COACH_TONE` / `COACH_BAND_TONE`, the panel's one coach colour vocabulary
- `extension/src/sidepanel/styles.css` — the `--strat-*` tokens and `.chip` taxonomy (§UI.14: one chip shape, five tone modifiers)

**Edit:**
- `extension/src/xRanker.ts` (NEW) — bare re-export shim
- `extension/src/xRankerSignals.ts` (NEW) — bare re-export shim
- `extension/tsconfig.app.json` — `include` twelve → **fourteen**
- `extension/src/sidepanel/Composer.tsx` — compute + render the C pill
- `extension/src/sidepanel/CoachChip.tsx` — `RANKER_BAND_TONE` (band → existing tone), nothing else
- `extension/src/sidepanel/styles.css` — only if a token-composed rule is genuinely missing; **no colour literal outside `:root`** (§UI.8)

**How:**
- Shims are bare re-exports (`export * from '../../src/shared/xRanker.ts';`) at the **top level** of `extension/src/`, not under `shared/` — `radarSweep.ts` and `searchQuery.ts` are the precedent.
- Compute alongside the existing coach memo, off the **same debounced `coachInput` and the same `coach` result** — passing `coach` into `scoreDraftRanker` is what stops the two pills from grading different evaluations:
  ```ts
  const ranker = useMemo(() => scoreDraftRanker(coachInput, draftFeats, { coach }), [coachInput, coach, draftFeats]);
  ```
  `draftFeats` is derived from what the Composer already knows (image attached, thread mode ⇒ `isThreadStarter`, link present in text). Do **not** add a fetch, a debounce of its own, or a stored field — the score is recomputed from text everywhere, never stamped (SC decision 2).
- Render as a second pill next to the coach pill, reusing `.chip` + a tone from `CoachChip.tsx`'s vocabulary through a new `RANKER_BAND_TONE` map. **No new colour class, no new chip shape** (§UI.14).
- Copy discipline (Decision 2): the pill reads `C 58` with a title/tooltip that says, in one sentence, that it is X's published For You weights over estimated probabilities, that 50 is a typical post, and that it is a relative read, **not** an impression forecast. Somewhere in the coach column, one line distinguishes the two numbers: the coach catches own goals, C reads the ranker's predisposition.
- **Advisory only** (§7.23a): no disabled state, no confirm, no reordering of anything by C.
- Verify the shared modules actually inlined: `cd extension && bun run build`, then `grep -c 'rust_home_mixer_favorite_weight' dist/sidepanel.js` returns ≥1 (the `min_faves` check at OU.5 is the precedent).

**Tests:**
- `extension/src/sidepanel/composerLogic.test.ts` (or a new `rankerPill.test.ts` if the logic lands in a helper): the feature-derivation function maps a Composer state with an attached image to `hasImage: true`, thread mode to `isThreadStarter: true`, and a bare-URL draft to `hasExternalLink: true`.
- `CoachChip.test.ts`: `RANKER_BAND_TONE` maps all three bands to tones that exist in `COACH_TONE`'s class set — no orphan class.

**Done when:**
- [ ] Typing in the Composer updates the C pill with no network request (verify in devtools Network: zero new requests per keystroke)
- [ ] `grep -c 'rust_home_mixer_favorite_weight' extension/dist/sidepanel.js` ≥ 1
- [ ] `bun test` + `bun run typecheck` + `bun run lint` + `cd extension && bun run build` green
- [ ] Committed: `feat(composer): ranker C score beside the coach pill (XR.5)`

**Cost note:** $0 — local computation, no fetch.

---

## Task XR.6: E chip on Radar sightings
**Depends on:** XR.5 (needs the shims)
**Session budget:** ~180 lines, 4 files

**Read first:**
- `extension/src/shared/radar.ts` lines 60–130 (the `Sighting` shape — `likes?`, `verified?`, and what `signals` carries)
- `src/shared/replyBand.ts` lines 25–45 (`TweetSignals`: `views`, `replies`, `ageMin`, `vpm`, `bait`)
- `extension/src/sidepanel/Radar.tsx` — the queue row render (grep `.radar-` class names) and where `personTier` / existing chips are drawn
- codemap §7.24 (background is the single session-storage writer) and §UI.14 (chip taxonomy)

**Edit:**
- `extension/src/sidepanel/Radar.tsx` — compute + render the E chip per row
- `extension/src/shared/radar.ts` — only if a pure helper belongs there; prefer computing in the panel
- `extension/src/shared/radar.test.ts` — if a helper lands
- `extension/src/sidepanel/styles.css` — only if a token-composed rule is missing

**How:**
- Score the **sighting** — the post being replied to — never the drafted reply (Decision 9). Inputs available with no new wire and no migration: `signals.views`, `signals.replies`, `sighting.likes`. `reposts` is not captured ⇒ pass `null`; `scoreHeads` skips it (§7.11), which is precisely why the null-vs-zero rule in XR.1 is load-bearing here.
- `scoreMeasured` returns `{available: false}` when views are missing — **render nothing** in that case, not a zero and not a dash-with-a-tooltip. A queue row that shows `E 0` for "we didn't capture views" is a lie the reader will act on.
- The chip is **read-only against the buffer**: the panel computes it at render time and writes nothing. Do not stamp it onto the sighting — a stored score would go stale on re-sighting and would need a merge rule in `mergeSightings` that nothing needs (§7.24, and the `pastePace` precedent of "the stored ms is the truth, `Date.now()` is the clock").
- Tooltip carries the caveat: this scores the post you would be replying to. An out-of-network **reply** is removed from For You outright by `OONRetweetReplyFilter`, so a reply's own ranker score is close to meaningless — that is why the chip is on the target and not on the draft.
- Reuse `.chip` + an existing tone (§UI.14). No new class with its own padding and radius.

**Tests:** `extension/src/shared/radar.test.ts` (if a helper lands) or a small pure test beside it
- a sighting with `signals.views > 0` and `likes` yields a numeric score
- a sighting with `signals.views === 0` yields `available: false`
- a sighting missing `likes` still scores (reply + view rate alone), and `favorite` is absent from `contributions`

**Done when:**
- [ ] Radar queue rows with captured views show an E chip; rows without views show none
- [ ] Nothing writes to `chrome.storage.local` as a result of rendering the chip
- [ ] `bun test` + `bun run typecheck` + `bun run lint` + `cd extension && bun run build` green
- [ ] Committed: `feat(radar): ranker E chip on sightings that carry views (XR.6)`

**Cost note:** $0 — reads the existing buffer, no fetch.

---

## Task XR.7: keep the reading on a swipe-file save (migration 0032 + on-page badge)
**Depends on:** XR.5
**Session budget:** ~330 lines, 6 files — **split into 7a/7b if the session strains**
**Migration:** owns **`0032`**. Do not run this task in parallel with any other migration-generating work (journal conflicts).

**Read first:**
- codemap §4 (`voice_tweets` columns, migration head `0031_sharp_screwball`) and the CLAUDE.md migration rule (`bun run db:generate`, then **inspect the emitted SQL** — drizzle-kit drops seed INSERTs)
- `src/x/db/schema.ts` lines 303–330 (`voiceTweets`)
- `src/x/routes/voice.ts` — `scrapeSave` and its request-body parse (§7.16: the client reports an OBSERVATION, the server decides the MEANING)
- `extension/src/content.ts` — `OVERLAY_TOKENS` (top of file) and the swipe-file save affordance (grep for the voice/save handler); `readTweetCapture`
- `extension/src/harvester.ts` — `extractArticle(art)` and `interface Extracted`, the ONE DOM reader (HV.2)
- codemap §7.26 (IIFE), §7.11 (null = unknown)

**Edit:**
- `src/x/db/schema.ts` — five nullable columns on `voiceTweets`
- `src/db/migrations/0032_*.sql` (generated, then inspected)
- `src/x/routes/voice.ts` — accept + persist the metrics on `scrapeSave`, compute `rankerE` server-side
- `extension/src/content.ts` — read metrics off the article, show the E badge, send them with the save
- `src/x/routes/voice.test.ts` — the route half
- `docs/voice-tab.md` — noted in XR.8's docs-sync, not here

**How:**
- Columns: `views`, `likes`, `replies`, `reposts` (`integer`, nullable) + `ranker_e` (`real`, nullable). **Nullable = unknown** (§7.11): every existing row and every save from an older extension build stays legal and reads as unscored. Never default them to `0`.
- **The server computes `ranker_e`, the client reports counts** (§7.16). The scrape body carries observed metrics; `scrapeSave` calls `scoreMeasured` and persists the result. A client-supplied score would be a number the server cannot defend.
- Persist `null` for `ranker_e` when `scoreMeasured` returns `available: false` — do not persist a zero.
- On-page: reuse `extractArticle(art)`'s metrics rather than writing a second DOM reader (HV.2's rule — one reader). The badge renders with `OVERLAY_TOKENS` (`--stratus-*`), **never** the panel's `--strat-*` (§UI.16).
- The badge is informational and does not gate the save (§7.23a).
- **Two bugs in `extractArticle` are in scope here because this task makes them visible, and both are one-line-ish:**
  1. `hasPhoto`/`hasVideo` query the whole `<article>`, so a text-only quote tweet of a photo post records `hasPhoto: true`. Add the quote-scoping predicate — a node whose `closest('div[role="link"]')` contains its own `[data-testid="tweetText"]` belongs to the *quoted* tweet. (`tweetKind.ts`'s `CARD_ANCESTOR_SELECTOR` is the sibling idea; this is the `role="link"` case it does not cover.) Fix it with a fixture test in `harvest.test.ts` or a new happy-dom suite, and note it in the commit — it silently poisons the Playbook's media cell.
  2. `parseMetrics` reads only the `role="group"` aria-label, so a locale our stems miss records zeros behind an `unparsed` flag. Add the locale-independent fallback: `button[data-testid="like"|"reply"|"retweet"|"bookmark"]` + first numeric token, and `a[href*="/analytics"]` for views. Testids are identical in every locale. Only fill a metric the label did not supply — never overwrite a parsed value.
- If the session strains, **7a** = schema + migration + route + route tests; **7b** = content script badge + the two `extractArticle` fixes. Both land green independently (7a's columns are simply unwritten until 7b ships).

**Tests:**
- `src/x/routes/voice.test.ts`: `scrapeSave` with metrics persists them and a non-null `ranker_e`; without metrics persists nulls and a null `ranker_e`; with `views: 0` persists the counts and a **null** `ranker_e`; a client-supplied `rankerE` in the body is ignored.
- `extension/src/shared/` happy-dom fixtures (the `verified.ts`/`tweetKind.ts` pattern) for both `extractArticle` fixes: an article whose ONLY photo sits inside a `role="link"` quote card reports `hasPhoto: false`; an article with an empty/foreign group label but present testid buttons reports the button counts; a present label is not overwritten by the fallback.

**Done when:**
- [ ] `bun run db:generate` emitted `0032`, the SQL was inspected, and boot auto-migration applies cleanly on a copy of the live DB
- [ ] A swipe-file save from an x.com search page stores counts + a non-null `ranker_e`; a save with no visible view count stores nulls
- [ ] A quote tweet of a photo post records `hasPhoto: false`
- [ ] `bun test` + `bun run typecheck` + `bun run lint` + `cd extension && bun run build` green
- [ ] Committed: `feat(voice): stamp ranker E on swipe-file saves + fix quote-scoped media and locale-blind metrics (XR.7)`

**Cost note:** $0 — no X call. The scrape is DOM-only, which is the whole reason the voice library is a scrape and not an API read (invariant #8, and the $0.005 other-user post read it avoids).

---

## Task XR.8 (final): docs-sync + smoke
**Depends on:** all prior.

- [ ] `scripts/smoke-x-ranker.ts` — rerunnable, **$0, no `--live` flag** (nothing here can spend). Steps: (1) assert all 26 weights + params against a hardcoded expectation table, so a transcription drift fails a script as well as a unit test; (2) score three fixture drafts and print C with its top contributions; (3) `GET /x/playbook`, print the `rankerScoreEffectiveness` quartile table; (4) **one verdict line** — `spread N.NNx over n=… — C/E separates our corpus` or `no measurable spread (n=… below the n≥20 gate) — the score stays context, not advice`; (5) print `X_OBSERVED_RATES.provenance` so a `imported-pending-calibration` baseline is visible on every run. Creates nothing, so nothing to clean up. **§RA.6 warning: this script reads JSON, so no typecheck covers its field names — assert the field exists before reading it and fail loudly if it does not.**
- [ ] `docs/PHASE-HISTORY.md`: the XR phase entry (what shipped, 2026-09-XX, $0, the two `extractArticle` bugs fixed in passing, the MIT attribution to Bangermeter, and whether the falsification cell found a spread).
- [ ] `CLAUDE.md`: **only if a guardrail changed.** One candidate does: if the plan ships with `provenance: 'imported-pending-calibration'`, add one line to the thresholds paragraph naming the ranker baseline as an un-recalibrated import. Otherwise leave CLAUDE.md alone.
- [ ] `PLAN.md`: XR phase status.
- [ ] `docs/composer-tab.md`, `docs/radar-tab.md`, `docs/voice-tab.md`: the new pill/chip/badge and what each one does and does not claim.
- [ ] `.claude/skills/plan-feature/references/codemap.md`: §3.1 (two new rows in the shared-module table — recount the siblings rather than trusting this line), §4 (`voice_tweets` +5 columns; migration head → `0032`; **next migration owns `0033`**), §5 (`tsconfig.app.json` include twelve → **fourteen**; two new shims), §9 (new test files + the smoke script, count 41 → 42), and the header re-stamped to the new commit.

## Out of scope (do NOT build)

- **A Playbook panel table for `rankerScoreEffectiveness`.** The route returns it; the smoke script reads it. Render it only after the cell has said something. (User answer: Playbook panel table not selected.)
- **Bangermeter's estimator table.** No `contentModifiers`, no `baselineP` re-derivation beyond Decision 4, no locale count-word table (`metricsAria.ts` already covers ours with a better failure mode), no reply-marker locale table.
- **Their UI**: badge injection on every timeline article, the breakdown panel, "show the math" expander, the compose meter's floating chip, score history, draft A/B variants, the Under the Hood importer, the userscript build.
- **The 2023 verified boost and the Community-Note factor.** One is archived code absent from the 2026 release; the other is a round figure chosen inside a range from three studies. Neither is an X parameter.
- **Any gate, sort or refusal driven by C or E.** Advisory only (§7.23a).
- **Adding a settings-registry knob for a weight.** These are transcribed facts. If a *modifier* magnitude ever needs tuning, that is a recalibration commit with a measurement behind it, not a slider.
- **Reintroducing any billed X read** to get counts the DOM did not give us (invariant #8). A missing view count is unknown and renders nothing.

## Risks / watch items

1. **The corpus may not be big enough to calibrate.** XR.3 refuses to emit medians below n=100 timeline rows. If it refuses, the E score ships against an imported baseline labeled as such, and the smoke script says so on every run. That is the designed degradation, not a failure — but it means "50 = typical post" is *their* typical post until the corpus fills.
2. **E is partly circular.** Views is the denominator of every rate E is built from, and rate falls as reach rises, so "high E ⇒ high views" is weak evidence. C is the non-circular test. XR.4 reports both and the header says which is which — do not let a later reader quote the E spread as the finding.
3. **Modifier magnitudes are unmeasured guesses.** Every one carries `provenance: 'estimate'` and a ≥100-measured recalibration trigger. The risk is that the C score looks authoritative because the *weights* are authoritative. The pill copy is the only thing standing between those two facts; do not trim it for space.
4. **X's DOM will drift** and take XR.7's on-page badge with it. Both `extractArticle` fixes ship with fixtures; the badge itself is browser-verified by convention, like the rest of `content.ts`.
5. **The published weights are synced from production by cron**, so they are current rather than historical — and can therefore change under us. `xRanker.ts`'s header records the sync stamp (`2026-08-12T04:09:22Z`). A re-verification is a cheap future task; nothing auto-detects drift.
6. **Two numbers in one column is a copy problem before it is a code problem.** If a browser check shows the two pills reading as one score with two renderings, fix the copy in XR.5 rather than shipping and hoping.
7. **XR.7 owns migration `0032`.** Any other migration-generating session started in parallel will conflict on the journal.
