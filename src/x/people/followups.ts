// Follow-up engine (CIRCLES-PLAN C5). Pure — no DB, no clock reads: the route
// (routes/followups.ts) loads the rows and passes `now`, this module decides
// who you owe, who to nurture, and who's heating up. Momentum is computed at
// read time from the snapshot series (deliberate deviation from the plan's
// "nightly inside dailyMetrics" phrasing: same $0 and the same queue line, but
// no stored flags to go stale — the C2 "no conversation table" discipline).
//
// The windows (24h chain, 7d dm-ready/neglected-target, 14d neglected-ally,
// 5%/week inflection, 30d band-entry horizon) are opening guesses — revisit
// after ~30 days of real queue use, same spirit as the stage thresholds.

import { type Stage, stageRank } from './stage.ts';

export const FOLLOWUP_KINDS = [
  'chain_live',
  'dm_ready',
  'neglected_target',
  'neglected_ally',
  // reup_candidate is NOT a person item (see pickReupCandidate) — it's a proven
  // own post worth quote-tweeting again. Assembled by the route, ranked just
  // above momentum. Kept in this list so isFollowupKind/PATCH-snooze accept it.
  'reup_candidate',
  'momentum',
] as const;
export type FollowupKind = (typeof FOLLOWUP_KINDS)[number];

