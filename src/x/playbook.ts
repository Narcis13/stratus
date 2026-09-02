// The Playbook (CIRCLES-PLAN C4): pure aggregations that turn measured-but-
// unused feedback signals into (a) a page the human reads and (b) short
// guidance lines the prompts consume. Every stat is guarded by a min-sample
// gate — a cell below the threshold still renders, flagged insufficient, so
// the page can show "insufficient data (n=7)" instead of a confident lie.
//
// Pure on purpose: no DB, no clock. routes/playbook.ts loads the rows and
// calls these; fixtures drive the tests.

import { JUDGE_VERDICT_ORDER, type JudgeVerdictLabel, deriveApproved } from '../shared/judge.ts';
import { detectScript, resolveLanguageProfile } from '../shared/language.ts';
import { type CoachBand, type CoachLexicon, scoreDraft } from '../shared/postCoach.ts';
import { POST_FORMATS, type PostFormat, classifyFormat } from '../shared/postFormat.ts';
import { SWEEP, type SweepConfig, passesSweep } from '../shared/radarSweep.ts';
import {
  REPLY_MODES,
  type ReplyMode,
  type ReplyModeId,
  containsLaneNoun,
  detectReplyMode,
  resolveModeId,
} from '../shared/replyMode.ts';
import {
  type DraftFeatures,
  type MeasuredCounts,
  scoreDraftRanker,
  scoreMeasured,
} from '../shared/xRankerSignals.ts';

/** Default per-cell minimum sample before a stat is allowed to claim anything.
 *  §7.19's ≥100-measured discipline, scaled to per-cell granularity. */
export const DEFAULT_MIN_CELL_N = 20;

export interface MeasuredOutcome {
  views: number | null;
  profileVisits: number | null;
}

/** The shared cell shape: `posted` counts every row that landed in the cell,
 *  `n` only the measured ones (the medians' sample). */
export interface OutcomeCell {
  posted: number;
  n: number;
  medianViews: number | null;
  medianProfileVisits: number | null;
  sufficient: boolean;
}

// ------------------------------------------------------------------ helpers

