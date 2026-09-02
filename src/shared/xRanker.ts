// X's published For You ranking weights + the `ranking_scorer.rs` arithmetic
// (XR.1) — the weight layer and nothing else.
//
// This file holds FACTS: 26 head weights, their upstream parameter names, the
// sums the production scorer derives from them, and the four arithmetic
// functions that turn per-head probabilities into a score. It contains no
// estimate of any kind. Our estimator — the mapping from a draft's text onto
// per-head probabilities — is `xRankerSignals.ts` (XR.2), deliberately a
// separate file so a reader can never mistake one for the other. **The weights
// are authoritative; nothing downstream of them is.**
//
// Canonical home (§7.27): consumed by the server and, from XR.5 on, by the
// panel and the content script through re-export shims. Dependency-free by
// contract — not one import, value or type — because XR.7 inlines this module
// into the content-script IIFE (§7.26), where a runtime import is fatal. It
// reads no settings store either: a published weight is CODE, not a knob
// (`language.ts`'s rule, and the reason "add a slider for a weight" is
// explicitly out of scope — you cannot tune someone else's ranker).
//
// ---------------------------------------------------------------- provenance
//
// Transcribed on 2026-09-02 directly from X's own published source:
//
//   xai-org/x-algorithm @ 7ba77684 (main, committed 2026-09-01T20:47:22Z)
//   home-mixer/params/param.rs                 — the 26 `param!` defaults
//   home-mixer/params/config.rs:40             — NEGATIVE_SCORES_OFFSET
//   home-mixer/scorers/ranking_scorer.rs       — ScoringWeights::from_params,
//                                                compute_weighted_parts,
//                                                offset_score, reply_weight_for,
//                                                oon_applies, diversity_multiplier
//
// Licensed Apache-2.0 (xai-org/x-algorithm/LICENSE). The weight VALUES are
// published production parameters and are unprotectable facts; the arithmetic
// below is a transcription of the Rust above and carries that license's
// attribution requirement, which this block is.
//
// **Credit where the idea came from:** the feature was inspired by Bangermeter
// (MIT, Copyright (c) 2026 Ryan Lenk), which does the same thing as a browser
// extension. This file is NOT a port of it — that source was not available when
// XR.1 ran, so every constant and every branch here was read off X's own
// repository instead. Said plainly because the plan text asked for a Bangermeter
// attribution, and crediting a file nobody on this task read would be a lie
// about where the numbers came from. See STATE.md D225.
//
// **§7.33 — the oracle is off-machine, so the assertions point at it.** A test
// written by the session that wrote the module proves self-consistency, not
// fidelity. `xRanker.test.ts` therefore asserts each head's `param` STRING as
// well as its value, so a silent transcription slip fails the suite instead of
// quietly re-weighting every score downstream. Re-verification against a newer
// upstream commit is a cheap future task; nothing here auto-detects drift, and
// X syncs these from production rather than freezing them.
//
// ------------------------------------------------------------------- traps
//
// Four branches are load-bearing and each is easy to "clean up" into a bug:
//
//   1. `X_WEIGHT_SUMS.positive` EXCLUDES the three `cont_*` heads and both
//      bidirectional boosts. That subset only shows up on the negative branch
//      of `offsetScore`, so getting it wrong changes every net-negative post's
//      score and NOTHING else — invisible to a test that only scores good posts.
//   2. `scoreHeads` splits terms by the sign of the TERM, not the sign of the
//      weight. A negative probability against a positive weight belongs in the
//      negative pile, and the production loop says so.
//   3. `offsetScore` SQUASHES a net-negative score into a sliver just under
//      zero-plus-offset. It does not clamp. Every negative post still ranks
//      below every positive one, but they keep their order relative to each
//      other — a clamp would throw that ordering away.
//   4. `oonApplies` is a boolean GATE. The 0.75 factor lands exactly once,
//      never squared, and it fires for in-network replies and reposts too.
//
// A head with no probability is `null`, never `0` (§7.11): a zero claims the
// head fired and did nothing, which drags `combined` down for every post we
// merely failed to measure. `scoreHeads` skips nulls entirely.

// ----------------------------------------------------------------- the heads

