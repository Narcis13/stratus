// Wire format + URL helpers for the Harvest feature, shared between the side
// panel (orchestrator) and the content script (scrape engine). The side panel
// drives a long-running scrape over a chrome.tabs port; the content script does
// the human-paced scroll and DOM read, streaming progress back.

export type HarvestMode = 'posts' | 'replies';
// 'all' scrapes the whole timeline (until bottom / max). 'today'/'yesterday'
// keep only items whose timestamp falls on that local calendar day.
export type HarvestScope = 'all' | 'today' | 'yesterday';
export type HarvestPace = 'slow' | 'human' | 'fast';

export interface HarvestOptions {
  mode: HarvestMode;
  scope: HarvestScope;
  pace: HarvestPace;
  // Hard row cap (safety / cost). Omitted means unlimited.
  max?: number;
  // Ship rows to POST /x/harvest/* alongside the CSV download. Default on —
  // only an explicit false skips the upload (OVERHAUL-PLAN §6.3).
  sendToStratus?: boolean;
}

// One harvested row as shipped to POST /x/harvest/rows. `orig` is the tweet
// replied to (replies mode only) — its capture-time metrics feed the BAND
// calibration crosstab, and its id strengthens the reply_drafts reconcile.
export interface HarvestIngestOrig {
  tweetId: string | null;
  handle: string | null;
  text: string;
  time: string | null;
  comments: number;
  likes: number;
  views: number;
}

export interface HarvestIngestRow {
  tweetId: string;
  handle: string;
  text: string;
  comments: number;
  reposts: number;
  likes: number;
  bookmarks: number;
  views: number;
  time: string | null;
  orig?: HarvestIngestOrig;
}

// Outcome of the upload, attached to the final 'done' event. The CSV download
// happens regardless — a failed upload only loses the Postgres copy.
export type HarvestIngest =
  | { sent: true; rows: number; runId: string; matched: number; backfilled: number }
  | { sent: false; error: string };

// Port name used by chrome.tabs.connect (side panel) / chrome.runtime.onConnect
// (content script).
export const HARVEST_PORT = 'stratus/harvest';

// side panel -> content script (over the port)
export type HarvestCommand = { type: 'start'; options: HarvestOptions } | { type: 'cancel' };

// content script -> side panel (over the port)
export type HarvestEvent =
  | { type: 'started'; handle: string; mode: HarvestMode; scope: HarvestScope }
  | { type: 'progress'; rows: number; oldest: string | null; steps: number }
  | { type: 'sending'; rows: number }
  | {
      type: 'done';
      rows: number;
      filename: string;
      firstTime: string | null;
      lastTime: string | null;
      cancelled: boolean;
      ingest?: HarvestIngest;
    }
  | { type: 'error'; code: string; message?: string };

// One-shot context probe (chrome.tabs.sendMessage). Doubles as a readiness ping:
// a successful response means the content script is injected and listening.
export interface HarvestContextRequest {
  type: 'stratus/harvest-context';
}

export interface HarvestContextResult {
  ok: true;
  url: string;
  handle: string | null; // profile handle if the page is a profile
  onReplies: boolean; // currently on the /with_replies sub-tab
  loggedIn: boolean; // best-effort
}

export function isHarvestContextRequest(msg: unknown): msg is HarvestContextRequest {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as { type?: unknown }).type === 'stratus/harvest-context'
  );
}

// Path segments whose first element is an app route, not a profile handle.
const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  'home',
  'explore',
  'notifications',
  'messages',
  'settings',
  'i',
  'search',
  'compose',
  'hashtag',
  'bookmarks',
  'lists',
  'communities',
  'jobs',
  'login',
  'about',
  'tos',
  'privacy',
  'intent',
  'share',
]);

function pathnameOf(url: string): string | null {
  try {
    return new URL(url, 'https://x.com').pathname;
  } catch {
    return null;
  }
}

// The profile handle a URL points at, or null if it isn't a profile page
// (home timeline, search, a status/detail page, etc.). Accepts a full URL or a
// bare pathname. /<handle>, /<handle>/with_replies, /<handle>/media all resolve
// to <handle>; /<handle>/status/<id> does not (it's a tweet, not the profile).
export function profileHandleFromUrl(url: string): string | null {
  const path = pathnameOf(url);
  if (path === null) return null;
  const seg = path.split('/').filter(Boolean);
  const h = seg[0];
  if (h === undefined || !/^[A-Za-z0-9_]{1,15}$/.test(h)) return null;
  if (RESERVED_HANDLES.has(h.toLowerCase())) return null;
  if (seg[1] === 'status') return null;
  return h;
}

export function isXUrl(url: string | undefined | null): boolean {
  return typeof url === 'string' && /^https:\/\/(x|twitter)\.com\//.test(url);
}

export function isRepliesPath(url: string): boolean {
  const path = pathnameOf(url);
  return path !== null && /\/with_replies\/?$/.test(path);
}

// Where a given handle+mode should be scraped from.
export function harvestTargetUrl(handle: string, mode: HarvestMode): string {
  const base = `https://x.com/${handle}`;
  return mode === 'replies' ? `${base}/with_replies` : base;
}

// True when `url` is already exactly the page we'd scrape for handle+mode — used
// to skip a navigation. Posts mode requires the bare profile (not /media,
// /highlights, …), replies mode requires /with_replies.
export function isAtTarget(url: string, handle: string, mode: HarvestMode): boolean {
  const path = pathnameOf(url);
  if (path === null) return false;
  const norm = path.replace(/\/$/, '').toLowerCase();
  const want = (mode === 'replies' ? `/${handle}/with_replies` : `/${handle}`).toLowerCase();
  return norm === want;
}