export function median(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((v): v is number => typeof v === 'number').sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 === 1
    ? (nums[mid] as number)
    : ((nums[mid - 1] as number) + (nums[mid] as number)) / 2;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function cellOf(outcomes: Array<MeasuredOutcome | null>, minN: number): OutcomeCell {
  const measured = outcomes.filter((o): o is MeasuredOutcome => o !== null);
  return {
    posted: outcomes.length,
    n: measured.length,
    medianViews: median(measured.map((o) => o.views)),
    medianProfileVisits: median(measured.map((o) => o.profileVisits)),
    sufficient: measured.length >= minN,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function fmt(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n * 10) / 10);
}

// -------------------------------------------------- 1. angle effectiveness
//
// RC.4 WARNING, and it applies to every cell this section produces: the angle
// vocabulary widened from three to five on `ANGLE_VOCABULARY_WIDENED_AT`
// (`src/shared/replyMode.ts`). Rows on either side of that date are NOT one
// population — `observation`/`question` were unrepresentable before it, so the
// replies that would have carried them were drafted (and are recorded) as
// `extends`. The aggregation below deliberately does not filter by date: a
// silent cut would hide the discontinuity instead of naming it, and the Playbook
// panel renders the boundary next to the table so the reader sees it. Take the
// split by hand — over `posts_published.posted_at` — before quoting any angle
// number that spans it.

export const AUTHOR_SIZE_BUCKETS = ['<1k', '1k-10k', '10k-100k', '100k+', 'unknown'] as const;
export type AuthorSizeBucket = (typeof AUTHOR_SIZE_BUCKETS)[number];

export function authorSizeBucket(followers: number | null): AuthorSizeBucket {
  if (followers === null || !Number.isFinite(followers)) return 'unknown';
  if (followers < 1_000) return '<1k';
  if (followers < 10_000) return '1k-10k';
  if (followers < 100_000) return '10k-100k';
  return '100k+';
}

export interface AngleRow {
  /** Angle of the variant that was actually posted; null when unknowable. */
  angle: string | null;
  /** Source-author followers at the best-known reading (people/voice join). */
  authorFollowers: number | null;
  outcome: MeasuredOutcome | null;
}

export interface AngleCell extends OutcomeCell {
  angle: string | null;
}

export interface AngleEffectiveness {
  overall: AngleCell[];
  byAuthorSize: Array<{ bucket: AuthorSizeBucket; cells: AngleCell[] }>;
  totalMeasured: number;
}

export function buildAngleEffectiveness(
  rows: AngleRow[],
  minN = DEFAULT_MIN_CELL_N,
): AngleEffectiveness {
  const overall = angleCells(rows, minN);
  const byAuthorSize: AngleEffectiveness['byAuthorSize'] = [];
  for (const bucket of AUTHOR_SIZE_BUCKETS) {
    const inBucket = rows.filter((r) => authorSizeBucket(r.authorFollowers) === bucket);
    if (inBucket.length === 0) continue;
    byAuthorSize.push({ bucket, cells: angleCells(inBucket, minN) });
  }
  return {
    overall,
    byAuthorSize,
    totalMeasured: rows.filter((r) => r.outcome !== null).length,
  };
}

function angleCells(rows: AngleRow[], minN: number): AngleCell[] {
  const byAngle = new Map<string | null, Array<MeasuredOutcome | null>>();
  for (const r of rows) {
    const list = byAngle.get(r.angle) ?? [];
    list.push(r.outcome);
    byAngle.set(r.angle, list);
  }
  return [...byAngle.entries()]
    .map(([angle, outcomes]) => ({ angle, ...cellOf(outcomes, minN) }))
    .sort((a, b) => b.n - a.n || b.posted - a.posted);
}

// ---------------------------------------------- 2. pillar × register scorecard

export interface PillarRegisterRow {
  pillar: string | null;
  register: string | null;
  outcome: MeasuredOutcome | null;
}

export interface PillarRegisterCell extends OutcomeCell {
  pillar: string | null;
  register: string | null;
}

export interface PillarRegisterScorecard {
  cells: PillarRegisterCell[];
  totalMeasured: number;
}

export function buildPillarRegisterScorecard(
  rows: PillarRegisterRow[],
  minN = DEFAULT_MIN_CELL_N,
): PillarRegisterScorecard {
  const byKey = new Map<
    string,
    { pillar: string | null; register: string | null; outcomes: Array<MeasuredOutcome | null> }
  >();
  for (const r of rows) {
    const key = `${r.pillar ?? '\0'}|${r.register ?? '\0'}`;
    const entry = byKey.get(key) ?? { pillar: r.pillar, register: r.register, outcomes: [] };
    entry.outcomes.push(r.outcome);
    byKey.set(key, entry);
  }
  const cells = [...byKey.values()]
    .map((e) => ({ pillar: e.pillar, register: e.register, ...cellOf(e.outcomes, minN) }))
    .sort((a, b) => b.n - a.n || b.posted - a.posted);
  return { cells, totalMeasured: rows.filter((r) => r.outcome !== null).length };
}

// ------------------------------------------- 3. skeleton/hook effectiveness

export interface StructureRow {
  hookType: string;
  device: string;
  outcome: MeasuredOutcome | null;
}

export interface StructureCell extends OutcomeCell {
  key: string;
}

export interface StructureEffectiveness {
  hooks: StructureCell[];
  devices: StructureCell[];
  totalMeasured: number;
}

export function buildStructureEffectiveness(
  rows: StructureRow[],
  minN = DEFAULT_MIN_CELL_N,
): StructureEffectiveness {
  return {
    hooks: structureCells(rows, (r) => r.hookType, minN),
    devices: structureCells(rows, (r) => r.device, minN),
    totalMeasured: rows.filter((r) => r.outcome !== null).length,
  };
}

function structureCells(
  rows: StructureRow[],
  keyOf: (r: StructureRow) => string,
  minN: number,
): StructureCell[] {
  const byKey = new Map<string, Array<MeasuredOutcome | null>>();
  for (const r of rows) {
    // Grok free-texts these ("stat hook" vs "Stat hook") — normalize the key.
    const key = keyOf(r).trim().toLowerCase();
    if (key === '') continue;
    const list = byKey.get(key) ?? [];
    list.push(r.outcome);
    byKey.set(key, list);
  }
  return [...byKey.entries()]
    .map(([key, outcomes]) => ({ key, ...cellOf(outcomes, minN) }))
    .sort((a, b) => b.n - a.n || b.posted - a.posted);
}

// ------------------------------------------------- 4. batch vs single drafts

export type ReplyOrigin = 'single' | 'radar' | 'canned';

export function normalizeReplyText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Attribute one of MY published replies to its drafting surface. A published
 *  reply linked to a posted reply_drafts row (by postedTweetId) is attributed
 *  by that row's `source` (RU.9, exact): a radar-confirmed draft carries
 *  source='radar' → `radar`; a Reply-Master draft (source='reply_master') or a
 *  pre-source legacy row (null) → `single`. The draft link is definitive, so
 *  source beats the heuristic. For replies with NO draft link (pre-tooling
 *  history), fall back to the reconstructed radar match — BOTH the target must
 *  match a drafted tweet AND the posted text must equal the drafted reply
 *  (collapsed whitespace — same reading as the harvest reconcile), so an
 *  independently written reply under the same post doesn't get counted as
 *  machine output. Canned (RL.7) is checked LAST — a canned use leaves no
 *  reply_drafts row, so its only evidence is the rendered text (stored typos
 *  and all, which is why the paste-exact match holds); a reply that is both a
 *  posted draft and a text match counts once, as the draft. Null =
 *  unattributed (hand-written). */
export function classifyReplyOrigin(
  reply: { tweetId: string; inReplyToTweetId: string | null; text: string },
  draftSourceByPostedId: ReadonlyMap<string, string | null>,
  radarRepliesByTarget: ReadonlyMap<string, string[]>,
  cannedTexts: ReadonlySet<string>,
): ReplyOrigin | null {
  if (draftSourceByPostedId.has(reply.tweetId)) {
    return draftSourceByPostedId.get(reply.tweetId) === 'radar' ? 'radar' : 'single';
  }
  const posted = normalizeReplyText(reply.text);
  if (reply.inReplyToTweetId) {
    const drafted = radarRepliesByTarget.get(reply.inReplyToTweetId);
    if (drafted?.some((d) => normalizeReplyText(d) === posted)) return 'radar';
  }
  if (posted !== '' && cannedTexts.has(posted)) return 'canned';
  return null;
}

export interface BatchVsSingle {
  single: OutcomeCell;
  radar: OutcomeCell;
  canned: OutcomeCell;
}

export function buildBatchVsSingle(
  rows: Array<{ origin: ReplyOrigin; outcome: MeasuredOutcome | null }>,
  minN = DEFAULT_MIN_CELL_N,
): BatchVsSingle {
  return {
    single: cellOf(
      rows.filter((r) => r.origin === 'single').map((r) => r.outcome),
      minN,
    ),
    radar: cellOf(
      rows.filter((r) => r.origin === 'radar').map((r) => r.outcome),
      minN,
    ),
    canned: cellOf(
      rows.filter((r) => r.origin === 'canned').map((r) => r.outcome),
      minN,
    ),
  };
}

// ------------------------------------------------------ 6. relationship lift

export interface RelationshipLift {
  withRelationship: OutcomeCell;
  withoutRelationship: OutcomeCell;
  /** Ratios only when BOTH sides pass the gate — a lift built on 3 rows lies. */
  viewsLift: number | null;
  profileVisitsLift: number | null;
}

export function buildRelationshipLift(
  rows: Array<{ hasRelationship: boolean; outcome: MeasuredOutcome | null }>,
  minN = DEFAULT_MIN_CELL_N,
): RelationshipLift {
  const withCell = cellOf(
    rows.filter((r) => r.hasRelationship).map((r) => r.outcome),
    minN,
  );
  const withoutCell = cellOf(
    rows.filter((r) => !r.hasRelationship).map((r) => r.outcome),
    minN,
  );
  const gated = withCell.sufficient && withoutCell.sufficient;
  return {
    withRelationship: withCell,
    withoutRelationship: withoutCell,
    viewsLift: gated ? ratio(withCell.medianViews, withoutCell.medianViews) : null,
    profileVisitsLift: gated
      ? ratio(withCell.medianProfileVisits, withoutCell.medianProfileVisits)
      : null,
  };
}

function ratio(a: number | null, b: number | null): number | null {
  if (a === null || b === null || b === 0) return null;
  return round2(a / b);
}

// ----------------------------------------- 6b. personal-context lift (M1/ME.5)

export interface MeEffectiveness {
  withMe: OutcomeCell;
  withoutMe: OutcomeCell;
  /** All measured rows — the denominator: `withMe.n + withoutMe.n`. */
  totalMeasured: number;
  /** Ratios only when BOTH sides pass the gate — a lift on a handful lies. */
  viewsLift: number | null;
  profileVisitsLift: number | null;
}

/** Do replies that carried the Me/profile brief outperform cold ones? Split by
 *  `contextSnapshot.me` present/absent. Replies are the only measured surface —
 *  the post drafter always injects, so posts have no control group. Clone of the
 *  relationship-lift cell reading `me` instead of `relationship`. */
export function buildMeEffectiveness(
  rows: Array<{ hasMe: boolean; outcome: MeasuredOutcome | null }>,
  minN = DEFAULT_MIN_CELL_N,
): MeEffectiveness {
  const withCell = cellOf(
    rows.filter((r) => r.hasMe).map((r) => r.outcome),
    minN,
  );
  const withoutCell = cellOf(
    rows.filter((r) => !r.hasMe).map((r) => r.outcome),
    minN,
  );
  const gated = withCell.sufficient && withoutCell.sufficient;
  return {
    withMe: withCell,
    withoutMe: withoutCell,
    totalMeasured: rows.filter((r) => r.outcome !== null).length,
    viewsLift: gated ? ratio(withCell.medianViews, withoutCell.medianViews) : null,
    profileVisitsLift: gated
      ? ratio(withCell.medianProfileVisits, withoutCell.medianProfileVisits)
      : null,
  };
}

// ---------------------------------------------- 7. media vs text-only (§S0.2)

export interface MediaRow {
  /** true = carried media, false = text-only, null = unknown (pre-column row). */
  hasMedia: boolean | null;
  outcome: MeasuredOutcome | null;
}

export interface MediaEffectiveness {
  media: OutcomeCell;
  textOnly: OutcomeCell;
  /** Rows whose media state we never recorded — null is UNKNOWN, never "no",
   *  so it gets its own bucket and never inflates the text-only baseline. */
  unknown: OutcomeCell;
  totalMeasured: number;
  /** Ratios only when BOTH media and text-only clear the gate (n≥20/side) —
   *  the image-lift number this whole patch exists to earn. */
  viewsLift: number | null;
  profileVisitsLift: number | null;
}

export function buildMediaEffectiveness(
  rows: MediaRow[],
  minN = DEFAULT_MIN_CELL_N,
): MediaEffectiveness {
  const media = cellOf(
    rows.filter((r) => r.hasMedia === true).map((r) => r.outcome),
    minN,
  );
  const textOnly = cellOf(
    rows.filter((r) => r.hasMedia === false).map((r) => r.outcome),
    minN,
  );
  const unknown = cellOf(
    rows.filter((r) => r.hasMedia === null).map((r) => r.outcome),
    minN,
  );
  const gated = media.sufficient && textOnly.sufficient;
  return {
    media,
    textOnly,
    unknown,
    totalMeasured: rows.filter((r) => r.outcome !== null).length,
    viewsLift: gated ? ratio(media.medianViews, textOnly.medianViews) : null,
    profileVisitsLift: gated
      ? ratio(media.medianProfileVisits, textOnly.medianProfileVisits)
      : null,
  };
}

// -------------------------------------------- 8. reply-latency × outcome (§S0.5)

/** Tweet-age-at-draft buckets, coarse on purpose: the doctrine bets everything
 *  on replying early, so the split that matters is minutes-fast (what the Radar
 *  and Launch Room enable) vs hours-late. `unknown` = no age recoverable. */
export const LATENCY_BUCKETS = ['<15m', '15-60m', '1-6h', '>6h', 'unknown'] as const;
export type LatencyBucket = (typeof LATENCY_BUCKETS)[number];

export function latencyBucket(ageMin: number | null): LatencyBucket {
  if (ageMin === null || !Number.isFinite(ageMin) || ageMin < 0) return 'unknown';
  if (ageMin < 15) return '<15m';
  if (ageMin < 60) return '15-60m';
  if (ageMin < 360) return '1-6h';
  return '>6h';
}

/** Resolve tweet-age-at-draft in minutes: the capture-stamped `signals.ageMin`
 *  when present, else derived from the gap between the tweet's post time and the
 *  draft's creation time — the same fallback ladder as scoreReplyOutcome, so the
 *  latency table and the band table read age the same way. Null when neither is
 *  recoverable (→ the `unknown` bucket, never folded into a real one). */
export function resolveAgeMin(row: {
  signals: { ageMin: number } | null | undefined;
  sourcePostedAt: Date | string | null;
  draftCreatedAt: Date | string;
}): number | null {
  if (row.signals && Number.isFinite(row.signals.ageMin)) {
    return Math.max(0, row.signals.ageMin);
  }
  if (!row.sourcePostedAt) return null;
  const postedMs = new Date(row.sourcePostedAt).getTime();
  const createdMs = new Date(row.draftCreatedAt).getTime();
  if (Number.isNaN(postedMs) || Number.isNaN(createdMs)) return null;
  return Math.max(0, (createdMs - postedMs) / 60_000);
}

export interface LatencyRow {
  /** Tweet age (minutes) when the reply was drafted; null when unrecoverable. */
  ageMin: number | null;
  outcome: MeasuredOutcome | null;
}

export interface LatencyCell extends OutcomeCell {
  bucket: LatencyBucket;
}

export interface LatencyEffectiveness {
  /** One cell per non-empty bucket, in chronological (LATENCY_BUCKETS) order. */
  cells: LatencyCell[];
  totalMeasured: number;
  /** The doctrine's grade, pooled to two cohorts so each can clear the gate on
   *  a real single-user sample: `early` = replied within 15 min (the window the
   *  machinery buys); `late` = replied an hour or more after the tweet
   *  (1-6h + >6h). The 15-60m middle stays in `cells` but out of the headline. */
  early: OutcomeCell;
  late: OutcomeCell;
  /** Lift of early over late, only when BOTH cohorts clear the gate — grading
   *  "reply early" on a thin sample would lie the same way any other lift does. */
  viewsLift: number | null;
  profileVisitsLift: number | null;
}

export function buildLatencyEffectiveness(
  rows: LatencyRow[],
  minN = DEFAULT_MIN_CELL_N,
): LatencyEffectiveness {
  const byBucket = new Map<LatencyBucket, Array<MeasuredOutcome | null>>();
  for (const r of rows) {
    const b = latencyBucket(r.ageMin);
    const list = byBucket.get(b) ?? [];
    list.push(r.outcome);
    byBucket.set(b, list);
  }
  const cells: LatencyCell[] = LATENCY_BUCKETS.filter((b) => byBucket.has(b)).map((b) => ({
    bucket: b,
    ...cellOf(byBucket.get(b) as Array<MeasuredOutcome | null>, minN),
  }));

  const early = cellOf(
    rows.filter((r) => latencyBucket(r.ageMin) === '<15m').map((r) => r.outcome),
    minN,
  );
  const late = cellOf(
    rows
      .filter((r) => {
        const b = latencyBucket(r.ageMin);
        return b === '1-6h' || b === '>6h';
      })
      .map((r) => r.outcome),
    minN,
  );
  const gated = early.sufficient && late.sufficient;
  return {
    cells,
    totalMeasured: rows.filter((r) => r.outcome !== null).length,
    early,
    late,
    viewsLift: gated ? ratio(early.medianViews, late.medianViews) : null,
    profileVisitsLift: gated ? ratio(early.medianProfileVisits, late.medianProfileVisits) : null,
  };
}

// ---------------------------------------- 9. roster coverage (§S0.7)

/** Where the replies went, banded against my own size. `in_band` = the 2–10x
 *  target sweet spot (big enough to lend reach, small enough that a good reply
 *  is seen); `above_band` too big to convert, `below_band` too small to matter,
 *  `unknown` = author size we couldn't resolve (no people/voice follower count,
 *  or no account snapshot to band against). */
export const ROSTER_BANDS = ['in_band', 'above_band', 'below_band', 'unknown'] as const;
export type RosterBandKey = (typeof ROSTER_BANDS)[number];

export function classifyRosterBand(
  authorFollowers: number | null,
  band: { min: number; max: number } | null,
): RosterBandKey {
  if (band === null || authorFollowers === null || !Number.isFinite(authorFollowers)) {
    return 'unknown';
  }
  if (authorFollowers < band.min) return 'below_band';
  if (authorFollowers > band.max) return 'above_band';
  return 'in_band';
}

export interface RosterCoverage {
  /** All posted replies in the window — the denominator of `pct`. */
  total: number;
  counts: Record<RosterBandKey, number>;
  /** Each band's share of ALL replies (integer %); null when total === 0. */
  pct: Record<RosterBandKey, number | null>;
  /** Replies whose author size we could resolve (in + above + below). */
  known: number;
  /** In-band share of KNOWN-size replies — the doctrine number, computed over
   *  known authors so a large roster gap (unknowns) doesn't silently sink it.
   *  Null when nothing was resolvable. */
  inBandPctOfKnown: number | null;
  /** True once `known` clears the gate — only then is the verdict trustworthy. */
  sufficient: boolean;
  /** In-band is a majority of known authors. Null under the gate (a verdict on
   *  a handful of known authors lies) or when no account size is known yet. */
  majorityInBand: boolean | null;
  /** The 2–10x bounds used, or null when no account size is known yet. */
  band: { min: number; max: number } | null;
}

/** Band each posted reply by its source author's size and report the coverage.
 *  Pure: the caller windows the replies (trailing 7d for the page, the digest
 *  week for the Sunday note) and resolves both the follower counts and my own
 *  2–10x band. The verdict gates on the KNOWN-size sample, not the total, and
 *  the unknown bucket is surfaced separately as the roster gap. */
export function buildRosterCoverage(
  authorFollowers: Array<number | null>,
  band: { min: number; max: number } | null,
  minN = DEFAULT_MIN_CELL_N,
): RosterCoverage {
  const counts: Record<RosterBandKey, number> = {
    in_band: 0,
    above_band: 0,
    below_band: 0,
    unknown: 0,
  };
  for (const f of authorFollowers) counts[classifyRosterBand(f, band)]++;
  const total = authorFollowers.length;
  const pct = {} as Record<RosterBandKey, number | null>;
  for (const k of ROSTER_BANDS) {
    pct[k] = total === 0 ? null : Math.round((counts[k] / total) * 100);
  }
  const known = counts.in_band + counts.above_band + counts.below_band;
  const inBandPctOfKnown = known === 0 ? null : Math.round((counts.in_band / known) * 100);
  const sufficient = known >= minN;
  return {
    total,
    counts,
    pct,
    known,
    inBandPctOfKnown,
    sufficient,
    majorityInBand: band !== null && sufficient ? counts.in_band / known > 0.5 : null,
    band,
  };
}

// ---------------------------------------- 10. idea → outcome (§S0.8)

/** One published draft, keyed by surface and whether a captured Idea seeded it.
 *  `seeded` = an `ideas` row consumed this draft (consumed_by_id === its id). */
export interface IdeaRow {
  kind: 'post' | 'reply';
  seeded: boolean;
  outcome: MeasuredOutcome | null;
}

/** Seeded-vs-unseeded medians for one surface, with the payoff ratios (only
 *  when BOTH sides clear the gate — a lift on a handful of seeded rows lies the
 *  same way media/latency/relationship lift does). */
export interface IdeaSurface {
  seeded: OutcomeCell;
  unseeded: OutcomeCell;
  viewsLift: number | null;
  profileVisitsLift: number | null;
}

/** Does the Idea Inbox actually pay? The pooled headline (seeded vs unseeded
 *  across posts + replies) is the plan's "one gated cell, n≥20 per side". But
 *  posts and replies have very different view distributions — the pooled number
 *  is dominated by whichever surface has more volume — so the per-surface split
 *  is kept visible, each gated independently. */
export interface IdeaEffectiveness extends IdeaSurface {
  posts: IdeaSurface;
  replies: IdeaSurface;
  /** Measured rows that were idea-seeded (across both surfaces). */
  totalSeeded: number;
  /** All measured rows (the denominator: seeded + unseeded). */
  totalMeasured: number;
}

function ideaSurface(rows: IdeaRow[], minN: number): IdeaSurface {
  const seeded = cellOf(
    rows.filter((r) => r.seeded).map((r) => r.outcome),
    minN,
  );
  const unseeded = cellOf(
    rows.filter((r) => !r.seeded).map((r) => r.outcome),
    minN,
  );
  const gated = seeded.sufficient && unseeded.sufficient;
  return {
    seeded,
    unseeded,
    viewsLift: gated ? ratio(seeded.medianViews, unseeded.medianViews) : null,
    profileVisitsLift: gated
      ? ratio(seeded.medianProfileVisits, unseeded.medianProfileVisits)
      : null,
  };
}

export function buildIdeaEffectiveness(
  rows: IdeaRow[],
  minN = DEFAULT_MIN_CELL_N,
): IdeaEffectiveness {
  return {
    ...ideaSurface(rows, minN),
    posts: ideaSurface(
      rows.filter((r) => r.kind === 'post'),
      minN,
    ),
    replies: ideaSurface(
      rows.filter((r) => r.kind === 'reply'),
      minN,
    ),
    totalSeeded: rows.filter((r) => r.seeded && r.outcome !== null).length,
    totalMeasured: rows.filter((r) => r.outcome !== null).length,
  };
}

// ---------------------------------------- 11. model effectiveness (AI.12)

/** One reply-draft's drafting model + its measured outcome. `model` is the raw
 *  id string (`grok-4.3`, `anthropic/claude-sonnet-4.5`, …) — a `/` already reads
 *  as the provider, so we bucket the whole string as-is, never parse it. */
export interface ModelRow {
  model: string;
  outcome: MeasuredOutcome | null;
}

export interface ModelCell extends OutcomeCell {
  model: string;
}

export interface ModelEffectiveness {
  /** One cell per distinct model, most-sampled first (ties broken by posted
   *  volume, then model id for a stable order). No lift line — there is no
   *  canonical baseline pair, so this is buckets only, each independently gated. */
  cells: ModelCell[];
  totalMeasured: number;
}

/** Judge of the OpenRouter experiment: posted+measured replies grouped by the
 *  model that drafted them × median views/profile clicks, each bucket gated at
 *  `minN`. Buckets only — no baseline pair to compute a lift against. */
export function buildModelEffectiveness(
  rows: ModelRow[],
  minN = DEFAULT_MIN_CELL_N,
): ModelEffectiveness {
  const byModel = new Map<string, Array<MeasuredOutcome | null>>();
  for (const r of rows) {
    const list = byModel.get(r.model) ?? [];
    list.push(r.outcome);
    byModel.set(r.model, list);
  }
  const cells: ModelCell[] = [...byModel.entries()]
    .map(([model, outcomes]) => ({ model, ...cellOf(outcomes, minN) }))
    .sort((a, b) => b.n - a.n || b.posted - a.posted || a.model.localeCompare(b.model));
  return {
    cells,
    totalMeasured: rows.filter((r) => r.outcome !== null).length,
  };
}

// -------------------------- 12. timeline opportunity-capture funnel (HV.5)

/** One tweet the algorithm put in front of me, from the ambient home-timeline
 *  corpus (`harvest_rows` mode='timeline', HV.1). Metrics are DOM-scraped at
 *  sighting time; the bucket is derived here and never stored (§7.12). */
export interface TimelineSeenRow {
  tweetId: string;
  views: number;
  comments: number;
  likes: number;
  text: string;
  /** null when the article's `<time>` never rendered — see TimelineBucket. */
  tweetTimeMs: number | null;
  capturedAtMs: number;
}

/** Which side of the sweep filters a seen tweet fell on.
 *
 *  This axis used to be the reply band's four verdicts. The classifier is gone,
 *  and re-axising onto `passesSweep` is what keeps the cell honest: the funnel
 *  now measures capture against the ONE rule the user actually tunes, so a
 *  disappointing `qualifies` rate is a real instruction (scroll a sweep, or
 *  loosen the filters) instead of a comment on a classifier nobody controls.
 *
 *  `unknown` is NOT a filter verdict: a row with no tweet time has no derivable
 *  age, so the always-enforced age gate cannot be evaluated at all. It stays its
 *  own bucket (LATENCY_BUCKETS' `unknown` discipline) so it can never be folded
 *  into `filtered`, which DOES mean "the filters looked and said no". */
export type TimelineBucket = 'qualifies' | 'filtered' | 'unknown';

const TIMELINE_BUCKET_ORDER: TimelineBucket[] = ['qualifies', 'filtered', 'unknown'];

/** **`verifiedOnly` is deliberately forced OFF here — and so are the two content
 *  gates.** `harvest_rows` never recorded the author's badge, whether the tweet
 *  carried media, or whether it was promoted; the passive corpus predates all
 *  three filters. Asking the real config would fail every row on unknown
 *  (passesSweep resolves unknown as a refusal, by design) and print a funnel
 *  that means nothing. The metric and age filters are evaluated exactly as
 *  configured; the three content/identity ones are not evaluated at all, and the
 *  page says so. */
export function deriveTimelineBucket(
  row: TimelineSeenRow,
  cfg: SweepConfig = SWEEP,
): TimelineBucket {
  if (row.tweetTimeMs === null || !Number.isFinite(row.tweetTimeMs)) return 'unknown';
  const ageMin = Math.max(0, (row.capturedAtMs - row.tweetTimeMs) / 60_000);
  const passes = passesSweep(
    {
      views: row.views,
      likes: row.likes,
      replies: row.comments,
      ageMin,
      verified: true,
      hasMedia: null,
      promoted: false,
    },
    { ...cfg, verifiedOnly: false, media: 'any', excludeAds: false },
  );
  return passes ? 'qualifies' : 'filtered';
}

export interface FunnelCell {
  bucket: TimelineBucket;
  /** Distinct tweets in this bucket (rows are deduped to their first sighting). */
  seen: number;
  replied: number;
  /** replied/seen, null under the gate — "33% capture" off 3 tweets is a lie. */
  rate: number | null;
  sufficient: boolean;
}

export interface TimelineFunnel {
  /** One cell per non-empty bucket, in TIMELINE_BUCKET_ORDER. */
  cells: FunnelCell[];
  totalSeen: number;
  totalReplied: number;
}

/** Of the tweets the algorithm actually showed me, how many did I reply to?
 *  The denominator only exists because passive capture records EVERY parseable
 *  article, filtered ones included — a funnel over the qualifying cell alone
 *  would be a tautology.
 *
 *  First sighting per tweet is the reading that mattered (the moment it was
 *  still replyable); later re-sightings of the same id are the longitudinal view
 *  curve and must never re-bucket it, so rows are deduped by earliest capture
 *  here as well as in the loader's SQL.
 *
 *  The bucket is derived at read time (§7.12 — never stored) from the CONFIGURED
 *  sweep, so tightening the filters re-labels the whole 30-day history on the
 *  next request. That is the intended behaviour: the cell answers "how much of
 *  what my current filters would admit did I actually reply to". */
export function buildTimelineFunnel(
  rows: TimelineSeenRow[],
  repliedTweetIds: Set<string>,
  minN = DEFAULT_MIN_CELL_N,
  cfg: SweepConfig = SWEEP,
): TimelineFunnel {
  const firstByTweet = new Map<string, TimelineSeenRow>();
  for (const r of rows) {
    const prev = firstByTweet.get(r.tweetId);
    if (!prev || r.capturedAtMs < prev.capturedAtMs) firstByTweet.set(r.tweetId, r);
  }

  const byBucket = new Map<TimelineBucket, { seen: number; replied: number }>();
  let totalReplied = 0;
  for (const [tweetId, row] of firstByTweet) {
    const bucket = deriveTimelineBucket(row, cfg);
    const cell = byBucket.get(bucket) ?? { seen: 0, replied: 0 };
    cell.seen++;
    if (repliedTweetIds.has(tweetId)) {
      cell.replied++;
      totalReplied++;
    }
    byBucket.set(bucket, cell);
  }

  const cells: FunnelCell[] = TIMELINE_BUCKET_ORDER.filter((b) => byBucket.has(b)).map((bucket) => {
    const { seen, replied } = byBucket.get(bucket) as { seen: number; replied: number };
    const sufficient = seen >= minN;
    return { bucket, seen, replied, rate: sufficient ? round2(replied / seen) : null, sufficient };
  });

  return { cells, totalSeen: firstByTweet.size, totalReplied };
}
// -------------------------------------- 13. post format effectiveness (SC.5)

/** One own ORIGINAL post. `text` is `posts_published.text` RAW — both
 *  classifiers normalize at their own input (X's HTML entities, curly
 *  apostrophes, t.co URLs), so pre-normalizing here would double-strip. The
 *  label is derived at read time and never stored (SC decision 2): improving
 *  `classifyFormat` re-labels the entire measured history on the next request. */
export interface OriginalPostRow {
  text: string;
  outcome: MeasuredOutcome | null;
}

export interface FormatCell extends OutcomeCell {
  format: PostFormat;
}

export interface FormatEffectiveness {
  /** One cell per format that actually occurs, in `POST_FORMATS` cascade order.
   *  Fixed order, not most-sampled-first: the cascade order is itself
   *  information (earlier = more specific shape), and a diagnostic table you
   *  re-read weekly should keep its rows where you left them. No lift line —
   *  a 14-way axis has no canonical baseline pair (same shape as
   *  `buildModelEffectiveness`), so cells are compared by eye, each gated. */
  cells: FormatCell[];
  /** Every original, measured or not — the format axis is knowable on rows
   *  whose metrics never landed, unlike every other cell's denominator. */
  totalPosted: number;
  totalMeasured: number;
}

/** The fourth axis (SC decision 3): pillar = topic, register = tone, angle =
 *  reply stance, FORMAT = structure. Unlike every other Playbook cell this one
 *  has n on day one — `posts_published.text` is NOT NULL, so the whole measured
 *  history classifies without a backfill. */
export function buildFormatEffectiveness(
  rows: OriginalPostRow[],
  minN = DEFAULT_MIN_CELL_N,
): FormatEffectiveness {
  const byFormat = new Map<PostFormat, Array<MeasuredOutcome | null>>();
  for (const r of rows) {
    const format = classifyFormat(r.text);
    const list = byFormat.get(format) ?? [];
    list.push(r.outcome);
    byFormat.set(format, list);
  }
  const cells = POST_FORMATS.flatMap((format) => {
    const outcomes = byFormat.get(format);
    return outcomes === undefined ? [] : [{ format, ...cellOf(outcomes, minN) }];
  });
  return {
    cells,
    totalPosted: rows.length,
    totalMeasured: rows.filter((r) => r.outcome !== null).length,
  };
}

// ------------------------------------ 14. the coach's own judge (SC.5)

/** Bands worst→best. Deliberately NOT re-cut here: `scoreDraft` owns the cut
 *  points, and this cell exists to grade the number the Composer actually
 *  showed. Re-deriving bands locally would measure a different score than the
 *  user saw — the badge-vs-gate fork, one surface later. */
const COACH_BAND_ORDER: readonly CoachBand[] = ['rework', 'almost', 'ship', 'top'];

export interface CoachScoreCell extends OutcomeCell {
  band: CoachBand;
}

export interface CoachScoreEffectiveness {
  /** All four bands, worst→best. An empty band is an honest zero here (the
   *  bands partition every original), unlike the format table's absent rows. */
  cells: CoachScoreCell[];
  /** The band is a WEAK key: `standard` is a mean over ~20 rules, so a draft
   *  with one red fix row still scores ~90 and lands in `top`. "Did the coach's
   *  advice help" is the fix-count question, so it is reported BESIDE the band
   *  one rather than instead of it — `clean` = the coach flagged no fixes. */
  clean: OutcomeCell;
  flagged: OutcomeCell;
  totalPosted: number;
  totalMeasured: number;
  /** Highest ÷ lowest GATED band and which two those were — null unless two
   *  distinct bands clear the gate. Naming the pair is what keeps the number
   *  honest: on a small corpus the comparison is rarely top-vs-rework. */
  spread: number | null;
  profileVisitsSpread: number | null;
  spreadBands: { high: CoachBand; low: CoachBand } | null;
  /** clean ÷ flagged, only when BOTH sides clear the gate (the media/idea/
   *  relationship both-sides discipline). */
  fixSpread: number | null;
  fixProfileVisitsSpread: number | null;
}

/** The phase's own falsification test (SC design, non-optional): does the score
 *  the coach shows predict anything about reach? Shipped in the same commit as
 *  the format cell on purpose — if the answer is "no measurable spread", the
 *  coach stays a floor and the UI copy already says so (decision 4). Originals
 *  only, graded with the post rules (`isReply` defaults false) — a reply skips
 *  two checks and would be scored on a different denominator.
 *
 *  `lexicon` must be the ACTIVE niche lexicon (the route passes
 *  `loadActiveCoachLexicon()`), for the same reason the bands are not re-cut
 *  here: the Composer grades with it, so grading without it measures a score
 *  the user never saw — two rules (`concrete_detail`, `hook_opener`'s vocative
 *  branch) move with it. Omitting it falls back to the empty default, which is
 *  only right for a caller that never showed the user a score. */
export function buildCoachScoreEffectiveness(
  rows: OriginalPostRow[],
  minN = DEFAULT_MIN_CELL_N,
  lexicon?: CoachLexicon,
): CoachScoreEffectiveness {
  const byBand = new Map<CoachBand, Array<MeasuredOutcome | null>>();
  const clean: Array<MeasuredOutcome | null> = [];
  const flagged: Array<MeasuredOutcome | null> = [];
  for (const r of rows) {
    const result = lexicon ? scoreDraft(r.text, { lexicon }) : scoreDraft(r.text);
    const list = byBand.get(result.band) ?? [];
    list.push(r.outcome);
    byBand.set(result.band, list);
    (result.counts.fix > 0 ? flagged : clean).push(r.outcome);
  }
  const cells = COACH_BAND_ORDER.map((band) => ({
    band,
    ...cellOf(byBand.get(band) ?? [], minN),
  }));
  const gated = cells.filter((c) => c.sufficient);
  const low = gated[0];
  const high = gated[gated.length - 1];
  const pair =
    low !== undefined && high !== undefined && low.band !== high.band ? { low, high } : null;
  const cleanCell = cellOf(clean, minN);
  const flaggedCell = cellOf(flagged, minN);
  const fixGated = cleanCell.sufficient && flaggedCell.sufficient;
  return {
    cells,
    clean: cleanCell,
    flagged: flaggedCell,
    totalPosted: rows.length,
    totalMeasured: rows.filter((r) => r.outcome !== null).length,
    spread: pair ? ratio(pair.high.medianViews, pair.low.medianViews) : null,
    profileVisitsSpread: pair
      ? ratio(pair.high.medianProfileVisits, pair.low.medianProfileVisits)
      : null,
    spreadBands: pair ? { high: pair.high.band, low: pair.low.band } : null,
    fixSpread: fixGated ? ratio(cleanCell.medianViews, flaggedCell.medianViews) : null,
    fixProfileVisitsSpread: fixGated
      ? ratio(cleanCell.medianProfileVisits, flaggedCell.medianProfileVisits)
      : null,
  };
}

// ------------------------------- 15. does the LLM judge predict anything? (JD.7)

/** One own original with the band the judge gave the EXACT text that shipped.
 *  `verdictBand: null` = never judged, or judged and then edited — the link is a
 *  read-time text hash (JD decision 6), so a post whose typo was fixed after
 *  judging correctly reads as unjudged rather than carrying a verdict about
 *  different words. The loader owns the hashing; this file stays clock- and
 *  crypto-free. */
export interface JudgeRow {
  verdictBand: JudgeVerdictLabel | null;
  outcome: MeasuredOutcome | null;
}

export interface JudgeBandCell extends OutcomeCell {
  band: JudgeVerdictLabel;
}

export interface JudgeEffectiveness {
  /** All four bands, worst→best (`JUDGE_VERDICT_ORDER`) — they partition the
   *  JUDGED rows only, which is why `unjudged` is a sibling and not a fifth. */
  cells: JudgeBandCell[];
  /** Never judged, or edited after judging. Its own bucket (§7.11): folding it
   *  into a band would put a number on "we don't know", and on this cell it is
   *  expected to be the biggest row for months (the tool is on-demand). */
  unjudged: OutcomeCell;
  /** The same judged rows split two ways instead of four — `deriveApproved` is
   *  the only other reading the verdict supports, and a 2-way split clears the
   *  gate at half the sample. Ships BESIDE the band table for the reason SC.5's
   *  clean/flagged does: on a small corpus the 4-way axis is too sparse to say
   *  anything, and this one might not be. */
  approved: OutcomeCell;
  rejected: OutcomeCell;
  totalPosted: number;
  totalMeasured: number;
  /** Highest ÷ lowest GATED band, and which two those were — null unless two
   *  distinct bands clear the gate. Naming the pair is what keeps the number
   *  honest: it is rarely post_now-vs-do_not_post. */
  spread: number | null;
  profileVisitsSpread: number | null;
  spreadBands: { high: JudgeVerdictLabel; low: JudgeVerdictLabel } | null;
  /** approved ÷ rejected, only when BOTH sides clear the gate. */
  approvedSpread: number | null;
  approvedProfileVisitsSpread: number | null;
}

/** The falsification cell for the paid judge, shipped in the same phase as the
 *  tool (JD design, non-optional): do the posts it liked actually reach further?
 *  x-builder — where the rubric comes from — cannot ask this, because its verdict
 *  is never persisted. Ours is, keyed to the exact text.
 *
 *  Expect "insufficient data" for a long time: two gated bands is ~40 judged AND
 *  measured originals. That is the honest alternative to shipping an unvalidated
 *  number as advice, and nothing anywhere sorts or gates on the score (decision
 *  4) regardless of what this cell eventually says. */
export function buildJudgeEffectiveness(
  rows: JudgeRow[],
  minN = DEFAULT_MIN_CELL_N,
): JudgeEffectiveness {
  const byBand = new Map<JudgeVerdictLabel, Array<MeasuredOutcome | null>>();
  const unjudged: Array<MeasuredOutcome | null> = [];
  const approved: Array<MeasuredOutcome | null> = [];
  const rejected: Array<MeasuredOutcome | null> = [];
  for (const r of rows) {
    if (r.verdictBand === null) {
      unjudged.push(r.outcome);
      continue;
    }
    const list = byBand.get(r.verdictBand) ?? [];
    list.push(r.outcome);
    byBand.set(r.verdictBand, list);
    (deriveApproved(r.verdictBand) ? approved : rejected).push(r.outcome);
  }
  const cells = JUDGE_VERDICT_ORDER.map((band) => ({
    band,
    ...cellOf(byBand.get(band) ?? [], minN),
  }));
  const gated = cells.filter((c) => c.sufficient);
  const low = gated[0];
  const high = gated[gated.length - 1];
  const pair =
    low !== undefined && high !== undefined && low.band !== high.band ? { low, high } : null;
  const approvedCell = cellOf(approved, minN);
  const rejectedCell = cellOf(rejected, minN);
  const approvedGated = approvedCell.sufficient && rejectedCell.sufficient;
  return {
    cells,
    unjudged: cellOf(unjudged, minN),
    approved: approvedCell,
    rejected: rejectedCell,
    totalPosted: rows.length,
    totalMeasured: rows.filter((r) => r.outcome !== null).length,
    spread: pair ? ratio(pair.high.medianViews, pair.low.medianViews) : null,
    profileVisitsSpread: pair
      ? ratio(pair.high.medianProfileVisits, pair.low.medianProfileVisits)
      : null,
    spreadBands: pair ? { high: pair.high.band, low: pair.low.band } : null,
    approvedSpread: approvedGated
      ? ratio(approvedCell.medianViews, rejectedCell.medianViews)
      : null,
    approvedProfileVisitsSpread: approvedGated
      ? ratio(approvedCell.medianProfileVisits, rejectedCell.medianProfileVisits)
      : null,
  };
}

// ------------------ 15b. does the RANKER score predict anything? (XR.4)

/** One own original as the $0 DOM harvest saw it — the E score's whole input
 *  plus the text the C score reads.
 *
 *  `counts` and `outcome` are derived from the SAME harvest row by the loader
 *  and must stay that way: `outcome.views` is `counts.views`, and letting two
 *  call sites build them separately is how the denominator of the score and the
 *  denominator of the outcome quietly become different numbers. */
export interface RankerPostRow {
  text: string;
  counts: MeasuredCounts;
  /** What the DOM recorded about the post's shape. Absent fields are unknown,
   *  never false (§7.11) — `has_photo` is null on rows written by an extension
   *  build that predates the column. */
  feats?: DraftFeatures;
  outcome: MeasuredOutcome | null;
}

export interface RankerScoreCell extends OutcomeCell {
  /** 1..4, worst→best. NOT the array index: a quartile that caught no rows is
   *  omitted rather than rendered empty, so the numbers can skip. */
  quartile: number;
  /** The score range this quartile actually covered on THIS sample — the cut
   *  points are recomputed per call, so without it a reader has no way to know
   *  what "top quartile" meant on the corpus in front of them. */
  range: { lo: number; hi: number };
  medianScore: number | null;
}

export interface RankerScoreEffectiveness {
  /** Quartiles of the **E** score (measured counts), worst→best. */
  cells: RankerScoreCell[];
  /** Quartiles of the **C** score (text alone) over the same rows. */
  contentCells: RankerScoreCell[];
  totalPosted: number;
  totalMeasured: number;
  /** Rows E could actually be computed for. A post the harvest caught with no
   *  view count has no rate and therefore no E — it is not a zero. */
  totalScoredE: number;
  spread: number | null;
  spreadQuartiles: { high: number; low: number } | null;
  contentSpread: number | null;
  contentSpreadQuartiles: { high: number; low: number } | null;
}

/** `calibrate-ranker.ts`'s quantile, deliberately the same one: sort ascending,
 *  index `min(len-1, floor(p*len))`. Two definitions of "the 25th percentile"
 *  in one feature is how a re-cut stops reproducing. */
function quantile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] as number;
}

