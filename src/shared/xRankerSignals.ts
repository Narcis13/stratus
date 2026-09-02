// Our estimator layer over X's published ranker weights (XR.2) — the mapping
// from a draft (or a measured post) onto per-head probabilities, and the two
// scores built on it.
//
// **The split with `xRanker.ts` is the point of both files.** That one holds
// FACTS: X's 26 published weights and the `ranking_scorer.rs` arithmetic,
// transcribed from X's own source. This one holds ESTIMATES: what we guess a
// post's per-head probabilities are. Nothing here is authoritative, every
// number carries a `provenance`, and a reader who confuses the two files has
// confused a published production parameter with our opening guess.
//
// Two entry points:
//   `scoreDraftRanker(text, feats, opts)` -> **C**, prospective. What the For
//        You ranker is predisposed to predict from this shape, before it ships.
//   `scoreMeasured(counts, feats)`        -> **E**, retrospective. The same
//        weights over a post's real, observed rates.
//
// C is CONTEXT, never advice (§7.23a). It may not sort, gate, block or refuse,
// and it does not answer the same question the coach pill answers: `postCoach`
// is an own-goal FLOOR over prose facts, C is the ranker's predisposition over
// estimated probabilities. Two numbers, two questions — the Composer copy
// (XR.5) says which is which. Whether either separates our own posts by median
// views is XR.4's cell, and until that cell clears n>=20 per side neither is
// a claim about reach.
//
// Canonical home (§7.27): consumed by the server and, from XR.5 on, by the
// panel and the content script through re-export shims.
//
// ---------------------------------------------------------------- provenance
//
// Ported on 2026-09-02 from Bangermeter — MIT, Copyright (c) 2026 Ryan Lenk —
// `extension/weights.js` (`baselineP`, `observedRates`, `engagementShrinkage`)
// and `extension/scoring.js` (`engagementScore`'s empirical-Bayes shrinkage,
// `contentScore`'s always-on / enable-only head split, `vqvEligible`). Those
// are theirs and are credited here; the MIT permission notice travels with
// them:
//
//   Permission is hereby granted, free of charge, to any person obtaining a
//   copy of this software and associated documentation files (the "Software"),
//   to deal in the Software without restriction, including without limitation
//   the rights to use, copy, modify, merge, publish, distribute, sublicense,
//   and/or sell copies of the Software, and to permit persons to whom the
//   Software is furnished to do so, subject to the following conditions: the
//   above copyright notice and this permission notice shall be included in all
//   copies or substantial portions of the Software.
//
// **`xRanker.ts` carries a DIFFERENT attribution and that is not an
// inconsistency.** Its weights were read off X's own repository (Apache-2.0,
// xai-org/x-algorithm) because the Bangermeter tree was not on the machine the
// day XR.1 ran; this file's material has no upstream to go to, so it is
// credited to Bangermeter. Each file cites what was actually read. See
// STATE.md D225.
//
// **What is deliberately NOT ported: their `contentModifiers` table.** It
// overlaps `postCoach`'s 29 rules, and shipping both would put two rule
// vocabularies on one sentence — the fork §7.27 exists to prevent (plan
// Decision 1). `X_MODIFIERS` below is anchored in OUR vocabulary instead:
// every entry names a `postCoach` check id, a `postFormat` value, or a
// `DraftFeatures` flag declared in this file. Their table survives as this
// sentence.
//
// ------------------------------------------------------------------- traps
//
//   1. A modifier multiplies a PROBABILITY, never a score. Factors compose
//      multiplicatively and are clamped at the head's ceiling, so a stack of
//      "x1.5" penalties cannot drive `not_dwelled` past 1.0.
//   2. `open_link` is a REACH fact. The ranker pays 0.2 for a link open; it
//      does not punish links. Invariant #1 -- the $0.20-vs-$0.015 URL
//      surcharge -- is an X **API pricing** rule about `createPost` and is
//      untouched by this file. The coach's `url_cost` check is what surfaces
//      the billing rule, and it is deliberately absent from `X_MODIFIERS`:
//      conflating the two would let a reach model argue with a budget.
//   3. Network position is KNOWN for a draft and UNKNOWN for a sighting.
//      `xRanker.oonApplies` maps unknown to `false` on purpose. A draft of our
//      own post is in-network for our own followers, so `scoreDraftRanker`
//      supplies `inNetwork: true` (flip it with `assumeOutOfNetwork`); a
//      measured post is not rescored at all -- see `scoreMeasured`.
//   4. `vqv`'s weight is 0.0, so its duration gate changes no score. It is
//      still enforced, because a `vqv` row in `contributions` claims the head
//      fired -- and "the gate fired and X paid nothing for it" is the finding.

import { type CoachLexicon, type CoachResult, scoreDraft } from './postCoach.ts';
import { type PostFormat, classifyFormat } from './postFormat.ts';
import {
  type XHeadName,
  X_HEADS,
  normalizeScore,
  offsetScore,
  oonApplies,
  replyWeightFor,
  scoreHeads,
} from './xRanker.ts';
import type { HeadContribution } from './xRanker.ts';

// ------------------------------------------------------------------ the rates