export type XHeadName =
  | 'favorite'
  | 'reply'
  | 'retweet'
  | 'photo_expand'
  | 'video_open'
  | 'click'
  | 'open_link'
  | 'profile_click'
  | 'vqv'
  | 'share'
  | 'share_via_dm'
  | 'share_via_copy_link'
  | 'dwell'
  | 'quote'
  | 'quoted_click'
  | 'quoted_vqv'
  | 'cont_dwell_time'
  | 'cont_click_dwell_time'
  | 'cont_active_secs_5m_residual_norm'
  | 'follow_author'
  | 'not_interested'
  | 'block_author'
  | 'mute_author'
  | 'report'
  | 'not_dwelled'
  | 'post_unexplored';

export interface XHead {
  /** `param.rs` default. Multiplies a PREDICTED PROBABILITY (or, for a
   *  `continuous` head, a raw value such as seconds) — never a raw engagement
   *  count. X's own source carries a paragraph warning about exactly this
   *  misreading, e.g. "one report cancels 468 likes" is wrong. */
  weight: number;
  /** The upstream feature-switch name. Asserted individually by the suite —
   *  this string is what makes a transcription slip loud. */
  param: string;
  /** `published` — the default is applied as-is.
   *  `config` — the default is a BASE that another published parameter gates or
   *  replaces at scoring time, so this number is not always the applied one. */
  provenance: 'published' | 'config';
  label: string;
  /** Can WE see this from a $0 DOM harvest? Only the three public counters can.
   *  Everything else is a private X signal, which is why `scoreMeasured` (XR.2)
   *  works from three heads and reports the rest as unknown rather than zero. */
  observable: boolean;
  /** Multiplies a continuous value rather than a probability. The three
   *  `cont_*` heads, which are also the three excluded from `positive_sum`. */
  continuous?: boolean;
  note?: string;
}

/** Declared in the order of the `terms` array in `compute_weighted_parts` —
 *  the production scoring order, so a side-by-side read against the Rust is a
 *  straight line down the page. */