interface ScoredRow {
  score: number;
  outcome: MeasuredOutcome | null;
}

/** Cut points come from the sample itself, so the cells are quartiles of THIS
 *  corpus rather than of a remembered one. Ties are kept together — two
 *  identical drafts must never land in different cells — which is why an empty
 *  quartile is possible and is omitted instead of rendered as a zero row. */
function quartileCells(scored: ScoredRow[], minN: number): RankerScoreCell[] {
  if (scored.length === 0) return [];
  const sorted = scored.map((s) => s.score).sort((a, b) => a - b);
  const c25 = quantile(sorted, 0.25);
  const c50 = quantile(sorted, 0.5);
  const c75 = quantile(sorted, 0.75);
  const buckets = new Map<number, ScoredRow[]>();
  for (const row of scored) {
    const q = row.score < c25 ? 1 : row.score < c50 ? 2 : row.score < c75 ? 3 : 4;
    const list = buckets.get(q) ?? [];
    list.push(row);
    buckets.set(q, list);
  }
  return [1, 2, 3, 4].flatMap((quartile) => {
    const rows = buckets.get(quartile);
    if (rows === undefined) return [];
    const scores = rows.map((r) => r.score);
    return [
      {
        quartile,
        range: {
          lo: scores.reduce((a, b) => Math.min(a, b), scores[0] as number),
          hi: scores.reduce((a, b) => Math.max(a, b), scores[0] as number),
        },
        medianScore: median(scores),
        ...cellOf(
          rows.map((r) => r.outcome),
          minN,
        ),
      },
    ];
  });
}

