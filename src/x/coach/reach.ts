// SC.8 — the reach band: what a post of this SHAPE has historically done
// against your own recent baseline. Architecture adopted from
// evals/x-builder-static-engine-analysis.md §L3 (base = trailing median, the
// format as the dominant weight, escape probability moved separately from the
// midpoint, `weightSource` provenance on every output, seed→fitted swap behind
// an n gate). **None of its numbers are adopted** — SC decision 1 and 9: there
// is no seed table in this file, so a format below the gate has no numeric band
// anywhere in the payload, not a placeholder one.
//
// Server-only and pure. The panel reads finished cells off `GET /x/coach/reach`
// and never builds them, so no extension re-export shim ships with this (the
// `postCooldown.ts` precedent, D156c); the extension mirrors the wire shape in
// `shared/types.ts`. A shim is a two-line add if a panel surface ever needs to
// fit weights itself.
//
// §7.19: the band is measurement metadata, never advice. Nothing sorts, gates,
// blocks or refuses on it (SC decision 4 — the score and everything derived
// from it is a floor, never a target).
//
// ---------------------------------------------------------------------------
// TWO METHOD CHOICES THAT ARE MEASUREMENTS, NOT PREFERENCES
//
// The plan for this task said to read the LATEST snapshot per tweet (the house
// `latestOutcomes` shape) and to age-normalize views with `age_at_snapshot_min`
// the way `buildBestTimes` does. Both were measured against the real corpus
// (138 own originals, 2026-06-21 → 07-27) before anything was written here, and
// both are wrong for a per-post MULTIPLIER. They are right for what they were
// built for; a ratio of two of them is a different quantity.
//
// 1. FIRST snapshot, not latest. 25 of 135 measured originals carry a second
//    snapshot, and those 25 are the winner re-reads (§8 "≤$0.005/day winner
//    re-reads") — their median views at the FIRST snapshot is already 1,059
//    against 122 for the single-snapshot rows. So "latest" is not one
//    measurement protocol, it is two, and which one a post gets is decided by
//    whether it won. Taking the latest imports that selection straight into the
//    numerator, and with it the extra days of accrual: latest-snapshot ages run
//    to p90 = 10,883 min, while first-snapshot ages are p5 = 111 / p95 = 1,311.
//    The first snapshot is the daily pass, and every post gets exactly one.
//
// 2. RAW views inside the daily-pass window, not an age-normalized rate.
//    `views * 1440 / age` assumes views accrue linearly. They do not — they are
//    front-loaded, and the corpus says so plainly: posts snapshotted under 12 h
//    old and posts snapshotted at 12–27 h have effectively the SAME raw view
//    count (median 129 vs 121, a 6% difference) while their normalized rates
//    differ by 170% (452 vs 167/day). Normalizing therefore manufactures the
//    very spread the fit is trying to detect — one post read at 4 minutes old
//    produced a 696× multiplier. `buildBestTimes` survives this because it
//    averages ≥3 posts per cell and reports a rate; dividing one rate by another
//    compounds it. So the population is restricted to snapshots taken inside the
//    daily pass's own documented window (§8.4: "3 to 27 hours old") and the raw
//    count is compared directly. Rows measured outside it are dropped, not
//    rescaled — a post read a week late has no comparable first-day number.
//
// The general rule, worth more than this module: "latest row wins" is correct
// for displaying one post and wrong for comparing many, whenever the re-read is
// selective. Same for any normalization whose model you have not checked
// against the data it will be applied to.
//
// ---------------------------------------------------------------------------
// WHAT THE CORPUS SAYS TODAY (2026-07-27 — 138 originals → 127 in population →
// 107 with a full trailing window; live baseline 334 views)
//
//   format          n    p50×   escape ≥3×
//   substance      46    0.87      13%   ← exempt, see below
//   audience_cta   17    1.59      35%
//   list           16    1.08      19%
//   story          16    1.34      25%
//   hot_take        5    3.18      60%
//
// At the house n≥20 gate that is ZERO fitted formats: the only bucket with the
// sample is `substance`, which means "no format detected" (D146a) and is exempt
// here for the same reason SC.6 exempts it from the cooldown — a band keyed on
// the residual bucket is a number attached to "unknown", which is exactly what
// §7.11 forbids. So this ships rendering the insufficient line for every draft,
// which is SC decision 9 working as designed rather than a disappointment:
// `audience_cta` is three posts away from arming itself, `list` and `story`
// four. The architecture is the deliverable; the numbers arrive on their own.

import { POST_FORMATS, type PostFormat, classifyFormat } from '../../shared/postFormat.ts';
import { DEFAULT_MIN_CELL_N } from '../playbook.ts';