export const X_HEADS: Record<XHeadName, XHead> = {
  favorite: {
    weight: 0.5,
    param: 'rust_home_mixer_favorite_weight',
    provenance: 'published',
    label: 'Like',
    observable: true,
  },
  reply: {
    weight: 5.0,
    param: 'rust_home_mixer_reply_weight',
    provenance: 'config',
    label: 'Reply',
    observable: true,
    note: 'Base weight. `replyWeightFor` adds the mutual-follow boost, taking it to 20.0 on an original.',
  },
  retweet: {
    weight: 1.0,
    param: 'rust_home_mixer_retweet_weight',
    provenance: 'published',
    label: 'Repost',
    observable: true,
  },
  photo_expand: {
    weight: 0.05,
    param: 'rust_home_mixer_photo_expand_weight',
    provenance: 'published',
    label: 'Photo expand',
    observable: false,
  },
  video_open: {
    weight: 0.07,
    param: 'rust_home_mixer_video_open_weight',
    provenance: 'published',
    label: 'Video open',
    observable: false,
  },
  click: {
    weight: 0.4,
    param: 'rust_home_mixer_click_weight',
    provenance: 'published',
    label: 'Post click',
    observable: false,
  },
  open_link: {
    weight: 0.2,
    param: 'rust_home_mixer_open_link_weight',
    provenance: 'published',
    label: 'Open link',
    observable: false,
    note: 'A REACH fact, not a billing fact. The ranker does not punish links — it pays for them. Invariant #1 (the $0.20-vs-$0.015 URL surcharge on `createPost`) is an X *API pricing* rule and is untouched by this number. The two get conflated on sight; they are unrelated.',
  },
  profile_click: {
    weight: 0.0,
    param: 'rust_home_mixer_profile_click_weight',
    provenance: 'published',
    label: 'Profile click',
    observable: false,
    note: 'Explicitly zeroed in production. A finding, not an omission — the head is wired and weighted at zero.',
  },
  vqv: {
    weight: 0.0,
    param: 'rust_home_mixer_vqv_weight',
    provenance: 'config',
    label: 'Video quality view',
    observable: false,
    note: 'Explicitly zeroed, AND gated by `MinVideoDurationMs` before the weight is even read.',
  },
  share: {
    weight: 2.0,
    param: 'rust_home_mixer_share_weight',
    provenance: 'published',
    label: 'Share',
    observable: false,
  },
  share_via_dm: {
    weight: 5.0,
    param: 'rust_home_mixer_share_via_dm_weight',
    provenance: 'published',
    label: 'Share via DM',
    observable: false,
  },
  share_via_copy_link: {
    weight: 20.0,
    param: 'rust_home_mixer_share_via_copy_link_weight',
    provenance: 'published',
    label: 'Share via copy link',
    observable: false,
    note: 'The largest positive weight in the table by 4x — copying a link out of X is the strongest positive signal the ranker predicts.',
  },
  dwell: {
    weight: 0.05,
    param: 'rust_home_mixer_dwell_weight',
    provenance: 'config',
    label: 'Dwell',
    observable: false,
    note: 'Base weight. `BidirectionalFollowDwellWeightBoost` would add to it, but that boost is 0.0 today, so unlike the reply boost it never fires.',
  },
  quote: {
    weight: 5.0,
    param: 'rust_home_mixer_quote_weight',
    provenance: 'published',
    label: 'Quote',
    observable: false,
  },
  quoted_click: {
    weight: 0.05,
    param: 'rust_home_mixer_quoted_click_weight',
    provenance: 'published',
    label: 'Quoted-post click',
    observable: false,
  },
  quoted_vqv: {
    weight: 0.0,
    param: 'rust_home_mixer_quoted_vqv_weight',
    provenance: 'config',
    label: 'Quoted video quality view',
    observable: false,
    note: 'Explicitly zeroed, AND gated by `EnableQuotedVqvDurationCheck`.',
  },
  cont_dwell_time: {
    weight: 0.004,
    param: 'rust_home_mixer_cont_dwell_time_weight',
    provenance: 'published',
    label: 'Dwell seconds',
    observable: false,
    continuous: true,
    note: 'Per SECOND, not per event. Paired with `not_dwelled` (-0.02) this is the largest swing an ordinary post carries, which is why "did anyone actually read it" outranks most engagement heads.',
  },
  cont_click_dwell_time: {
    weight: 0.0,
    param: 'rust_home_mixer_cont_click_dwell_time_weight',
    provenance: 'published',
    label: 'Click-dwell seconds',
    observable: false,
    continuous: true,
    note: 'Explicitly zeroed.',
  },
  cont_active_secs_5m_residual_norm: {
    weight: 0.0,
    param: 'rust_home_mixer_cont_active_secs_5m_residual_norm_weight',
    provenance: 'published',
    label: 'Active-seconds residual',
    observable: false,
    continuous: true,
    note: 'Explicitly zeroed.',
  },
  follow_author: {
    weight: 4.0,
    param: 'rust_home_mixer_follow_author_weight',
    provenance: 'published',
    label: 'Follow author',
    observable: false,
  },
  not_interested: {
    weight: -43.2,
    param: 'rust_home_mixer_not_interested_weight',
    provenance: 'published',
    label: 'Not interested',
    observable: false,
  },
  block_author: {
    weight: -31.2,
    param: 'rust_home_mixer_block_author_weight',
    provenance: 'published',
    label: 'Block author',
    observable: false,
  },
  mute_author: {
    weight: -58.8,
    param: 'rust_home_mixer_mute_author_weight',
    provenance: 'published',
    label: 'Mute author',
    observable: false,
  },
  report: {
    weight: -234.0,
    param: 'rust_home_mixer_report_weight',
    provenance: 'published',
    label: 'Report',
    observable: false,
    note: 'The largest magnitude in the table, and the most misread. It weights a PREDICTED report probability, whose baseline is >1000x rarer than a like — it is not "one report cancels 468 likes".',
  },
  not_dwelled: {
    weight: -0.02,
    param: 'rust_home_mixer_not_dwelled_weight',
    provenance: 'published',
    label: 'Scrolled past',
    observable: false,
  },
  post_unexplored: {
    weight: 0.02,
    param: 'rust_home_mixer_post_unexplored_weight',
    provenance: 'config',
    label: 'Post unexplored',
    observable: false,
    note: 'In `positive_sum` only while `EnableMultiplicativePostUnexplored` is false (its default). When true the head becomes a multiplier on dwell time instead and drops out of the sum entirely.',
  },
};

// ------------------------------------------------------- published constants

/** `home-mixer/params/config.rs:40`. */
export const NEGATIVE_SCORES_OFFSET = 0.001;

/** Added to `reply` on an ORIGINAL post from a mutual follow: 5.0 -> 20.0.
 *  Typed `number` rather than left as the literal `15`, because the guard in
 *  `replyWeightFor` is the source's own `!= 0.0` check — a feature switch X can
 *  turn off, not a constant a compiler should fold away. */
export const BIDIRECTIONAL_FOLLOW_REPLY_BOOST: number = 15.0;

