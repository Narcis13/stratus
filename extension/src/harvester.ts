// X (Twitter) timeline harvester — the content-script half of the Harvest tab.
//
// Adapted from the standalone console script scrape.js: it scrolls a profile's
// Posts or Posts-&-replies timeline like a human (variable eased flicks,
// randomized reading pauses, occasional scroll-backs, jittered lazy-load waits)
// and reads each tweet's metrics from its exact aria-label. Here it runs inside
// the content script, driven over a chrome.tabs port from the side panel:
// progress streams back, the user can cancel, and the finished CSV downloads to
// the browser's Downloads folder — same output shape as the original script.
//
// New vs scrape.js: the `today` / `yesterday` scopes keep only items whose
// timestamp falls on that local calendar day, stopping the scroll once the
// timeline has scrolled past the window (pinned tweets are excluded from that
// stop test so an old pin can't end the run early).

import {
  HAND_SWEEP_BATCH_MAX,
  HAND_SWEEP_FLUSH_MS,
  HAND_SWEEP_KEY,
  HAND_SWEEP_STATS_KEY,
  type HandSweepMode,
  type HandSweepSession,
  type HandSweepStats,
  handSweepActiveAt,
  handSweepMinutesLeft,
  pageInHandSweep,
  parseHandSweepStats,
} from './shared/handSweep.ts';
import {
  type FollowingIngestRow,
  HARVEST_PORT,
  type HarvestCommand,
  type HarvestContextResult,
  type HarvestEvent,
  type HarvestIngest,
  type HarvestIngestRow,
  type HarvestMode,
  type HarvestOptions,
  type HarvestScope,
  harvestCursorKey,
  isFollowingPath,
  isHarvestContextRequest,
  isRepliesPath,
  passesMinViews,
  profileHandleFromUrl,
} from './shared/harvest.ts';
import type { ApiRequest, ApiResponse } from './shared/messages.ts';
import { parseMetricsAria, reportUnparsed } from './shared/metricsAria.ts';
import {
  MAX_THREAD_REPLIES,
  type ThreadCaptureResult,
  dedupeThreadReplies,
  extractedToIngestRow,
  threadRootIdFromUrl,
} from './shared/thread.ts';
import { findShowOriginalButtons, viewerLangOf } from './shared/translation.ts';
import { handleFromAvatarTestid, parseUserCell } from './shared/userCell.ts';

// ----------------------------------------------------------------- randomness
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const rand = (a: number, b: number): number => a + Math.random() * (b - a);
const randInt = (a: number, b: number): number => Math.floor(rand(a, b + 1));
const chance = (p: number): boolean => Math.random() < p;
// bell-ish distribution (avg of 3 uniforms) so most values cluster mid-range
const gauss = (min: number, max: number): number => {
  let s = 0;
  for (let i = 0; i < 3; i++) s += Math.random();
  return min + (s / 3) * (max - min);
};

// ------------------------------------------------------------- pacing presets
interface Pacing {
  flickMin: number;
  flickMax: number;
  pauseMin: number;
  pauseMax: number;
  longChance: number;
  longMin: number;
  longMax: number;
  backChance: number;
  backMin: number;
  backMax: number;
  loadMin: number;
  loadMax: number;
  stableNeeded: number;
}

const PRESETS: Record<HarvestOptions['pace'], Pacing> = {
  slow: {
    flickMin: 0.25,
    flickMax: 0.5,
    pauseMin: 2200,
    pauseMax: 4200,
    longChance: 0.2,
    longMin: 5000,
    longMax: 9000,
    backChance: 0.12,
    backMin: 0.1,
    backMax: 0.3,
    loadMin: 2200,
    loadMax: 3800,
    stableNeeded: 6,
  },
  human: {
    flickMin: 0.35,
    flickMax: 0.65,
    pauseMin: 1400,
    pauseMax: 2800,
    longChance: 0.14,
    longMin: 3500,
    longMax: 6500,
    backChance: 0.08,
    backMin: 0.08,
    backMax: 0.25,
    loadMin: 1600,
    loadMax: 3000,
    stableNeeded: 5,
  },
  fast: {
    flickMin: 0.55,
    flickMax: 0.85,
    pauseMin: 700,
    pauseMax: 1500,
    longChance: 0.06,
    longMin: 2000,
    longMax: 3500,
    backChance: 0.04,
    backMin: 0.06,
    backMax: 0.18,
    loadMin: 1200,
    loadMax: 2200,
    stableNeeded: 5,
  },
};

const HARD_STEP_CAP = 4000;

// ------------------------------------------------------------------ DOM read
interface MetricSet {
  comments: number;
  reposts: number;
  likes: number;
  bookmarks: number;
  views: number;
}

// Exported for the passive home-timeline capture (HV.2), which reuses this
// file's DOM reader rather than forking a second one.
export interface Extracted {
  handle: string | null;
  id: string | null;
  url: string;
  text: string;
  time: string; // ISO 8601 UTC, or ''
  timeMs: number | null;
  pinned: boolean;
  isRepost: boolean;
  metrics: MetricSet;
  // Content-shape signals (§9.4) — "which formats earn views" needs these.
  hasPhoto: boolean;
  hasVideo: boolean;
  isQuote: boolean;
  lineBreaks: number;
}

function profileHandle(): string | null {
  return profileHandleFromUrl(location.href)?.toLowerCase() ?? null;
}

function parseMetrics(aria: string | null): MetricSet {
  // aria like: "19 replies, 4 reposts, 38 likes, 2 bookmarks, 845 views" — in
  // an English UI. The locale-hardened parser (§9.3) covers the rest; a label
  // with numbers nothing matched is reported loudly (zeros would silently
  // pollute the calibration data).
  const m = parseMetricsAria(aria);
  if (m.unparsed && aria) reportUnparsed('harvester', aria);
  return {
    comments: m.replies,
    reposts: m.reposts,
    likes: m.likes,
    bookmarks: m.bookmarks,
    views: m.views,
  };
}

function idFrom(art: Element): { handle: string; id: string; url: string } | null {
  const a = Array.from(art.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]')).find((x) =>
    /\/status\/\d+/.test(x.getAttribute('href') ?? ''),
  );
  const href = a?.getAttribute('href');
  if (!href) return null;
  const m = href.match(/\/([^/]+)\/status\/(\d+)/);
  if (!m?.[1] || !m[2]) return null;
  return { handle: m[1], id: m[2], url: `https://x.com/${m[1]}/status/${m[2]}` };
}

export function extractArticle(art: Element): Extracted {
  const id = idFrom(art);
  const txtEl = art.querySelector('div[data-testid="tweetText"]');
  const time = art.querySelector('time');
  const grp = art.querySelector('div[role="group"][aria-label]');
  const socialContext = art.querySelector('[data-testid="socialContext"]')?.textContent ?? '';
  const isRepost = /(reposted|you reposted)/i.test(socialContext);
  // Pinned tweets carry a "Pinned" social-context label (localized). They sit
  // at the top of a profile regardless of age, so they must not drive the
  // scroll-past-the-window stop check.
  const pinned = /pin|fixat|épingl|anclado|fijado|festgeh|gepin/i.test(socialContext);
  const iso = time?.getAttribute('datetime') ?? '';
  const ms = iso ? Date.parse(iso) : Number.NaN;
  const rawText = txtEl ? (txtEl as HTMLElement).innerText : '';
  return {
    handle: id ? id.handle : null,
    id: id ? id.id : null,
    url: id ? id.url : '',
    text: rawText.replace(/\s*\n\s*/g, ' ').trim(),
    time: iso,
    timeMs: Number.isNaN(ms) ? null : ms,
    pinned,
    isRepost,
    metrics: parseMetrics(grp ? grp.getAttribute('aria-label') : ''),
    hasPhoto: art.querySelector('[data-testid="tweetPhoto"]') !== null,
    hasVideo: art.querySelector('video, [data-testid="videoPlayer"]') !== null,
    // A quoted tweet renders as a nested tweetText inside a role="link" card.
    isQuote: art.querySelector('div[role="link"] [data-testid="tweetText"]') !== null,
    // Counted on the raw innerText, before line breaks collapse to spaces.
    lineBreaks: (rawText.match(/\n/g) ?? []).length,
  };
}