/** Own originals only, each with the FIRST snapshot's raw view count. `text` is
 *  passed RAW — `classifyFormat` normalizes X's stored entities itself
 *  (D146c). */
export interface ReachRow {
  text: string;
  postedAt: Date;
  views: number | null;
  /** Age of the tweet at that first snapshot, in minutes. Null on pre-§8.4
   *  rows, which drop out: without it there is no way to know the count is
   *  comparable. */
  ageAtSnapshotMin: number | null;
}

/** The daily pass reads tweets at 3–27 h old (§8.4, and the `age_at_snapshot_min`
 *  column comment). That IS the measurement protocol, so it is also the window a
 *  count has to fall inside to be comparable to another one. Not a knob: widening
 *  it does not add data, it adds rows measured by a different process. */
export const SNAPSHOT_MIN_AGE_MIN = 180;
export const SNAPSHOT_MAX_AGE_MIN = 1620;

/** How many preceding in-population originals the baseline is the median of.
 *  Per-post rather than global on purpose: an account that grows would otherwise
 *  have every early post drag every multiplier down. A full window is required —
 *  a base taken from 5 posts is a noisier estimator than one taken from 20, and
 *  mixing the two silently mixes noise levels into the same multiplier. */
export const REACH_BASE_WINDOW = 20;

/** "Escape" = cleared 3× the baseline. x-builder's `escapeRangeLowCoeff`, kept
 *  as the SHAPE of their model with our own rates underneath it. Measured share
 *  of posts clearing it, per format: audience_cta 35%, story 25%, list 19%,
 *  substance 13%. Recalibrate against those, not against a feeling. */
export const ESCAPE_MULTIPLE = 3;

/** The same three labels SC.6 exempts from the cooldown, for the same reason and
 *  deliberately as the same set: they mean "no format detected", not "this
 *  format". Fitting a multiplier on them would put a number on the residual
 *  bucket — two `substance` posts share nothing except failing every predicate —
 *  and §7.11 is that unknown stays unknown rather than becoming a quiet value.
 *  Their weights still ship (the tally is worth reading) with `exempt: true`, so
 *  no consumer has to keep a copy of this list. */
export const REACH_EXEMPT_FORMATS: readonly PostFormat[] = ['substance', 'one_liner', 'other'];

export interface FormatWeights {
  format: PostFormat;
  /** Posts of this format that had a full trailing window to be measured against. */
  n: number;
  /** Median of `views ÷ base`. Null when n is 0. */
  p50Multiplier: number | null;
  /** Share of them that cleared `ESCAPE_MULTIPLE × base`, 0–1. */
  escapeRate: number | null;
  /** Interquartile multipliers of the posts that did NOT escape — the ordinary
   *  outcome, which is what the stall range renders. */
  p25StallMultiplier: number | null;
  p75StallMultiplier: number | null;
  exempt: boolean;
  sufficient: boolean;
}

export interface ReachCell {
  format: PostFormat;
  n: number;
  exempt: boolean;
  /** `'fitted'` only when this format cleared the gate on our own corpus. There
   *  is no third value: no seed table exists, so `'insufficient'` carries no
   *  numbers at all. */
  weightSource: 'fitted' | 'insufficient';
  /** Views, absolute — `[p25, p75]` of the non-escape outcomes × base. Null
   *  unless fitted. */
  stallRange: [number, number] | null;
  /** Views this format clears in `escapeProbability` of cases. Null unless
   *  fitted. Deliberately a threshold and not the plan's `escapeRange`: the top
   *  of an escape is where the sample is thinnest (one format's maximum is 22.7×
   *  off 17 rows), so an upper bound would be the least supported number on the
   *  surface while looking like the most exciting one. */
  escapeThreshold: number | null;
  escapeProbability: number | null;
  p50Multiplier: number | null;
}

export interface ReachFit {
  /** Median views of the last `REACH_BASE_WINDOW` in-population originals — what
   *  an ordinary post of yours does right now. Null below the window, which
   *  makes every cell insufficient. */
  base: number | null;
  /** Rows that survived the population filter (measured, in-window). */
  measuredPosts: number;
  /** Of those, the ones that had a full trailing window behind them. */
  fittedPosts: number;
  minN: number;
  escapeMultiple: number;
  baseWindow: number;
  cells: ReachCell[];
}

function quantile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] as number;
}

function round(n: number): number {
  return Math.round(n);
}

/** The fit population: measured, and measured inside the daily pass's window, in
 *  publication order. Exported for the route's `measuredPosts` count and for
 *  tests that need to assert the filter directly. */
