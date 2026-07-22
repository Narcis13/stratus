# x-builder's static engine — code analysis + adoption assessment for stratus

> **Source:** `~/newme/x-builder` @ `fff737a` (github.com/creynir/x-builder — @i_mika_el's tool).
> Companion to `evals/i_mika_el_analysis.md` (the posts/replies harvest study) and
> `plans/2026-07-22-mika-growth-tactics.md` (the tactics backlog).
> **Scope:** `engine/src/deterministic/**` (23 files, 3,212 LOC) + its inputs
> (`engine/src/capture/*`, `tools/calibration/*`) and its one UI consumer
> (`overlay/src/compose/static-engine-column.tsx`).

## TLDR

The static engine is **four separable layers stacked into one number**, and they have wildly
different trustworthiness:

| Layer | What it is | LOC | Calibration debt | Worth adopting? |
|---|---|---|---|---|
| **L0 format classifier** | 26-format regex cascade over draft text | ~350 | none (it's a labeller) | **yes — the single best asset** |
| **L1 Post Coach checks** | ~29 boolean writing rules → Fix/Nudge/On-point | ~620 | none (rules are self-evident) | **yes, adapted** |
| **L2 static score** | `min(baseline, quality)` aggregation → 0–100 | ~45 | low | yes, with the anti-Goodhart framing |
| **L3 reach prediction** | format table × 7 multipliers → stall/escape ranges + pEscape | ~700 | **total — every constant is `// CALIBRATE`** | **architecture yes, numbers no** |

The headline finding: **x-builder's own architecture doc admits the premise that kills L3's
credibility.** `docs/features/reach-model-upgrade/README.md:17` — *"Format multipliers span
0.2×–7× with a fat tail; writing quality is nearly uncorrelated with impressions."* That's why
they inverted the model to be format-dominant. It also means the 0–100 score they render as the
headline is, by their own analysis, **not a reach predictor** — it's a floor that catches
own-goals. Their UI copy says so out loud (`post-coach-model.ts:60`: *"Signals, not verdicts…
60+ usually reads ship-ready; the goal is the post, not the score"*).

And the reach numbers those format multipliers come from are **invented**. Every entry in
`const/reach-model-weights.ts` carries a literal `// CALIBRATE` comment; `tools/calibration`
exists to refit them from a labeled corpus that, per the README, **is not in the repo**
(`"The labeled corpus JSONL is not yet in the repo; calibration ships synthetic fixtures and
tests mechanics only"`). So the "reach prediction, calibrated to your account" in the product
README is calibrated only in its *base* (your trailing median) — every multiplier applied to
that base is a guess.

**Stratus is a strictly better host for this engine than x-builder is**, for one reason: x-builder
has to DOM-scrape or archive-import to learn what its own posts did, while stratus already owns
`metrics_snapshots` — true API impressions, once-only-read, per own tweet, with
`age_at_snapshot_min` for normalization — plus `account_snapshots` for followers-at-time. The
corpus x-builder's calibration scaffold is *waiting for* is a table stratus has been filling since
Phase 2. And because `posts_published.text` is `NOT NULL`, the format classifier can be run
**retroactively over the entire measured history at query time** — no migration, no backfill, n on
day one.

---

## Layer by layer

### L0 — the format classifier (`format-classifier.ts:186`)

A 26-way ordered cascade of regex predicates over the trimmed draft. Order is load-bearing
(`controversy_product_reveal` before `hot_take` before question shapes before the structural
fallbacks; `wisdom_one_liner` = "single line that matched nothing", `insight_share` = "multi-line
that matched nothing"). Formats are structural, not topical: `fill_blank_tribal` fires on ≥2
parallel "X has/is Y" lines plus an incomplete final line; `would_you_rather` on either the literal
opener or a 3-line `A / or / B` shape with ≤8 words per option.

This is the genuinely novel asset, and it is **orthogonal to all three taxonomies stratus already
has**:

| Axis | stratus | x-builder |
|---|---|---|
| Topic | `pillar` (ai-craft / builder-51 / unsexy-problems, DB-editable) | — |
| Tone | `register` (plain / spicy / reflective) | — |
| Reply stance | `angle` (extends / contrarian / debate) | — |
| **Structure** | — (`post_templates.hookType/skeleton`, but LLM-extracted, ~$0.005/tweet, sparse) | **`PostFormat` — deterministic, free, universal** |

Note the last row: stratus's §8.3/C4 structure signal costs a Grok call per tweet and only covers
extracted winners. A deterministic classifier gives the same axis for **$0 over 100% of history**.
That alone justifies the port even if nothing else ships.

The mika harvest independently validates the taxonomy's top end: his best-performing types
(`evals/i_mika_el_analysis.md` §Taxonomy) were milestone (2,819 median views), poll-list (2,672),
would-you-rather (1,698), audience-CTA (1,509) — which map to `milestone`, `ab_choice`,
`would_you_rather`, `cta_farm`. His worst were statement/other (660) and news commentary (327) —
`insight_share` / `substance_analysis` territory. The **ordering** of the seed table is defensible;
the **magnitudes** are not.

### L1 — the Post Coach checks

29 checks in three files, all pure, all returning `{id, label, status: pass|warn|fail}`:

- `writing-checks.ts:252` — 13 **baseline** hygiene checks: substance, em-dash, weak closer
  ("thoughts?"/"agree?"), corporate buzzwords, AI-tell phrases ("delve", "tapestry", "realm of"),
  hashtag cap, ALL-CAPS, spammy punctuation, weak opener ("just…", "honestly,…", "I think…"),
  rhythm (long single line), **X's 15-raw-line "show more" cutoff**, word count >30, hedge words.
- `writing-checks.ts:12` — 7 **high-intent** checks: hook opener, tension/contrast, concrete
  detail, quotable shape (≤12 words one-liner OR ≤8-word punchline final line), value signal
  (insight | practical | humor | proof), breathing room (blank line between thoughts), ends on a
  question.
- `quality-signal-checks.ts:248` — 9 **quality-signal** checks: answerable question (with a
  stacked-question fail), vague curiosity without an anchor, standalone context ("This changed
  everything" with no subject), sweeping claim without evidence, profile-click reason (author-
  specific proof vs generic advice), one-idea focus, line length ≥180 chars, link density, mention
  density.

Two of these are quietly excellent and unavailable anywhere else in stratus:

1. **`expand_zone`** (`writing-checks.ts:318`) — *"Cut 1 line — 15 hides behind 'show more', 14
   shows in full."* A platform-mechanic rule, not a taste rule. Verifiable, actionable, and it
   costs a real chunk of reach when violated.
2. **`quality_profile_click_reason`** (`quality-signal-checks.ts:163`) — does the post give a
   stranger a reason to click the profile? Stratus *measures* profile clicks
   (`user_profile_clicks`, the whole §6.2/C4 outcome column) but has never had a **pre-publish**
   signal for them.

Roughly a third of the rules are hardcoded to a founder/SaaS audience (`hasSpecificTerm` at
`writing-checks.ts:47` matches mrr/arr/churn/cac/ltv/pmf; `tribeVocativeTerms` at
`rule-lexicon.ts:72` is founders/builders/indie/shipping). In x-builder that's a global constant.
In stratus it must be **niche-scoped** (N0 owns persona/beliefs; channels own keywords) or a
nutrition niche gets graded on whether it mentions ARR.

### L2 — the score (`score-aggregator.ts:7`)

```
standardScore = mean(pass=1, warn=0.5, fail=0) over non-quality checks × 100
qualityScore  = 40 + 60 × (passRate over quality checks)
score         = min(standardScore, qualityScore)      // weakest-link, deliberate
                capped at 25 if <4 words/<15 chars, 65 if <7 words/<30 chars
```

Bands (`const/scoring-weights.ts:27`): 85 Top tier / 60 Ship it / 45 Almost there / else Rework.

The `min()` is a good choice — it stops a draft from passing on hygiene alone — and the quality
floor of 40 stops the number from collapsing to zero on a valid one-liner. The caps are the honest
part: a 3-word draft can never score above 25 regardless of how many hygiene checks it trivially
passes. This is ~45 lines and I'd port the arithmetic essentially as-is.

### L3 — the reach model (`prediction-estimator.ts:137`)

```
base  = trailingMedianImpressions ?? clamp(0.4 × followers, 80, 4000)
mid   = max(1, base × format × quality × link × repeat × status × advancedCtx × topicWidth)
stall = [min(0.3·base, mid), max(0.3·base, 1.2·mid)]
escape= [3·base, 12·base × amplifierTail × wideTechTail]
pEscape = formatTable.escapeProbability, then × trending / one-word / answer-effort /
          amplifier, clamped [0,1], with the external-link cap (0.03) applied LAST
```

The **discipline** here is genuinely good and worth copying wholesale:

- **pEscape vs midpoint separation** — answer-effort and trending adjustments move the escape
  probability and expected replies but *never* the midpoint. Only the external-link penalty does
  both (×0.2 midpoint **and** a 0.03 pEscape cap). That's a real modelling decision, stated once
  and enforced consistently.
- **Provenance fields on the output** — `baseSource: "trailing_median" | "follower_estimate"`,
  `qualityBasis: "static" | "judge"`, `reachModelVersion`. The consumer always knows how much of
  the number is real.
- **Seed → fitted swap with an n gate** (`served-weights.ts:149`) — a fitted per-format weight
  replaces the seed only at `n >= 3`, and the metadata reports `seed | mixed | fitted` plus the
  sample count. The learning copy then says it out loud (`learning-model.ts:22`: *"…is using a
  universal prior until local outcome evidence reaches n>=3; current n=1"*). This is exactly
  stratus's silent-until-gated culture, arrived at independently.
- **Fit by aggregation, not regression** (`reach-model-upgrade/README.md:74`) — *"At ~350 rows
  over 15+ features, OLS is the wrong tool"*; per-format geometric median of `actual/base`,
  empirical escape fraction, median reply rate. Validated by leave-one-account-out Spearman +
  escape AUC, both hand-rolled, no stats dependency (`tools/calibration/validate.ts`). Correct
  call at this sample size, and directly reusable.

The **numbers** are the problem, and not just because they're uncalibrated. Look at what the seed
table would coach a user toward:

| Format | p50× | pEscape |
|---|---|---|
| `cta_farm`, `fill_blank_tribal` | **3.0** | 0.30 |
| `fantasy_question`, `one_word_game`, `recommendation_question` | 2.5 | 0.25 |
| `substance_analysis`, `insight_share` | **0.3** | 0.02 |
| `nuanced_question` | 0.5 | 0.03 |

A tool that renders this as advice tells you, every time you open it, that **reply-farming beats
analysis by 10×**. For stratus that is not a neutral number — it's in direct opposition to the
active niche's persona (build in public, substance) and to the whole §8.6 pillar apparatus. Adopt
this table as-is and the coach becomes an engagement-bait optimizer with a stratus logo on it.

Three more pieces of L3 should simply be **dropped** rather than ported, because stratus already
does the same job with measured data instead of invented constants:

- `postingHourMultipliers` (24 hand-written values, ±8%) — stratus has
  `GET /x/metrics/best-times`: real weekday×hour cells from own tweets, age-normalized, gated at
  n≥3, already wired into the Composer and the brief (S0.4).
- `mediaAttachmentMultiplier` (1.06) — stratus has `has_media` + `buildMediaEffectiveness`, gated
  n≥20/side (S0.2).
- `accountAgeMultiplier` — a 0.95→1.08 ramp over 10 years. For a single fixed account this is a
  constant; it can't inform anything.

Also note `trending-topic-lexicon.ts` carries an explicit expiry (`trendingTopicAsOf =
"2026-06-14"` with *"entries EXPIRE; review every release"*) — a hardcoded list of model names.
Stratus already has a user-editable equivalent in `channels.keywords` (C8) with the same
word-boundary matching in `src/shared/channelSuggest.ts`. Reuse that; don't inherit a list that
rots.

### Inputs (what feeds the engine)

`LiveContextResolver` (`capture/live-context-resolver.ts`) patches the scoring context from the
local corpus, caller-supplied values always winning:

- `followers` ← most recent profile snapshot.
- `trailingMedianImpressions` ← integer median over the **20 most recent original posts** that
  carry a live-capture snapshot.
- `repeatHistory` ← `RepetitionWindowService.compute(7)`.

The repetition window (`capture/repetition-window-service.ts`) is the cooldown feature: originals
only, classified by format, clustered by **Jaccard token overlap ≥0.45** (stop-worded, ≥3-char
tokens) so it counts *repeated ideas*, not just repeated formats; ≥4 in 7d = cooldown, ≥2 =
warming. The reach model then applies `repeatDecayBase^count` floored at 0.2 — but only when the
prior text overlaps the draft ≥0.5 (`prediction-estimator.ts:469`), so an entry with no stored
text never decays. Careful, defensible design.

---

## Adoption assessment

### What stratus gains that it cannot get elsewhere

1. **A pre-publish signal at all.** Stratus currently has zero draft-time feedback on its own text.
   The Composer knows *when* to post (best-times), *what pillar* it is, and whether a URL will cost
   $0.20 — but nothing about the draft itself. Every quality signal it has is **post-hoc**
   (Playbook, n≥20, weeks late) or **about other people's tweets** (`replyBand`). The Coach closes
   a loop that is currently open by ~2 weeks.
2. **A free structural axis over 100% of history.** `posts_published.text` is `NOT NULL`, so
   classifying at read time yields format×outcome for every measured tweet ever, immediately —
   including the ~n needed to clear the Playbook's own n≥20 gate on day one, where every other
   Playbook cell has had to wait months.
3. **The `expand_zone` and `profile_click_reason` rules** — platform mechanics and a pre-publish
   proxy for the outcome column stratus cares most about.
4. **A cooldown that covers hand-written posts.** `plans/2026-07-22-mika-growth-tactics.md`
   decision 6 already plans a cooldown on `register` + `pillar` — but those are stamped only by the
   drafter, so hand-written posts land in an `unknown` bucket that is *surfaced but never warned
   on*. A format classifier reads the text, so the cooldown covers everything. **This supersedes
   the GT cooldown task** rather than duplicating it.
5. **The seed→fitted machinery**, which stratus can actually complete. x-builder's calibration
   scaffold is a working refit pipeline with no corpus. Stratus's corpus is `metrics_snapshots`.

### What stratus must NOT adopt

1. **The reach numbers.** Ship the classifier and *measure*; never render an invented multiplier.
   Under stratus's gating rule the honest output for months is "insufficient data (n=…)", which is
   exactly what every other Playbook cell says.
2. **The engagement-bait gradient as advice.** If a fitted format table ever does show `cta_farm`
   winning, that's a *description* to put in the Playbook, not a nudge to put in the Composer.
   The niche persona is the constraint; the number is the observation.
3. **Verbatim code.** There is **no LICENSE file** in the repo (`creynir/x-builder`), which under
   default copyright means all rights reserved. The *rules* are unprotectable facts ("don't use
   em-dashes", "cap hashtags at 2", "15 lines triggers show-more") and the *aggregation arithmetic*
   is trivial; the *expression* — their exact regexes, label strings, file layout — is not. Port by
   re-implementing from the rule list, with our own regexes and copy, and a header comment citing
   the source. This is also the better engineering outcome: a third of their lexicon is
   audience-specific and has to be niche-scoped for stratus anyway.
4. **A fourth taxonomy with no relationship to the other three.** Format is orthogonal to
   pillar/register/angle and should be stated as such in one place, or the Playbook grows a fourth
   set of cells nobody can reason about jointly.

### The honest risk: does any of this correlate with anything?

x-builder's own conclusion — *quality is nearly uncorrelated with impressions* — is the reason to
build the measurement half **at the same time** as the coach half. Stratus can do what x-builder
cannot: bucket its own measured posts by static score band and by format, and ask whether either
predicts views or profile clicks. If the score band shows nothing at n≥20 (the likely outcome, and
the outcome their own analysis predicts), the Coach is still worth keeping — as a **floor** that
catches em-dashes, 15-line truncation, weak closers and URL surcharges — but it must never be
dressed up as a lift. That framing has to be in the UI copy from the first commit, not retrofitted
after the first disappointing Playbook cell.

### Cost

**$0 recurring, $0 per use.** Pure functions over text already in the DB. No X API reads, no LLM
calls, no new tables required for the first two phases. The only spend-adjacent effect is
*negative*: a URL check at draft time catches the $0.20 surcharge earlier than the schedule-time
guard.

### Verdict

Adopt **L0 + L1 + L2 now** (re-implemented, niche-scoped, framed as a floor), adopt **L3's
architecture but none of its numbers**, and let stratus's own measured corpus fill the table it
was designed for. Plan: `plans/2026-07-22-static-coach.md`.