// X swaps a tweet's text for a machine translation IN PLACE (shared/translation.ts):
// read it as-is and a Japanese target lands in the corpus as English, unmarked.
// Clicking "Show original" restores the same node from X's client-side copy with
// no network call, so this is a click plus a settle — never a paid read.
//
// Run before every sweep, not once per run: the timeline virtualizes, and a
// recycled article comes back translated. The store overwrites per tweet id on
// each sweep, so a row can only ever be rewritten with the original, not back.
const TRANSLATION_SETTLE_MS = 60;

async function revealOriginals(): Promise<void> {
  const buttons = findShowOriginalButtons(document, viewerLangOf(document));
  if (buttons.length === 0) return;
  for (const btn of buttons) btn.click();
  // Live-verified: the swap lands on the next macrotask. 60ms is the same
  // settle budget the composer fill uses, with room for a slow frame.
  await sleep(TRANSLATION_SETTLE_MS);
}

function groupsOfArticles(): Element[][] {
  // Conversation items in the timeline are separated by empty cells.
  const cells = Array.from(document.querySelectorAll('div[data-testid="cellInnerDiv"]'));
  const groups: Element[][] = [];
  let cur: Element[] = [];
  for (const c of cells) {
    const a = c.querySelector('article[data-testid="tweet"]');
    if (a) cur.push(a);
    else {
      if (cur.length) groups.push(cur);
      cur = [];
    }
  }
  if (cur.length) groups.push(cur);
  return groups;
}

// --------------------------------------------------------------- date windows
interface DayWindow {
  startMs: number;
  endMs: number;
}

// A local calendar day, `offsetDays` back from today (0 = today, 1 = yesterday).
function dayWindow(offsetDays: number): DayWindow {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offsetDays, 0, 0, 0, 0);
  const startMs = start.getTime();
  return { startMs, endMs: startMs + 86_400_000 };
}

// 'recent' is a rolling 48h window, NOT a calendar day: the own-reply read layer
// buckets by UTC day, so a local-midnight window clips hours off every UTC day
// outside UTC+0. 48h covers two whole UTC days from any timezone; the overlap
// costs nothing because the read layer keeps the latest row per tweet. Fixed on
// purpose (decision 6) — a tunable would reintroduce the clipping it fixes.
const RECENT_WINDOW_MS = 48 * 60 * 60 * 1000;

function scopeWindow(scope: HarvestScope): DayWindow | null {
  if (scope === 'today') return dayWindow(0);
  if (scope === 'yesterday') return dayWindow(1);
  // endMs unbounded, same shape as 'since-last' — a tweet timestamped slightly
  // ahead of the local clock must not be dropped.
  if (scope === 'recent') {
    return { startMs: Date.now() - RECENT_WINDOW_MS, endMs: Number.POSITIVE_INFINITY };
  }
  return null;
}