/** What a post carrying NO notable content signals is estimated to do, per
 *  impression — the starting point `X_MODIFIERS` multiplies.
 *
 *  **Deliberately NOT the measured median in `X_OBSERVED_RATES` below** (plan
 *  Decision 4). A measured median is the rate of a typical post *including*
 *  whatever signals it happens to carry; using it as the signal-free base
 *  double-counts the average signal and flattens the score's ability to
 *  separate a strong post from a weak one. Two numbers, two questions, never
 *  merged.
 *
 *  Estimates, all of them — Bangermeter's, kept because they are calibrated so
 *  that `weight x p` lands in a comparable band across heads, which is what
 *  X's own note about the weights implies. `cont_dwell_time` is in SECONDS,
 *  not a probability. */
export const X_BASELINE_P: Readonly<Partial<Record<XHeadName, number>>> = {
  favorite: 0.005,
  reply: 0.0005,
  retweet: 0.0005,
  quote: 0.0001,
  share: 0.0004,
  share_via_dm: 0.0002,
  share_via_copy_link: 0.00005,
  follow_author: 0.0002,
  click: 0.01,
  open_link: 0.002, // enable-only: a link is present
  photo_expand: 0.012, // enable-only: an image is present
  video_open: 0.02, // enable-only: video is present
  vqv: 0.03, // enable-only: video strictly over 10s
  quoted_click: 0.004, // enable-only: the post quotes another
  cont_dwell_time: 3.0, // SECONDS of predicted dwell, not a probability
  not_dwelled: 0.55, // most impressions are scrolled past
  not_interested: 0.00005,
  block_author: 0.00001,
  mute_author: 0.00001,
  report: 0.000005,
};

export const X_BASELINE_P_PROVENANCE = 'bangermeter-estimate' as const;

/** The E score's reference: what a typical post really does per view.
 *
 *  **OURS, measured (XR.3).** Per-post medians over 766 tweets from our own
 *  passive Home-Timeline harvest (`harvest_rows` where `mode = 'timeline'`,
 *  deduped at first sighting, `views > 0`), collected 2026-07-24..2026-08-17.
 *  Rerun `bun run scripts/calibrate-ranker.ts` to re-derive; it refuses below
 *  n=100 and prints what the swap does to the score distribution.
 *
 *  These replaced Bangermeter's 141-post For You sample of 0.0123 / 0.00135 /
 *  0.0007, which was low by 2.4x on favorites and **14.6x on replies**. Under
 *  those, the median post in OUR feed scored 63 on a scale whose midpoint is 50
 *  and 77% of the corpus read above average. Against these it reads 50 and 43%.
 *  That gap is a real difference between two feeds, not a sampling artefact:
 *  both samples are feed-time readings of the same maturity (theirs median 6h /
 *  max 43h, ours median 3.1h / max 44.6h).
 *
 *  **Why `retweet` is 0 and that is not a missing measurement.** 66% of the
 *  posts in our feed have no reposts at all, so zero IS the median. The head
 *  becomes one-sided — at-reference for a post with none, above it for any post
 *  with one — which is the honest shape of the thing. Nothing divides by it:
 *  it is a shrinkage prior (`scoreMeasured`) and a baseline term
 *  (`measuredBaselineRaw`), never a denominator.
 *
 *  **Limits, and they are ours rather than theirs.** One account, one niche —
 *  a Home Timeline full of small founder accounts whose reply rates run an
 *  order of magnitude above a general feed (median 297 views against their
 *  6,600). The For You / Following split is NOT recorded by the passive
 *  harvester, and their sample found Following running ~2x For You, so ours is
 *  a blend of unknown proportions. These are **not** population constants for
 *  X and must not be quoted as such — they are the reference that makes one of
 *  our sightings comparable to another of our sightings.
 *
 *  Recalibration trigger: rerun when the corpus has roughly doubled, or after
 *  any change in who the account follows — that changes the feed, which is the
 *  whole population being measured. */
export const X_OBSERVED_RATES: Readonly<Record<'favorite' | 'reply' | 'retweet', number>> = {
  favorite: 0.029412,
  reply: 0.019774,
  retweet: 0,
};

export const X_OBSERVED_RATES_PROVENANCE = 'measured' as const;

/** Sample stamp for `X_OBSERVED_RATES` — what was measured, and off what. */
export const X_OBSERVED_RATES_SAMPLE = {
  n: 766,
  feed: 'home-timeline',
  collected: '2026-07-24..2026-08-17',
  source: "harvest_rows mode='timeline'",
} as const;

/** Empirical-Bayes pseudo-views for the E score:  p̂ = (count + K·p0)/(views + K).
 *  At K = 2000 a post with 200 views is pulled ~91% toward the feed median, so
 *  a single like on a small post cannot spike it. `provenance: 'estimate'`.
 *
 *  **XR.3 measured what that costs us and it is the binding constraint on E.**
 *  K was borrowed from a feed whose median post has 6,600 views (pulled 23%);
 *  ours has 297 (pulled ~87%), so a typical sighting is nearly on the reference
 *  before it is scored and E's p10..p90 spans only 32..54. The rates are right;
 *  the smoother is too strong for this corpus. Not retuned here — that is a
 *  measured recalibration, and XR.4's cell is what will justify one. */
export const ENGAGEMENT_SHRINKAGE_PSEUDO_VIEWS = 2000;