/** The out-of-network multiplier. Applied once, never squared (trap 4). */
export const OON_WEIGHT_FACTOR = 0.75;

/** `EnableOonRescoreForInNetworkRepliesRetweets` — default TRUE, which is what
 *  makes an in-network reply take the OON penalty as well. */
export const ENABLE_OON_RESCORE_FOR_IN_NETWORK_REPLIES_RETWEETS = true;

/** `EnableMultiplicativePostUnexplored` — default FALSE, which is what keeps
 *  `post_unexplored` inside `positive_sum`. */
export const ENABLE_MULTIPLICATIVE_POST_UNEXPLORED = false;

export const AUTHOR_DIVERSITY = { decay: 0.5, floor: 0.25 };

// ------------------------------------------------------------------ the sums

/** The heads `ScoringWeights::from_params` adds into `positive_sum`, in source
 *  order. NOT "every head with a positive weight": the three `cont_*` heads are
 *  positive and are absent (trap 1). `post_unexplored` is last because it is
 *  conditional on `ENABLE_MULTIPLICATIVE_POST_UNEXPLORED`. */
export const POSITIVE_SUM_MEMBERS: readonly XHeadName[] = [
  'favorite',
  'reply',
  'retweet',
  'photo_expand',
  'video_open',
  'click',
  'open_link',
  'profile_click',
  'vqv',
  'share',
  'share_via_dm',
  'share_via_copy_link',
  'dwell',
  'quote',
  'quoted_click',
  'quoted_vqv',
  'follow_author',
  'post_unexplored',
];

/** `negative_sum` is the NEGATED sum of these five, so it is a positive number.
 *  It is the width of the band `offsetScore` squashes net-negative posts into. */
export const NEGATIVE_SUM_MEMBERS: readonly XHeadName[] = [
  'not_interested',
  'block_author',
  'mute_author',
  'report',
  'not_dwelled',
];

function buildWeightSums(): { positive: number; negative: number; total: number } {
  let positive = 0;
  for (const name of POSITIVE_SUM_MEMBERS) {
    if (name === 'post_unexplored' && ENABLE_MULTIPLICATIVE_POST_UNEXPLORED) continue;
    positive += X_HEADS[name].weight;
  }
  let negatives = 0;
  for (const name of NEGATIVE_SUM_MEMBERS) negatives += X_HEADS[name].weight;
  const negative = -negatives;
  return { positive, negative, total: positive + negative };
}

/** Summed left-to-right in source order rather than written down as literals,
 *  so the f64 rounding matches the Rust bit-for-bit (43.339999999999996, not a
 *  tidied 43.34) and an edited weight can never leave a stale total behind. */
export const X_WEIGHT_SUMS = buildWeightSums();

// ------------------------------------------------------------- the arithmetic

/** `ranking_scorer.rs::offset_score`, verbatim.
 *
 *  A net-negative post is squashed into `[0, negative/total * OFFSET)` — a
 *  sliver strictly below `offsetScore(0)` — instead of being clamped, so
 *  negative posts keep their order relative to each other while still ranking
 *  under every positive one (trap 3). Do NOT reach for `Math.pow` here: a
 *  negative base at a fractional exponent is `NaN`, and the linear map below is
 *  what the source actually does.
 *
 *  The `total === 0` guard is dead against today's table (410.56) and is kept
 *  anyway: it is the source's, and it is the only thing standing between a
 *  future weight edit that zeroes the table and a silent `NaN` in every score. */
export function offsetScore(combined: number): number {
  if (X_WEIGHT_SUMS.total === 0) return Math.max(combined, 0);
  if (combined < 0) {
    return ((combined + X_WEIGHT_SUMS.negative) / X_WEIGHT_SUMS.total) * NEGATIVE_SCORES_OFFSET;
  }
  return combined + NEGATIVE_SCORES_OFFSET;
}

export interface HeadContribution {
  head: XHeadName;
  /** The probability (or continuous value) supplied for this head. */
  p: number;
  /** The weight actually applied, after any `weights` override. */
  weight: number;
  contribution: number;
}

export interface ScoreHeadsResult {
  /** `offsetScore(combined)` — the production `score`. */
  raw: number;
  /** `pos - neg`, the net weighted sum before the offset. */
  combined: number;
  /** The Rust `(pos, neg)` pair. `negative` is reported POSITIVE, as there. */
  positive: number;
  negative: number;
  /** Supplied heads only, sorted by absolute contribution, descending. */
  contributions: HeadContribution[];
}

