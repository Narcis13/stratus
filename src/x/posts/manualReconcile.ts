// Manual-post reconcile (A3.6): links a manually-pasted tweet back to the
// scheduled_posts row it fulfilled, so a hand-published post flows into the
// metrics pipeline exactly like an API post. mark-posted (A3.5) flips the row's
// status but deliberately writes NO tweet id (decision 6 — the max stored
// tweet_id IS discovery's since_id checkpoint; injecting a DOM-known id would
// park the checkpoint above tweets posted earlier the same day and hide them,
// the same trap the `mentions` since_id has). The daily discovery pull inserts
// the pasted tweet as a normal posts_published row; THIS matcher then links the
// two by text + time — the same discipline the harvest replies-reconcile uses
// (routes/harvest.ts::matchUnlinkedDraft).
//
// Pure logic only; the impure DB wrapper `reconcileManualPosts` lives in
// workers/dailyMetrics.ts. Timing is Date-based, mirroring matchUnlinkedDraft.

/** A scheduled row awaiting reconcile — `manual`/`posted` with no tweet linked
 *  yet. `scheduledFor` is guaranteed non-null by the wrapper's select. */
export interface ManualScheduledRow {
  id: string;
  text: string;
  scheduledFor: Date;
  status: string;
}

/** A discovered own tweet the reconcile might link. */
export interface PublishedCandidate {
  tweetId: string;
  text: string;
  postedAt: Date;
  isReply: boolean;
  scheduledPostId: string | null;
}

export interface ReconcileLink {
  scheduledPostId: string;
  tweetId: string;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
// A pasted tweet lands at (or just before) its slot, and up to a week late if
// the user got to the copy-card after a few days — anything outside that window
// is a different post that happens to share text. Opening guesses.
export const RECONCILE_WINDOW_BEFORE_MS = HOUR_MS;
export const RECONCILE_WINDOW_AFTER_MS = 7 * DAY_MS;

/** Collapse whitespace runs to single spaces and trim — X's paste path and our
 *  stored draft can differ only in whitespace (newlines vs spaces). Same
 *  normalization as the harvest reconcile (normalizeHarvestText). */
function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Link manual scheduled rows to the tweets that fulfilled them. Candidates are
 * published ORIGINALS (`isReply === false`) not yet linked (`scheduledPostId ===
 * null`); a link requires collapsed-whitespace text equality and `postedAt`
 * within `[scheduledFor − 1h, scheduledFor + 7d]` (both edges inclusive). When
 * several pairs qualify, the closest in time wins, and each tweet AND each row
 * links at most once — a greedy pass over `|postedAt − scheduledFor|`, nearest
 * first (a tie keeps manual-row order via the stable sort). Pure — unit-tested.
 */
export function matchManualRows(
  manual: ManualScheduledRow[],
  published: PublishedCandidate[],
): ReconcileLink[] {
  const candidates = published.filter((p) => !p.isReply && p.scheduledPostId === null);

  const pairs: Array<{ scheduledPostId: string; tweetId: string; distance: number }> = [];
  for (const row of manual) {
    const rowText = collapse(row.text);
    if (rowText === '') continue; // never let two empty texts spuriously match
    const scheduledMs = row.scheduledFor.getTime();
    const lo = scheduledMs - RECONCILE_WINDOW_BEFORE_MS;
    const hi = scheduledMs + RECONCILE_WINDOW_AFTER_MS;
    for (const cand of candidates) {
      if (collapse(cand.text) !== rowText) continue;
      const postedMs = cand.postedAt.getTime();
      if (postedMs < lo || postedMs > hi) continue;
      pairs.push({
        scheduledPostId: row.id,
        tweetId: cand.tweetId,
        distance: Math.abs(postedMs - scheduledMs),
      });
    }
  }

  pairs.sort((a, b) => a.distance - b.distance);

  const usedTweets = new Set<string>();
  const usedRows = new Set<string>();
  const links: ReconcileLink[] = [];
  for (const pair of pairs) {
    if (usedTweets.has(pair.tweetId) || usedRows.has(pair.scheduledPostId)) continue;
    usedTweets.add(pair.tweetId);
    usedRows.add(pair.scheduledPostId);
    links.push({ scheduledPostId: pair.scheduledPostId, tweetId: pair.tweetId });
  }
  return links;
}