/** Highest ÷ lowest GATED quartile, naming which two — `buildCoachScoreEffectiveness`'s
 *  `spreadBands` discipline, copied on purpose. On a corpus this size the
 *  comparison is rarely q4-vs-q1, and a ratio whose endpoints are unnamed is a
 *  number nobody can check. */
function quartileSpread(cells: RankerScoreCell[]): {
  spread: number | null;
  pair: { high: number; low: number } | null;
} {
  const gated = cells.filter((c) => c.sufficient);
  const low = gated[0];
  const high = gated[gated.length - 1];
  if (low === undefined || high === undefined || low.quartile === high.quartile) {
    return { spread: null, pair: null };
  }
  return {
    spread: ratio(high.medianViews, low.medianViews),
    pair: { high: high.quartile, low: low.quartile },
  };
}

/** **The XR wave's falsification test** (plan decision 3, non-optional and not
 *  last): does either ranker score separate our own posts by median views?
 *
 *  **Two cells, and only one of them is evidence.** `contentCells` (C) is the
 *  question worth asking — it is computed from the text alone, before the post
 *  exists, so "high C ⇒ high views" would be a real finding. `cells` (E) is a
 *  SANITY CHECK and is partly circular by construction: views is E's own
 *  denominator, and engagement rate falls as reach rises, so E is mildly
 *  *anti*-correlated with views before any content effect is in play. Read a
 *  strong E spread as "the arithmetic is wired up", never as "the ranker
 *  predicts reach".
 *
 *  Population is own harvested ORIGINALS (`latestOwnPostRows`), never
 *  `metrics_snapshots` — see that loader's header for why.
 *
 *  `lexicon` must be the ACTIVE niche lexicon, for exactly the reason
 *  `buildCoachScoreEffectiveness` states: C reads `postCoach` check results, two
 *  of which move with the lexicon, so grading without it measures a score the
 *  Composer never showed. */
