// S0.1 Profile conversion rate (SURFACES-PLAN §S0.1) — "is my profile leaking?"
// The doctrine's whole currency is the earned profile visit; nothing yet asks
// whether those visits actually convert to follows. Pure arithmetic over two
// series the daily 03:00 pass already collects at $0: account_snapshots
// (follower count) and metrics_snapshots.user_profile_clicks (per own tweet).
// No DB, no clock reads — the caller passes `now` and the rows.
//
//   conversion = follower delta over the window ÷ Σ profile clicks on own
//                tweets posted inside the window
//
// Guarded null below MIN_PROFILE_CLICKS so a handful of clicks can't read as a
// wild rate — the same min-sample discipline as BAND, the Playbook, and the
// rest of this codebase. `rate` is a fraction (×100 for a percentage) and may
// be negative when followers dropped — an honest "leaking" signal, not a bug.

const DAY_MS = 24 * 60 * 60 * 1000;

/** Below this many summed profile clicks the rate is null — too little signal
 *  for the ratio to mean anything. */
export const MIN_PROFILE_CLICKS = 20;

/** The two trailing windows the brief reports. */
export const CONVERSION_WINDOWS_DAYS = [7, 28] as const;

export interface FollowerPoint {
  snapshotAt: Date;
  followers: number;
}

export interface ConversionTweet {
  postedAt: Date;
  /** user_profile_clicks from the tweet's latest snapshot; null until measured. */
  profileVisits: number | null;
}

export interface ConversionWindow {
  windowDays: number;
  /** Σ user_profile_clicks over own tweets posted inside the window. */
  profileClicks: number;
  /** Follower change across the window (latest − baseline at/just before its
   *  start; the oldest point when history is shorter). Null with <2 points. */
  followerDelta: number | null;
  /** followerDelta / profileClicks (a fraction; ×100 for %). Null when
   *  profileClicks < MIN_PROFILE_CLICKS or followerDelta is unknown. */
  rate: number | null;
}

/** The shared min-sample guard — kept in one place so the brief and the Sunday
 *  digest gate identically. */
export function conversionRate(profileClicks: number, followerDelta: number | null): number | null {
  if (followerDelta === null || profileClicks < MIN_PROFILE_CLICKS) return null;
  return followerDelta / profileClicks;
}

/** Follower change from the window's start to the latest snapshot. Baseline is
 *  the newest point at least `windowDays` old; when history is shorter, the
 *  oldest point (mirrors followerTrend in brief.ts). Null with <2 points. */
export function followerDeltaOverWindow(
  points: FollowerPoint[],
  now: Date,
  windowDays: number,
): number | null {
  if (points.length < 2) return null;
  const ordered = [...points].sort((a, b) => a.snapshotAt.getTime() - b.snapshotAt.getTime());
  const latest = ordered.at(-1) as FollowerPoint;
  const windowStart = now.getTime() - windowDays * DAY_MS;
  let baseline = ordered[0] as FollowerPoint;
  for (const p of ordered) {
    if (p.snapshotAt.getTime() <= windowStart) baseline = p;
  }
  return baseline === latest ? null : latest.followers - baseline.followers;
}

/** Σ profile clicks over own tweets posted inside the trailing window. Tweets
 *  with a null (unmeasured) click count contribute nothing. */
export function sumProfileClicks(tweets: ConversionTweet[], now: Date, windowDays: number): number {
  const from = now.getTime() - windowDays * DAY_MS;
  let sum = 0;
  for (const t of tweets) {
    if (t.postedAt.getTime() >= from && t.profileVisits !== null) sum += t.profileVisits;
  }
  return sum;
}

export function conversionForWindow(
  points: FollowerPoint[],
  tweets: ConversionTweet[],
  now: Date,
  windowDays: number,
): ConversionWindow {
  const profileClicks = sumProfileClicks(tweets, now, windowDays);
  const followerDelta = followerDeltaOverWindow(points, now, windowDays);
  return {
    windowDays,
    profileClicks,
    followerDelta,
    rate: conversionRate(profileClicks, followerDelta),
  };
}

export interface Conversion {
  d7: ConversionWindow;
  d28: ConversionWindow;
}

export function computeConversion(
  points: FollowerPoint[],
  tweets: ConversionTweet[],
  now: Date,
): Conversion {
  return {
    d7: conversionForWindow(points, tweets, now, 7),
    d28: conversionForWindow(points, tweets, now, 28),
  };
}
