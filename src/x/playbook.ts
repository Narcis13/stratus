// The Playbook (CIRCLES-PLAN C4): pure aggregations that turn measured-but-
// unused feedback signals into (a) a page the human reads and (b) short
// guidance lines the prompts consume. Every stat is guarded by a min-sample
// gate — a cell below the threshold still renders, flagged insufficient, so
// the page can show "insufficient data (n=7)" instead of a confident lie.
//
// Pure on purpose: no DB, no clock. routes/playbook.ts loads the rows and
// calls these; fixtures drive the tests.

import { type Band, classifyBand, textLooksLikeReplyBait } from '../shared/replyBand.ts';

/** Default per-cell minimum sample before a stat is allowed to claim anything.
 *  Same spirit as the BAND ≥100 rule, scaled to per-cell granularity. */
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

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] as number;
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

// ------------------------------------- 5. bait crosstab + band hit-rates

/** One measured reply with its capture-time classifier reading — the JSON
 *  form of what evals/analyze-own-replies.ts computes (the script stays for
 *  deep dives; this feeds the page). */
export interface ScoredReply {
  band: Band;
  bait: boolean;
  views: number;
  likes: number;
  profileClicks: number | null;
}

/** Derive a ScoredReply from an outcome row: capture-time signals when
 *  stamped, else derived from contextSnapshot metrics + draft-creation age
 *  (same fallback as the eval script). Null when unmeasurable. */
export function scoreReplyOutcome(row: {
  signals: {
    band: Band;
    views: number;
    replies: number;
    ageMin: number;
    vpm: number;
    bait: boolean;
  } | null;
  sourceMetrics: { views: number; replies: number } | null;
  sourceText: string;
  sourcePostedAt: Date | string | null;
  draftCreatedAt: Date | string;
  outcome: { views: number | null; likes: number | null; profileVisits: number | null } | null;
}): ScoredReply | null {
  if (!row.outcome || row.outcome.views === null) return null;

  let band: Band;
  let bait: boolean;
  if (row.signals) {
    band = row.signals.band;
    bait = row.signals.bait;
  } else {
    if (!row.sourceMetrics || !row.sourcePostedAt) return null;
    const postedMs = new Date(row.sourcePostedAt).getTime();
    const createdMs = new Date(row.draftCreatedAt).getTime();
    if (Number.isNaN(postedMs) || Number.isNaN(createdMs)) return null;
    const ageMin = Math.max(0, (createdMs - postedMs) / 60_000);
    bait = textLooksLikeReplyBait(row.sourceText);
    band = classifyBand({
      views: row.sourceMetrics.views,
      replies: row.sourceMetrics.replies,
      ageMin,
      vpm: row.sourceMetrics.views / Math.max(ageMin, 1),
      bait,
    });
  }
  return {
    band,
    bait,
    views: row.outcome.views,
    likes: row.outcome.likes ?? 0,
    profileClicks: row.outcome.profileVisits,
  };
}

export interface BandCell {
  band: Band;
  n: number;
  medianViews: number | null;
  meanViews: number | null;
  /** Share of this band's replies clearing the account's p75 views. */
  hitRate: number | null;
  /** Share that got at least one like. */
  likeRate: number | null;
  meanProfileClicks: number | null;
  sufficient: boolean;
}

export interface BaitCell {
  n: number;
  medianViews: number | null;
  meanLikes: number | null;
  sufficient: boolean;
}

export interface BandCalibration {
  totalMeasured: number;
  /** p75 of all measured reply views — the "hit" bar, account-calibrated. */
  hitThresholdViews: number | null;
  bands: BandCell[];
  actionable: { n: number; medianViews: number | null; hitRate: number | null };
  passed: { n: number; medianViews: number | null; hitRate: number | null };
  bait: { bait: BaitCell; nonBait: BaitCell };
}

const BAND_ORDER: Band[] = ['hot', 'warm', 'skip', null];

export function buildBandCalibration(
  scored: ScoredReply[],
  minN = DEFAULT_MIN_CELL_N,
): BandCalibration {
  const allViews = scored.map((s) => s.views);
  const hit = percentile(allViews, 75);

  const bands: BandCell[] = [];
  for (const band of BAND_ORDER) {
    const g = scored.filter((s) => s.band === band);
    if (g.length === 0) continue;
    const views = g.map((s) => s.views);
    const clicks = g.filter((s) => s.profileClicks !== null).map((s) => s.profileClicks as number);
    bands.push({
      band,
      n: g.length,
      medianViews: median(views),
      meanViews: roundOrNull(mean(views)),
      hitRate: hit === null ? null : round2(g.filter((s) => s.views >= hit).length / g.length),
      likeRate: round2(g.filter((s) => s.likes >= 1).length / g.length),
      meanProfileClicks: roundOrNull(mean(clicks)),
      sufficient: g.length >= minN,
    });
  }

  const actionable = scored.filter((s) => s.band === 'hot' || s.band === 'warm');
  const passed = scored.filter((s) => s.band === 'skip' || s.band === null);

  return {
    totalMeasured: scored.length,
    hitThresholdViews: hit,
    bands,
    actionable: sideCell(actionable, hit),
    passed: sideCell(passed, hit),
    bait: {
      bait: baitCell(
        scored.filter((s) => s.bait),
        minN,
      ),
      nonBait: baitCell(
        scored.filter((s) => !s.bait),
        minN,
      ),
    },
  };
}