/** `compute_weighted_parts` + `offset_score`.
 *
 *  `weights` overrides a head's weight for this call — that is how the
 *  mutual-follow reply boost reaches the sum, exactly as `reply_weight_for`
 *  does upstream.
 *
 *  A head whose probability is `null`/absent is SKIPPED: no term, no
 *  contribution row (§7.11). The Rust `unwrap_or(0.0)` is arithmetically the
 *  same for the sums, but reporting an unmeasured head as a zero contribution
 *  would tell the reader we looked and found nothing. */
export function scoreHeads(
  headPs: Partial<Record<XHeadName, number | null>>,
  weights?: Partial<Record<XHeadName, number>>,
): ScoreHeadsResult {
  const contributions: HeadContribution[] = [];
  let positive = 0;
  let negative = 0;

  for (const name of Object.keys(X_HEADS) as XHeadName[]) {
    const p = headPs[name];
    if (p === null || p === undefined) continue;
    const weight = weights?.[name] ?? X_HEADS[name].weight;
    const contribution = p * weight;
    // Split by the sign of the TERM, not of the weight (trap 2).
    if (contribution >= 0) positive += contribution;
    else negative -= contribution;
    contributions.push({ head: name, p, weight, contribution });
  }

  contributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  const combined = positive - negative;
  return { raw: offsetScore(combined), combined, positive, negative, contributions };
}

/** `ScoringWeights::reply_weight_for`. 5.0 normally; 20.0 only on an ORIGINAL
 *  post by a mutual follow — a mutual's reply or repost gets the base weight. */
export function replyWeightFor(ctx: {
  isMutualFollow?: boolean;
  isReply?: boolean;
  isRepost?: boolean;
}): number {
  const eligible = ctx.isMutualFollow === true && ctx.isReply !== true && ctx.isRepost !== true;
  if (BIDIRECTIONAL_FOLLOW_REPLY_BOOST !== 0 && eligible) {
    return X_HEADS.reply.weight + BIDIRECTIONAL_FOLLOW_REPLY_BOOST;
  }
  return X_HEADS.reply.weight;
}

/** The `oon_applies` closure in `RankingScorer::score`.
 *
 *  Out-of-network always applies. In-network applies only to replies and
 *  reposts, because `EnableOonRescoreForInNetworkRepliesRetweets` defaults on.
 *  UNKNOWN network position is `false` — the Rust matches `None => false`, and
 *  that default matters to us specifically: we usually cannot tell, and
 *  guessing `true` would quietly shave 25% off every score we compute. */
export function oonApplies(ctx: {
  inNetwork?: boolean;
  isReply?: boolean;
  isRepost?: boolean;
}): boolean {
  if (ctx.inNetwork === false) return true;
  if (ctx.inNetwork === true) {
    return (
      ENABLE_OON_RESCORE_FOR_IN_NETWORK_REPLIES_RETWEETS &&
      (ctx.isReply === true || ctx.isRepost === true)
    );
  }
  return false;
}

/** `diversity_multiplier`. `k` is how many higher-scoring posts by the SAME
 *  author already sit above this one in the slate — so the first post from an
 *  author is `k = 0` and keeps its full score. */
export function diversityMultiplier(k: number): number {
  return (1 - AUTHOR_DIVERSITY.floor) * AUTHOR_DIVERSITY.decay ** k + AUTHOR_DIVERSITY.floor;
}

/** Map a raw score onto 0-100 against a reference score, where the reference
 *  lands on exactly 50.
 *
 *  **The one function here that is OURS rather than X's** — production ranks by
 *  raw score and never needs a display scale. It is parameter-free on purpose:
 *  `100 * raw / (raw + baseline)` has no tunable in it to be mistaken for a
 *  published constant, is monotonic, and is bounded on (0, 100), so a viral
 *  outlier cannot run the scale away. A post twice the baseline reads 67, half
 *  the baseline reads 33.
 *
 *  Non-positive or non-finite inputs return `0` rather than `NaN`: this is the
 *  display boundary, and it is where the `raw > 0` guard belongs — never inside
 *  `offsetScore`, whose whole job is to let the deepest negatives sit a hair
 *  below zero (trap 3). */
export function normalizeScore(raw: number, baselineRaw: number): number {
  if (!(raw > 0) || !(baselineRaw > 0)) return 0;
  return (100 * raw) / (raw + baselineRaw);
}
