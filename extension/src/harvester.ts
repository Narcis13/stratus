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
  isHarvestContextRequest,
  isRepliesPath,
  passesMinViews,
  profileHandleFromUrl,
} from './shared/harvest.ts';
import type { ApiRequest, ApiResponse } from './shared/messages.ts';
import { parseMetricsAria, reportUnparsed } from './shared/metricsAria.ts';

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

function scopeWindow(scope: HarvestScope): DayWindow | null {
  if (scope === 'today') return dayWindow(0);
  if (scope === 'yesterday') return dayWindow(1);
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
  toIngest: (profile: string, store: Record<string, R>) => HarvestIngestRow[],
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
        if (stable >= cfg.stableNeeded) break; // bottom reached, no new content
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
    ingest = await shipToStratus(profile, mode, options.scope, toIngest(profile, ctx.store));
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

function currentContext(): HarvestContextResult {
  return {
    ok: true,
    url: location.href,
    handle: profileHandleFromUrl(location.href),
    onReplies: isRepliesPath(location.href),
    loggedIn: document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]') !== null,
  };
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
      const opts = cmd.options;
      const run =
        opts.mode === 'replies'
          ? runHarvest<ReplyRow>(
              'replies',
              opts,
              harvestReplies,
              repliesCSV,
              (profile, store) => repliesIngestRows(profile, store),
              (r) => r.r_time,
              emit,
              shouldCancel,
            )
          : runHarvest<PostRow>(
              'posts',
              opts,
              harvestPosts,
              postsCSV,
              (_profile, store) => postsIngestRows(store),
              (r) => r.time,
              emit,
              shouldCancel,
            );

      void run
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