// 'since-last' (§9.4): window opens at the previous completed run's newest
// item for this handle+mode. First run (no cursor) scrapes like 'all'.
async function readCursorMs(handle: string, mode: HarvestMode): Promise<number | null> {
  try {
    const key = harvestCursorKey(handle, mode);
    const out = await chrome.storage.local.get(key);
    const v = out[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

async function writeCursorMs(handle: string, mode: HarvestMode, ms: number): Promise<void> {
  try {
    const key = harvestCursorKey(handle, mode);
    const existing = await readCursorMs(handle, mode);
    if (existing === null || ms > existing) await chrome.storage.local.set({ [key]: ms });
  } catch {
    // cursor is an optimization — never fail the harvest over it
  }
}

async function windowFor(
  handle: string,
  mode: HarvestMode,
  scope: HarvestScope,
): Promise<DayWindow | null> {
  if (scope !== 'since-last') return scopeWindow(scope);
  const cursor = await readCursorMs(handle, mode);
  if (cursor === null) return null; // first run — full scrape
  // Strictly newer than the cursor; endMs unbounded.
  return { startMs: cursor + 1, endMs: Number.POSITIVE_INFINITY };
}

function inWindow(timeMs: number | null, win: DayWindow | null): boolean {
  if (!win) return true;
  if (timeMs === null) return false;
  return timeMs >= win.startMs && timeMs < win.endMs;
}

// ------------------------------------------------------------------- harvest
interface PostRow {
  text: string;
  comments: number;
  reposts: number;
  likes: number;
  bookmarks: number;
  views: number;
  time: string;
  handle: string;
  url: string;
  hasPhoto: boolean;
  hasVideo: boolean;
  isQuote: boolean;
  lineBreaks: number;
}

// Fields beyond the CSV columns (o_id, r_reposts, r_bookmarks) exist for the
// stratus ingest only — the CSV builders ignore them to keep the original
// scrape.js output shape.
interface ReplyRow {
  o_id: string;
  o_text: string;
  o_comments: number;
  o_likes: number;
  o_views: number;
  o_time: string;
  o_handle: string;
  r_text: string;
  r_comments: number;
  r_reposts: number;
  r_likes: number;
  r_bookmarks: number;
  r_views: number;
  r_time: string;
  // 1-based index of the reply inside its rendered group (§9.4). Position 1
  // sits directly under the true original; deeper positions mark self-threads/
  // chains where the items[k-1] pairing mislabels the "original" — calibration
  // analysis can filter or downweight them.
  r_position: number;
  hasPhoto: boolean;
  hasVideo: boolean;
  isQuote: boolean;
  lineBreaks: number;
}

// One row of a /following list page. `listPosition` is assigned on FIRST
// sighting: the list virtualizes, so a cell's index in the current DOM restarts
// every screen — only the order in which handles first appear tracks the page's
// top-down order (which on X is roughly follow recency).
interface FollowRow {
  handle: string;
  displayName: string | null;
  followsBack: boolean;
  listPosition: number;
}

interface HarvestCtx<R> {
  store: Record<string, R>;
  profile: string;
  window: DayWindow | null;
  // oldest own (non-pinned) item seen so far, in or out of window — tracks how
  // far down the timeline we've scrolled, independent of what we kept.
  oldestSeenMs: number | null;
  // HV.3 view floor. Applied AFTER noteSeen so a filtered-out item still counts
  // as scrolled-past — otherwise a high floor would defeat the day-window
  // exhaustion break and scroll to the hard step cap every time.
  minViews: number | undefined;
}

type Harvester<R> = (ctx: HarvestCtx<R>) => number;

function noteSeen<R>(ctx: HarvestCtx<R>, item: Extracted): void {
  if (item.pinned || item.timeMs === null) return;
  if (ctx.oldestSeenMs === null || item.timeMs < ctx.oldestSeenMs) ctx.oldestSeenMs = item.timeMs;
}

function harvestPosts(ctx: HarvestCtx<PostRow>): number {
  let added = 0;
  for (const g of groupsOfArticles()) {
    for (const art of g) {
      const p = extractArticle(art);
      if (!p.id) continue;
      if (p.handle && p.handle.toLowerCase() !== ctx.profile) continue; // skip others
      if (p.isRepost) continue; // skip bare reposts
      noteSeen(ctx, p);
      if (!inWindow(p.timeMs, ctx.window)) continue;
      if (!passesMinViews(p.metrics.views, ctx.minViews)) continue;
      if (!ctx.store[p.id]) added++;
      ctx.store[p.id] = {
        text: p.text,
        comments: p.metrics.comments,
        reposts: p.metrics.reposts,
        likes: p.metrics.likes,
        bookmarks: p.metrics.bookmarks,
        views: p.metrics.views,
        time: p.time,
        handle: p.handle ?? '',
        url: p.url,
        hasPhoto: p.hasPhoto,
        hasVideo: p.hasVideo,
        isQuote: p.isQuote,
        lineBreaks: p.lineBreaks,
      };
    }
  }
  return added;
}

function harvestReplies(ctx: HarvestCtx<ReplyRow>): number {
  let added = 0;
  for (const g of groupsOfArticles()) {
    const items = g.map(extractArticle);
    for (let k = 1; k < items.length; k++) {
      const reply = items[k];
      const orig = items[k - 1];
      if (!reply || !orig) continue;
      if (!reply.handle || reply.handle.toLowerCase() !== ctx.profile || !reply.id) continue;
      noteSeen(ctx, reply);
      if (!inWindow(reply.timeMs, ctx.window)) continue;
      // The floor reads MY reply's views, never the original's.
      if (!passesMinViews(reply.metrics.views, ctx.minViews)) continue;
      if (!ctx.store[reply.id]) added++;
      ctx.store[reply.id] = {
        o_id: orig.id ?? '',
        o_text: orig.text,
        o_comments: orig.metrics.comments,
        o_likes: orig.metrics.likes,
        o_views: orig.metrics.views,
        o_time: orig.time,
        o_handle: orig.handle ?? '',
        r_text: reply.text,
        r_comments: reply.metrics.comments,
        r_reposts: reply.metrics.reposts,
        r_likes: reply.metrics.likes,
        r_bookmarks: reply.metrics.bookmarks,
        r_views: reply.metrics.views,
        r_time: reply.time,
        r_position: k,
        hasPhoto: reply.hasPhoto,
        hasVideo: reply.hasVideo,
        isQuote: reply.isQuote,
        lineBreaks: reply.lineBreaks,
      };
    }
  }
  return added;
}

function harvestFollowing(ctx: HarvestCtx<FollowRow>): number {
  let added = 0;
  for (const cell of Array.from(document.querySelectorAll('[data-testid="UserCell"]'))) {
    const parsed = parseUserCell(cell);
    if (!parsed) continue; // skeleton or renamed testid — let a later sweep retry
    if (parsed.handle === ctx.profile) continue; // never ingest the list's owner
    const prev = ctx.store[parsed.handle];
    if (!prev) {
      const listPosition = Object.keys(ctx.store).length;
      ctx.store[parsed.handle] = { ...parsed, listPosition };
      added++;
      continue;
    }
    // Re-sighting on a later screen: GR.1's rule at DOM scale — the badge is
    // presence evidence, so a half-painted cell must not be able to un-say
    // "follows you". Across runs the server always takes the newest value, so a
    // real unfollow still lands on the next scrape.
    prev.followsBack = prev.followsBack || parsed.followsBack;
    prev.displayName = prev.displayName ?? parsed.displayName;
  }
  return added;
}

// ----------------------------------------------------------------- CSV build
// Formula-escape (§9.4): a scraped tweet starting with =, +, - or @ would
// execute as a formula when the CSV opens in Excel/Sheets. Prefix with ' —
// the standard CSV-injection guard.
const esc = (s: unknown): string => {
  let v = String(s);
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return `"${v.replace(/"/g, '""')}"`;
};

function postsCSV(store: Record<string, PostRow>): string {
  const header = [
    'Post text',
    'Comments',
    'Reposts',
    'Likes',
    'Bookmarks',
    'Views',
    'Date and time',
    'Handle @...',
    'URL',
  ];
  const rows = Object.values(store).sort((a, b) => (b.time || '').localeCompare(a.time || ''));
  const lines = [header.map(esc).join(',')];
  for (const r of rows) {
    lines.push(
      [
        esc(r.text),
        esc(r.comments),
        esc(r.reposts),
        esc(r.likes),
        esc(r.bookmarks),
        esc(r.views),
        esc(r.time),
        esc(`@${r.handle || ''}`),
        esc(r.url),
      ].join(','),
    );
  }
  return `﻿${lines.join('\r\n')}`;
}

function repliesCSV(store: Record<string, ReplyRow>): string {
  const header = [
    'Original post text',
    'Original post comments',
    'Original post likes',
    'Original post views',
    'Original post Date and time',
    'Original post twitter handle @...',
    'Reply text',
    'Reply comments',
    'Reply likes',
    'Reply views',
    'Reply Date and time',
  ];
  const rows = Object.values(store).sort((a, b) => (b.r_time || '').localeCompare(a.r_time || ''));
  const lines = [header.map(esc).join(',')];
  for (const r of rows) {
    lines.push(
      [
        esc(r.o_text),
        esc(r.o_comments),
        esc(r.o_likes),
        esc(r.o_views),
        esc(r.o_time),
        esc(`@${r.o_handle || ''}`),
        esc(r.r_text),
        esc(r.r_comments),
        esc(r.r_likes),
        esc(r.r_views),
        esc(r.r_time),
      ].join(','),
    );
  }
  return `﻿${lines.join('\r\n')}`;
}

function followingRows(store: Record<string, FollowRow>): FollowRow[] {
  return Object.values(store).sort((a, b) => a.listPosition - b.listPosition);
}

function followingCSV(store: Record<string, FollowRow>): string {
  const header = ['Handle @...', 'Name', 'Follows you'];
  const lines = [header.map(esc).join(',')];
  for (const r of followingRows(store)) {
    lines.push(
      [esc(`@${r.handle}`), esc(r.displayName ?? ''), esc(r.followsBack ? 'yes' : 'no')].join(','),
    );
  }
  return `﻿${lines.join('\r\n')}`;
}

// -------------------------------------------------------------- stratus ship
// Rows go through the existing background ApiRequest path (the background
// worker owns the bearer token), in batches, alongside the CSV download.
// Upload failure never loses the harvest — the CSV is already on disk.

const INGEST_CHUNK = 200;

function postsIngestRows(store: Record<string, PostRow>): HarvestIngestRow[] {
  return Object.entries(store).map(([id, r]) => ({
    tweetId: id,
    handle: r.handle,
    text: r.text,
    comments: r.comments,
    reposts: r.reposts,
    likes: r.likes,
    bookmarks: r.bookmarks,
    views: r.views,
    time: r.time || null,
    hasPhoto: r.hasPhoto,
    hasVideo: r.hasVideo,
    isQuote: r.isQuote,
    textLen: r.text.length,
    lineBreaks: r.lineBreaks,
  }));
}

function repliesIngestRows(profile: string, store: Record<string, ReplyRow>): HarvestIngestRow[] {
  return Object.entries(store).map(([id, r]) => ({
    tweetId: id,
    handle: profile,
    text: r.r_text,
    comments: r.r_comments,
    reposts: r.r_reposts,
    likes: r.r_likes,
    bookmarks: r.r_bookmarks,
    views: r.r_views,
    time: r.r_time || null,
    hasPhoto: r.hasPhoto,
    hasVideo: r.hasVideo,
    isQuote: r.isQuote,
    textLen: r.r_text.length,
    lineBreaks: r.lineBreaks,
    groupPosition: r.r_position,
    orig: {
      tweetId: r.o_id || null,
      handle: r.o_handle || null,
      text: r.o_text,
      time: r.o_time || null,
      comments: r.o_comments,
      likes: r.o_likes,
      views: r.o_views,
    },
  }));
}

async function apiSend<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const req: ApiRequest = { type: 'stratus/api', method, path, body };
  const res = (await chrome.runtime.sendMessage(req)) as ApiResponse<T> | undefined;
  if (!res) throw new Error('no_response');
  if (!res.ok) throw new Error(res.code);
  return res.data;
}

// How a run ended, handed to the ship step. `complete` means the scroll reached
// the natural bottom of the list — for the following ledger that is the whole
// ballgame (only a complete run may reconcile), so it is computed from the loop's
// exit reason, never assumed.
interface RunOutcome {
  cancelled: boolean;
  complete: boolean;
}

async function shipToStratus(
  handle: string,
  mode: HarvestMode,
  scope: HarvestScope,
  rows: HarvestIngestRow[],
): Promise<HarvestIngest> {
  try {
    const run = await apiSend<{ id: string }>('POST', '/x/harvest/runs', { handle, mode, scope });
    let matched = 0;
    let backfilled = 0;
    for (let i = 0; i < rows.length; i += INGEST_CHUNK) {
      const batch = await apiSend<{ matched: number; backfilled: number }>(
        'POST',
        '/x/harvest/rows',
        { runId: run.id, rows: rows.slice(i, i + INGEST_CHUNK) },
      );
      matched += batch.matched;
      backfilled += batch.backfilled;
    }
    return { sent: true, rows: rows.length, runId: run.id, matched, backfilled };
  } catch (err) {
    return { sent: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// The server caps a batch at 500; 200 keeps the payloads small and matches the
// harvest ingest's own chunk.
const FOLLOWING_CHUNK = 200;

async function shipFollowing(
  store: Record<string, FollowRow>,
  outcome: RunOutcome,
): Promise<HarvestIngest> {
  const rows: FollowingIngestRow[] = followingRows(store).map((r) => ({
    handle: r.handle,
    displayName: r.displayName,
    followsBack: r.followsBack,
    listPosition: r.listPosition,
  }));
  try {
    const run = await apiSend<{ id: string }>('POST', '/x/following/runs', {});
    for (let i = 0; i < rows.length; i += FOLLOWING_CHUNK) {
      const last = i + FOLLOWING_CHUNK >= rows.length;
      await apiSend('POST', '/x/following/rows', {
        runId: run.id,
        rows: rows.slice(i, i + FOLLOWING_CHUNK),
        // Only a scroll that reached the bottom may close the run: the server
        // marks every handle it never saw as `gone` off this one flag, and a
        // cancelled or row-capped pass proves nothing about what it never
        // reached. A mid-batch failure leaves the run open for the same reason.
        ...(last && outcome.complete ? { done: true } : {}),
      });
    }
    return {
      sent: true,
      rows: rows.length,
      runId: run.id,
      matched: 0,
      backfilled: 0,
      followsBack: rows.filter((r) => r.followsBack).length,
      complete: outcome.complete,
    };
  } catch (err) {
    return { sent: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function download(csv: string, name: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 4000);
}

// ------------------------------------------------------------ human scrolling
// Animate a scroll over `distance` px in eased increments with per-frame jitter,
// so it reads as a trackpad/wheel flick rather than a jump.
async function humanScroll(se: Element, distance: number): Promise<void> {
  const frames = randInt(10, 20);
  let doneAmt = 0;
  for (let i = 1; i <= frames; i++) {
    const t = i / frames;
    const ease = 1 - (1 - t) ** 2; // easeOutQuad (decelerates near end)
    const target = distance * ease;
    se.scrollTop += target - doneAmt + rand(-2, 2);
    doneAmt = target;
    await sleep(rand(12, 34));
  }
}

async function readingPause(cfg: Pacing): Promise<void> {
  let ms = gauss(cfg.pauseMin, cfg.pauseMax);
  if (chance(cfg.longChance)) ms = gauss(cfg.longMin, cfg.longMax); // got distracted
  await sleep(ms);
}

// --------------------------------------------------------------- run the loop
function localDateStamp(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function scopeSuffix(scope: HarvestScope): string {
  if (scope === 'all') return '';
  return `_${scope.replace(/-/g, '_')}`;
}

function postEvent(port: chrome.runtime.Port, e: HarvestEvent): void {
  try {
    port.postMessage(e);
  } catch {
    // port already closed (side panel went away) — nothing to do
  }
}

async function runHarvest<R>(
  mode: HarvestMode,
  options: HarvestOptions,
  harvest: Harvester<R>,
  buildCsv: (store: Record<string, R>) => string,
  ship: (profile: string, store: Record<string, R>, outcome: RunOutcome) => Promise<HarvestIngest>,
  rowTime: (r: R) => string,
  emit: (e: HarvestEvent) => void,
  shouldCancel: () => boolean,
): Promise<void> {
  const profile = profileHandle();
  if (!profile) {
    emit({ type: 'error', code: 'no_handle' });
    return;
  }

  const cfg = PRESETS[options.pace] ?? PRESETS.human;
  const win = await windowFor(profile, mode, options.scope);
  const ctx: HarvestCtx<R> = {
    store: {},
    profile,
    window: win,
    oldestSeenMs: null,
    minViews: options.minViews,
  };

  emit({ type: 'started', handle: profile, mode, scope: options.scope });

  const oldestStored = (): string | null =>
    Object.values(ctx.store).reduce<string | null>((min, r) => {
      const t = rowTime(r);
      return !min || (t && t < min) ? t : min;
    }, null);

  const se = document.scrollingElement ?? document.documentElement;
  const max = options.max && options.max > 0 ? options.max : Number.POSITIVE_INFINITY;

  let lastH = 0;
  let stable = 0;
  let steps = 0;
  let cancelled = false;
  let reachedBottom = false;
  let lastCount = -1;
  let lastEmitStep = 0;

  await sleep(gauss(600, 1500)); // settle before starting
  se.scrollTop = 0;
  await sleep(gauss(500, 1200));

  while (steps < HARD_STEP_CAP) {
    if (shouldCancel()) {
      cancelled = true;
      break;
    }

    await revealOriginals();
    harvest(ctx);
    const count = Object.keys(ctx.store).length;

    if (count !== lastCount || steps - lastEmitStep >= 6) {
      emit({ type: 'progress', rows: count, oldest: oldestStored(), steps });
      lastCount = count;
      lastEmitStep = steps;
    }

    if (count >= max) break;
    // Scrolled past the requested day window: everything inside it is above us
    // and already captured on prior screens.
    if (win && ctx.oldestSeenMs !== null && ctx.oldestSeenMs < win.startMs) break;

    const atBottom = se.scrollTop + se.clientHeight >= se.scrollHeight - 5;
    if (atBottom) {
      if (se.scrollHeight === lastH) {
        stable++;
        if (stable >= cfg.stableNeeded) {
          // The ONLY exit that means "I saw everything" — a cancel, the row cap,
          // the day window and the hard step cap all leave the tail unread.
          reachedBottom = true;
          break;
        }
      } else stable = 0;
      lastH = se.scrollHeight;
      await sleep(gauss(cfg.loadMin, cfg.loadMax)); // wait for lazy-load
    } else {
      // occasionally drift back up a little, like a human re-reading
      if (chance(cfg.backChance)) {
        await humanScroll(se, -rand(cfg.backMin, cfg.backMax) * se.clientHeight);
        await sleep(gauss(500, 1300));
      }
      await humanScroll(se, rand(cfg.flickMin, cfg.flickMax) * se.clientHeight);
      await readingPause(cfg);
    }
    steps++;
  }
  await revealOriginals();
  harvest(ctx); // final sweep of whatever is on screen

  const rows = Object.values(ctx.store);
  const times = rows
    .map(rowTime)
    .filter((t): t is string => Boolean(t))
    .sort();
  // HV.3: a DB-only run downloads nothing, and reports an empty filename so the
  // panel can word the result "saved to stratus only" without a second flag.
  const wantsCsv = options.downloadCsv !== false;
  const filename = `${profile}_${mode}${scopeSuffix(options.scope)}_${localDateStamp()}.csv`;

  if (wantsCsv && rows.length > 0) download(buildCsv(ctx.store), filename);

  let ingest: HarvestIngest | undefined;
  if (rows.length > 0 && options.sendToStratus !== false) {
    emit({ type: 'sending', rows: rows.length });
    ingest = await ship(profile, ctx.store, { cancelled, complete: reachedBottom && !cancelled });
  }

  // Advance the per-handle cursor only on a COMPLETED run (§9.4) — a cancelled
  // partial scroll would otherwise skip everything it never reached.
  if (!cancelled && rows.length > 0) {
    const newest = times[times.length - 1];
    const newestMs = newest ? Date.parse(newest) : Number.NaN;
    if (!Number.isNaN(newestMs)) await writeCursorMs(profile, mode, newestMs);
  }

  emit({
    type: 'done',
    rows: rows.length,
    filename: wantsCsv && rows.length > 0 ? filename : '',
    firstTime: times[times.length - 1] ?? null,
    lastTime: times[0] ?? null,
    cancelled,
    ...(ingest ? { ingest } : {}),
  });
}

// --------------------------------------------------------------- port wiring
let running = false;

// A hand-run harvest owns the page's scroll while it runs; passive capture
// (HV.2) suspends itself so the two never write the same articles twice.
export function isHarvestActive(): boolean {
  return running;
}

// ------------------------------------------------------- thread capture (TH.4)
//
// A sibling of runHarvest, not a mode of it: this one runs from the page (the 🧵
// button in the root tweet's action row), needs no port, no CSV and no side
// panel, and ships ONE atomic POST /x/harvest/thread instead of runs+rows. What
// it does share is the scroll idiom below — the same pacing preset, the same
// stable-scrollHeight bottom test, the same per-sweep revealOriginals — because
// that is the part x.com's virtualization punishes you for improvising.
//
// It also takes the module `running` flag, so passive capture (HV.2, via
// isHarvestActive) suspends for the duration and a hand-run harvest refuses with
// already_running. $0: DOM reads plus one POST to the local service.

// Opening guesses, all three (§7.19) — recalibrate after ~20 real captures
// against how many came back truncated, never by vibes.
const THREAD_STEP_CAP = 400;
const MAX_SHOW_MORE_CLICKS = 20;
// Sweeps with no new tweet before pagination is called exhausted. 3 covers one
// slow lazy-load plus a frame where X re-rendered without adding anything.
const THREAD_STALL_SWEEPS = 3;

interface ThreadEntry {
  row: HarvestIngestRow;
  order: number;
}

// "Show more replies" — the single most drift-prone selector in this file, so it
// is identified by SHAPE, never by text: the label is localized (shared/
// translation.ts makes the same argument for "Show original"), and matching an
// English string would silently under-collect for every other UI language.
//
// The shape that holds: X renders the control in its own `cellInnerDiv` that
// contains NO article — a reply cell always contains one — and it sits BELOW the
// last rendered article, because it is the tail of the conversation. Buttons
// above the last article (the inline composer, a tweet's own action row) are
// excluded by that ordering alone.
//
// The `role="separator"` cut is decision 2: X puts a divider above the
// "probable spam" / "may contain offensive content" tail, and we deliberately do
// not paginate into it. Anything from the first separator down is off-limits;
// articles that happen to render there are still read, we just never click to
// reveal more of them.
//
// `clicked` is the anti-loop: a control that does not disappear after its click
// (X re-rendering, or a mis-identified button) must not be clicked every sweep.
function findShowMoreControl(clicked: WeakSet<Element>): HTMLElement | null {
  const cells = Array.from(document.querySelectorAll('div[data-testid="cellInnerDiv"]'));
  let lastArticleIdx = -1;
  let separatorIdx = -1;
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (!cell) continue;
    if (cell.querySelector('article[data-testid="tweet"]')) lastArticleIdx = i;
    else if (separatorIdx === -1 && cell.querySelector('[role="separator"]')) separatorIdx = i;
  }
  if (lastArticleIdx === -1) return null;

  for (let i = lastArticleIdx + 1; i < cells.length; i++) {
    if (separatorIdx !== -1 && i >= separatorIdx) break; // spam/offensive tail
    const cell = cells[i];
    if (!cell) continue;
    const btn = cell.querySelector<HTMLElement>('button, [role="button"]');
    if (!btn || clicked.has(btn)) continue;
    // A bare icon button (the "back to top" arrow and friends) is not it; the
    // expander always carries its own label.
    if ((btn.textContent ?? '').trim() === '') continue;
    return btn;
  }
  return null;
}

/** Capture the conversation on the current /status/ page: the root plus every
 *  top-level reply the scroll reaches, shipped as one POST. `onProgress` is
 *  called with the reply count each time it changes, for the button's label. */
export async function captureThread(
  onProgress: (replies: number) => void,
): Promise<ThreadCaptureResult> {
  if (running) return { ok: false, code: 'already_running' };
  running = true;
  try {
    const rootTweetId = threadRootIdFromUrl(location.href);
    if (!rootTweetId) return { ok: false, code: 'not_a_thread' };

    const cfg = PRESETS.human;
    const se = document.scrollingElement ?? document.documentElement;

    // Keyed by tweet id, `order` assigned at FIRST sighting off a monotonic
    // counter — the harvestFollowing list-position rule at conversation scale.
    // X virtualizes, so a cell's index in the current DOM restarts every screen;
    // only first-seen order under a top-down scroll tracks render order, and a
    // recycled article must never renumber. Re-sighting overwrites the ROW
    // (fresher metrics, and TR.1's un-translation may have landed since) but
    // never the order.
    const store = new Map<string, ThreadEntry>();
    let order = 0;
    const clicked = new WeakSet<Element>();

    const sweep = async (): Promise<void> => {
      // Per sweep, not once per run: the conversation virtualizes and a recycled
      // article comes back translated (TR.1's reason, verbatim).
      await revealOriginals();
      for (const art of Array.from(document.querySelectorAll('article[data-testid="tweet"]'))) {
        const row = extractedToIngestRow(extractArticle(art));
        if (!row) continue; // ad, promoted cell, unparseable article
        const prev = store.get(row.tweetId);
        store.set(row.tweetId, { row, order: prev ? prev.order : order++ });
      }
    };

    // The root renders inline in its own conversation, so it is one of the
    // sighted articles; everything else is a reply.
    const replyCount = (): number => store.size - (store.has(rootTweetId) ? 1 : 0);

    await sleep(gauss(600, 1500)); // settle before starting
    se.scrollTop = 0;
    await sleep(gauss(500, 1200));

    let lastH = 0;
    let stable = 0;
    let steps = 0;
    let lastReported = -1;
    let lastSize = 0;
    let stalled = 0;
    let showMoreClicks = 0;
    let truncated = false;

    while (steps < THREAD_STEP_CAP) {
      await sweep();

      const replies = replyCount();
      if (replies !== lastReported) {
        onProgress(replies);
        lastReported = replies;
      }
      if (replies >= MAX_THREAD_REPLIES) {
        truncated = true;
        break;
      }

      // Exhaustion is measured on what we CAPTURED, not on how many articles the
      // DOM holds: under virtualization the article count hovers around a screen
      // regardless of how far the conversation has been expanded.
      if (store.size > lastSize) {
        lastSize = store.size;
        stalled = 0;
      } else stalled++;

      const paginationDone =
        stalled >= THREAD_STALL_SWEEPS || showMoreClicks >= MAX_SHOW_MORE_CLICKS;
      const more = paginationDone ? null : findShowMoreControl(clicked);
      if (more) {
        clicked.add(more);
        more.click();
        showMoreClicks++;
        if (showMoreClicks >= MAX_SHOW_MORE_CLICKS) truncated = true;
        stable = 0; // the page is about to grow
        await sleep(gauss(cfg.loadMin, cfg.loadMax));
        steps++;
        continue;
      }

      const atBottom = se.scrollTop + se.clientHeight >= se.scrollHeight - 5;
      if (atBottom) {
        if (se.scrollHeight === lastH) {
          stable++;
          if (stable >= cfg.stableNeeded) break; // nothing left to load
        } else stable = 0;
        lastH = se.scrollHeight;
        await sleep(gauss(cfg.loadMin, cfg.loadMax)); // wait for lazy-load
      } else {
        if (chance(cfg.backChance)) {
          await humanScroll(se, -rand(cfg.backMin, cfg.backMax) * se.clientHeight);
          await sleep(gauss(500, 1300));
        }
        await humanScroll(se, rand(cfg.flickMin, cfg.flickMax) * se.clientHeight);
        await readingPause(cfg);
      }
      steps++;
    }
    await sweep(); // final sweep of whatever is on screen

    const rootEntry = store.get(rootTweetId);
    // The URL says this is a thread but its root never parsed — a login wall, a
    // deleted tweet, or an article shape we did not recognize. Shipping replies
    // with no root would create a capture nothing can read.
    if (!rootEntry) return { ok: false, code: 'root_not_found' };

    const ordered = [...store.values()].sort((a, b) => a.order - b.order).map((e) => e.row);
    // The break above fires AFTER the sweep that crossed the line, so a last
    // screen can carry the count past the ceiling; the slice is what keeps the
    // payload inside the server's own row cap.
    const replies = dedupeThreadReplies(ordered, rootTweetId).slice(0, MAX_THREAD_REPLIES);

    try {
      const res = await apiSend<{ inserted: number; replies: number }>(
        'POST',
        '/x/harvest/thread',
        { root: rootEntry.row, replies },
      );
      onProgress(res.replies);
      return { ok: true, rootTweetId, inserted: res.inserted, replies: res.replies, truncated };
    } catch (err) {
      // flushPassiveHarvest's rule: a lost capture is a retry, not a thrown page.
      // `unconfigured` (no bearer yet) is silent — it is a setup state, not a bug.
      const code = err instanceof Error ? err.message : String(err);
      if (code !== 'unconfigured') console.warn('[stratus] thread capture failed', code);
      return { ok: false, code };
    }
  } finally {
    running = false;
  }
}

// The logged-in account, read off the left-nav account switcher's avatar. Null
// whenever the nav isn't rendered — treat that as "unknown", never as a mismatch
// (§7.11): the only thing this guards is the following scrape, and refusing a
// legitimate run over a collapsed sidebar would be worse than the risk.
function loggedInHandle(): string | null {
  const avatar = document.querySelector(
    '[data-testid="SideNav_AccountSwitcher_Button"] [data-testid^="UserAvatar-Container-"]',
  );
  return handleFromAvatarTestid(avatar?.getAttribute('data-testid'));
}

function currentContext(): HarvestContextResult {
  return {
    ok: true,
    url: location.href,
    handle: profileHandleFromUrl(location.href),
    onReplies: isRepliesPath(location.href),
    onFollowing: isFollowingPath(location.href),
    loggedIn: document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]') !== null,
  };
}

function startRun(
  opts: HarvestOptions,
  emit: (e: HarvestEvent) => void,
  shouldCancel: () => boolean,
): Promise<void> {
  if (opts.mode === 'following') {
    // Scraping SOMEONE ELSE's following list into the ledger would insert their
    // followees as mine and, on a complete run, mark my real follows `gone`. The
    // panel only offers the mode on a /following page; this is the check that
    // actually holds, and it only fires on a POSITIVE mismatch.
    const self = loggedInHandle();
    const page = profileHandle();
    if (self !== null && page !== null && self !== page) {
      emit({ type: 'error', code: 'not_own_following' });
      return Promise.resolve();
    }
    return runHarvest<FollowRow>(
      'following',
      // No date axis and no metrics on a list page: scope is forced 'all' (which
      // also leaves the since-last cursor untouched, since rowTime is empty).
      { ...opts, scope: 'all' },
      harvestFollowing,
      followingCSV,
      (_profile, store, outcome) => shipFollowing(store, outcome),
      () => '',
      emit,
      shouldCancel,
    );
  }
  if (opts.mode === 'replies') {
    return runHarvest<ReplyRow>(
      'replies',
      opts,
      harvestReplies,
      repliesCSV,
      (profile, store) =>
        shipToStratus(profile, 'replies', opts.scope, repliesIngestRows(profile, store)),
      (r) => r.r_time,
      emit,
      shouldCancel,
    );
  }
  return runHarvest<PostRow>(
    'posts',
    opts,
    harvestPosts,
    postsCSV,
    (profile, store) => shipToStratus(profile, 'posts', opts.scope, postsIngestRows(store)),
    (r) => r.time,
    emit,
    shouldCancel,
  );
}

export function initHarvest(): void {
  // One-shot context / readiness probe from the side panel.
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!isHarvestContextRequest(msg)) return false;
    sendResponse(currentContext());
    return false; // responded synchronously
  });

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== HARVEST_PORT) return;

    let cancelled = false;
    const shouldCancel = (): boolean => cancelled;

    port.onDisconnect.addListener(() => {
      // Side panel closed mid-run — stop scrolling.
      cancelled = true;
    });

    port.onMessage.addListener((raw) => {
      const cmd = raw as HarvestCommand;
      if (cmd.type === 'cancel') {
        cancelled = true;
        return;
      }
      if (cmd.type !== 'start') return;

      if (running) {
        postEvent(port, { type: 'error', code: 'already_running' });
        return;
      }
      running = true;

      const emit = (e: HarvestEvent): void => postEvent(port, e);

      void startRun(cmd.options, emit, shouldCancel)
        .catch((err: unknown) => {
          emit({ type: 'error', code: 'crashed', message: String(err) });
        })
        .finally(() => {
          running = false;
          try {
            port.disconnect();
          } catch {
            // already gone
          }
        });
    });
  });
}