export function buildRankerScoreEffectiveness(
  rows: RankerPostRow[],
  minN = DEFAULT_MIN_CELL_N,
  lexicon?: CoachLexicon,
): RankerScoreEffectiveness {
  const measured: ScoredRow[] = [];
  const content: ScoredRow[] = [];
  for (const r of rows) {
    const feats = r.feats ?? {};
    const e = scoreMeasured(r.counts, feats);
    if (e.available) measured.push({ score: e.score, outcome: r.outcome });
    content.push({
      score: scoreDraftRanker(r.text, feats, lexicon ? { lexicon } : undefined).score,
      outcome: r.outcome,
    });
  }
  const cells = quartileCells(measured, minN);
  const contentCells = quartileCells(content, minN);
  const e = quartileSpread(cells);
  const c = quartileSpread(contentCells);
  return {
    cells,
    contentCells,
    totalPosted: rows.length,
    totalMeasured: rows.filter((r) => r.outcome !== null).length,
    totalScoredE: measured.length,
    spread: e.spread,
    spreadQuartiles: e.pair,
    contentSpread: c.spread,
    contentSpreadQuartiles: c.pair,
  };
}

// ----------------------- 16. my own harvested replies (growth plan §2.2–§2.4)

/** One of MY replies as the free DOM harvest saw it, already reduced to one row
 *  per tweet by the loader (latest capture wins — the freshest view count).
 *
 *  `views` is never null: a reply whose numbers didn't parse is not a row at
 *  all. Every `parent*` field IS nullable, and a null there means the SCRAPE
 *  MISSED THE PARENT — a different fact from "small parent" (§7.11), which is
 *  why each axis carries its own `unknown` bucket rather than folding nulls
 *  into the bottom one. */
