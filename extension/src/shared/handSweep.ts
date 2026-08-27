// Hand sweep (HS.1) — the Harvest tab's second engine: the same DOM read as the
// auto harvest, driven by YOUR scrolling instead of by the scroll robot.
//
// Why it exists: the auto harvest owns the page. It scrolls, it paces itself,
// and while it runs the tab is unusable — which is the right trade for "collect
// @someone's last 800 posts", and the wrong one for "I'm reading this profile
// anyway, keep what I scroll past". A hand sweep is armed from the panel, and
// from then on every screen the user scrolls into view is harvested and shipped
// in the background. $0 either way: DOM reads plus POSTs to the local service.
//
// This module is the pure, unit-testable core — the two storage keys, the armed
// session, the page gate and the labels. The DOM read lives in harvester.ts
// (which reuses `harvestPosts`/`harvestReplies` verbatim, §7.27: one reader, not
// two) and the on-page HUD in content.ts.
//
// Two keys, one writer each — the §7.24 discipline applied to a control:
//   `harvest:handSweep`        the ARM. Written by the panel only; the page
//                              reads it, and removes it (Stop from the HUD).
//   `harvest:handSweep:stats`  the PROGRESS. Written by the page only; the panel
//                              reads it to mirror the HUD's numbers.
// Stats carry the `startedAt` of the session they belong to, so a stale blob
// from a previous sweep can never be read as this one's progress.

import { type HarvestMode, isAtTarget, isXUrl, profileHandleFromUrl } from './harvest.ts';

/** A hand sweep collects what a timeline shows, so it has exactly the two
 *  timeline modes — `following` is a list page with no metrics and no date axis,
 *  and its ledger semantics need a COMPLETE scroll (only a run that reached the
 *  bottom may mark people `gone`), which a human-paced sweep never promises. */
export type HandSweepMode = Extract<HarvestMode, 'posts' | 'replies'>;

export const HAND_SWEEP_KEY = 'harvest:handSweep';
export const HAND_SWEEP_STATS_KEY = 'harvest:handSweep:stats';

// Opening guesses (§7.19), all three:
//   90 min  — a sweep is a reading session, not a subscription. The radar's
//             sweep expires at 30 because it FILTERS into a queue you then have
//             to work; this one only stores rows, so it can be longer. The
//             honest signal that it is wrong is re-arming mid-read.
//   4 s     — the passive tap's 5s flush, one notch tighter: this is a
//             deliberate action with a visible counter, so "saved" should trail
//             "captured" by about a scroll tick.
//   200     — the auto harvest's own INGEST_CHUNK. The server caps at 500.
export const HAND_SWEEP_MINUTES = 90;
export const HAND_SWEEP_FLUSH_MS = 4000;
export const HAND_SWEEP_BATCH_MAX = 200;

/** The armed session. Shaped like `SweepSession` (radarSweep.ts) on purpose —
 *  same expiry-resolved-on-every-read contract — plus what it targets. */
export interface HandSweepSession {
  /** lowercase, no `@` */
  handle: string;
  mode: HandSweepMode;
  startedAt: string;
  expiresAt: string;
}

/** Progress, mirrored for the panel. `rows` counts what the page CAPTURED and
 *  `saved` what the server ACCEPTED; they differ while a flush is in flight and
 *  stay apart when one failed, which is the whole point of showing both. */
export interface HandSweepStats {
  startedAt: string;
  rows: number;
  saved: number;
  /** ISO of the oldest item captured — "how far back down the timeline did I
   *  get", the one thing a reader cannot tell from the counter. */
  oldest: string | null;
  runId: string | null;
  updatedAt: string;
  /** Last flush failure code, or null. */
  error: string | null;
}

export function startHandSweepSession(
  handle: string,
  mode: HandSweepMode,
  nowMs: number,
  minutes: number = HAND_SWEEP_MINUTES,
): HandSweepSession {
  return {
    handle: handle.toLowerCase(),
    mode,
    startedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + minutes * 60_000).toISOString(),
  };
}