/** `rust_home_mixer_min_video_duration_ms` (xai-org/x-algorithm @ 7ba77684).
 *  Published, not an estimate — it lives here rather than in `xRanker.ts`
 *  because it gates one of OUR enable-only heads and has no other consumer. */
export const MIN_VIDEO_DURATION_MS = 10_000;

// -------------------------------------------------------------- the features

export interface DraftFeatures {
  hasImage?: boolean;
  hasVideo?: boolean;
  videoSeconds?: number | null;
  hasExternalLink?: boolean;
  isThreadStarter?: boolean;
  isReply?: boolean;
  isQuote?: boolean;
  /** Score as seen by a mutual follow: takes `reply` from 5.0 to 20.0 on an
   *  original. Viewer state, not post state — the same post scores differently
   *  for a mutual than for a stranger. */
  isMutualFollow?: boolean;
  /** Score as seen from outside the network: applies the 0.75 OON factor even
   *  to an original. Default is in-network (trap 3). */
  assumeOutOfNetwork?: boolean;
}

// ------------------------------------------------------------- the modifiers

/** Where a modifier's trigger comes from. Naming the source in the data is
 *  what keeps this table from drifting back into a second rule vocabulary:
 *  a `coach` entry is a `postCoach` check id, asserted against the live check
 *  list by the suite, and a `format` entry is a real `PostFormat`. */
export type ModifierSource =
  | { kind: 'coach'; id: string; on: 'pass' | 'flag' }
  | { kind: 'format'; format: PostFormat }
  | { kind: 'feature'; flag: keyof DraftFeatures };

export interface RankerModifier {
  id: string;
  label: string;
  from: ModifierSource;
  /** head -> multiplier on that head's baseline probability. One map rather
   *  than Bangermeter's `applies` + `factor` + `alsoApplies` triple: a head
   *  that moves the other way is the same kind of fact, and a `Record` makes
   *  "names a real head" a type error instead of a string split. */
  applies: Partial<Record<XHeadName, number>>;
  /** Which way the score is claimed to move. Asserted one modifier at a time
   *  by the suite — a mixed-direction entry is deliberately not in the table,
   *  because a chip that says "this moved your score somewhere" tells the
   *  writer nothing. */
  direction: 'up' | 'down';
  provenance: 'estimate';
  /** Names the head AND its weight. A factor with no weight behind it is a
   *  hunch, and this table is allowed to hold guesses but not hunches. */
  why: string;
}

/** **Magnitudes are opening guesses** (plan Decision 5). How far a coach check
 *  moves a head's probability is unmeasured; what is grounded is the DIRECTION
 *  and the choice of head, each anchored on the published weight it exploits.
 *  Recalibration trigger: >=100 measured originals through XR.4's cell. Never
 *  move one of these by vibes (CLAUDE.md thresholds rule). */