export interface OwnReplyRow {
  tweetId: string;
  /** The reply's own text, verbatim from the DOM harvest. RC.6 reads it as the
   *  measured few-shot pool; the §2.2–§2.4 crosstabs below ignore it. */
  text: string;
  views: number;
  likes: number;
  comments: number;
  /** When I posted the reply (epoch ms); null when the DOM carried no time. */
  tweetTimeMs: number | null;
  parentHandle: string | null;
  /** The parent's text — the arm axis needs it for `detectScript`. */
  parentText: string | null;
  parentViews: number | null;
  parentComments: number | null;
  parentTimeMs: number | null;
}

/** Bucket edges on all four axes are taken VERBATIM from `x-growth-plan-v3.md`
 *  §2.2/§2.3/§2.4 so my tables read against the same rows as the 1,000-reply
 *  reference corpus. They deliberately do NOT match `AUTHOR_SIZE_BUCKETS`: that
 *  axis bands an author's FOLLOWERS, this one bands a single POST's views, and
 *  the measurement that produced these cuts found 200k+ carrying 56.7% of all
 *  yield — a ceiling of `100k+` would hide the entire finding. */
export const OWN_REPLY_BANDS = [
  '<1k',
  '1k-10k',
  '10k-50k',
  '50k-200k',
  '200k+',
  'unknown',
] as const;
export type OwnReplyBand = (typeof OWN_REPLY_BANDS)[number];

export function ownReplyBand(parentViews: number | null): OwnReplyBand {
  if (parentViews === null || !Number.isFinite(parentViews)) return 'unknown';
  if (parentViews < 1_000) return '<1k';
  if (parentViews < 10_000) return '1k-10k';
  if (parentViews < 50_000) return '10k-50k';
  if (parentViews < 200_000) return '50k-200k';
  return '200k+';
}

/** Age of the parent when I replied. Distinct from `LATENCY_BUCKETS` (§8) on
 *  purpose: that axis measures age-at-DRAFT over `reply_drafts`, this one
 *  age-at-POST over every harvested reply, and §2.3 splits `>6h` into
 *  `6-24h`/`>24h` because those two rows behave nothing alike (yield 12 vs 6 on
 *  parents averaging 139k vs 82 views). Two instruments, never one number. */
export const OWN_REPLY_LATENCY_BUCKETS = [
  '<15m',
  '15-60m',
  '1-6h',
  '6-24h',
  '>24h',
  'unknown',
] as const;
export type OwnReplyLatencyBucket = (typeof OWN_REPLY_LATENCY_BUCKETS)[number];

export function ownReplyLatencyBucket(
  tweetTimeMs: number | null,
  parentTimeMs: number | null,
): OwnReplyLatencyBucket {
  if (tweetTimeMs === null || parentTimeMs === null) return 'unknown';
  if (!Number.isFinite(tweetTimeMs) || !Number.isFinite(parentTimeMs)) return 'unknown';
  // Clamped like resolveAgeMin: X renders relative times, so a reply can read
  // a minute "before" its parent. Negative age is scrape noise, not a reply
  // sent into the past — it belongs in the fastest bucket, not in unknown.
  const min = Math.max(0, (tweetTimeMs - parentTimeMs) / 60_000);
  if (min < 15) return '<15m';
  if (min < 60) return '15-60m';
  if (min < 360) return '1-6h';
  if (min < 1_440) return '6-24h';
  return '>24h';
}

/** How many replies were already on the parent — §2.4's "real discovery": reach
 *  per existing reply, not reach, is the variable. */
export const OWN_REPLY_CROWD_BUCKETS = ['<10', '10-50', '50-200', '200+', 'unknown'] as const;
export type OwnReplyCrowdBucket = (typeof OWN_REPLY_CROWD_BUCKETS)[number];

export function ownReplyCrowdBucket(parentComments: number | null): OwnReplyCrowdBucket {
  if (parentComments === null || !Number.isFinite(parentComments)) return 'unknown';
  if (parentComments < 10) return '<10';
  if (parentComments < 50) return '10-50';
  if (parentComments < 200) return '50-200';
  return '200+';
}

/** The §8 two-week experiment's arms, read off rows that were already free.
 *  Arm attribution is POST-HOC and derived, never stamped: 0 of the first 98
 *  harvested replies matched a `reply_drafts` row (all hand-typed outside the
 *  pipeline), so the drafting path cannot supply it and never will. */
export const OWN_REPLY_ARMS = [
  'roster-ja',
  'roster-en',
  'off-roster-nonlatin',
  'off-roster-en',
  'unknown',
] as const;
export type OwnReplyArm = (typeof OWN_REPLY_ARMS)[number];

function normalizeHandle(handle: string | null): string | null {
  if (handle === null) return null;
  const h = handle.trim().replace(/^@+/, '').toLowerCase();
  return h === '' ? null : h;
}

/**
 * Which experiment arm a reply landed in. `rosterByHandle` maps a camped handle
 * to `cannon_targets.language` (null there = English, per the schema); its keys
 * must already be normalized — `buildOwnReplyPerformance` normalizes the map it
 * is handed once, rather than per row.
 *
 * A null handle is `unknown`, never `off-roster-*`: "off roster" is a claim
 * about a handle we would have had to see (§7.11). Past that, `detectScript`
 * answering null means Latin-or-unvoteable, which folds into the English arm —
 * the arm axis only asks "is this the Japanese lane or an English one", and
 * Latin script cannot separate es/pt/fr anyway.
 */
export function ownReplyArm(
  parentHandle: string | null,
  parentText: string | null,
  rosterByHandle: Map<string, string | null>,
): OwnReplyArm {
  const handle = normalizeHandle(parentHandle);
  if (handle === null) return 'unknown';
  if (rosterByHandle.has(handle)) {
    return resolveLanguageProfile(rosterByHandle.get(handle) ?? null)?.code === 'ja'
      ? 'roster-ja'
      : 'roster-en';
  }
  const text = parentText?.trim() ?? '';
  if (text === '') return 'unknown';
  return detectScript(text) === null ? 'off-roster-en' : 'off-roster-nonlatin';
}

// ------------------------------------------------------- RC.9: the mode axis
//
// Which ROOM each reply was written into, attributed at READ time from the
// CURRENT roster and the current taxonomy — `ownReplyArm`'s precedent, and the
// reason is the same: a stored column on `harvest_rows` would go stale the
// moment a handle is pinned, and every row harvested before 2026-08-08 predates
// the taxonomy entirely.
//
// The precedence is `resolveReplyMode`'s minus the two rules that do not exist
// at read time (no panel override on a reply I already posted, no curate pass on
// a parent I never queued): pin, then detection, then unknown. Deliberately NOT
// `general`: `resolveReplyMode`'s `fallback` means "nothing answered", and
// folding that into the neutral room would let an unresolvable parent vote in a
// cell that claims a register was chosen (§7.11). `winners.ts` drops the same
// rows for the same reason.

/** Attribution keys for the mode axis, in table order. `unknown` is the honest
 *  seventh: no pin, and nothing the detector could score. */
export type OwnReplyModeKey = ReplyModeId | 'unknown';
export const OWN_REPLY_MODES: readonly OwnReplyModeKey[] = [
  ...REPLY_MODES.map((m) => m.id),
  'unknown',
];

/** The room a harvested reply was written into, or null when nothing answered.
 *  `topicByHandle` maps a camped handle to `cannon_targets.topic`; its keys must
 *  already be normalized (the builder normalizes the map it is handed, once). */
export function ownReplyMode(
  parentHandle: string | null,
  parentText: string | null,
  topicByHandle: Map<string, string | null>,
): ReplyMode | null {
  const handle = normalizeHandle(parentHandle);
  // The pin outranks detection here exactly as it does in the resolver: a camped
  // handle is the same room for weeks, and a pin is both free and exact.
  const pinned = handle === null ? null : resolveModeId(topicByHandle.get(handle) ?? null);
  if (pinned) return pinned;
  const text = parentText?.trim() ?? '';
  if (text === '') return null;
  return detectReplyMode(text);
}

