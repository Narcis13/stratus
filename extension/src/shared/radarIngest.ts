// The sighting mirror (RA.2) — every row the Radar queue admits is shipped to
// `POST /x/radar/sightings` at capture time, so what the sweep admitted outlives
// the browser and is readable from a Claude Code session. $0: one local POST per
// report window over rows the page has already read.
//
// This module is the pure, unit-testable core (the per-tweet resend throttle,
// the sighting → wire-row mapping, the tab-URL → path read); the chrome
// plumbing lives in background.ts, which is the single writer of the buffer and
// the only owner of the auth transport (§7.24). Twin of
// `shared/passiveHarvest.ts`, one feed over.

import type { RadarBand, RadarSighting } from './radar.ts';

// Settings key, read straight from chrome.storage.local by the background (the
// HV.2 `passiveHarvest` precedent): default ON, only an explicit `false`
// disables. Deliberately NOT a server registry knob — a mirrored knob is seven
// edits and two exact-list tests for a switch only the human at the browser
// needs.
export const RADAR_SYNC_KEY = 'radarSightingSync';

// Cadence mirrors the server contract in `src/x/routes/radar.ts`: batches cap at
// its MAX_SIGHTING_BATCH and the resend window matches its
// SIGHTING_RECAPTURE_MS, so the wire doesn't carry rows the server would only
// count as skippedRecent. It is the THIRD copy of that window — `RADAR_RESEND_MS`
// in content.ts throttles one page's captures, this one throttles what reaches
// the wire from every tab at once (two tabs on x.com hold two independent
// content-side maps, and a page reload empties one), and the server has the
// final say. All three carry the same "unless the band changed" clause.
export const RADAR_INGEST_BATCH_MAX = 100;
export const RADAR_INGEST_RESEND_MS = 60_000;

// The four ceilings `src/x/radar/corpus.ts::parseSightingWireRow` enforces,
// **restated rather than imported** (§7.33 — the extension cannot import a
// server module, and this one lives under `src/x/`). Restating them is not
// belt-and-braces: the route parses every row BEFORE writing any and 400s the
// whole batch on the first bad one, while this client warns and drops. So a
// single unrepresentable row would silently cost up to 99 good ones. Keep these
// in step with the server's constants, or the mirror starts losing batches for a
// reason nothing logs.
const SIGHTING_URL_MAX = 300;
const SIGHTING_AUTHOR_MAX = 120;
export const SIGHTING_PATH_MAX = 200;
/** One year in minutes. The server treats anything past this as a parse bug and
 *  refuses the row; a ⊕ pin on a genuinely ancient tweet is the one case where
 *  that is a real post, and it is dropped from the MIRROR only — the queue keeps
 *  it and the reply flow is untouched. */
export const SIGHTING_MAX_AGE_MIN = 525_600;

const TWEET_ID_RE = /^\d{1,32}$/;
// Shape check only: the server owns the lowercasing and the leading-@ strip, so
// the optional @ is tolerated here exactly as it is there (§7.4c — reproduce the
// rule, never a proxy near it).
const HANDLE_RE = /^@?[A-Za-z0-9_]{1,15}$/;

/** One sighting as `POST /x/radar/sightings` accepts it. A local mirror of the
 *  server's `SightingWireRow` (build isolation, §5) — the same hand-sync the
 *  panel's settings types live with. `likes`/`verified` are absent when unread,
 *  never `undefined`-valued: absent is the wire's "unknown" (§7.11). */
export interface SightingWireInput {
  tweetId: string;
  url: string | null;
  handle: string;
  author: string | null;
  text: string;
  band: RadarBand;
  views: number;
  replies: number;
  likes?: number;
  bait: boolean;
  verified?: boolean;
  ageMin: number;
  seenAt: string;
  sourcePath: string | null;
}

/** What the background remembers about a tweet it already mirrored. */
export interface SightingSend {
  at: number;
  band: RadarBand;
}

/** Per-tweet resend throttle: ship when never sent, when the window elapsed, or
 *  when the band changed. The third arm is the one that matters — a ⊕ pin
 *  landing on a swept row, or a sweep admitting a roster capture on its numbers,
 *  is a real event and must not wait out a throttle meant for scroll noise. The
 *  server's own skip rule reads exactly this way. */
export function shouldShipSighting(
  sent: SightingSend | undefined,
  band: RadarBand,
  nowMs: number,
  resendMs: number = RADAR_INGEST_RESEND_MS,
): boolean {
  if (!sent) return true;
  if (sent.band !== band) return true;
  return nowMs - sent.at >= resendMs;
}

/** Map one buffered sighting onto the ingest wire row.
 *
 *  `null` when the row cannot be represented at all — the same answer
 *  `toPassiveIngestRow` gives an article with no permalink. Only the REQUIRED
 *  fields can force it: an optional field that doesn't fit is sent as `null`
 *  instead, because "unknown" is a legal value for those and losing a display
 *  name is not a reason to lose the sighting. */
export function toSightingWireRow(
  s: RadarSighting,
  sourcePath: string | null,
): SightingWireInput | null {
  if (!TWEET_ID_RE.test(s.tweetId)) return null;
  if (!HANDLE_RE.test(s.handle)) return null;

  const { views, replies, bait, ageMin } = s.signals;
  if (!isCount(views) || !isCount(replies)) return null;
  if (!isCount(ageMin) || ageMin > SIGHTING_MAX_AGE_MIN) return null;

  const row: SightingWireInput = {
    tweetId: s.tweetId,
    url: fits(s.url, SIGHTING_URL_MAX) ? s.url : null,
    handle: s.handle,
    author: fits(s.author, SIGHTING_AUTHOR_MAX) ? s.author : null,
    text: s.text,
    band: s.band,
    views,
    replies,
    bait,
    ageMin,
    // The capture time, not now: a report can sit behind a buffer write, and the
    // server's merge decides what is fresher off this field.
    seenAt: s.lastSeenAt,
    sourcePath: fits(sourcePath, SIGHTING_PATH_MAX) ? sourcePath : null,
  };
  // exactOptionalPropertyTypes: build without the key, never assign undefined.
  if (typeof s.likes === 'number') row.likes = s.likes;
  if (typeof s.verified === 'boolean') row.verified = s.verified;
  return row;
}

/** Where the sweep admitted this row, from the reporting tab. A chrome:// page,
 *  a discarded tab or an opaque URL is normal and answers `null` — the server
 *  stores that as "unknown" rather than refusing the sighting. */
export function pathFromTabUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const path = new URL(url).pathname;
    return fits(path, SIGHTING_PATH_MAX) && path.startsWith('/') ? path : null;
  } catch {
    return null;
  }
}

function isCount(n: number): boolean {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}

function fits(v: string | null | undefined, max: number): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= max;
}
