// Thread capture (TH.3) — the pure core behind "capture this conversation":
// which page is a thread, how one extracted article becomes a wire row, and how
// the on-page list stays honest about what it actually kept. The DOM read, the
// scroll and the chrome plumbing live in content.ts; everything testable lives
// here.
//
// IIFE contract (codemap §5/§7.26): this module is INLINED into content.js, so
// its only imports are `type HarvestIngestRow` from './harvest.ts' and
// `type Extracted` from '../harvester.ts', both erased under
// `verbatimModuleSyntax`. No value import, ever — a single one would drag the
// side panel's chrome-API surface into the content bundle.

import type { Extracted } from '../harvester.ts';
import type { HarvestIngestRow } from './harvest.ts';

// One capture ships root + replies in a single POST /harvest/thread, whose
// server ceiling is 500 rows (root included). 400 is an opening guess that keeps
// the payload comfortably one call under that ceiling; recalibrate only after
// real captures show what a long conversation actually renders, never by vibes.
export const MAX_THREAD_REPLIES = 400;

// Path segments that are app routes, not handles. shared/harvest.ts keeps the
// full list private to `profileHandleFromUrl`; the only reserved word that can
// precede /status/ in a real X URL is /i/ (the app's own permalink route), so
// this file matches that one rather than duplicating fifteen entries that would
// then have two places to drift.
const RESERVED_THREAD_HANDLES: ReadonlySet<string> = new Set(['i', 'intent', 'compose']);

// Duplicated from shared/harvest.ts rather than exported from it: exporting it
// would be a VALUE import here, which the IIFE contract above forbids. Three
// lines of duplication is the cheaper side of that trade.
function pathnameOf(url: string): string | null {
  try {
    return new URL(url, 'https://x.com').pathname;
  } catch {
    return null;
  }
}

/** The root tweet id of a status page, or null if the URL isn't one. Accepts a
 *  full URL or a bare pathname; trailing segments (/photo/1, /analytics) still
 *  resolve to the id, since they are the same conversation. */
export function threadRootIdFromUrl(url: string): string | null {
  const path = pathnameOf(url);
  if (path === null) return null;
  const seg = path.split('/').filter(Boolean);
  const handle = seg[0];
  const id = seg[2];
  if (handle === undefined || id === undefined) return null;
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) return null;
  if (RESERVED_THREAD_HANDLES.has(handle.toLowerCase())) return null;
  if (seg[1] !== 'status') return null;
  if (!/^\d+$/.test(id)) return null;
  return id;
}

/** Map one extracted article onto the ingest wire row. Null when the permalink
 *  didn't resolve — an ad, a promoted cell or an unparseable article filters
 *  itself out, the same rule the passive harvest follows. Empty text survives:
 *  image-only tweets are legal all the way to the server's parseIngestRow.
 *
 *  Field-for-field the harvester's own `postsIngestRows` mapping, deliberately
 *  copied rather than shared: the shipped harvest path stays byte-untouched. */
export function extractedToIngestRow(e: Extracted): HarvestIngestRow | null {
  if (!e.id || !e.handle) return null;
  return {
    tweetId: e.id,
    handle: e.handle,
    text: e.text,
    comments: e.metrics.comments,
    reposts: e.metrics.reposts,
    likes: e.metrics.likes,
    bookmarks: e.metrics.bookmarks,
    views: e.metrics.views,
    time: e.time || null,
    hasPhoto: e.hasPhoto,
    hasVideo: e.hasVideo,
    isQuote: e.isQuote,
    textLen: e.text.length,
    lineBreaks: e.lineBreaks,
  };
}

/** First-wins dedupe of a capture's replies, with the root dropped wherever it
 *  appears (a conversation renders its own root inline, and virtualized
 *  scrolling re-sights articles). The server dedupes too; this pass exists so
 *  the on-page counter reports what will actually be stored. */
export function dedupeThreadReplies(
  rows: readonly HarvestIngestRow[],
  rootTweetId: string,
): HarvestIngestRow[] {
  const seen = new Set<string>([rootTweetId]);
  const kept: HarvestIngestRow[] = [];
  for (const r of rows) {
    if (seen.has(r.tweetId)) continue;
    seen.add(r.tweetId);
    kept.push(r);
  }
  return kept;
}