/** The one resolver. Every reader — page, HUD, panel — goes through it on every
 *  read rather than caching an `armed` boolean: a backgrounded side panel gets
 *  its timers throttled, and a cached flag would keep claiming a sweep the page
 *  itself stopped honouring minutes ago. */
export function handSweepActiveAt(raw: unknown, nowMs: number): HandSweepSession | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.handle !== 'string' || o.handle === '') return null;
  if (o.mode !== 'posts' && o.mode !== 'replies') return null;
  if (typeof o.startedAt !== 'string' || typeof o.expiresAt !== 'string') return null;
  const expiresMs = Date.parse(o.expiresAt);
  if (!Number.isFinite(expiresMs) || expiresMs <= nowMs) return null;
  return {
    handle: o.handle.toLowerCase(),
    mode: o.mode,
    startedAt: o.startedAt,
    expiresAt: o.expiresAt,
  };
}

/** Minutes left, rounded up so a live sweep never reads "0m left". */
export function handSweepMinutesLeft(session: HandSweepSession, nowMs: number): number {
  return Math.max(0, Math.ceil((Date.parse(session.expiresAt) - nowMs) / 60_000));
}

/** Progress for `session`, or null when the blob is missing, malformed, or
 *  belongs to an earlier sweep. Lenient per field (the `parseHarvestForm`
 *  discipline): a stats blob written by an older build still renders. */
export function parseHandSweepStats(raw: unknown, startedAt: string): HandSweepStats | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.startedAt !== startedAt) return null;
  const num = (v: unknown): number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
  const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
  return {
    startedAt,
    rows: num(o.rows),
    saved: num(o.saved),
    oldest: str(o.oldest),
    runId: str(o.runId),
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : '',
    error: str(o.error),
  };
}

/** What a URL can be swept as, or null when it is not a sweepable timeline.
 *  The mode comes from the PAGE, never from the panel's mode tabs: a sweep
 *  harvests what is already on screen, and a session whose mode disagreed with
 *  the open tab would arm and then sit paused forever.
 *
 *  Built on `isAtTarget` — the same function the page gate uses — so "the button
 *  was enabled" and "the page is being swept" can never disagree. `/media`,
 *  `/highlights`, `/following` and a status page all answer null. */
export function handSweepTargetFor(url: string): { handle: string; mode: HandSweepMode } | null {
  // The host check is this function's own, not `isAtTarget`'s: the page gate
  // runs inside a content script that only exists on x.com, but the panel asks
  // this about whatever tab happens to be active.
  if (!isXUrl(url)) return null;
  const handle = profileHandleFromUrl(url)?.toLowerCase();
  if (!handle) return null;
  if (isAtTarget(url, handle, 'replies')) return { handle, mode: 'replies' };
  if (isAtTarget(url, handle, 'posts')) return { handle, mode: 'posts' };
  return null;
}

/** True when this page is the session's own timeline. Off-target the sweep goes
 *  quiet rather than ending: opening a tweet and coming back is normal reading,
 *  and a sweep that died on the first click would be useless. */
export function pageInHandSweep(url: string, session: HandSweepSession): boolean {
  return isAtTarget(url, session.handle, session.mode);
}

/** "replies", "post" — what a sweep of this mode collects, counted. Split from
 *  the label below because the HUD sets the number in its own type size. */
export function handSweepNoun(rows: number, mode: HandSweepMode): string {
  if (mode === 'replies') return rows === 1 ? 'reply' : 'replies';
  return rows === 1 ? 'post' : 'posts';
}

/** "128 replies", "1 post" — the panel's line, and the HUD's accessible name. */
export function handSweepCountLabel(rows: number, mode: HandSweepMode): string {
  return `${rows} ${handSweepNoun(rows, mode)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Compact date for the HUD: "3 Aug", or "3 Aug 2025" once the year differs
 *  from the reading's own. Hand-formatted rather than `toLocaleDateString` so
 *  the overlay reads the same on every machine (and so it is testable) — the
 *  panel, which is stratus's own surface, keeps using the locale formatter. */
export function handSweepDateLabel(iso: string | null, nowMs: number): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  const stamp = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === new Date(nowMs).getFullYear() ? stamp : `${stamp} ${d.getFullYear()}`;
}