export const X_MODIFIERS: readonly RankerModifier[] = [
  // --- down ---------------------------------------------------------------
  {
    id: 'thin_substance',
    label: 'Too thin to hold anyone',
    from: { kind: 'coach', id: 'substance', on: 'flag' },
    applies: { cont_dwell_time: 0.5, not_dwelled: 1.3 },
    direction: 'down',
    provenance: 'estimate',
    why: 'Under 7 words gives nothing to dwell on. `cont_dwell_time` pays 0.004 per SECOND and `not_dwelled` costs -0.02 — the largest pair of terms an ordinary post carries.',
  },
  {
    id: 'curiosity_bait',
    label: 'Curiosity bait with no payload',
    from: { kind: 'coach', id: 'vague_curiosity', on: 'flag' },
    applies: { not_interested: 2.5, not_dwelled: 1.25, favorite: 0.7 },
    direction: 'down',
    provenance: 'estimate',
    why: 'A tease with nothing behind it invites `not_interested` (-43.2), the second-largest magnitude in the table, and buys no dwell.',
  },
  {
    id: 'shouting',
    label: 'Shouting in caps',
    from: { kind: 'coach', id: 'all_caps', on: 'flag' },
    applies: { not_interested: 1.5, mute_author: 1.5 },
    direction: 'down',
    provenance: 'estimate',
    why: 'Caps correlate with "show less" feedback: `not_interested` -43.2 and `mute_author` -58.8.',
  },
  {
    id: 'tag_spam',
    label: 'Tag-spam density',
    from: { kind: 'coach', id: 'mention_density', on: 'flag' },
    applies: { not_interested: 1.5, block_author: 1.5 },
    direction: 'down',
    provenance: 'estimate',
    why: 'Three or more @mentions reads as being tagged at, not talked to — `not_interested` -43.2 and `block_author` -31.2.',
  },
  {
    id: 'hashtag_spam',
    label: '3+ hashtags',
    from: { kind: 'coach', id: 'hashtags', on: 'flag' },
    applies: { favorite: 0.9, retweet: 0.9, not_interested: 1.2 },
    direction: 'down',
    provenance: 'estimate',
    why: "Earlybird's multiple-hashtag penalty exists in code and its magnitude was never published, so this stays mild: `favorite` 0.5, `retweet` 1.0, `not_interested` -43.2.",
  },
  {
    id: 'canned_closer',
    label: 'Canned closer',
    from: { kind: 'coach', id: 'weak_closer', on: 'flag' },
    applies: { reply: 0.8, not_interested: 1.4 },
    direction: 'down',
    provenance: 'estimate',
    why: '"Thoughts?" asks for the reply without earning it. `reply` is 5.0 — ten times a like — and reply-farming is what `not_interested` (-43.2) is for.',
  },
  {
    id: 'ai_tells',
    label: 'AI-tell phrasing',
    from: { kind: 'coach', id: 'ai_tells', on: 'flag' },
    applies: { favorite: 0.85, cont_dwell_time: 0.9, not_interested: 1.3 },
    direction: 'down',
    provenance: 'estimate',
    why: 'Generated-sounding prose is skimmed rather than read: `cont_dwell_time` 0.004/sec, `favorite` 0.5, `not_interested` -43.2.',
  },
  {
    id: 'stacked_questions',
    label: 'Stacked questions',
    from: { kind: 'coach', id: 'answerable_question', on: 'flag' },
    applies: { reply: 0.7, not_interested: 1.4 },
    direction: 'down',
    provenance: 'estimate',
    why: 'Nobody answers a quiz. Two or more questions lower the very head they are aimed at — `reply` 5.0 — while inviting `not_interested` -43.2.',
  },
  {
    id: 'behind_the_fold',
    label: 'Hidden behind "show more"',
    from: { kind: 'coach', id: 'show_more', on: 'flag' },
    applies: { not_dwelled: 1.2, cont_dwell_time: 0.85 },
    direction: 'down',
    provenance: 'estimate',
    why: 'A platform mechanic, not a taste rule: 15 raw lines folds the post, and a folded post is scrolled past. `not_dwelled` -0.02, `cont_dwell_time` 0.004/sec.',
  },
  {
    id: 'flat_opener',
    label: 'Flat opener',
    from: { kind: 'coach', id: 'weak_opener', on: 'flag' },
    applies: { click: 0.85, not_dwelled: 1.2 },
    direction: 'down',
    provenance: 'estimate',
    why: 'Line one decides the scroll: it gates `click` (0.4) and it is the whole of what `not_dwelled` (-0.02) measures.',
  },
  {
    id: 'wall_of_text',
    label: 'Wall-of-text line',
    from: { kind: 'coach', id: 'dense_line', on: 'flag' },
    applies: { not_dwelled: 1.2, cont_dwell_time: 0.9 },
    direction: 'down',
    provenance: 'estimate',
    why: 'A 180-char unbroken line loses mobile readers before the dwell clock starts: `not_dwelled` -0.02, `cont_dwell_time` 0.004/sec.',
  },
  // --- up -----------------------------------------------------------------
  {
    id: 'hooked_opener',
    label: 'First line hooks',
    from: { kind: 'coach', id: 'hook_opener', on: 'pass' },
    applies: { click: 1.2, not_dwelled: 0.85, cont_dwell_time: 1.15 },
    direction: 'up',
    provenance: 'estimate',
    why: 'The hook is what stops the scroll, which is exactly the `not_dwelled` (-0.02) / `cont_dwell_time` (0.004/sec) pair, and it earns the `click` (0.4).',
  },
  {
    id: 'quotable_shape',
    label: 'Quotable shape',
    from: { kind: 'coach', id: 'quotable', on: 'pass' },
    applies: { quote: 1.3, share_via_copy_link: 1.3 },
    direction: 'up',
    provenance: 'estimate',
    why: 'A line short enough to screenshot is a line worth quoting (`quote` 5.0) or copying out (`share_via_copy_link` 20.0 — the largest positive weight in the table by 4x).',
  },
  {
    id: 'concrete_detail',
    label: 'Concrete detail',
    from: { kind: 'coach', id: 'concrete_detail', on: 'pass' },
    applies: { favorite: 1.1, share_via_copy_link: 1.2 },
    direction: 'up',
    provenance: 'estimate',
    why: 'A number or a name is what gets copied out of X: `share_via_copy_link` 20.0, `favorite` 0.5.',
  },
  {
    id: 'own_proof',
    label: 'Own proof, not generic advice',
    from: { kind: 'coach', id: 'profile_click', on: 'pass' },
    applies: { follow_author: 1.4 },
    direction: 'up',
    provenance: 'estimate',
    why: "First-person proof is the reason a stranger follows: `follow_author` 4.0. NOTE the name collision — postCoach's `profile_click` CHECK is mapped onto the follow head on purpose, because the ranker's `profile_click` HEAD is weighted 0.0 and moving it would do nothing.",
  },
  {
    id: 'delivers_value',
    label: 'Delivers value',
    from: { kind: 'coach', id: 'value_signal', on: 'pass' },
    applies: { favorite: 1.15, share: 1.3, share_via_dm: 1.3, follow_author: 1.2 },
    direction: 'up',
    provenance: 'estimate',
    why: 'Something teachable, provable or funny is what gets passed on: `share` 2.0, `share_via_dm` 5.0, `follow_author` 4.0.',
  },
  {
    id: 'has_turn',
    label: 'Has a turn or contrast',
    from: { kind: 'coach', id: 'tension', on: 'pass' },
    applies: { cont_dwell_time: 1.15, quote: 1.2 },
    direction: 'up',
    provenance: 'estimate',
    why: 'A contrast is what makes a post worth finishing (`cont_dwell_time` 0.004/sec) and gives a quoter something to agree or disagree with (`quote` 5.0).',
  },
  {
    id: 'reads_long',
    label: 'Long enough to read, not skim',
    from: { kind: 'coach', id: 'word_count', on: 'flag' },
    applies: { cont_dwell_time: 1.35, not_dwelled: 0.8 },
    direction: 'up',
    provenance: 'estimate',
    why: '**The clearest place the two pills disagree, and the reason C exists beside the coach.** `word_count` flags a post over 30 words as unpunchy and DOCKS the coach score; the ranker pays for exactly that, per second (`cont_dwell_time` 0.004) and by not being scrolled past (`not_dwelled` -0.02). Neither is wrong — they answer different questions.',
  },
  {
    id: 'format_question',
    label: 'Question format',
    from: { kind: 'format', format: 'question' },
    applies: { reply: 1.4, quote: 1.2 },
    direction: 'up',
    provenance: 'estimate',
    why: 'A real question raises expected reply rate, and `reply` is 5.0 — ten times a like — with `quote` matching it at 5.0.',
  },
  {
    id: 'format_story',
    label: 'Story format',
    from: { kind: 'format', format: 'story' },
    applies: { cont_dwell_time: 1.3, not_dwelled: 0.8 },
    direction: 'up',
    provenance: 'estimate',
    why: 'A narrative is read to the end rather than skimmed: `cont_dwell_time` 0.004/sec against `not_dwelled` -0.02.',
  },
  {
    id: 'format_list',
    label: 'List format',
    from: { kind: 'format', format: 'list' },
    applies: { cont_dwell_time: 1.2, share_via_copy_link: 1.2 },
    direction: 'up',
    provenance: 'estimate',
    why: 'A list is scanned line by line and saved for later: `cont_dwell_time` 0.004/sec, `share_via_copy_link` 20.0.',
  },
  {
    id: 'format_data_comparison',
    label: 'Data comparison format',
    from: { kind: 'format', format: 'data_comparison' },
    applies: { share_via_copy_link: 1.3, retweet: 1.2 },
    direction: 'up',
    provenance: 'estimate',
    why: 'A before/after number is the most copied and reposted shape there is: `share_via_copy_link` 20.0, `retweet` 1.0.',
  },
  {
    id: 'thread_starter',
    label: 'Thread starter',
    from: { kind: 'feature', flag: 'isThreadStarter' },
    applies: { click: 1.3, quote: 1.2 },
    direction: 'up',
    provenance: 'estimate',
    why: 'A first post with more behind it is what a post CLICK is (`click` 0.4), and a thread gives people something to quote (`quote` 5.0).',
  },
];