export function reachPopulation(rows: readonly ReachRow[]): ReachRow[] {
  return rows
    .filter(
      (r) =>
        r.views != null &&
        r.views >= 0 &&
        r.ageAtSnapshotMin != null &&
        r.ageAtSnapshotMin >= SNAPSHOT_MIN_AGE_MIN &&
        r.ageAtSnapshotMin <= SNAPSHOT_MAX_AGE_MIN,
    )
    .sort((a, b) => a.postedAt.getTime() - b.postedAt.getTime());
}

/** Per-format weights fitted on own history. Fit-by-aggregation, not regression
 *  (§L3): each post contributes one ratio against the median of the 20 that
 *  preceded it, and a format's weight is a quantile over those ratios. Nothing
 *  here reads the draft — these are properties of the corpus. */
export function fitFormatWeights(
  rows: readonly ReachRow[],
  minN: number = DEFAULT_MIN_CELL_N,
): { base: number | null; measuredPosts: number; fittedPosts: number; weights: FormatWeights[] } {
  const pop = reachPopulation(rows);
  const views = pop.map((r) => r.views as number);

  const ratios = new Map<PostFormat, number[]>();
  let fittedPosts = 0;
  for (let i = REACH_BASE_WINDOW; i < pop.length; i++) {
    const window = views.slice(i - REACH_BASE_WINDOW, i).sort((a, b) => a - b);
    const base = quantile(window, 0.5);
    // A baseline of zero has no ratio to give — dividing by it would mint an
    // Infinity that no gate downstream could catch.
    if (base == null || base <= 0) continue;
    const format = classifyFormat((pop[i] as ReachRow).text);
    fittedPosts++;
    ratios.set(format, [...(ratios.get(format) ?? []), (views[i] as number) / base]);
  }

  // The live baseline is the trailing median as of NOW — the same estimator the
  // ratios were fitted against, so the band it scales is in the same units.
  const tail = views.slice(-REACH_BASE_WINDOW).sort((a, b) => a - b);
  const base = views.length >= REACH_BASE_WINDOW ? quantile(tail, 0.5) : null;

  const weights = POST_FORMATS.map((format) => {
    const list = (ratios.get(format) ?? []).slice().sort((a, b) => a - b);
    const exempt = REACH_EXEMPT_FORMATS.includes(format);
    const escaped = list.filter((r) => r >= ESCAPE_MULTIPLE);
    const stalled = list.filter((r) => r < ESCAPE_MULTIPLE);
    return {
      format,
      n: list.length,
      p50Multiplier: quantile(list, 0.5),
      escapeRate: list.length === 0 ? null : escaped.length / list.length,
      p25StallMultiplier: quantile(stalled, 0.25),
      p75StallMultiplier: quantile(stalled, 0.75),
      exempt,
      sufficient: !exempt && list.length >= minN,
    };
  });

  return { base, measuredPosts: pop.length, fittedPosts, weights };
}

/** One format's weights resolved into the absolute view numbers a surface can
 *  render. The gate is enforced HERE, not at the call site: an insufficient
 *  format returns nulls in every numeric field, so there is no code path by
 *  which a consumer can read a number this corpus did not support. */
export function buildReachBand(w: FormatWeights, base: number | null): ReachCell {
  const fitted =
    w.sufficient &&
    base != null &&
    base > 0 &&
    w.p25StallMultiplier != null &&
    w.p75StallMultiplier != null;
  if (!fitted) {
    return {
      format: w.format,
      n: w.n,
      exempt: w.exempt,
      weightSource: 'insufficient',
      stallRange: null,
      escapeThreshold: null,
      escapeProbability: null,
      p50Multiplier: null,
    };
  }
  const b = base as number;
  return {
    format: w.format,
    n: w.n,
    exempt: w.exempt,
    weightSource: 'fitted',
    stallRange: [
      round((w.p25StallMultiplier as number) * b),
      round((w.p75StallMultiplier as number) * b),
    ],
    escapeThreshold: round(ESCAPE_MULTIPLE * b),
    escapeProbability: w.escapeRate,
    p50Multiplier: w.p50Multiplier,
  };
}

/** The whole payload, in `POST_FORMATS` cascade order so the reach table reads
 *  in the same order as the cooldown line and the Playbook's format cells. */
export function buildReachFit(
  rows: readonly ReachRow[],
  minN: number = DEFAULT_MIN_CELL_N,
): ReachFit {
  const { base, measuredPosts, fittedPosts, weights } = fitFormatWeights(rows, minN);
  return {
    base,
    measuredPosts,
    fittedPosts,
    minN,
    escapeMultiple: ESCAPE_MULTIPLE,
    baseWindow: REACH_BASE_WINDOW,
    cells: weights.map((w) => buildReachBand(w, base)),
  };
}
