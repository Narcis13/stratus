# Static Coach (SC) — deterministic pre-publish checks, format classifier, and a fitted reach band

- **Status:** planned 2026-07-22 · not started · **backlog — after the current masterplan waves; SC.1–SC.3 are the usable slice, SC.8 is deliberately last**
- **Source:** `evals/x-builder-static-engine-analysis.md` (the code study of `~/newme/x-builder`'s `engine/src/deterministic/**`). Read it first — every decision below is argued there. Companion study: `evals/i_mika_el_analysis.md`.
- **Goal fit:** goal 1 (posting — better originals before they ship) and goal 2 (tracking — a new **structural** axis over the whole measured corpus). Nothing here touches goals 3–4.
- **Cost impact:** **$0 recurring, $0 per use, no X API reads, no LLM calls, no new tables in SC.1–SC.6.** Pure functions over text already in SQLite. The one spend-adjacent effect is negative: the URL check fires at draft time instead of schedule time, catching the $0.20 surcharge (invariant #1) one step earlier.
- **Invariants touched:** #1 (URL surcharge — the coach *surfaces* it, the `calendar.ts` 400 guard stays the only enforcement), §7.3 (canonical module in `src/shared/` + extension re-export shim — the `replyBand.ts` pattern, verbatim), §7.11 (null = unknown — an unclassifiable draft is `other`, never a silent bucket), §7.19 (a classifier verdict is queue/measurement metadata, never advice), §7.20 (static routes before `:param`), §7.26 (IIFE-safe content-script imports), plus the house n≥20 gate (`DEFAULT_MIN_CELL_N`) on every new Playbook cell.
- **Codemap sections relevant:** §3.3 (`playbook.ts`, `routes/playbook.ts`, `routes/calendar.ts`, `drafter.ts`, `replies.ts`, `niche/*`), §3.4 (brief), §5 (`Composer.tsx`, `Playbook.tsx`, `Radar.tsx`, extension shims), §7, §9.
- **Plan collision — resolved here:** `plans/2026-07-22-mika-growth-tactics.md` decision 6 plans a 7-day cooldown keyed on `register` + `pillar`, with hand-written posts landing in an `unknown` bucket that is surfaced but never warned on. **SC.6 supersedes that task.** A format classifier reads the text, so the cooldown covers hand-written posts too. If GT ships first, SC.6 replaces its implementation rather than adding a second cooldown surface.

## Why / what changes for the user

Today stratus gives **zero feedback on the text of your own draft**. It knows *when* to post (best-times), *what pillar* it is, and that a URL will cost $0.20 — but nothing about the writing. Every quality signal it has is either post-hoc (the Playbook, n≥20, weeks late) or about *other people's* tweets (`replyBand`).

After this plan: typing in the Composer shows a live 0–100 score and a short Fix/Nudge list — em-dashes, weak closers ("thoughts?"), hedge stacking, a 15th line that hides the post behind "show more", a sweeping claim with no evidence, a post that gives a stranger no reason to click the profile — recomputed on every keystroke with **no network call and no spend**. Reply Master variants each carry a compact score so the pick is informed. The Playbook gains a **format** axis (question / would-you-rather / poll-list / milestone / substance / …) computed retroactively over the entire measured history, because `posts_published.text` is `NOT NULL` — n on day one, where every other Playbook cell waited months. And the Composer warns when a format has been used 4× in 7 days.

What it deliberately does **not** do: predict reach from invented numbers. x-builder's own architecture doc states *"writing quality is nearly uncorrelated with impressions"*, and every one of its reach multipliers is marked `// CALIBRATE` against a corpus that isn't in that repo. So the score ships as a **floor that catches own-goals, never a lift**, in the UI copy from the first commit — and the reach band (SC.8) renders only from weights fitted on stratus's own `metrics_snapshots`, showing "insufficient data (n=…)" until the gate clears.

## Design

**Provenance / licensing.** `creynir/x-builder` has **no LICENSE file** → default all rights reserved. The rules are unprotectable facts ("cap hashtags at 2", "15 raw lines triggers show-more") and the aggregation arithmetic is trivial; their exact regexes, label strings and file layout are not. **Every module here is re-implemented from the rule list with our own patterns and copy**, carrying a header comment citing the source study. This is also the better outcome: a third of their lexicon is founder/SaaS-specific (mrr/arr/churn/cac) and has to be niche-scoped for stratus anyway.

**Data:** **no migrations in SC.1–SC.7.** Format and score are pure functions of text, classified **at read time** from `posts_published.text` / `scheduled_posts.text`. Never stored, never stamped — so a classifier improvement retroactively improves every cell instead of leaving a stale column behind (the C2 no-derived-state discipline). SC.8 adds one optional cache table only if the fit proves too slow to compute per request, and the plan's default is that it doesn't.

**Pure logic:** `src/shared/postCoach.ts` (checks + score) and `src/shared/postFormat.ts` (classifier) — canonical in `src/shared/` with `extension/src/*.ts` re-export shims and an `extension/tsconfig.app.json` `include` entry, exactly like `replyBand.ts` / `channelSuggest.ts`. Both zero-dependency, both bun-tested, both usable from the server, the panel, and the content script.

**Routes:** `GET /x/posts/cooldowns` (SC.6, calendar router, $0 SQL + classification), `GET /x/coach/lexicon` (SC.7), and new gated cells inside the existing `GET /x/playbook` (SC.5) and `GET /x/brief` — no new top-level router until SC.8.

**Extension:** Composer coach column (SC.3), Reply Master / Radar variant chips (SC.4), Playbook sections (SC.5), Composer cooldown chips (SC.6). All client-side computation — the panel never round-trips for a score.

**Measurement of the coach itself (SC.5, non-optional):** bucket own measured originals by score band **and** by format, gated n≥20. If the score band shows nothing — the likely outcome, and the one x-builder's own analysis predicts — the coach stays as a floor and the UI copy is already honest about it. Building the judge in the same phase as the tool is the point.

## Decisions taken

1. **Three layers, adopted separately.** Checks + score (SC.1) and the classifier (SC.2) ship now; the reach model's *architecture* (base = trailing median, format-dominant, pEscape moved separately from the midpoint, `baseSource`/`weightSource` provenance on the output, seed→fitted swap behind an n gate) is adopted in SC.8; **none of its numbers are.** x-builder's seed table would coach toward `cta_farm`/`fill_blank_tribal` at 3.0× and away from `substance_analysis`/`insight_share` at 0.3× — in direct opposition to the active niche's persona. Their table is a guess; ours will be a measurement or it will be absent.
2. **Never store the score or the format.** Both are pure functions of text; recompute at read time everywhere. No columns, no backfills, no drift, and the entire measured history is classifiable on the first commit.
3. **Format is a fourth, orthogonal axis** — pillar = topic, register = tone, angle = reply stance, **format = structure**. Stated once in `src/shared/postFormat.ts`'s header and in the Playbook copy. It is *not* merged into `post_templates` (that table is LLM-extracted own-winner structure at ~$0.005/tweet; a free deterministic label alongside it is complementary, and polluting it would corrupt §8.3/C4 measurement).
4. **The score is a floor, not a target.** UI copy says so from commit one ("signals, not verdicts — 60+ reads ship-ready; the goal is the post, not the score"), and no surface ever sorts, gates, or blocks on it. A low score never refuses anything. Verified by SC.5's own measurement cell.
5. **Drop the invented environment multipliers entirely** — posting-hour (stratus has measured best-times cells, n≥3-gated, already in the Composer), media attachment (stratus has `has_media` + `buildMediaEffectiveness`, n≥20/side), account age (a constant for one fixed account). Porting them would add noise and contradict measured surfaces.
6. **No trending-term lexicon.** x-builder's carries an explicit expiry date and rots between releases. Stratus already has user-editable `channels.keywords` with word-boundary matching in `src/shared/channelSuggest.ts` — SC.7 reuses it.
7. **Niche-scoping is a follow-up, not a blocker.** SC.1 ships a neutral default lexicon plus an optional `lexicon` parameter; SC.7 fills it from the active niche + channels. A niche-less coach is still correct on ~two thirds of its rules (em-dash, hedges, show-more cutoff, hashtags, weak closers) — those are platform and prose facts, not audience facts.
8. **The URL check surfaces, it never enforces.** `calendar.ts`'s `400 url_in_text` stays the only gate (invariant #1). The coach's version says the stratus-specific thing their generic "link friction" check can't: *"a URL in a standalone post bills $0.20 vs $0.015 — move it to the first reply (§8.2)"*.
9. **SC.8 renders nothing until it can render something true.** Fitted-only: no seed table ships to the UI at all. Below the gate the Composer says "reach band: insufficient data (n=…)" — the same sentence every other gated surface says.

## Done when

- [ ] Typing in the Composer updates a 0–100 score and a Fix/Nudge list on every keystroke with no network request; the passing checks stay collapsed.
- [ ] A draft containing an em-dash, "thoughts?", and 15 raw lines shows exactly three Fix rows naming those three things; a URL in a standalone post shows the $0.20 line.
- [ ] `GET /x/playbook` returns `formatEffectiveness` with real n over the whole measured history on the first deploy (no backfill run), each cell gated at n≥20, and `coachScoreEffectiveness` alongside it.
- [ ] The Composer shows a cooldown chip after 4 same-format posts in 7 days — **including hand-written ones** (the GT decision-6 gap).
- [ ] `bun scripts/smoke-coach.ts` passes $0 (check matrix, classifier fixtures over real own posts, cooldown arithmetic, gated Playbook cells, fitted-vs-insufficient reach provenance).
- [ ] Every new Playbook/Composer surface is silent-until-gated; no surface anywhere sorts, blocks, or refuses on the score.

---

## Task 1: `src/shared/postCoach.ts` — the check engine  [parallel-ok]
**Depends on:** none
**Session budget:** ~450 diff lines, 2 files

**Read first:** `evals/x-builder-static-engine-analysis.md` §L1/§L2 (the rule inventory and the aggregation formula — this is the spec); `src/shared/replyBand.ts` + `src/shared/replyBand.test.ts` (the canonical-module + bun-test exemplar, including how it stays dependency-free for the content script); codemap §7.3.

**Edit:**
- `src/shared/postCoach.ts` (new) — header comment citing the source study and the licensing note (re-implemented, not copied). Exports: `type CoachStatus = 'pass' | 'nudge' | 'fix'`; `type CoachCheck = {id, group: 'hygiene' | 'craft' | 'signal', status, label, why?}`; `type CoachResult = {score, band, checks, counts}`; `type CoachLexicon = {specificTerms: string[], tribeTerms: string[]}` + `DEFAULT_LEXICON`; `scoreDraft(text, opts?: {lexicon?, isReply?}) : CoachResult`.
- Three check groups, ~29 rules total, each a small named predicate:
  - **hygiene** (baseline, most fire as `nudge`): substance floor, em-dash/en-dash, weak closer (`thoughts?` / `agree?`), corporate buzzwords, AI-tell phrases, hashtags >2, ALL-CAPS beyond an allowed-acronym list, spammy punctuation, weak opener ("just…", "honestly,", "I think"), long single line, **15-raw-line show-more cutoff**, word count >30, hedge-word stacking (>2).
  - **craft**: hook opener, tension/contrast, concrete detail, quotable shape (single line ≤12 words OR a final line ≤8 words ending on a verb), value signal (insight | practical | humor | proof), breathing room (≥2 non-empty lines with no blank line between), ends on a question.
  - **signal**: answerable question (stacked questions = `fix`), vague curiosity with no concrete anchor, standalone context ("This changed everything" with no subject), sweeping claim with no evidence, **profile-click reason** (author-specific proof vs generic advice), one-idea focus, dense line ≥180 chars, **URL → the $0.20 surcharge line**, mention density.
- Score: `standard = mean(pass 1 / nudge 0.5 / fix 0) over hygiene+craft × 100`; `quality = 40 + 60 × passRate over signal`; `score = min(standard, quality)`; capped at 25 when <4 words or <15 chars, 65 when <7 words or <30 chars; 0 on empty. Bands 85 / 60 / 45.
- `src/shared/postCoach.test.ts` (new) — one assertion per rule (a firing draft and a clean draft), the aggregation formula, both short/thin caps, the empty case, and a `lexicon`-override case.

**How:** Every rule is a pure predicate over `{trimmed, lower, lines, words}` computed once at the top — no rule re-splits the text. Keep it **zero-dependency and IIFE-safe** (§7.26): no imports at all beyond types, so the content script can inline it later. Write our own regexes and label copy — do not transcribe x-builder's (see the licensing note in the study). Labels are the actionable sentence, not the rule name ("Cut 1 line — 15 hides the post behind 'show more'"). `isReply: true` relaxes the craft group (a reply doesn't need a hook or breathing room) but keeps hygiene and signal.

**Tests:** the new suite. No route/DB touch in this task.

**Done when:**
- [ ] `scoreDraft('')` → `{score: 0}` with no thrown error; a 3-word draft never exceeds 25
- [ ] A draft with an em-dash + "thoughts?" + 15 raw lines yields exactly those three non-pass checks
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(coach): deterministic pre-publish check engine (SC.1)`

**Cost note:** $0.

---

## Task 2: `src/shared/postFormat.ts` — the format classifier  [parallel-ok]
**Depends on:** none
**Session budget:** ~350 diff lines, 2 files

**Read first:** `evals/x-builder-static-engine-analysis.md` §L0 (cascade order is load-bearing — read the ordering argument); `evals/i_mika_el_analysis.md` §"Taxonomy by performance" (the measured type list this must be able to express); `src/shared/channelSuggest.ts` (the word-boundary matching idiom to reuse).

**Edit:**
- `src/shared/postFormat.ts` (new) — header stating the orthogonality contract (**pillar = topic, register = tone, angle = reply stance, format = structure**) and that the label is measurement metadata, never advice (§7.19). Exports `type PostFormat` (a trimmed taxonomy — keep the shapes stratus can actually produce or measure: `question`, `would_you_rather`, `poll_list`, `binary_choice`, `audience_cta`, `hot_take`, `confession`, `milestone`, `story`, `data_comparison`, `substance`, `one_liner`, `list`, `other`), `FORMAT_LABELS`, and `classifyFormat(text): PostFormat` — an ordered cascade with one comment per branch explaining why it sits where it does.
- `src/shared/postFormat.test.ts` (new) — a fixture table of ≥3 drafts per format, plus **ordering regression tests** (a draft matching two branches lands on the earlier one) and the `other` fallback.

**How:** Fewer formats than x-builder's 26 on purpose — every format must be (a) reliably detectable from text alone and (b) something the Playbook can accumulate n on. A format nobody posts is a permanently-empty cell. Derive the fixtures from **real own posts**: pull 30–50 rows of `posts_published.text` through the explorer (`GET /x/data/posts_published`, S1 read-only) and hand-label them; a classifier that disagrees with the human label on our own corpus is wrong, not the corpus. Do **not** stamp the format anywhere (decision 2).

**Tests:** the new suite + a sanity script run (not committed as a test) printing the format distribution over the real corpus — a taxonomy where >60% lands in `other` is a failed design and must be reworked before SC.5 depends on it.

**Done when:**
- [ ] The fixture suite passes and the real-corpus distribution has `other` under ~35%
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(coach): deterministic post-format classifier (SC.2)`

**Cost note:** $0.

---

## Task 3: Composer live coach column
**Depends on:** SC.1
**Session budget:** ~280 diff lines, 4 files

**Read first:** codemap §5 + §7.3; `extension/src/replyBand.ts` and `extension/tsconfig.app.json` (the shim + `include` pattern — both must be updated); `extension/src/sidepanel/Composer.tsx` (whole — the best-times/pillar/media_note sections are the layout exemplar); `extension/src/sidepanel/composerLogic.ts` (pure-helpers-beside-the-panel pattern).

**Edit:**
- `extension/src/postCoach.ts` (new) — `export * from '../../src/shared/postCoach.ts';`
- `extension/tsconfig.app.json` — add `"../src/shared/postCoach.ts"` to `include`.
- `extension/src/sidepanel/Composer.tsx` — a coach block under the textarea: the 0–100 value with its band label, the Fix rows (red) then Nudge rows (amber), and a `<details>` "N passing" disclosure. Recomputed with a ~150ms debounce directly from the draft text — **no fetch, no state beyond the memo**. Thread mode scores segment 1 (the head is what has to hook). The helper line is verbatim decision 4's copy.
- `extension/src/sidepanel/*.css` (or the panel's existing style location) — three tone classes reusing the existing chip/badge palette; no new colors.

**How:** Pure presentation over `scoreDraft(text)`; the panel must never call the server for a score. Place the block **below** the existing pillar/best-time controls so the primary flow is unchanged. The score is never used to disable the Schedule button (decision 4).

**Tests:** none required (panel components are manually verified by convention); the pure module is already covered by SC.1.

**Done when:**
- [ ] Typing updates score + rows with no network request in the devtools Network tab
- [ ] Thread mode scores the head segment; the Schedule button is never blocked by a low score
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green (extension included)
- [ ] Committed: `feat(composer): live static coach column (SC.3)`

**Cost note:** $0.

---

## Task 4: Coach chips on reply variants  [parallel-ok after SC.3]
**Depends on:** SC.1, SC.3
**Session budget:** ~150 diff lines, 2–3 files

**Read first:** codemap §5 (Replies editor + Radar rows); the reply-variant chip rendering in the panel's replies surface; `extension/src/shared/variantChips.ts` (RU.8 — the on-page chip preview helpers).

**Edit:**
- The panel's reply editor — a compact `score` chip on each of the three variant chips (`scoreDraft(text, {isReply: true})`), plus the top two non-pass labels as the chip's `title` tooltip. No sorting, no auto-selection (decision 4).
- `extension/src/sidepanel/Radar.tsx` — the same chip on a drafted radar reply row.

**How:** `isReply: true` so a one-line reply isn't nudged for missing breathing room or a hook. Compute inline in the render (replies are short; no debounce needed). Do **not** touch `content.ts`'s on-page chip strip in this task — the action row is deliberately light (RU.7) and a score there is noise at the moment of pasting.

**Tests:** none required beyond SC.1's suite.

**Done when:**
- [ ] Each variant shows a score chip; hovering names its top issues; picking order is unchanged
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(replies): coach score chips on variants (SC.4)`

**Cost note:** $0.

---

## Task 5: Playbook — format effectiveness + the coach's own judge
**Depends on:** SC.1, SC.2
**Session budget:** ~400 diff lines, 5 files

**Read first:** codemap §3.3 playbook rows; `src/x/playbook.ts` §S0.2 `buildMediaEffectiveness` and §S0.8 `buildIdeaEffectiveness` (the two closest exemplars — bucketing + `DEFAULT_MIN_CELL_N` gate + the `ratio()` both-sides-clear discipline); `src/x/routes/playbook.ts` (`loadMediaRows`/`loadIdeaRows` — the loader shape and where `minN` flows); `src/x/routes/playbook.test.ts`; `extension/src/sidepanel/Playbook.tsx` (a silent-until-gated section).

**Edit:**
- `src/x/playbook.ts` — two new pure sections: `buildFormatEffectiveness(rows, minN)` (own **non-reply** originals bucketed by `classifyFormat(text)` → median views / profile clicks / n per cell, each cell independently gated, **no lift line** — there is no baseline pair, same shape as `buildModelEffectiveness`) and `buildCoachScoreEffectiveness(rows, minN)` (the same rows bucketed by score band — `<45 / 45–59 / 60–84 / 85+` — with a `spread` only when the top and bottom bands both clear the gate).
- `src/x/routes/playbook.ts` — one loader over `posts_published` (non-reply) joined to the latest `metrics_snapshots`, selecting `text` so both builders classify at read time; wire both into `GET /x/playbook` with `minN` flowing through.
- `extension/src/sidepanel/Playbook.tsx` — a **Post format** section (table, silent-until-gated) and a **Does the coach score predict anything?** section that states the honest verdict either way ("no measurable spread at n=… — the score is a floor, not a lift" / "the top band outperforms the bottom by …×").
- `src/x/playbook.test.ts` + `src/x/routes/playbook.test.ts` — bucketing, gates, the no-lift-without-both-bands rule, and a partition invariant (every measured original lands in exactly one format cell and one score band).

**How:** Reuse the existing measured-rows loader if one already selects `text`; add the column rather than a second query. Classification is at read time (decision 2) — nothing is stamped. The score-band cell is the phase's own falsification test and must ship in the same commit as the format cell, not later.

**Tests:** as listed. Verify end-to-end against the real DB by hitting `GET /x/playbook?minN=3` and eyeballing the format distribution against SC.2's sanity run.

**Done when:**
- [ ] `GET /x/playbook` returns both cells with real n over the full history and no backfill step
- [ ] Both sections render silent-until-gated; the score-band section states its verdict honestly
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(playbook): format + coach-score effectiveness cells (SC.5)`

**Cost note:** $0 — pure SQL over already-billed data.

---

## Task 6: Format cooldown (supersedes GT decision 6)
**Depends on:** SC.2, SC.3
**Session budget:** ~300 diff lines, 5 files

**Read first:** `evals/x-builder-static-engine-analysis.md` §Inputs (the repetition-window design — format tally **plus** a Jaccard token-overlap cluster, so it counts repeated *ideas*, not just repeated shapes); `plans/2026-07-22-mika-growth-tactics.md` decision 6 + its cooldown task (being replaced); `src/x/routes/calendar.ts` (route + validation idiom); `src/x/routes/channels.ts` (a `$0` aggregate route exemplar).

**Edit:**
- `src/shared/postCooldown.ts` (new, pure) — `buildCooldowns(posts: {text, postedAt}[], now, windowDays = 7)` → per-format `{format, count, status: 'clear' | 'warming' | 'cooldown', lastPostedAt, exampleText}`; ≥4 = cooldown, ≥2 = warming; within a format, cluster by stop-worded token-set Jaccard ≥0.45 and report the largest cluster's count, so four *different* questions don't read as repetition.
- `src/x/routes/calendar.ts` — `GET /x/posts/cooldowns?days=7` ($0: own non-reply `posts_published` in the window → `buildCooldowns`).
- `extension/src/sidepanel/Composer.tsx` — a cooldown chip when the **current draft's** classified format is `warming`/`cooldown`, with the count and the last-used date in the tooltip; amber, never blocking.
- `src/shared/postCooldown.test.ts` + a route-wiring test.

**How:** Originals only (replies have their own cadence doctrine). Hand-written posts are included by construction — that's the whole reason this supersedes the register-keyed version. If GT's register cooldown has already shipped, **replace** its route and chip rather than rendering two.

**Tests:** as listed — boundary cases at 1/2/3/4 posts, the clustering threshold, and the window edge.

**Done when:**
- [ ] Four same-format originals in 7 days (at least one hand-written) show a cooldown chip in the Composer; four dissimilar questions do not
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(composer): format cooldown from own corpus (SC.6)`

**Cost note:** $0.

---

## Task 7: Niche-scoped coach lexicon
**Depends on:** SC.1, SC.3
**Session budget:** ~200 diff lines, 4 files

**Read first:** codemap §3.3 niche rows; `src/x/niche/store.ts` + `src/x/niche/defaults.ts` (`loadActiveNicheSafe` — never throws, default-grounded); `src/x/routes/channels.ts` (`keywords` JSON); `src/x/routes/pillars.ts` (the always-mounted CRUD exemplar).

**Edit:**
- `src/x/routes/coach.ts` (new, always mounted, $0) — `GET /x/coach/lexicon` → `{specificTerms, tribeTerms}` assembled from the active niche (its `label`/persona nouns) + active `channels.keywords` + active pillar slugs, deduped and lowercased; falls back to `DEFAULT_LEXICON` on any failure (`loadActiveNicheSafe` discipline).
- `src/x/index.ts` — mount it.
- `extension/src/sidepanel/Composer.tsx` (and the replies surface) — fetch once on mount, cache module-level for 60s (the `ChannelTags` cache idiom), pass as `scoreDraft(text, {lexicon})`; a failed fetch silently keeps the default.
- Server-side call sites that want a coach opinion (none required in this task) take the same lexicon from `loadActiveNicheSafe`.

**How:** This is what stops a nutrition niche from being graded on whether it mentions ARR. Keep the derivation dumb and inspectable — no LLM, no stemming beyond lowercase, word-boundary matching identical to `channelSuggest.ts`. A term list that grows unbounded is fine; the checks only ever ask "does the draft contain one of these".

**Tests:** route shape + fallback-on-failure over the in-memory DB; a `scoreDraft` case proving `concrete detail` flips with a custom lexicon.

**Done when:**
- [ ] `GET /x/coach/lexicon` returns the active niche's terms; deactivating everything still returns the default set
- [ ] A nutrition-niche draft mentioning "macros" passes the concrete-detail check
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(coach): niche-scoped lexicon (SC.7)`

**Cost note:** $0.

---

## Task 8: Fitted reach band — architecture yes, invented numbers never
**Depends on:** SC.2, SC.5
**Session budget:** ~450 diff lines, 6 files

**Read first:** `evals/x-builder-static-engine-analysis.md` §L3 (the discipline to copy: pEscape moved separately from the midpoint, provenance fields, seed→fitted swap, fit-by-aggregation not regression) **and its verdict** (none of their constants ship); `src/x/routes/metrics.ts` (`loadBestTimeCells` — the "query + build shared by route and consumer" shape); `src/x/playbook.ts` `DEFAULT_MIN_CELL_N`.

**Edit:**
- `src/x/coach/reach.ts` (new, pure) — `fitFormatWeights(rows, minN)` → per-format `{p50Multiplier: median(actualViews / base), escapeRate: share(actualViews ≥ 3 × base), replyRate: median(replies / views), n, sufficient}` where `base` = the trailing median views of the 20 own originals preceding that post; and `buildReachBand({text, format, weights, base})` → `{stallRange, escapeRange, escapeProbability, base, weightSource: 'fitted' | 'insufficient', n}`. **There is no seed table** — a format below the gate returns `weightSource: 'insufficient'` and no ranges.
- `src/x/routes/coach.ts` — `GET /x/coach/reach?format=` (or fold into the Composer's existing payload), $0 SQL over `posts_published` + `metrics_snapshots`.
- `extension/src/sidepanel/Composer.tsx` — one line under the coach block: the stall/escape band with its n and "fitted from your last N posts", or `reach band: insufficient data (n=…)` below the gate.
- Tests: the fit arithmetic on fixtures, the gate, and a route test asserting **no numeric band is ever returned for an under-gate format**.

**How:** The trailing-median base is per-post (the 20 originals *before* it), not a global constant, or early low-reach posts drag every multiplier down. Views come from the latest `metrics_snapshots.public_metrics.impression_count` (the same first-row-wins read as `buildReplyOutcomes`); age-normalize with `age_at_snapshot_min` the way `buildBestTimes` does before comparing across posts. Escape threshold 3× base mirrors x-builder's `escapeRangeLowCoeff` — the **shape** of their model, fitted to our numbers. Keep pEscape adjustments out of the midpoint if any are ever added (their one real modelling rule).

**Tests:** as listed, plus an end-to-end check over the real DB confirming which formats currently clear n≥20 and that the rest render the insufficient line.

**Done when:**
- [ ] The Composer shows a fitted band only for formats at n≥20 and the insufficient line otherwise — no invented number is reachable through any code path
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(coach): fitted reach band from own corpus (SC.8)`

**Cost note:** $0.

---

## Task 9: Smoke script + docs sync
**Depends on:** SC.1–SC.8 (whatever has landed)
**Session budget:** ~300 diff lines, 4–6 files

**Read first:** `scripts/smoke-playbook.ts` and `scripts/smoke-pinned-watch.ts` (the two closest rerunnable-$0 exemplars — seeded rows, surgical cleanup); the CLAUDE.md Phase-status entry format.

**Edit:**
- `scripts/smoke-coach.ts` (new, $0, no `--live` mode — nothing here can spend) — the check matrix, the classifier fixtures, cooldown arithmetic over seeded rows, the gated Playbook cells, and the reach route's insufficient-vs-fitted provenance; cleans up after itself.
- `docs/` — a `docs/sc-static-coach.md` describing the four layers, what was deliberately not adopted and why, and the floor-not-lift framing.
- `CLAUDE.md` — one Phase-status entry in the house style (what shipped, what's $0, the invariants, the "done when" tails needing live use).
- `evals/x-builder-static-engine-analysis.md` — append a short "what we actually shipped" postscript.

**Done when:**
- [ ] `bun scripts/smoke-coach.ts` passes against the real DB and leaves no rows behind
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `docs(coach): static-coach docs-sync + $0 smoke (SC.9)`

**Cost note:** $0.
