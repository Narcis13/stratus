// Wire format + URL helpers for the Harvest feature, shared between the side
// panel (orchestrator) and the content script (scrape engine). The side panel
// drives a long-running scrape over a chrome.tabs port; the content script does
// the human-paced scroll and DOM read, streaming progress back.

import type { HarvestRun } from './types.ts';

// 'following' (GR.2) scrapes a `/<handle>/following` list page instead of a
// timeline: no metrics, no dates, and it ships to the ledger routes rather than
// the harvest ones. Scope is forced 'all' for it — the page has no date axis.
export type HarvestMode = 'posts' | 'replies' | 'following';
// 'all' scrapes the whole timeline (until bottom / max). 'today'/'yesterday'
// keep only items whose timestamp falls on that local calendar day.
// 'since-last' (§9.4) is the per-handle incremental cursor: keep only items
// newer than the newest item of the previous completed run for this
// handle+mode (chrome.storage.local); behaves like 'all' on the first run.
export type HarvestScope = 'all' | 'today' | 'yesterday' | 'since-last';
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
  // HV.3 — download the CSV at the end of the run. Default on; an explicit
  // false makes the harvest DB-only (the 'done' event's filename is then '').
  downloadCsv?: boolean;
  // HV.3 — drop items below this view count at store time, so the filter
  // reaches the CSV and the ingest alike. Omitted/0 means no floor.
  minViews?: number;
}

/** The min-views floor, applied to the harvested item's OWN views (never the
 *  `orig` it replied to). An absent, non-finite or non-positive floor passes
 *  everything — a blank input must never silently drop rows. */
export function passesMinViews(views: number, minViews?: number): boolean {
  if (minViews === undefined || !Number.isFinite(minViews) || minViews <= 0) return true;
  return views >= minViews;
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
  // Content-shape columns (§9.4) — optional so older builds keep working.
  hasPhoto?: boolean;
  hasVideo?: boolean;
  isQuote?: boolean;
  textLen?: number;
  lineBreaks?: number;
  /** Replies mode: 1-based position inside the rendered group (1 = directly
   *  under the true original; deeper = self-thread/chain pairing suspect). */
  groupPosition?: number;
  orig?: HarvestIngestOrig;
}

// One scraped row of a `/following` list page, as shipped to
// POST /x/following/rows. Mirrors the server's exported `FollowingIngestRow`
// field for field — `followsBack` is REQUIRED there, so a build that can't read
// the badge gets an indexed 400 rather than silently writing off the whole
// roster as non-reciprocating.
export interface FollowingIngestRow {
  handle: string;
  displayName: string | null;
  followsBack: boolean;
  listPosition: number | null;
}

// Per-handle incremental cursor (§9.4), stored in chrome.storage.local.
export function harvestCursorKey(handle: string, mode: HarvestMode): string {
  return `harvest:cursor:${handle.toLowerCase()}:${mode}`;
}

// ------------------------------------------------------ persisted form (HV.3)

// One chrome.storage.local key holds the whole Harvest-tab form. The legacy
// `harvestSendToStratus` key keeps its own slot — it predates this and other
// surfaces already read it.
export const HARVEST_FORM_KEY = 'harvestForm';

// The numeric fields are kept as the raw input strings the panel holds, so a
// blank box round-trips as blank instead of collapsing to a 0 floor.
export interface HarvestForm {
  mode: HarvestMode;
  scope: HarvestScope;
  pace: HarvestPace;
  maxStr: string;
  minViewsStr: string;
  downloadCsv: boolean;
}

export const DEFAULT_HARVEST_FORM: HarvestForm = {
  mode: 'posts',
  scope: 'all',
  pace: 'human',
  maxStr: '',
  minViewsStr: '',
  downloadCsv: true,
};

function isHarvestMode(v: unknown): v is HarvestMode {
  return v === 'posts' || v === 'replies' || v === 'following';
}

function isHarvestScope(v: unknown): v is HarvestScope {
  return v === 'all' || v === 'today' || v === 'yesterday' || v === 'since-last';
}

function isHarvestPace(v: unknown): v is HarvestPace {
  return v === 'slow' || v === 'human' || v === 'fast';
}

