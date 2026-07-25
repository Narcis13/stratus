// Passive home-timeline harvest (HV.2) — every tweet the algorithm puts in
// front of you on /home joins the same harvest_rows longitudinal series the
// active harvester fills, at $0. This module is the pure, unit-testable core
// (the page gate, the per-tweet resend throttle, the DOM-shape → wire-row
// mapping); the DOM read and the chrome plumbing live in content.ts.

import type { Extracted } from '../harvester.ts';
import type { HarvestIngestRow } from './harvest.ts';

// Settings key, read straight from chrome.storage.local by the content script
// (C6 `passiveCapture` pattern): default ON, only an explicit `false` disables.
export const PASSIVE_HARVEST_KEY = 'passiveHarvest';

// Cadence mirrors the server contract in src/x/routes/harvest.ts: batches cap at
// its MAX_PASSIVE_BATCH, and the resend window matches its PASSIVE_RECAPTURE_MS
// so the wire doesn't carry rows the server would only count as skippedRecent.
export const PASSIVE_FLUSH_MS = 5000;
export const PASSIVE_RESEND_MS = 30 * 60_000;
export const PASSIVE_BATCH_MAX = 100;

// Same clamp the radar uses — enough of a long tweet to analyse later, with the
// stored volume bounded (2,000 rows/day).
export const PASSIVE_TEXT_MAX = 500;

/** Home timeline only (decision 2): the corpus means "what the algorithm fed
 *  me", which is what keeps affinity and the capture funnel honest. */
export function isHomeTimelinePath(pathname: string): boolean {
  return pathname === '/home' || pathname === '/home/';
}

/** Per-tweet resend throttle: record when never sent, or when the last send is
 *  older than the window. Re-seeing a tweet after it IS the longitudinal curve;
 *  re-seeing it sooner is just bytes the server would drop. */
export function shouldRecordPassive(
  lastSentAtMs: number | undefined,
  nowMs: number,
  resendMs = PASSIVE_RESEND_MS,
): boolean {
  return lastSentAtMs === undefined || nowMs - lastSentAtMs >= resendMs;
}

/** Map one extracted article onto the ingest wire row the active harvester
 *  already ships. Null when the permalink didn't resolve — without a tweet id
 *  there is no series to join the row to. */
export function toPassiveIngestRow(x: Extracted): HarvestIngestRow | null {
  if (!x.id || !x.handle) return null;
  return {
    tweetId: x.id,
    handle: x.handle,
    text: x.text.slice(0, PASSIVE_TEXT_MAX),
    comments: x.metrics.comments,
    reposts: x.metrics.reposts,
    likes: x.metrics.likes,
    bookmarks: x.metrics.bookmarks,
    views: x.metrics.views,
    time: x.time || null,
    hasPhoto: x.hasPhoto,
    hasVideo: x.hasVideo,
    isQuote: x.isQuote,
    // Pre-truncation length — the shape stat is about what was written, not
    // about how much of it we chose to store.
    textLen: x.text.length,
    lineBreaks: x.lineBreaks,
  };
}