// ------------------------------------------------------------ hand sweep (HS.1)
//
// The same harvest, driven by the user's own scrolling. `runHarvest` above owns
// the page while it runs — it scrolls, it paces itself, and the tab is unusable
// for the duration, which is the right trade for "collect @someone's last 800
// posts" and the wrong one for "I'm reading this profile anyway, keep what I
// scroll past". A hand sweep is armed from the panel (or stopped from the on-page
// HUD), captures every screen the reader brings into view, and ships in the
// background while they keep reading.
//
// Three things it deliberately does NOT do, each of them a property of the auto
// harvest that a human-paced pass cannot honestly claim:
//   * no CSV — rows ship as they are captured, so there is no end-of-run moment
//     that owns a complete file. What reaches stratus is the whole output;
//   * no `since-last` cursor advance — the cursor means "everything newer than
//     this is already collected", which only a run that scrolled the window can
//     say. A sweep skips whatever the reader skipped;
//   * no scope, no max, no min-views — the scope of a sweep is what you looked
//     at. The rows land under scope 'all', which is what they are.
//
// $0 by construction, like everything else in this file: DOM reads plus POSTs to
// the local service. The row builders, the group pairing and the metrics parse
// are `harvestPosts`/`harvestReplies` verbatim (§7.27 — one reader, not two), so
// a swept row and a harvested row are the same row.