// ---------------------------------------------------------------- the bands

export type RankerBand = 'below' | 'typical' | 'strong';

/** Cut points from Bangermeter's `scoreLevel` (40 / 65), `provenance:
 *  'estimate'`, and checked rather than assumed: they were derived against
 *  their `50·sqrt(raw/baseline)` display scale, while ours is `xRanker`'s
 *  parameter-free `100·raw/(raw+baseline)`. In the band that matters the two
 *  agree closely — 65 is a ratio of 1.69 there against 1.86 here, 40 is 0.64
 *  against 0.67 — and they only diverge in the tails, where theirs pins at 100
 *  for anything at 4x baseline and ours never saturates.
 *
 *  **Deliberately NOT `CoachBand`'s vocabulary.** C is a different scale
 *  answering a different question; sharing the words would invite the two
 *  pills to be read as one number.
 *
 *  **UNVALIDATED, and measurably off-centre today** — the same status
 *  `X_OBSERVED_RATES` carries, for the same reason (§7.34: it is the borrowed
 *  METHOD that needs validating, not only the borrowed number). 50 is where a
 *  draft with ZERO modifiers lands, and no real draft has zero modifiers:
 *  `X_MODIFIERS` keys twelve of its entries on `postCoach` checks PASSING, and
 *  an ordinary well-formed post passes several. Measured over the suite's
 *  fixtures, a competent post lands at 66-71 — so `strong` is the modal band,
 *  not the exceptional one. Their cut points were calibrated against their own
 *  modifier set, which is mostly penalties and rare enables; ours mostly
 *  rewards.
 *
 *  Left at 40/65 on purpose rather than nudged to fit: the reference a band
 *  should be centred on is a TYPICAL draft, and what a typical draft scores is
 *  a measurement nobody has taken yet. `SIGNAL_FREE_SCORE` and the suite's
 *  distribution fixture pin today's behaviour so a recalibration is a visible
 *  decision instead of a drift.
 *
 *  TODO(XR.4): re-cut off the measured quartiles once the falsification cell
 *  has n>=20 per side. Never by vibes (CLAUDE.md thresholds rule). */
export const RANKER_BAND_CUTS = { strong: 65, typical: 40 } as const;

export const RANKER_BAND_CUTS_PROVENANCE = 'imported-unvalidated' as const;

export const RANKER_BAND_LABEL: Record<RankerBand, string> = {
  below: 'below typical',
  typical: 'typical',
  strong: 'strong shape',
};