// ------------------------------------------------ RC.9: the opening-word axis
//
// WHY THIS DIMENSION EXISTS, and it is the whole point of it: at n=182 the
// opening-word question is UNANSWERABLE, because parent size swamps it. The
// stance-marker group led on raw yield by 20× (1,831 vs 91) while landing under
// parents averaging 154,792 views against the corpus's 18,569 — and on capture
// rate the four classes do not separate at all (2,309–3,845 bp), with the best
// RAW group scoring the WORST capture. The opening rules in `replyMode.ts`'s
// `moves` therefore shipped as GUESSES argued from scanning mechanics (§7.19),
// and this crosstab is what retires them: once the mode is stamped, the cells can
// be read within a band, and every cell quotes capture beside yield so nobody
// re-derives the 20× that was never there. Do not quote the 1,831 anywhere.

export const OWN_REPLY_OPENINGS = [
  'stance-marker',
  'i-my',
  'subordinate',
  'determiner',
  'content-word',
  'unknown',
] as const;
export type OwnReplyOpening = (typeof OWN_REPLY_OPENINGS)[number];

// Opening guesses, all three lists (§7.19). The stance markers are the four the
// corpus scan used plus the rest of the family; the subordinators and
// determiners are the two shapes the RC.1 opening bans name.
const STANCE_MARKER_OPENERS = new Set([
  'imo',
  'imho',
  'ngl',
  'tbh',
  'idk',
  'honestly',
  'lol',
  'lmao',
  'lmfao',
  'haha',
  'yep',
  'yup',
  'yeah',
  'yea',
  'yes',
  'nah',
  'nope',
  'ok',
  'okay',
  'fr',
  'frfr',
  'facts',
  'true',
  'agreed',
  'exactly',
  'same',
  'wow',
  'damn',
  'oof',
  'hmm',
  'huh',
  'oh',
  'ah',
  'wait',
]);
const SELF_OPENERS = new Set(['i', 'im', 'ive', 'id', 'ill', 'my', 'me', 'mine', 'myself']);
const SUBORDINATE_OPENERS = new Set([
  'while',
  'although',
  'though',
  'if',
  'when',
  'whenever',
  'since',
  'because',
  'given',
  'unless',
  'until',
  'after',
  'before',
  'whereas',
  // "As someone who…" is the credentialing open the expertise `moves` line
  // bans by name, and it is a subordinate clause besides.
  'as',
]);
// `a`/`an` are deliberately absent: the ban is on determiner + ABSTRACTION
// ("The reality of…", "This kind of…"), and "a partial index does…" is a
// concrete content opener that happens to start with an article.
const DETERMINER_OPENERS = new Set([
  'the',
  'this',
  'that',
  'these',
  'those',
  'it',
  'its',
  'there',
  'they',
  'them',
  'such',
  'which',
  'what',
]);

/**
 * Which opening class a reply's first word falls in.
 *
 * A NON-LATIN opener answers `unknown`, never `content-word`. This taxonomy is
 * English scanning mechanics — a Japanese reply opening 「いや」 is a stance
 * marker and opening 「猫」 is a content word, and nothing here can tell them
 * apart. An English-tuned heuristic applied to a language it was never validated
 * against yields unknown, not a class (§7.11, the same call ML.3 made for the
 * specificity gate). It costs the crosstab the Japanese rows; inventing a class
 * for them would cost it the truth.
 */