// What the run rows are recorded under. A sweep has no date window; 'all' is the
// scope the server already whitelists for "whatever the scroll reached".
const HAND_SWEEP_SCOPE: HarvestScope = 'all';
// After a failed flush, back off rather than retrying on the 4s cadence: the
// usual cause is an unreachable service or a missing bearer, and neither is
// fixed by asking again three times a minute.
const HAND_SWEEP_RETRY_MS = 15_000;
// The progress mirror is for the panel, and the panel repaints on it; a scroll
// tick that adds four rows must not write four times.
const HAND_STATS_MIN_MS = 1000;
// Stop drains what the timer never got to. Ten batches is 2,000 rows — far past
// any real sitting, and a bound rather than a `while (true)` over the network.
const HAND_DRAIN_BATCHES = 10;
// The capture pass reads EVERY article in the DOM (that is what makes a swept
// row identical to a harvested one), and content.ts's scan runs on every
// animation frame while a thumb is on the wheel. 400ms is far below the time it
// takes to scroll one screen and far above one frame, so nothing is missed and
// the timeline still scrolls at 60fps. A throttled burst leaves a trailing pass
// armed, so the last screen before a stop is never the one that got skipped.
const HAND_SCAN_MIN_MS = 400;

type HandCtx =
  | { mode: 'posts'; ctx: HarvestCtx<PostRow> }
  | { mode: 'replies'; ctx: HarvestCtx<ReplyRow> };