export const RANKER_DISCLAIMER =
  "Context, not advice — X's published weights over estimated probabilities, not a reach prediction.";

export function rankerBand(score: number): RankerBand {
  if (score >= RANKER_BAND_CUTS.strong) return 'strong';
  if (score >= RANKER_BAND_CUTS.typical) return 'typical';
  return 'below';
}

// ------------------------------------------------------------------ the maths

/** Heads scored for every post regardless of media or links. Ordered as
 *  `X_HEADS` is, i.e. production scoring order. */
const ALWAYS_ON: readonly XHeadName[] = [
  'favorite',
  'reply',
  'retweet',
  'click',
  'share',
  'share_via_dm',
  'share_via_copy_link',
  'quote',
  'cont_dwell_time',
  'follow_author',
  'not_interested',
  'block_author',
  'mute_author',
  'report',
  'not_dwelled',
];

/** `cont_dwell_time` is seconds, so its ceiling is not 1. 600s is ten minutes
 *  on one post — unreachable in practice and there only so a runaway factor
 *  stack cannot produce an absurd number. */
const HEAD_CEILING = (head: XHeadName): number => (head === 'cont_dwell_time' ? 600 : 1);

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** Is the video-quality-view head payable?
 *
 *  `MinVideoDurationMs` is a STRICT gate, so a 10.000s clip earns nothing.
 *  An UNKNOWN duration earns nothing either — Bangermeter credits it on the
 *  grounds that most X video clears 10s, but §7.11 says an unmeasured thing is
 *  unknown rather than assumed, and a GIF reaches us as exactly that (video
 *  with no duration). Since `vqv`'s weight is 0.0 the choice moves no score;
 *  what it moves is whether `contributions` claims the head fired (trap 4).
 *
 *  A second published gate we cannot see — the VIEWER having under 10,000
 *  followers — can zero it as well, so even an eligible clip is not promised
 *  the head. Disclosed rather than modelled. */
export function vqvEligible(feats: DraftFeatures): boolean {
  if (feats.hasVideo !== true) return false;
  const seconds = feats.videoSeconds;
  if (seconds === null || seconds === undefined) return false;
  return seconds * 1000 > MIN_VIDEO_DURATION_MS;
}

export interface AppliedModifier {
  id: string;
  label: string;
  direction: 'up' | 'down';
  applies: Partial<Record<XHeadName, number>>;
  provenance: 'estimate';
  why: string;
}

export interface HeadProbabilities {
  headPs: Partial<Record<XHeadName, number>>;
  applied: AppliedModifier[];
}

/** The mapping itself: our signal vocabulary -> per-head probabilities.
 *
 *  Exported because it is the interesting half — a caller that wants to show
 *  *why* a draft scored what it scored reads `applied`, and XR.4's cell reads
 *  `headPs`. Absent affordance ⇒ head absent, never 0 (§7.11): a zero would
 *  claim the head fired and did nothing, which drags the score down for every
 *  post we merely failed to measure. */
export function signalsToHeadPs(
  coach: CoachResult,
  format: PostFormat,
  feats: DraftFeatures = {},
): HeadProbabilities {
  const headPs: Partial<Record<XHeadName, number>> = {};
  for (const head of ALWAYS_ON) {
    const base = X_BASELINE_P[head];
    if (base !== undefined) headPs[head] = base;
  }

  // Enable-only heads. Each is scored only when the post carries the
  // affordance the head is about.
  const linkP = X_BASELINE_P.open_link;
  if (feats.hasExternalLink === true && linkP !== undefined) headPs.open_link = linkP;
  const photoP = X_BASELINE_P.photo_expand;
  if (feats.hasImage === true && feats.hasVideo !== true && photoP !== undefined) {
    headPs.photo_expand = photoP;
  }
  if (feats.hasVideo === true) {
    const videoP = X_BASELINE_P.video_open;
    if (videoP !== undefined) headPs.video_open = videoP;
    const vqvP = X_BASELINE_P.vqv;
    if (vqvEligible(feats) && vqvP !== undefined) headPs.vqv = vqvP;
  }
  const quotedP = X_BASELINE_P.quoted_click;
  if (feats.isQuote === true && quotedP !== undefined) headPs.quoted_click = quotedP;

  const status = new Map(coach.checks.map((c) => [c.id, c.status]));
  const applied: AppliedModifier[] = [];

  for (const mod of X_MODIFIERS) {
    if (!modifierFires(mod.from, status, format, feats)) continue;
    for (const [head, factor] of Object.entries(mod.applies) as [XHeadName, number][]) {
      const current = headPs[head];
      if (current === undefined) continue; // head not scored for this post
      headPs[head] = clamp(current * factor, 0, HEAD_CEILING(head));
    }
    applied.push({
      id: mod.id,
      label: mod.label,
      direction: mod.direction,
      applies: mod.applies,
      provenance: mod.provenance,
      why: mod.why,
    });
  }

  return { headPs, applied };
}