export function ownReplyOpening(text: string): OwnReplyOpening {
  // Leading quotes, brackets, emoji and @-mentions are not the opening WORD.
  const first = text
    .trim()
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .match(/^[\p{L}\p{N}'’]+/u)?.[0];
  if (first === undefined) return 'unknown';
  const word = first.replace(/['’]/g, '').toLowerCase();
  if (word === '' || !/^[a-z0-9]/.test(word)) return 'unknown';
  if (STANCE_MARKER_OPENERS.has(word)) return 'stance-marker';
  if (SELF_OPENERS.has(word)) return 'i-my';
  if (SUBORDINATE_OPENERS.has(word)) return 'subordinate';
  if (DETERMINER_OPENERS.has(word)) return 'determiner';
  return 'content-word';
}

/** One row of any of the four tables. An insufficient cell still reports its
 *  counts and NULLS its averages — the `OutcomeCell` discipline, restated here
 *  because this family averages (the §2.2 corpus is quoted as means) where the
 *  rest of the file takes medians. */
export interface OwnReplyCell {
  /** Replies in the cell. Every harvested reply is measured, so this is both
   *  the volume and the gate's sample. */
  n: number;
  totalViews: number;
  /** Mean views per reply — the ladder number, per cell. Null under the gate. */
  avgYield: number | null;
  /** Mean views on the parents in this cell; null under the gate, and also when
   *  no row in the cell knew its parent's view count. */
  avgParentViews: number | null;
  /**
   * RC.9 — mean capture in basis points: of the parent's views, how many ten-
   * thousandths my reply took. Null under the gate, and when no row in the cell
   * knew its parent's view count.
   *
   * It rides beside `avgYield` in EVERY cell because raw yield is what made the
   * stance-marker opening group look 20× better than it is: yield rewards a cell
   * for the parents it happened to land under, capture asks what the reply did
   * with them. Two numbers, never one — a cell that leads on both has actually
   * found something.
   *
   * A MEAN of per-reply ratios, not a ratio of the sums: the latter is decided
   * by whichever row had the biggest parent, which is the exact confound this
   * column exists to remove.
   */
  captureBp: number | null;
  /** Share of ALL harvested reply views in the window, including the views in
   *  cells that failed the gate — a share computed over gated cells only would
   *  not sum to 100, and this column exists to be summed by eye. */
  sharePct: number;
  sufficient: boolean;
}

export interface OwnReplyBandCell extends OwnReplyCell {
  band: OwnReplyBand;
}
export interface OwnReplyLatencyCell extends OwnReplyCell {
  bucket: OwnReplyLatencyBucket;
}
export interface OwnReplyCrowdCell extends OwnReplyCell {
  bucket: OwnReplyCrowdBucket;
}
export interface OwnReplyArmCell extends OwnReplyCell {
  arm: OwnReplyArm;
}
export interface OwnReplyModeCell extends OwnReplyCell {
  mode: OwnReplyModeKey;
}
export interface OwnReplyOpeningCell extends OwnReplyCell {
  opening: OwnReplyOpening;
}
/** The opening × mode crosstab: one cell per non-empty PAIR. Thin by
 *  construction for months — that is the honest state of the question, not a
 *  defect (see the axis header). */
export interface OwnReplyOpeningModeCell extends OwnReplyOpeningCell {
  mode: OwnReplyModeKey;
}

/**
 * RC.9 — how often a reply written into a room where the persona is BACKGROUND
 * reached for my lane anyway. The defect the whole overhaul exists to kill,
 * as one number.
 *
 * Denominator: replies whose parent resolved to a room with
 * `personaUse !== 'full'`. Unknown-mode rows are OUT of it — "I could not tell
 * which room this was" is not evidence that the persona was off-limits (§7.11) —
 * which makes this rate strictly smaller-sample and strictly more honest than
 * the 2026-08-07 baseline it is compared against (19 of 182 = 10.4%, those 19
 * averaging 27 views, computed over the whole corpus by hand).
 */
export interface OwnReplyContamination {
  /** Replies in a persona-is-background room. The gate's sample. */
  n: number;
  contaminated: number;
  /** Percent of `n`. Null under the gate. */
  pct: number | null;
  /** The comparison that matters: contaminated replies averaged 27 views on the
   *  baseline day against a corpus average of 183. Each side gated on its OWN
   *  count — a 3-row "clean" average is not a rebuttal. */
  avgYieldContaminated: number | null;
  avgYieldClean: number | null;
  sufficient: boolean;
}

export interface OwnReplyPerformance {
  /** Distinct replies in the window. */
  totalMeasured: number;
  totalViews: number;
  /** The one number the §8 two-week test tracks daily. Null under the gate. */
  viewsPerReply: number | null;
  /** Corpus-wide mean capture in basis points — `OwnReplyCell.captureBp` over
   *  every measured reply. The denominator that makes a cell's capture readable. */
  captureBp: number | null;
  /** One cell per non-empty bucket, in canonical (not most-sampled) order. */
  bands: OwnReplyBandCell[];
  latency: OwnReplyLatencyCell[];
  crowding: OwnReplyCrowdCell[];
  arms: OwnReplyArmCell[];
  modes: OwnReplyModeCell[];
  openings: OwnReplyOpeningCell[];
  openingsByMode: OwnReplyOpeningModeCell[];
  contamination: OwnReplyContamination;
}

/** Mean capture in basis points over the rows that knew their parent's views.
 *  A parent of 0 views is excluded rather than treated as infinite capture. */
function meanCaptureBp(rows: OwnReplyRow[]): number | null {
  const ratios = rows.flatMap((r) =>
    r.parentViews !== null && Number.isFinite(r.parentViews) && r.parentViews > 0
      ? [(r.views / r.parentViews) * 10_000]
      : [],
  );
  const m = mean(ratios);
  return m === null ? null : round2(m);
}

function ownReplyCell(rows: OwnReplyRow[], totalViews: number, minN: number): OwnReplyCell {
  const cellViews = rows.reduce((sum, r) => sum + r.views, 0);
  const sufficient = rows.length >= minN;
  const parentViews = rows
    .map((r) => r.parentViews)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  const avgParent = mean(parentViews);
  const capture = meanCaptureBp(rows);
  return {
    n: rows.length,
    totalViews: cellViews,
    avgYield: sufficient ? round2(mean(rows.map((r) => r.views)) ?? 0) : null,
    avgParentViews: sufficient && avgParent !== null ? round2(avgParent) : null,
    captureBp: sufficient ? capture : null,
    sharePct: totalViews > 0 ? round2((cellViews / totalViews) * 100) : 0,
    sufficient,
  };
}

function ownReplyCells<K extends string>(
  order: readonly K[],
  rows: OwnReplyRow[],
  keyOf: (row: OwnReplyRow) => K,
  totalViews: number,
  minN: number,
): Array<OwnReplyCell & { key: K }> {
  const byKey = new Map<K, OwnReplyRow[]>();
  for (const r of rows) {
    const k = keyOf(r);
    const list = byKey.get(k) ?? [];
    list.push(r);
    byKey.set(k, list);
  }
  return order.flatMap((k) => {
    const inCell = byKey.get(k);
    return inCell === undefined ? [] : [{ key: k, ...ownReplyCell(inCell, totalViews, minN) }];
  });
}

/** The roster row this family reads, per camped handle. Both columns are
 *  attribution inputs and neither is stored on the reply: `language` splits the
 *  §8 arms, `topic` is RC.3's mode pin. One map rather than two, so a caller
 *  cannot hand over a roster that is half fresh. */
export interface OwnReplyRosterEntry {
  /** `cannon_targets.language`; null = English, per the schema. */
  language: string | null;
  /** `cannon_targets.topic`; null = unpinned, and detection decides. */
  topic: string | null;
}

/**
 * The §2.2–§2.4 tables over my own harvested replies, plus RC.9's three:
 * room, opening class (crossed with room) and the contamination rate.
 *
 * Pure: no DB, no clock — the caller supplies the window and the roster.
 *
 * Rows are deduped by `tweetId` here as well as in the loader's SQL, LATEST
 * wins. `harvest_rows` stores every capture of the same tweet on purpose (that
 * IS the longitudinal curve), so any consumer that forgets to reduce silently
 * doubles every total the second time a day is harvested. The direction is the
 * opposite of `buildTimelineFunnel`'s earliest-wins and both are correct: that
 * one wants the band at first sighting, this one wants the freshest view count.
 */
export function buildOwnReplyPerformance(
  rows: OwnReplyRow[],
  rosterByHandle: Map<string, OwnReplyRosterEntry>,
  minN = DEFAULT_MIN_CELL_N,
): OwnReplyPerformance {
  const latestByTweet = new Map<string, OwnReplyRow>();
  for (const r of rows) latestByTweet.set(r.tweetId, r);
  const deduped = [...latestByTweet.values()];

  const roster = new Map<string, string | null>();
  const topics = new Map<string, string | null>();
  for (const [handle, entry] of rosterByHandle) {
    const key = normalizeHandle(handle);
    if (key === null) continue;
    roster.set(key, entry.language);
    topics.set(key, entry.topic);
  }

  // Resolved once per row: the mode axis, the contamination rate and the
  // opening crosstab all read it, and three call sites of `ownReplyMode` is
  // three chances for them to disagree about which room a reply was in.
  const modeOf = new Map<OwnReplyRow, ReplyMode | null>();
  for (const r of deduped) modeOf.set(r, ownReplyMode(r.parentHandle, r.parentText, topics));
  const modeKey = (r: OwnReplyRow): OwnReplyModeKey => modeOf.get(r)?.id ?? 'unknown';

  const totalViews = deduped.reduce((sum, r) => sum + r.views, 0);
  const bands = ownReplyCells(
    OWN_REPLY_BANDS,
    deduped,
    (r) => ownReplyBand(r.parentViews),
    totalViews,
    minN,
  ).map(({ key, ...cell }) => ({ band: key, ...cell }));
  const latency = ownReplyCells(
    OWN_REPLY_LATENCY_BUCKETS,
    deduped,
    (r) => ownReplyLatencyBucket(r.tweetTimeMs, r.parentTimeMs),
    totalViews,
    minN,
  ).map(({ key, ...cell }) => ({ bucket: key, ...cell }));
  const crowding = ownReplyCells(
    OWN_REPLY_CROWD_BUCKETS,
    deduped,
    (r) => ownReplyCrowdBucket(r.parentComments),
    totalViews,
    minN,
  ).map(({ key, ...cell }) => ({ bucket: key, ...cell }));
  const arms = ownReplyCells(
    OWN_REPLY_ARMS,
    deduped,
    (r) => ownReplyArm(r.parentHandle, r.parentText, roster),
    totalViews,
    minN,
  ).map(({ key, ...cell }) => ({ arm: key, ...cell }));
  const modes = ownReplyCells(OWN_REPLY_MODES, deduped, modeKey, totalViews, minN).map(
    ({ key, ...cell }) => ({ mode: key, ...cell }),
  );
  const openings = ownReplyCells(
    OWN_REPLY_OPENINGS,
    deduped,
    (r) => ownReplyOpening(r.text),
    totalViews,
    minN,
  ).map(({ key, ...cell }) => ({ opening: key, ...cell }));

  // The crossed set. The pair list carries its own components so the cells never
  // have to be re-parsed out of a composite key.
  const pairs = OWN_REPLY_MODES.flatMap((mode) =>
    OWN_REPLY_OPENINGS.map((opening) => ({ mode, opening, key: `${mode}|${opening}` as const })),
  );
  const crossed = new Map(
    ownReplyCells(
      pairs.map((p) => p.key),
      deduped,
      (r) => `${modeKey(r)}|${ownReplyOpening(r.text)}` as const,
      totalViews,
      minN,
    ).map((c) => [c.key, c]),
  );
  const openingsByMode = pairs.flatMap((p) => {
    const cell = crossed.get(p.key);
    if (cell === undefined) return [];
    const { key: _key, ...rest } = cell;
    return [{ mode: p.mode, opening: p.opening, ...rest }];
  });

  // Contamination: lane nouns where the room said the persona is background.
  const background = deduped.filter((r) => {
    const m = modeOf.get(r) ?? null;
    return m !== null && m.personaUse !== 'full';
  });
  const contaminated = background.filter((r) => containsLaneNoun(r.text));
  const clean = background.filter((r) => !containsLaneNoun(r.text));

  return {
    totalMeasured: deduped.length,
    totalViews,
    viewsPerReply: deduped.length >= minN ? round2(totalViews / deduped.length) : null,
    captureBp: deduped.length >= minN ? meanCaptureBp(deduped) : null,
    bands,
    latency,
    crowding,
    arms,
    modes,
    openings,
    openingsByMode,
    contamination: {
      n: background.length,
      contaminated: contaminated.length,
      pct:
        background.length >= minN ? round2((contaminated.length / background.length) * 100) : null,
      avgYieldContaminated:
        contaminated.length >= minN ? round2(mean(contaminated.map((r) => r.views)) ?? 0) : null,
      avgYieldClean: clean.length >= minN ? round2(mean(clean.map((r) => r.views)) ?? 0) : null,
      sufficient: background.length >= minN,
    },
  };
}

// ------------------------------------------------ feedback into generation

/** Gated guidance line for the reply prompts. Null unless the best angle's
 *  cell passes the min-sample gate — an ungated hunch must never steer a
 *  prompt. Ranks by median profile visits (the follow-precursor), views as
 *  tie-break, and quotes the multiplier vs the other angles when computable. */
export function topAngles(cells: AngleCell[], minN = DEFAULT_MIN_CELL_N): string | null {
  const eligible = cells.filter((c) => c.angle !== null && c.n >= minN);
  if (eligible.length === 0) return null;
  const ranked = [...eligible].sort(
    (a, b) =>
      (b.medianProfileVisits ?? -1) - (a.medianProfileVisits ?? -1) ||
      (b.medianViews ?? -1) - (a.medianViews ?? -1) ||
      b.n - a.n,
  );
  const best = ranked[0] as AngleCell & { angle: string };

  const others = cells.filter((c) => c.angle !== null && c.angle !== best.angle && c.n > 0);
  const otherClicks = median(others.map((c) => c.medianProfileVisits));
  const otherViews = median(others.map((c) => c.medianViews));

  if (best.medianProfileVisits !== null && otherClicks !== null && otherClicks > 0) {
    const mult = round2(best.medianProfileVisits / otherClicks);
    if (mult > 1) {
      return `measured: my '${best.angle}' replies earn ${mult}x the median profile clicks of my other angles (n=${best.n}) — prefer that angle when it fits the post.`;
    }
  }
  if (best.medianViews !== null && otherViews !== null && otherViews > 0) {
    const mult = round2(best.medianViews / otherViews);
    if (mult > 1) {
      return `measured: my '${best.angle}' replies earn ${mult}x the median views of my other angles (n=${best.n}) — prefer that angle when it fits the post.`;
    }
  }
  if (best.medianViews !== null) {
    return `measured: my '${best.angle}' replies perform best so far (median ${fmt(best.medianViews)} views, n=${best.n}) — prefer that angle when it fits the post.`;
  }
  return null;
}

/** Gated guidance line for the post drafter: the best-measured hook shape and
 *  rhetorical device from MY OWN winners. Null unless at least one cell passes. */
export function topStructures(
  structures: StructureEffectiveness,
  minN = DEFAULT_MIN_CELL_N,
): string | null {
  const bestHook = bestStructureCell(structures.hooks, minN);
  const bestDevice = bestStructureCell(structures.devices, minN);
  const parts: string[] = [];
  if (bestHook?.medianViews != null) {
    parts.push(
      `'${bestHook.key}' openers earn median ${fmt(bestHook.medianViews)} views on my feed (n=${bestHook.n})`,
    );
  }
  if (bestDevice?.medianViews != null && bestDevice.key !== bestHook?.key) {
    parts.push(`'${bestDevice.key}' is my strongest device (n=${bestDevice.n})`);
  }
  if (parts.length === 0) return null;
  return `measured: ${parts.join('; ')} — reach for these shapes when they fit the topic.`;
}

function bestStructureCell(cells: StructureCell[], minN: number): StructureCell | null {
  const eligible = cells.filter((c) => c.n >= minN && c.medianViews !== null);
  if (eligible.length === 0) return null;
  return eligible.reduce((best, c) =>
    (c.medianViews ?? -1) > (best.medianViews ?? -1) ? c : best,
  );
}
