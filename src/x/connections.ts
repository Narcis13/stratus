// Following curation (Guardrails §A, GR.3). Pure — no DB, no clock reads, no
// Math.random: the route (routes/following.ts) loads the ledger, assembles the
// whitelist and passes `now` + a `rand`; this module decides who may be offered
// for unfollow and how many of them fit inside the cadence caps.
//
// Nothing here ever unfollows anybody. Unfollowing is a manual act in the X app
// (no `follows.write` scope, $0), so the caps exist to keep MY OWN behaviour
// under X's churn heuristics — the queue only ever nudges, and `keep` is one
// click away from silencing it for a person forever.
//
// The numbers are opening guesses (plan decisions 6–7): 7-day grace, 15–18 per
// 6h window, 40/day. Revisit after ~30 days of real queue use, never by vibes.

const DAY_MS = 24 * 60 * 60 * 1000;

// Measured from `first_seen_at`, the ledger's follow-date proxy (§7.11) — X
// never exposes when a follow happened. Consequence worth knowing before
// "fixing" an empty queue: for the first week after the FIRST scrape nobody is
// eligible, however old the follow really is.
export const GRACE_DAYS = 7;
export const UNFOLLOW_WINDOW_MS = 6 * 60 * 60 * 1000;
export const WINDOW_CAP_MIN = 15;
export const WINDOW_CAP_MAX = 18;
export const DAILY_CEILING = 40;
// The widest window `releaseBudget` looks at — the route loads exactly this much
// mark history so the two can't drift apart.
export const MARK_LOOKBACK_MS = DAY_MS;

/** The ledger fields curation reads. Structural on purpose: a `following` row
 *  satisfies it as-is, and tests can hand-build one without a DB. */
export interface CurationRow {
  handle: string;
  displayName: string | null;
  status: string;
  followsBack: boolean;
  keep: boolean;
  firstSeenAt: Date;
  listPosition: number | null;
}

/** Longest-standing non-followers first. `listPosition` desc breaks ties because
 *  X renders /following most-recently-followed first, so a row further down the
 *  page is the older follow (null = position unknown, which claims nothing and
 *  sorts last); handle asc keeps the order total, so two rows seeded in the same
 *  millisecond can't shuffle between reads. */
export function rankForUnfollow<T extends CurationRow>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const byAge = a.firstSeenAt.getTime() - b.firstSeenAt.getTime();
    if (byAge !== 0) return byAge;
    const ap = a.listPosition ?? -1;
    const bp = b.listPosition ?? -1;
    if (ap !== bp) return bp - ap;
    return a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0;
  });
}

/** Who may be offered for unfollow, ranked. `whitelist` is the read-time set of
 *  protected handles the route assembles from Circles data (§7.12); `keep` is a
 *  column on the row itself, so it stays out of that set and is enforced here. */
export function eligibleForUnfollow<T extends CurationRow>(
  rows: readonly T[],
  whitelist: ReadonlySet<string>,
  now: Date,
): T[] {
  const graceCutoff = now.getTime() - GRACE_DAYS * DAY_MS;
  return rankForUnfollow(
    rows.filter(
      (r) =>
        r.status === 'active' &&
        !r.followsBack &&
        !r.keep &&
        !whitelist.has(r.handle) &&
        r.firstSeenAt.getTime() <= graceCutoff,
    ),
  );
}

export interface QueuedReview<T> {
  /** Still in the batch — released earlier, not yet ticked off. */
  held: T[];
  /** Protected after release: drop from the batch, flip back to `active`. */
  revoked: T[];
}

/** Rows an earlier read already released come back on every read until the user
 *  ticks them off. But protection can appear AFTER release — the person becomes
 *  mutual/ally, they follow back, I pin them `keep` — and someone the CRM now
 *  calls a relationship must never be sitting in an unfollow batch. Revoking
 *  hands no budget back and takes none: the budget counts completed marks, not
 *  releases. */
export function reviewQueued<T extends CurationRow>(
  rows: readonly T[],
  whitelist: ReadonlySet<string>,
): QueuedReview<T> {
  const held: T[] = [];
  const revoked: T[] = [];
  for (const r of rows) {
    if (r.status !== 'queued') continue;
    if (r.keep || r.followsBack || whitelist.has(r.handle)) revoked.push(r);
    else held.push(r);
  }
  return { held: rankForUnfollow(held), revoked };
}

export interface ReleaseBudget {
  /** How many rows may be in the batch right now — the caller still subtracts
   *  whatever it is already holding before releasing anything new. */
  budget: number;
  windowCap: number;
  windowUsed: number;
  dailyUsed: number;
  dailyCeiling: number;
}

/** `marks` = `unfollow_marked_at` values from the trailing `MARK_LOOKBACK_MS`.
 *  Only completed marks count, never releases: a row that sat in the batch for a
 *  week without being ticked off never cost a slot, because nothing happened on
 *  X. Marks are never cleared (D99) — a re-follow or a failed tick must not hand
 *  churn budget back. */
export function releaseBudget(
  marks: readonly Date[],
  now: Date,
  rand: () => number,
): ReleaseBudget {
  const t = now.getTime();
  const windowStart = t - UNFOLLOW_WINDOW_MS;
  const dayStart = t - MARK_LOOKBACK_MS;
  let windowUsed = 0;
  let dailyUsed = 0;
  for (const m of marks) {
    const ms = m.getTime();
    if (ms < dayStart) continue;
    dailyUsed++;
    if (ms >= windowStart) windowUsed++;
  }
  // Jittered per call — a fixed batch size is itself a fingerprint, and the
  // point of the cap is to look like a person working through a list.
  const windowCap = Math.min(
    WINDOW_CAP_MAX,
    WINDOW_CAP_MIN + Math.floor(rand() * (WINDOW_CAP_MAX - WINDOW_CAP_MIN + 1)),
  );
  const budget = dailyUsed >= DAILY_CEILING ? 0 : Math.max(0, windowCap - windowUsed);
  return { budget, windowCap, windowUsed, dailyUsed, dailyCeiling: DAILY_CEILING };
}