function modifierFires(
  from: ModifierSource,
  status: Map<string, string>,
  format: PostFormat,
  feats: DraftFeatures,
): boolean {
  if (from.kind === 'format') return format === from.format;
  if (from.kind === 'feature') return feats[from.flag] === true;
  const s = status.get(from.id);
  if (s === undefined) return false; // check not applicable to this draft
  // `flag` is "the coach had something to say" — nudge OR fix. A three-state
  // check collapsed to two on purpose: the ranker heads do not have a
  // vocabulary for "mildly".
  return from.on === 'pass' ? s === 'pass' : s !== 'pass';
}

// ------------------------------------------------------------------- C score

export interface RankerDraftResult {
  /** 0-100 against a signal-free post of the same shape, which reads 50. */
  score: number;
  band: RankerBand;
  /** The production `score` — `offsetScore(combined)`, after the OON factor.
   *  Ratios between drafts belong here, not on `score`: the display map is
   *  non-linear, so a 0.75 rescore is a 0.75 ratio on `raw` and something else
   *  on `score`. */
  raw: number;
  /** `positive - negative` before the offset. Negative means the post's
   *  predicted negative heads outweigh everything it earns. */
  combined: number;
  /** `combined < 0`. Such a post is squashed into a sliver strictly below the
   *  score of ANY positive post (xRanker trap 3) — it is not clamped to zero,
   *  because negatives keep their order relative to each other. A surface that
   *  wants to say "below every positive post" reads this flag rather than
   *  looking for a 0 that will never arrive. */
  netNegative: boolean;
  /** The raw score of the same post with no modifiers and no rescoring — the
   *  reference `score` is measured against. */
  baselineRaw: number;
  contributions: HeadContribution[];
  modifiers: AppliedModifier[];
  /** Multiplicative rescorers actually applied, in production order. */
  rescorers: { label: string; factor: number; reason: string }[];
  format: PostFormat;
  coachScore: number;
}

/** **C — the prospective ranker score.**
 *
 *  `opts.coach` exists so the Composer can pass the `CoachResult` it already
 *  computed on the debounced text: that is what guarantees the two pills grade
 *  the same evaluation rather than two evaluations of the same string. When it
 *  is absent the coach is run here, with `isReply` threaded through, so a
 *  non-Composer caller still works. */
export function scoreDraftRanker(
  text: string,
  feats: DraftFeatures = {},
  opts?: { coach?: CoachResult; lexicon?: CoachLexicon },
): RankerDraftResult {
  const coach =
    opts?.coach ??
    (opts?.lexicon !== undefined
      ? scoreDraft(text, { lexicon: opts.lexicon, isReply: feats.isReply === true })
      : scoreDraft(text, { isReply: feats.isReply === true }));
  const format = classifyFormat(text);
  const { headPs, applied } = signalsToHeadPs(coach, format, feats);

  const replyWeight = replyWeightFor({
    isMutualFollow: feats.isMutualFollow === true,
    isReply: feats.isReply === true,
  });
  const scored = scoreHeads(headPs, { reply: replyWeight });

  // Production order is author diversity, then the OON factor. Diversity is
  // slate-relative — it needs the whole timeline, which a draft does not have —
  // so it is `xRanker.diversityMultiplier`'s job at read time and never enters
  // a draft's score.
  const rescorers: { label: string; factor: number; reason: string }[] = [];
  let raw = scored.raw;
  const outOfNetwork = feats.assumeOutOfNetwork === true;
  if (
    oonApplies({
      inNetwork: !outOfNetwork,
      isReply: feats.isReply === true,
    })
  ) {
    raw *= 0.75;
    rescorers.push({
      label: 'Out-of-network x0.75',
      factor: 0.75,
      reason: outOfNetwork ? 'Out-of-network view assumed' : 'In-network reply',
    });
  }

  // The reference: the same post's ALWAYS_ON heads at their signal-free
  // baseline, base reply weight, no modifiers and no rescoring. Enable-only
  // heads stay out of it, so having an image is a gain against the reference
  // rather than being priced into it.
  const baselineRaw = signalFreeBaselineRaw();

  const score = Math.round(normalizeScore(raw, baselineRaw));
  return {
    score,
    // Band off the ROUNDED score, so the number on the pill and the word beside
    // it can never disagree at a cut point.
    band: rankerBand(score),
    raw,
    combined: scored.combined,
    netNegative: scored.combined < 0,
    baselineRaw,
    contributions: scored.contributions,
    modifiers: applied,
    rescorers,
    format,
    coachScore: coach.score,
  };
}

let cachedBaselineRaw: number | null = null;

/** Computed once from `X_BASELINE_P` rather than written down, for the reason
 *  `X_WEIGHT_SUMS` is: a hand-typed literal would silently disagree with the
 *  table the moment XR.3 or a recalibration moves a prior. */
export function signalFreeBaselineRaw(): number {
  if (cachedBaselineRaw !== null) return cachedBaselineRaw;
  const headPs: Partial<Record<XHeadName, number>> = {};
  for (const head of ALWAYS_ON) {
    const base = X_BASELINE_P[head];
    if (base !== undefined) headPs[head] = base;
  }
  cachedBaselineRaw = scoreHeads(headPs).raw;
  return cachedBaselineRaw;
}

// ------------------------------------------------------------------- E score

export interface MeasuredCounts {
  likes: number | null;
  replies: number | null;
  reposts: number | null;
  views: number | null;
}