interface HandRun {
  session: HandSweepSession;
  ctx: HandCtx;
  /** Tweet ids already accepted by the server — the pending set is the store
   *  minus this, so a row is shipped once per sweep however often it is
   *  re-rendered by the timeline's virtualization. */
  sent: Set<string>;
  rows: number;
  saved: number;
  oldest: string | null;
  runId: string | null;
  error: string | null;
  onTarget: boolean;
  stopped: boolean;
  flushTimer: number | null;
  inFlight: Promise<void> | null;
  statsAt: number;
}

let handRun: HandRun | null = null;
let handListener: (() => void) | null = null;
let handScanAt = 0;
let handScanTrailing: number | null = null;

/** What the on-page HUD renders. Resolved, never cached: `handSweepView` is the
 *  only reader that decides whether a sweep is still live. */
export interface HandSweepView {
  handle: string;
  mode: HandSweepMode;
  rows: number;
  saved: number;
  oldest: string | null;
  /** False while the reader is off the swept timeline — a tweet detail page, a
   *  different profile. The sweep goes quiet, it does not end. */
  onTarget: boolean;
  error: string | null;
  minutesLeft: number;
  /** The HUD arms one timeout on this so a sweep also ends on a page nobody is
   *  scrolling; the expiry itself is still resolved on every read. */
  expiresAt: string;
}