function digitsOrBlank(v: unknown): string {
  return typeof v === 'string' && /^\d*$/.test(v) ? v : '';
}

/** Lenient parse (the `parseBrandKit` pattern): every unrecognised or missing
 *  field falls back to its default, so a form written by an older build — or a
 *  hand-edited storage value — still restores instead of throwing the tab. */
export function parseHarvestForm(raw: unknown): HarvestForm {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_HARVEST_FORM };
  const o = raw as Record<string, unknown>;
  return {
    mode: isHarvestMode(o.mode) ? o.mode : DEFAULT_HARVEST_FORM.mode,
    scope: isHarvestScope(o.scope) ? o.scope : DEFAULT_HARVEST_FORM.scope,
    pace: isHarvestPace(o.pace) ? o.pace : DEFAULT_HARVEST_FORM.pace,
    maxStr: digitsOrBlank(o.maxStr),
    minViewsStr: digitsOrBlank(o.minViewsStr),
    downloadCsv:
      typeof o.downloadCsv === 'boolean' ? o.downloadCsv : DEFAULT_HARVEST_FORM.downloadCsv,
  };
}

// ----------------------------------------------------- passive status (HV.3)

// The discriminator HV.1 hangs ambient rows off; `POST /harvest/runs` still
// refuses it, so only the server ever creates one of these runs.
export const PASSIVE_RUN_MODE = 'timeline';

/** Rows the passive tap captured during the current UTC day, read off
 *  `GET /x/harvest/runs`. The server keys its synthetic run by UTC day
 *  (`utcDayStart`), so the boundary here has to be UTC too — a local-midnight
 *  window would read yesterday's run for part of every day. Summed rather than
 *  first-match: there is exactly one such run today, and a sum can't silently
 *  under-report if that ever stops being true. */
export function passiveRowsToday(runs: readonly HarvestRun[], nowMs: number): number {
  const now = new Date(nowMs);
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  let rows = 0;
  for (const r of runs) {
    if (r.mode !== PASSIVE_RUN_MODE) continue;
    const at = Date.parse(r.createdAt);
    if (Number.isNaN(at) || at < dayStart) continue;
    rows += r.rowCount;
  }
  return rows;
}

// Outcome of the upload, attached to the final 'done' event. The CSV download
// happens regardless — a failed upload only loses the Postgres copy.
// `followsBack`/`complete` are following-mode only (GR.2) and absent everywhere
// else, so an older panel reading a newer engine just renders less.
export type HarvestIngest =
  | {
      sent: true;
      rows: number;
      runId: string;
      matched: number;
      backfilled: number;
      followsBack?: number;
      // Whether the run was closed `done: true` — i.e. the scroll actually
      // reached the bottom, so the server was allowed to reconcile.
      complete?: boolean;
    }
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
  onFollowing: boolean; // currently on the /<handle>/following list page
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

// True only for a real profile's following list — `/i/following` and friends are
// app routes, and profileHandleFromUrl already owns that reserved-word list.
export function isFollowingPath(url: string): boolean {
  const path = pathnameOf(url);
  if (path === null) return false;
  const seg = path.split('/').filter(Boolean);
  return seg.length === 2 && seg[1] === 'following' && profileHandleFromUrl(path) !== null;
}

// The one place a mode's page path is spelled out; harvestTargetUrl and
// isAtTarget both read it, so a new mode can't navigate somewhere its
// already-there check disagrees with.
function targetPath(handle: string, mode: HarvestMode): string {
  if (mode === 'replies') return `/${handle}/with_replies`;
  if (mode === 'following') return `/${handle}/following`;
  return `/${handle}`;
}

// Where a given handle+mode should be scraped from.
export function harvestTargetUrl(handle: string, mode: HarvestMode): string {
  return `https://x.com${targetPath(handle, mode)}`;
}

// True when `url` is already exactly the page we'd scrape for handle+mode — used
// to skip a navigation. Posts mode requires the bare profile (not /media,
// /highlights, …), replies mode requires /with_replies, following mode the
// /following list.
export function isAtTarget(url: string, handle: string, mode: HarvestMode): boolean {
  const path = pathnameOf(url);
  if (path === null) return false;
  return path.replace(/\/$/, '').toLowerCase() === targetPath(handle, mode).toLowerCase();
}