function sideCell(
  g: ScoredReply[],
  hit: number | null,
): { n: number; medianViews: number | null; hitRate: number | null } {
  return {
    n: g.length,
    medianViews: median(g.map((s) => s.views)),
    hitRate:
      hit === null || g.length === 0
        ? null
        : round2(g.filter((s) => s.views >= hit).length / g.length),
  };
}

function baitCell(g: ScoredReply[], minN: number): BaitCell {
  return {
    n: g.length,
    medianViews: median(g.map((s) => s.views)),
    meanLikes: roundOrNull(mean(g.map((s) => s.likes))),
    sufficient: g.length >= minN,
  };
}

function roundOrNull(v: number | null): number | null {
  return v === null ? null : round2(v);
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
 *  sighting time; the band is derived here and never stored (§7.12). */
export interface TimelineSeenRow {
  tweetId: string;
  views: number;
  comments: number;
  text: string;
  /** null when the article's `<time>` never rendered — see TimelineBand. */
  tweetTimeMs: number | null;
  capturedAtMs: number;
}

/** `unknown` is NOT a classifier verdict: a row with no tweet time has no
 *  derivable age, therefore no velocity, therefore nothing to ask classifyBand.
 *  It stays its own bucket (same discipline as LATENCY_BUCKETS' `unknown`) so it
 *  can never be folded into the real `null` band, which DOES mean "judged not
 *  worth replying to". */
export type TimelineBand = Band | 'unknown';

const TIMELINE_BAND_ORDER: TimelineBand[] = ['hot', 'warm', 'skip', null, 'unknown'];

export function deriveTimelineBand(row: TimelineSeenRow): TimelineBand {
  if (row.tweetTimeMs === null || !Number.isFinite(row.tweetTimeMs)) return 'unknown';
  const ageMin = Math.max(0, (row.capturedAtMs - row.tweetTimeMs) / 60_000);
  return classifyBand({
    views: row.views,
    replies: row.comments,
    ageMin,
    vpm: row.views / Math.max(ageMin, 1),
    bait: textLooksLikeReplyBait(row.text),
  });
}

export interface FunnelCell {
  band: TimelineBand;
  /** Distinct tweets in this band (rows are deduped to their first sighting). */
  seen: number;
  replied: number;
  /** replied/seen, null under the gate — "33% capture" off 3 tweets is a lie. */
  rate: number | null;
  sufficient: boolean;
}

export interface TimelineFunnel {
  /** One cell per non-empty band, in TIMELINE_BAND_ORDER. */
  cells: FunnelCell[];
  totalSeen: number;
  totalReplied: number;
}

/** Of the tweets the algorithm actually showed me, how many did I reply to?
 *  The denominator only exists because passive capture records EVERY parseable
 *  article including band 'skip' — a funnel over the hot cell alone would be a
 *  tautology.
 *
 *  First sighting per tweet is the band that mattered (the moment it was still
 *  replyable); later re-sightings of the same id are the longitudinal view curve
 *  and must never re-band it, so rows are deduped by earliest capture here as
 *  well as in the loader's SQL. */
export function buildTimelineFunnel(
  rows: TimelineSeenRow[],
  repliedTweetIds: Set<string>,
  minN = DEFAULT_MIN_CELL_N,
): TimelineFunnel {
  const firstByTweet = new Map<string, TimelineSeenRow>();
  for (const r of rows) {
    const prev = firstByTweet.get(r.tweetId);
    if (!prev || r.capturedAtMs < prev.capturedAtMs) firstByTweet.set(r.tweetId, r);
  }

  const byBand = new Map<TimelineBand, { seen: number; replied: number }>();
  let totalReplied = 0;
  for (const [tweetId, row] of firstByTweet) {
    const band = deriveTimelineBand(row);
    const cell = byBand.get(band) ?? { seen: 0, replied: 0 };
    cell.seen++;
    if (repliedTweetIds.has(tweetId)) {
      cell.replied++;
      totalReplied++;
    }
    byBand.set(band, cell);
  }

  const cells: FunnelCell[] = TIMELINE_BAND_ORDER.filter((b) => byBand.has(b)).map((band) => {
    const { seen, replied } = byBand.get(band) as { seen: number; replied: number };
    const sufficient = seen >= minN;
    return { band, seen, replied, rate: sufficient ? round2(replied / seen) : null, sufficient };
  });

  return { cells, totalSeen: firstByTweet.size, totalReplied };
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