/** content.ts registers the HUD repaint here — one listener, set once at start. */
export function onHandSweepChange(cb: () => void): void {
  handListener = cb;
}

function announceHand(): void {
  handListener?.();
}

export function handSweepView(): HandSweepView | null {
  const run = handRun;
  if (!run) return null;
  const now = Date.now();
  const live = handSweepActiveAt(run.session, now);
  if (!live) {
    // Expiry is resolved by whoever reads, exactly like the radar's sweep: the
    // HUD's timer only causes this read, it never owns the answer.
    void endHandRun();
    return null;
  }
  return {
    handle: run.session.handle,
    mode: run.session.mode,
    rows: run.rows,
    saved: run.saved,
    oldest: run.oldest,
    onTarget: run.onTarget,
    error: run.error,
    minutesLeft: handSweepMinutesLeft(live, now),
    expiresAt: live.expiresAt,
  };
}

function handStore(run: HandRun): Record<string, PostRow> | Record<string, ReplyRow> {
  return run.ctx.ctx.store;
}

function handPendingIds(run: HandRun): string[] {
  return Object.keys(handStore(run)).filter((id) => !run.sent.has(id));
}

function handRowTimes(run: HandRun): string[] {
  const times =
    run.ctx.mode === 'posts'
      ? Object.values(run.ctx.ctx.store).map((r) => r.time)
      : Object.values(run.ctx.ctx.store).map((r) => r.r_time);
  return times.filter((t): t is string => Boolean(t)).sort();
}

/** Widen the captured range rather than recompute it: after a reload the store
 *  is empty but how far back the sweep reached is already known from the mirror.
 *  ISO-8601 UTC strings, so a lexical compare IS the chronological one. */
function noteHandRange(run: HandRun): void {
  const first = handRowTimes(run)[0];
  if (first && (run.oldest === null || first < run.oldest)) run.oldest = first;
}

function handRowsFor(run: HandRun, ids: string[]): HarvestIngestRow[] {
  if (run.ctx.mode === 'posts') {
    const batch: Record<string, PostRow> = {};
    for (const id of ids) {
      const row = run.ctx.ctx.store[id];
      if (row) batch[id] = row;
    }
    return postsIngestRows(batch);
  }
  const batch: Record<string, ReplyRow> = {};
  for (const id of ids) {
    const row = run.ctx.ctx.store[id];
    if (row) batch[id] = row;
  }
  return repliesIngestRows(run.session.handle, batch);
}

function writeHandStats(run: HandRun, force = false): void {
  const now = Date.now();
  if (!force && now - run.statsAt < HAND_STATS_MIN_MS) return;
  run.statsAt = now;
  const stats: HandSweepStats = {
    startedAt: run.session.startedAt,
    rows: run.rows,
    saved: run.saved,
    oldest: run.oldest,
    runId: run.runId,
    updatedAt: new Date(now).toISOString(),
    error: run.error,
  };
  void chrome.storage.local.set({ [HAND_SWEEP_STATS_KEY]: stats }).catch(() => {
    // The panel loses a repaint; the sweep itself is unaffected.
  });
}

