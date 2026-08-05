// Cannon roster scoring (CQ.2). Pure — no DB, no clock, no `Math.random`
// (`connections.ts`/`monitor.ts` house style): the route loads the harvested
// rows, buckets them by handle and passes each bucket in; this module decides
// what one author's posts are worth as an arbitrage target.
//
// The score is `median(views) / (median(comments) + 1)` over the author's last
// ~30 posts — the roster-level twin of the per-sighting `cannonScore` in
// `src/shared/cannon.ts`, and the reason a roster review is a sort instead of a
// judgement call. Nothing here reads follower counts: author size is a $0.010
// lookup (§8) that measures the wrong axis.
//
// TWO METHOD NOTES, because both are borrowed and both have a wrong-looking
// twin elsewhere in this repo (§7.34 — validate the borrowed METHOD, not just
// the borrowed number):
//
// (a) The medians are taken of views and of comments SEPARATELY and then
//     divided — NOT the median of the per-post ratios. Those are different
//     statistics (the median of a ratio is not the ratio of the medians), and
//     the separate-medians form is the one the source measurement used, so it
//     is the one whose 5,000-style floors are comparable. Do not "simplify" it
//     into a per-post ratio median; that silently rescales every stored score.
//
// (b) Dedupe keeps the LATEST capture of a re-captured tweet — which is the
//     exact opposite of what `coach/reach.ts` needs, and a later reader will
//     otherwise apply SC.8's rule backwards. SC.8's rule is "latest row wins is
//     wrong when the RE-READ is selective": there, a post gets a second snapshot
//     because it won, so the latest snapshot is a second measurement protocol
//     chosen on the outcome. Here the corpus is `harvest_rows`, whose recaptures
//     are SCROLL-driven — a tweet is read twice because it came past again, not
//     because it did well — so picking the latest capture only picks a maturer
//     reading of the same tweet and selects nothing. Averaging the duplicates
//     instead would weight re-scrolled tweets by how often they were scrolled,
//     which IS a selection.
//
// The window and the sample floor are opening guesses; §7.19 stands —
// recalibrate from a corpus replay, never by feel.

/** Posts per author the score is taken over — the newest N. Roughly a month of
 *  a daily poster, short enough that a handle who changed what they post moves
 *  off the roster instead of coasting on last quarter's numbers. */
export const CANNON_SAMPLE_POSTS = 30;

/** Below this many posts the score is `null`, never a number (§7.19). Opening
 *  guess — recalibrate at n>=100 scored handles. A median over 3 posts is one
 *  outlier away from putting a dead account at the top of the roster, and a
 *  confident-looking wrong number is worse than an absent one. */
export const CANNON_MIN_SAMPLE = 8;

/** One author's harvested post, as the score reads it. Structural on purpose: a
 *  `harvest_rows` row satisfies it as-is and a test can hand-build one. */
export interface AuthorPost {
  tweetId: string;
  views: number;
  comments: number;
  /** When the post was published; null when the harvester couldn't read it —
   *  `capturedAt` is then the only ordering signal we have (§7.11). */
  tweetTime: number | null;
  capturedAt: number;
}

export interface AuthorScore {
  score: number;
  medianViews: number;
  medianComments: number;
  sampleN: number;
}

/** Even-length medians average the two middles. `null` on an empty list —
 *  "no data" is not 0 (§7.11). Does not mutate the input. */
export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/**
 * Score one author from their harvested posts. Returns `null` below
 * `CANNON_MIN_SAMPLE` — the caller stores that as `score: null` WITH the
 * `sampleN` it saw, because "we looked and there wasn't enough" is a different
 * fact from "never scored".
 *
 * Order of operations, and each step matters: dedupe by tweetId keeping the
 * latest capture (note (b) above) → sort newest-first by publish time, falling
 * back to capture time → take `maxPosts` → separate medians (note (a) above).
 */
export function scoreAuthor(
  posts: AuthorPost[],
  maxPosts: number = CANNON_SAMPLE_POSTS,
): AuthorScore | null {
  const latest = new Map<string, AuthorPost>();
  for (const p of posts) {
    const held = latest.get(p.tweetId);
    if (!held || p.capturedAt > held.capturedAt) latest.set(p.tweetId, p);
  }

  const window = [...latest.values()]
    .sort((a, b) => (b.tweetTime ?? b.capturedAt) - (a.tweetTime ?? a.capturedAt))
    .slice(0, maxPosts);

  if (window.length < CANNON_MIN_SAMPLE) return null;

  const medianViews = median(window.map((p) => p.views));
  const medianComments = median(window.map((p) => p.comments));
  if (medianViews === null || medianComments === null) return null;

  return {
    score: medianViews / (medianComments + 1),
    medianViews,
    medianComments,
    sampleN: window.length,
  };
}

/** Roster order: scored handles first (score desc), never-scored last, handle
 *  asc as the total tiebreak (`rankForUnfollow`'s discipline — a sort that isn't
 *  total lets two equal rows shuffle between reads of the same list, which is
 *  exactly what a review session can't have). Does not mutate the input. */
export function rankCannonTargets<T extends { score: number | null; handle: string }>(
  rows: T[],
): T[] {
  return [...rows].sort((a, b) => {
    if (a.score === null && b.score === null)
      return a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0;
    if (a.score === null) return 1;
    if (b.score === null) return -1;
    if (b.score !== a.score) return b.score - a.score;
    return a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0;
  });
}