export function isFollowupKind(v: unknown): v is FollowupKind {
  return typeof v === 'string' && (FOLLOWUP_KINDS as readonly string[]).includes(v);
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const CHAIN_LIVE_MAX_AGE_MS = DAY_MS;
export const DM_READY_WINDOW_MS = 7 * DAY_MS;
export const NEGLECTED_TARGET_DAYS = 7;
export const NEGLECTED_ALLY_DAYS = 14;

// Momentum thresholds: an inflection needs a recent segment spanning ≥3 days
// (two enriches minutes apart aren't a trend), a series whose latest point
// isn't stale, and a recent weekly growth rate ≥5% that beats the prior rate.
export const MOMENTUM_MIN_SEGMENT_DAYS = 3;
export const MOMENTUM_WEEKLY_PCT_THRESHOLD = 5;
export const MOMENTUM_STALE_DAYS = 30;
export const BAND_ENTRY_HORIZON_DAYS = 30;

/** Snooze rows key on this — one snooze per (kind, person). */
export function followupKey(kind: FollowupKind, handle: string): string {
  return `${kind}:${handle}`;
}

/** reup_candidate snoozes key on the tweet, not a person — `reup:<tweetId>`.
 *  Deliberately NOT `reup_candidate:<tweetId>` so the key stays short and the
 *  reup path never collides with a person handle in followup_snoozes. */
export function reupKey(tweetId: string): string {
  return `reup:${tweetId}`;
}

export interface FollowupItem {
  kind: FollowupKind;
  handle: string;
  displayName: string | null;
  stage: Stage | null;
  /** One human line: why this item is in the queue. */
  reason: string;
  /** The timestamp the reason hangs on (owed since / stage change / last
   *  outbound / last exchange / latest snapshot). */
  at: Date | null;
  /** chain_live only: the owed inbound tweet. */
  tweetId?: string;
  url?: string;
}

export interface FollowupPerson {
  handle: string;
  displayName: string | null;
  stage: Stage;
  stageUpdatedAt: Date | null;
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
}

export interface ChainInbound {
  handle: string;
  displayName: string | null;
  tweetId: string;
  text: string;
  postedAt: Date;
  url: string | null;
}

export interface MomentumCandidate {
  handle: string;
  displayName: string | null;
  stage: Stage | null;
  followersCount: number;
  inflection: MomentumInflection | null;
  enteringBand: boolean;
  latestCapturedAt: Date;
}

export interface ClassifyInputs {
  now: Date;
  /** Unanswered inbound replies to MY replies (route pre-joins mentions ↔
   *  posts_published); the classifier applies the 24h window. */
  chainInbound: ChainInbound[];
  /** Non-retired people rows. */
  people: FollowupPerson[];
  /** The 2–10x voice-target roster (lowercased handles). Empty when no
   *  account snapshot exists yet. */
  targetHandles: Set<string>;
  /** Pre-computed momentum candidates (see momentumInflection /
   *  aboutToEnterBand); the classifier keeps only flagged ones. */
  momentum: MomentumCandidate[];
  /** followupKey → snoozedUntil. Expired entries are ignored. */
  snoozes: Map<string, Date>;
}

export interface ClassifyResult {
  items: FollowupItem[];
  /** Items hidden by an active snooze. */
  snoozed: number;
}

/** The queue, ranked: chain-live (oldest debt first), then dm-ready (freshest
 *  advance first), then neglected targets (never/oldest outbound first), then
 *  neglected allies (oldest exchange first), then momentum lines (hottest
 *  first). One item per person — the highest-priority kind wins. */
export function classifyFollowups(inputs: ClassifyInputs): ClassifyResult {
  const nowMs = inputs.now.getTime();
  const personByHandle = new Map(inputs.people.map((p) => [p.handle, p]));

  const candidates: FollowupItem[] = [];

  // chain_live — inbound reply to my reply, <24h old. Top priority.
  const chains = inputs.chainInbound
    .filter((m) => nowMs - m.postedAt.getTime() < CHAIN_LIVE_MAX_AGE_MS)
    .sort((a, b) => a.postedAt.getTime() - b.postedAt.getTime());
  for (const m of chains) {
    const person = personByHandle.get(m.handle);
    candidates.push({
      kind: 'chain_live',
      handle: m.handle,
      displayName: m.displayName ?? person?.displayName ?? null,
      stage: person?.stage ?? null,
      reason: `replied to your reply ${fmtAgo(m.postedAt, inputs.now)} — the chain is live`,
      at: m.postedAt,
      tweetId: m.tweetId,
      ...(m.url ? { url: m.url } : {}),
    });
  }

  // dm_ready — just advanced to responded/mutual: the REPLY GUIDE's "good
  // reply + author replies back → DM" moment. The DM stays manual, in X.
  const dmReady = inputs.people
    .filter(
      (p) =>
        (p.stage === 'responded' || p.stage === 'mutual') &&
        p.stageUpdatedAt !== null &&
        nowMs - p.stageUpdatedAt.getTime() < DM_READY_WINDOW_MS,
    )
    .sort((a, b) => (b.stageUpdatedAt as Date).getTime() - (a.stageUpdatedAt as Date).getTime());
  for (const p of dmReady) {
    candidates.push({
      kind: 'dm_ready',
      handle: p.handle,
      displayName: p.displayName,
      stage: p.stage,
      reason: `advanced to ${p.stage} ${fmtAgo(p.stageUpdatedAt as Date, inputs.now)} — good DM moment`,
      at: p.stageUpdatedAt,
    });
  }

  // neglected_target — targets roster ∩ people, my last outbound >7d or never
  // (generalizes the Targets amber).
  const targetCutoff = nowMs - NEGLECTED_TARGET_DAYS * DAY_MS;
  const neglectedTargets = inputs.people
    .filter(
      (p) =>
        inputs.targetHandles.has(p.handle) &&
        (p.lastOutboundAt === null || p.lastOutboundAt.getTime() < targetCutoff),
    )
    .sort((a, b) => (a.lastOutboundAt?.getTime() ?? 0) - (b.lastOutboundAt?.getTime() ?? 0));
  for (const p of neglectedTargets) {
    candidates.push({
      kind: 'neglected_target',
      handle: p.handle,
      displayName: p.displayName,
      stage: p.stage,
      reason:
        p.lastOutboundAt === null
          ? 'on your target roster — never replied to'
          : `on your target roster — last reply ${fmtAgo(p.lastOutboundAt, inputs.now)}`,
      at: p.lastOutboundAt,
    });
  }

  // neglected_ally — stage ≥ mutual, no exchange either way in 14d.
  const allyCutoff = nowMs - NEGLECTED_ALLY_DAYS * DAY_MS;
  const neglectedAllies = inputs.people
    .filter((p) => {
      if (stageRank(p.stage) < stageRank('mutual')) return false;
      const lastExchange = Math.max(
        p.lastInboundAt?.getTime() ?? 0,
        p.lastOutboundAt?.getTime() ?? 0,
      );
      return lastExchange < allyCutoff;
    })
    .sort((a, b) => lastExchangeMs(a) - lastExchangeMs(b));
  for (const p of neglectedAllies) {
    const last = lastExchangeMs(p);
    candidates.push({
      kind: 'neglected_ally',
      handle: p.handle,
      displayName: p.displayName,
      stage: p.stage,
      reason:
        last === 0
          ? `${p.stage} — no exchange on record`
          : `${p.stage} — no exchange in ${Math.floor((nowMs - last) / DAY_MS)}d`,
      at: last === 0 ? null : new Date(last),
    });
  }

  // momentum — heating-up lines, never a push: they ride at the queue's tail.
  const momentum = inputs.momentum
    .filter((m) => m.inflection !== null || m.enteringBand)
    .sort(
      (a, b) =>
        (b.inflection?.weeklyRatePct ?? Number.NEGATIVE_INFINITY) -
        (a.inflection?.weeklyRatePct ?? Number.NEGATIVE_INFINITY),
    );
  for (const m of momentum) {
    candidates.push({
      kind: 'momentum',
      handle: m.handle,
      displayName: m.displayName,
      stage: m.stage,
      reason: momentumReason(m),
      at: m.latestCapturedAt,
    });
  }

  // Snooze filter, then one item per person (highest-priority kind wins —
  // candidates are already in priority order).
  const items: FollowupItem[] = [];
  const seen = new Set<string>();
  let snoozed = 0;
  for (const item of candidates) {
    const until = inputs.snoozes.get(followupKey(item.kind, item.handle));
    if (until && until.getTime() > nowMs) {
      snoozed++;
      continue;
    }
    if (seen.has(item.handle)) continue;
    seen.add(item.handle);
    items.push(item);
  }
  return { items, snoozed };
}

function lastExchangeMs(p: FollowupPerson): number {
  return Math.max(p.lastInboundAt?.getTime() ?? 0, p.lastOutboundAt?.getTime() ?? 0);
}

function momentumReason(m: MomentumCandidate): string {
  const parts: string[] = [];
  if (m.inflection) {
    const prev =
      m.inflection.prevWeeklyRatePct === null
        ? 'new trend'
        : `was ${fmtPct(m.inflection.prevWeeklyRatePct)}/wk`;
    parts.push(`followers ${fmtPct(m.inflection.weeklyRatePct)}/wk (${prev})`);
  }
  if (m.enteringBand) parts.push('on pace to enter your 2–10x band');
  return parts.join(' · ');
}

// -------------------------------------------------------------- momentum

export interface FollowerPoint {
  capturedAt: Date;
  followersCount: number;
}

export interface MomentumInflection {
  /** Growth over the most recent ≥3d segment, as %/week of its base count. */
  weeklyRatePct: number;
  /** Growth over the earlier part of the series; null when it spans <3d. */
  prevWeeklyRatePct: number | null;
  fromFollowers: number;
  toFollowers: number;
  segmentDays: number;
}

/** Upward inflection: the latest ≥3-day segment grows ≥5%/week AND faster
 *  than the series before it (no prior segment = a new trend counts). Null
 *  when the series is too thin, too stale, or just not accelerating. */
export function momentumInflection(points: FollowerPoint[], now: Date): MomentumInflection | null {
  if (points.length < 2) return null;
  const ordered = [...points].sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
  const last = ordered[ordered.length - 1] as FollowerPoint;
  if (now.getTime() - last.capturedAt.getTime() > MOMENTUM_STALE_DAYS * DAY_MS) return null;

  // Base of the recent segment: newest point ≥3d older than the latest.
  const minSpanMs = MOMENTUM_MIN_SEGMENT_DAYS * DAY_MS;
  const base = [...ordered]
    .reverse()
    .find((p) => last.capturedAt.getTime() - p.capturedAt.getTime() >= minSpanMs);
  if (!base || base.followersCount <= 0) return null;

  const segmentDays = (last.capturedAt.getTime() - base.capturedAt.getTime()) / DAY_MS;
  const weeklyRatePct =
    ((last.followersCount - base.followersCount) / base.followersCount / segmentDays) * 7 * 100;

  const first = ordered[0] as FollowerPoint;
  const prevDays = (base.capturedAt.getTime() - first.capturedAt.getTime()) / DAY_MS;
  const prevWeeklyRatePct =
    prevDays >= MOMENTUM_MIN_SEGMENT_DAYS && first.followersCount > 0
      ? ((base.followersCount - first.followersCount) / first.followersCount / prevDays) * 7 * 100
      : null;

  if (weeklyRatePct < MOMENTUM_WEEKLY_PCT_THRESHOLD) return null;
  if (prevWeeklyRatePct !== null && weeklyRatePct <= prevWeeklyRatePct) return null;

  return {
    weeklyRatePct: round2(weeklyRatePct),
    prevWeeklyRatePct: prevWeeklyRatePct === null ? null : round2(prevWeeklyRatePct),
    fromFollowers: base.followersCount,
    toFollowers: last.followersCount,
    segmentDays: round2(segmentDays),
  };
}

/** Small account below my 2x line, growing fast enough to cross it within the
 *  30-day horizon at the current followers/day rate. */
export function aboutToEnterBand(
  followersCount: number,
  perDay: number | null,
  myFollowers: number,
): boolean {
  if (myFollowers <= 0 || followersCount <= 0) return false;
  const bandMin = 2 * myFollowers;
  if (followersCount >= bandMin) return false;
  if (perDay === null || perDay <= 0) return false;
  return followersCount + perDay * BAND_ENTRY_HORIZON_DAYS >= bandMin;
}

// ---------------------------------------------------------- reup candidate

// §S0.6: a proven own post (measured views cleared WINNER_REREAD_MIN_VIEWS)
// that's 14–60d old — old enough to be worth resurfacing, recent enough to
// still land — and hasn't already been quote-tweeted. The age window and the
// views/already-quoted filters live in the route SQL; this module ranks the
// survivors and formats the single best one. One per queue read: a nudge, not
// a backlog.
export const REUP_MIN_AGE_DAYS = 14;
export const REUP_MAX_AGE_DAYS = 60;

export interface ReupCandidate {
  tweetId: string;
  /** Highest measured view count across the tweet's snapshots. */
  views: number;
  postedAt: Date;
}

export interface ReupPick {
  item: FollowupItem | null;
  /** Candidates hidden by an active reup snooze (same counting as classify). */
  snoozed: number;
}

/** The single best re-up candidate (highest measured views), snooze-filtered.
 *  Cap 1 — the queue surfaces one winner to quote, never a wall of them. */
export function pickReupCandidate(
  candidates: ReupCandidate[],
  snoozes: Map<string, Date>,
  now: Date,
): ReupPick {
  const nowMs = now.getTime();
  let snoozed = 0;
  const live: ReupCandidate[] = [];
  for (const cand of candidates) {
    const until = snoozes.get(reupKey(cand.tweetId));
    if (until && until.getTime() > nowMs) {
      snoozed++;
      continue;
    }
    live.push(cand);
  }
  if (live.length === 0) return { item: null, snoozed };

  live.sort((a, b) => {
    if (b.views !== a.views) return b.views - a.views;
    const dt = b.postedAt.getTime() - a.postedAt.getTime();
    if (dt !== 0) return dt;
    return a.tweetId.localeCompare(b.tweetId);
  });
  const best = live[0] as ReupCandidate;

  return {
    item: {
      kind: 'reup_candidate',
      // No person — the extension branches on kind and never renders a handle.
      handle: '',
      displayName: null,
      stage: null,
      reason: `${fmtViews(best.views)} views · posted ${fmtAgo(best.postedAt, now)} — quote-tweet re-up`,
      at: best.postedAt,
      tweetId: best.tweetId,
      // /i/web/status/ opens the tweet without needing my own handle.
      url: `https://x.com/i/web/status/${best.tweetId}`,
    },
    snoozed,
  };
}

// ------------------------------------------------------------------ fans

export const FAN_UNACKNOWLEDGED_DAYS = 7;

export interface FanInput {
  handle: string;
  /** their_mention + their_reply_to_me inside the trailing window. */
  inboundCount: number;
  lastInboundAt: Date | null;
  /** My last outbound to them — the "last acknowledged" reading. */
  lastOutboundAt: Date | null;
}

/** Most inbound first; recency of their latest inbound breaks ties, handle
 *  keeps the order stable. */
export function rankFans<T extends FanInput>(fans: T[]): T[] {
  return [...fans].sort((a, b) => {
    if (a.inboundCount !== b.inboundCount) return b.inboundCount - a.inboundCount;
    const dt = (b.lastInboundAt?.getTime() ?? 0) - (a.lastInboundAt?.getTime() ?? 0);
    if (dt !== 0) return dt;
    return a.handle.localeCompare(b.handle);
  });
}

/** A fan I haven't replied to in >7d (or ever) is unacknowledged — the panel
 *  ambers the top-10 ones. */
export function fanUnacknowledged(fan: FanInput, now: Date): boolean {
  return (
    fan.lastOutboundAt === null ||
    now.getTime() - fan.lastOutboundAt.getTime() > FAN_UNACKNOWLEDGED_DAYS * DAY_MS
  );
}

// --------------------------------------------------------------- helpers

function fmtAgo(at: Date, now: Date): string {
  const min = Math.max(0, (now.getTime() - at.getTime()) / 60_000);
  if (min < 60) return `${Math.round(min)}m ago`;
  if (min < 24 * 60) return `${Math.floor(min / 60)}h ago`;
  return `${Math.floor(min / 1440)}d ago`;
}

function fmtViews(n: number): string {
  if (n >= 1000) return `${Math.round(n / 100) / 10}k`;
  return String(n);
}

function fmtPct(n: number): string {
  const r = Math.abs(n) >= 10 ? Math.round(n) : Math.round(n * 10) / 10;
  return `${n >= 0 ? '+' : ''}${r}%`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