function scheduleHandFlush(run: HandRun, delayMs = HAND_SWEEP_FLUSH_MS): void {
  if (run.stopped || run.flushTimer !== null) return;
  run.flushTimer = window.setTimeout(() => {
    run.flushTimer = null;
    kickHandFlush(run);
  }, delayMs);
}

function kickHandFlush(run: HandRun): void {
  if (run.inFlight) return; // its own tail re-schedules
  run.inFlight = flushHandRun(run).finally(() => {
    run.inFlight = null;
  });
}

async function flushHandRun(run: HandRun): Promise<void> {
  const ids = handPendingIds(run).slice(0, HAND_SWEEP_BATCH_MAX);
  if (ids.length === 0) return;
  try {
    // The run is created on the FIRST batch, not at Start: arming and reading
    // nothing must not leave an empty run in the ledger.
    if (run.runId === null) {
      const created = await apiSend<{ id: string }>('POST', '/x/harvest/runs', {
        handle: run.session.handle,
        mode: run.session.mode,
        scope: HAND_SWEEP_SCOPE,
      });
      run.runId = created.id;
    }
    const rows = handRowsFor(run, ids);
    const res = await apiSend<{ inserted: number }>('POST', '/x/harvest/rows', {
      runId: run.runId,
      rows,
    });
    for (const id of ids) run.sent.add(id);
    run.saved += res.inserted ?? rows.length;
    run.error = null;
  } catch (err) {
    // Rows are NOT dropped here, and that is the difference from the passive tap
    // (§ passive: a failed flush loses a point on a view curve, which nobody
    // asked for). A sweep is an action the user took and is watching a counter
    // for, so the batch stays pending and the next flush retries it.
    run.error = err instanceof Error ? err.message : String(err);
  } finally {
    writeHandStats(run, true);
    announceHand();
    if (handPendingIds(run).length > 0) {
      scheduleHandFlush(run, run.error === null ? HAND_SWEEP_FLUSH_MS : HAND_SWEEP_RETRY_MS);
    }
  }
}

/** One scan's worth of capture, called from content.ts's mutation scan — which
 *  is to say: on every screen the reader scrolls into view, and nowhere else. */
export function handSweepScan(): void {
  const run = handRun;
  if (!run) return;
  if (handSweepActiveAt(run.session, Date.now()) === null) {
    void endHandRun();
    return;
  }
  // An auto harvest owns the page while it runs; two readers over the same
  // screens would file the same tweets under two runs.
  if (running) return;

  const onTarget = pageInHandSweep(location.href, run.session);
  if (onTarget !== run.onTarget) {
    run.onTarget = onTarget;
    announceHand();
  }
  if (!onTarget) return;

  const now = Date.now();
  const wait = HAND_SCAN_MIN_MS - (now - handScanAt);
  if (wait > 0) {
    if (handScanTrailing === null) {
      handScanTrailing = window.setTimeout(() => {
        handScanTrailing = null;
        handSweepScan();
      }, wait);
    }
    return;
  }
  handScanAt = now;

  // Same reason as the auto harvest's per-sweep call: X swaps a tweet's text for
  // a machine translation in place, and an unreverted one lands in the corpus as
  // English, unmarked. Fire-and-forget — the click's own mutation brings us back
  // here within a frame or two, well inside the flush window, and the store
  // overwrites the row with the original before it ships.
  void revealOriginals();

  const added = run.ctx.mode === 'posts' ? harvestPosts(run.ctx.ctx) : harvestReplies(run.ctx.ctx);
  if (added === 0) return;
  run.rows += added;
  noteHandRange(run);
  writeHandStats(run);
  scheduleHandFlush(run);
  announceHand();
}

function armHandRun(session: HandSweepSession, seed: HandSweepStats | null): void {
  // A re-arm over a live run (a second Start, a session swapped in another tab)
  // hands the old one off to `endHandRun` first: its timers are cleared and its
  // unshipped rows drained against the run they belong to, rather than leaking
  // with the reference that owned them.
  if (handRun) void endHandRun();

  const base = {
    profile: session.handle,
    window: null,
    oldestSeenMs: null,
    minViews: undefined,
  };
  handRun = {
    session,
    ctx:
      session.mode === 'replies'
        ? { mode: 'replies', ctx: { ...base, store: {} } }
        : { mode: 'posts', ctx: { ...base, store: {} } },
    sent: new Set<string>(),
    rows: seed?.rows ?? 0,
    saved: seed?.saved ?? 0,
    oldest: seed?.oldest ?? null,
    runId: seed?.runId ?? null,
    error: null,
    onTarget: false,
    stopped: false,
    flushTimer: null,
    inFlight: null,
    statsAt: 0,
  };
  announceHand();
  // Capture what is already on screen instead of waiting for the first scroll —
  // pressing Start on a screenful of posts has to move the counter.
  handScanAt = 0;
  handSweepScan();
}

async function endHandRun(): Promise<void> {
  const run = handRun;
  if (!run) return;
  handRun = null;
  run.stopped = true;
  if (run.flushTimer !== null) window.clearTimeout(run.flushTimer);
  run.flushTimer = null;
  if (handScanTrailing !== null) window.clearTimeout(handScanTrailing);
  handScanTrailing = null;
  announceHand();

  // The counter runs up to one flush window ahead of the ledger by design, so a
  // stop has to drain what the timer never got to.
  if (run.inFlight) await run.inFlight.catch(() => undefined);
  for (let i = 0; i < HAND_DRAIN_BATCHES && handPendingIds(run).length > 0; i++) {
    await flushHandRun(run);
    if (run.error !== null) break; // the service is down — retrying now won't fix it
  }
  writeHandStats(run, true);
}

/** Stop from the page (the HUD's ✕). Removing the arm is the whole stop: the
 *  onChanged listener below ends the run in this tab and in every other one. */
export async function stopHandSweep(): Promise<void> {
  await chrome.storage.local.remove(HAND_SWEEP_KEY);
}

export function initHandSweep(): void {
  void chrome.storage.local
    .get([HAND_SWEEP_KEY, HAND_SWEEP_STATS_KEY])
    .then((out) => {
      const session = handSweepActiveAt(out[HAND_SWEEP_KEY], Date.now());
      if (!session) return;
      // Reloaded mid-sweep: the page's store is gone, the sweep is not. Seeding
      // from the mirror keeps the counter climbing instead of restarting at zero
      // and keeps the rows landing in the SAME harvest run. Tweets seen before
      // the reload are captured again — harvest_rows is a longitudinal series,
      // not a set, and a second row for one tweet is a second measurement.
      armHandRun(session, parseHandSweepStats(out[HAND_SWEEP_STATS_KEY], session.startedAt));
    })
    .catch(() => {
      /* not armed — the safe state */
    });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const change = changes[HAND_SWEEP_KEY];
    if (!change) return;
    const session = handSweepActiveAt(change.newValue, Date.now());
    if (!session) {
      void endHandRun();
      return;
    }
    // Re-arming the same session (another tab's write echoing back) must not
    // throw away this tab's store and re-ship everything in it.
    if (handRun && handRun.session.startedAt === session.startedAt) return;
    armHandRun(session, null);
  });
}