export type RankerMeasuredResult =
  | { available: false; reason: string }
  | {
      available: true;
      score: number;
      band: RankerBand;
      raw: number;
      baselineRaw: number;
      contributions: HeadContribution[];
      views: number;
      /** Under `ENGAGEMENT_SHRINKAGE_PSEUDO_VIEWS`, so the rates are pulled
       *  hard toward the feed median and the score is about shape, not luck. */
      lowSample: boolean;
      note: string;
    };

/** **E — the retrospective ranker score.** The same published weights over a
 *  post's REAL rates.
 *
 *  Three heads of 26 are observable from a $0 DOM harvest — likes (0.5),
 *  replies (5.0), reposts (1.0). The other 23 need X's own predictions, and
 *  reporting them as zero would be a claim we looked (§7.11), so they are
 *  simply absent.
 *
 *  Rates are shrunk toward the measured feed median, `p̂ = (count + K·p0) /
 *  (views + K)` with K = 2000, so a 1-like/10-view post cannot out-rate a
 *  1000-view post that did ten times better per view.
 *
 *  **No rescoring, deliberately, and this is where we part with Bangermeter.**
 *  Their `engagementScore` applies the OON factor to measured counts; but the
 *  counts ALREADY embed whatever the ranker did to this post in production —
 *  that is their own stated reason for keeping the community-note factor off
 *  the retrospective score, and it applies to OON identically. Rescoring here
 *  would double-count it and would make two sightings incomparable on the
 *  strength of a viewer assumption. */
export function scoreMeasured(
  counts: MeasuredCounts,
  feats: DraftFeatures = {},
): RankerMeasuredResult {
  const views = counts.views;
  if (views === null || views === undefined || !Number.isFinite(views) || views <= 0) {
    return {
      available: false,
      reason: 'No view count — engagement rates are unknown, not zero.',
    };
  }

  const K = ENGAGEMENT_SHRINKAGE_PSEUDO_VIEWS;
  const rate = (n: number | null, p0: number): number | null => {
    if (n === null || n === undefined || !Number.isFinite(n) || n < 0) return null;
    return clamp((n + K * p0) / (views + K), 0, 1);
  };

  const headPs: Partial<Record<XHeadName, number>> = {};
  const favorite = rate(counts.likes, X_OBSERVED_RATES.favorite);
  if (favorite !== null) headPs.favorite = favorite;
  const reply = rate(counts.replies, X_OBSERVED_RATES.reply);
  if (reply !== null) headPs.reply = reply;
  const retweet = rate(counts.reposts, X_OBSERVED_RATES.retweet);
  if (retweet !== null) headPs.retweet = retweet;

  const replyWeight = replyWeightFor({
    isMutualFollow: feats.isMutualFollow === true,
    isReply: feats.isReply === true,
  });
  const scored = scoreHeads(headPs, { reply: replyWeight });

  // Fixed reference: a median post at the measured feed rates, BASE reply
  // weight, no rescoring. A mutual-follow post scoring above it is the finding,
  // not an artefact.
  const baselineRaw = measuredBaselineRaw();
  const score = Math.round(normalizeScore(scored.raw, baselineRaw));
  const lowSample = views < K;

  return {
    available: true,
    score,
    band: rankerBand(score),
    raw: scored.raw,
    baselineRaw,
    contributions: scored.contributions,
    views,
    lowSample,
    note: lowSample
      ? `Only ${views.toLocaleString()} views — rates are smoothed toward the feed median (K=${K.toLocaleString()}), so a small sample cannot spike or tank the score.`
      : `Scored from the three heads a DOM harvest can see: likes (0.5), replies (${replyWeight}), reposts (1.0). The other 23 heads need X's own predictions.`,
  };
}

let cachedMeasuredBaseline: number | null = null;

function measuredBaselineRaw(): number {
  if (cachedMeasuredBaseline !== null) return cachedMeasuredBaseline;
  cachedMeasuredBaseline = scoreHeads({
    favorite: X_OBSERVED_RATES.favorite,
    reply: X_OBSERVED_RATES.reply,
    retweet: X_OBSERVED_RATES.retweet,
  }).raw;
  return cachedMeasuredBaseline;
}

/** Test seam: the two baselines memoize, and XR.3 replaces `X_OBSERVED_RATES`
 *  in this file rather than at runtime, so nothing in production needs this.
 *  A suite that wants to prove the memo is derived and not a literal does. */
export function resetRankerBaselineCache(): void {
  cachedBaselineRaw = null;
  cachedMeasuredBaseline = null;
}

/** Exported for the suite and for XR.5's tooltip: the exact score a post with
 *  no notable signals lands on. It is 50 by construction — `normalizeScore`
 *  puts the reference at the midpoint — and asserting it is what catches a
 *  baseline that stopped being the reference. */
export const SIGNAL_FREE_SCORE = 50;

/** `offsetScore(0)` — the floor of any net-positive post, and the ceiling every
 *  net-negative one is squashed under. Derived, never written down. */
export function positiveFloorRaw(): number {
  return offsetScore(0);
}

/** Sanity guard for callers that hand us head names from outside TypeScript
 *  (the content script's IIFE, a stored row). Not used internally. */
export function isHeadName(name: string): name is XHeadName {
  return Object.hasOwn(X_HEADS, name);
}
