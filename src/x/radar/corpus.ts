// The sighting corpus (RA.1) — the pure half of `POST /x/radar/sightings`:
// what a wire row has to look like, and what a re-sighting does to a row that
// is already stored. No db import and no clock of its own (every function takes
// `nowMs`), so the rules are unit-testable and the route stays transport.
//
// Twin of two existing modules, one on each side of the wire: `parseIngestRow`
// in `routes/harvest.ts` (the passive-harvest parser) and `mergeSightings` in
// `extension/src/shared/radar.ts` (the page's own queue merge). Where the two
// could disagree this file follows the extension — it is merging the same
// sightings, one storage layer down — and the band ratchet is not re-stated at
// all: it is imported from `src/shared/radarSweep.ts` (§7.27).

import { type RadarBandName, bandStickiness } from '../../shared/radarSweep.ts';

const TWEET_ID_RE = /^\d{1,32}$/;
const USERNAME_RE = /^[A-Za-z0-9_]{1,15}$/;

/** Snippet ceiling, matching what the page already clips to. Storage bound, not
 *  a judgement: 2,000 rows/day × 60 days at this width is ~30 MB worst case. */
export const SIGHTING_TEXT_MAX = 500;
/** `source_path` is a pathname, so anything near this length is junk. */
export const SIGHTING_PATH_MAX = 200;
const SIGHTING_URL_MAX = 300;
const SIGHTING_NAME_MAX = 120;
/** One year in minutes. An `ageMin` past this is a parse bug, not an old post. */
const MAX_AGE_MIN = 525_600;

const BANDS: readonly string[] = ['manual', 'roster', 'cannon', 'sweep'];

/** One sighting as the extension ships it. `null` on the optional fields means
 *  unknown (§7.11) — the caller omitted it, which is NOT `0`/`false`. */
export interface SightingWireRow {
  tweetId: string;
  url: string | null;
  handle: string;
  author: string | null;
  text: string;
  band: RadarBandName;
  views: number;
  replies: number;
  likes: number | null;
  bait: boolean;
  verified: boolean | null;
  ageMin: number;
  seenAt: Date;
  sourcePath: string | null;
}

/** Validate one wire row, or name the field that failed.
 *
 *  Rejection is by FIELD (`handle_invalid`), not by row, because the route
 *  reports the offending `index` alongside and a client that ships 100 rows a
 *  minute needs to know which of its readers drifted. `nowMs` is a parameter
 *  rather than a `Date.now()` call so `seenAt`'s default and its clamp are
 *  testable; it is also the reason nothing here reads a clock. */
export function parseSightingWireRow(
  value: unknown,
  nowMs: number = Date.now(),
): SightingWireRow | { error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'row_invalid' };
  const v = value as Record<string, unknown>;

  const tweetId = typeof v.tweetId === 'string' ? v.tweetId.trim() : '';
  if (!TWEET_ID_RE.test(tweetId)) return { error: 'tweetId_invalid' };

  const handle = normalizeHandle(v.handle);
  if (!handle) return { error: 'handle_invalid' };

  // Empty text is legitimate (an image-only tweet), so only the type is a
  // rejection — the same call `parseIngestRow` makes.
  if (typeof v.text !== 'string') return { error: 'text_invalid' };
  const text = v.text.trim().slice(0, SIGHTING_TEXT_MAX);

  const band = coerceBand(v.band);
  if (!band) return { error: 'band_invalid' };

  const views = reqInt(v.views);
  if (views === null) return { error: 'views_invalid' };
  const replies = reqInt(v.replies);
  if (replies === null) return { error: 'replies_invalid' };

  const likes = optInt(v.likes);
  if (likes === false) return { error: 'likes_invalid' };

  if (typeof v.bait !== 'boolean') return { error: 'bait_invalid' };

  // Inlined rather than helper'd: a tri-state where one of the states IS
  // `false` cannot borrow the `false`-means-invalid sentinel the others use.
  let verified: boolean | null = null;
  if (v.verified !== undefined && v.verified !== null) {
    if (typeof v.verified !== 'boolean') return { error: 'verified_invalid' };
    verified = v.verified;
  }

  const ageMin = reqInt(v.ageMin);
  if (ageMin === null || ageMin > MAX_AGE_MIN) return { error: 'ageMin_invalid' };

  // Absent = now. A client clock ahead of ours would otherwise write a sighting
  // in the future, which reads as "newer" forever and freezes the row's metrics.
  let seenMs = nowMs;
  if (v.seenAt !== undefined && v.seenAt !== null && v.seenAt !== '') {
    if (typeof v.seenAt !== 'string') return { error: 'seenAt_invalid' };
    const parsed = Date.parse(v.seenAt);
    if (!Number.isFinite(parsed)) return { error: 'seenAt_invalid' };
    seenMs = Math.min(parsed, nowMs);
  }

  const url = optText(v.url, SIGHTING_URL_MAX);
  if (url === false) return { error: 'url_invalid' };
  const author = optText(v.author, SIGHTING_NAME_MAX);
  if (author === false) return { error: 'author_invalid' };

  // A PATH, kept verbatim past the leading slash — the client sends
  // `new URL(tab.url).pathname`. A full URL is refused rather than trimmed
  // down: it would mean the client sent the wrong thing, and silently
  // rewriting it is how "/home" and "https://x.com/home" become two answers to
  // "where do I sweep".
  const sourcePath = optText(v.sourcePath, SIGHTING_PATH_MAX);
  if (sourcePath === false) return { error: 'sourcePath_invalid' };
  if (sourcePath !== null && !sourcePath.startsWith('/')) return { error: 'sourcePath_invalid' };

  return {
    tweetId,
    url,
    handle,
    author,
    text,
    band,
    views,
    replies,
    likes,
    bait: v.bait,
    verified,
    ageMin,
    seenAt: new Date(seenMs),
    sourcePath,
  };
}

/** When the post actually went up. Derived once at capture and then frozen
 *  (see the column comment): `ageMin: 0` is a real answer — a post sighted the
 *  second it appeared — not a missing one, so this never returns null. */
export function derivePostedAt(seenAtMs: number, ageMin: number): Date {
  return new Date(seenAtMs - ageMin * 60_000);
}

/** The stored row, as much of it as the merge reads. */
export interface StoredSighting {
  url: string | null;
  author: string | null;
  text: string;
  band: string;
  views: number;
  replies: number;
  likes: number | null;
  bait: boolean;
  verified: boolean | null;
  postedAt: Date | null;
  sourcePath: string | null;
  lastSeenAt: Date;
  seenCount: number;
}

/** The column patch a re-sighting produces. `first_seen_at` is deliberately
 *  absent: where and when a tweet FIRST entered the queue is the fact this
 *  table exists to keep, and an update that could move it is one bad clock away
 *  from erasing it. */
export interface SightingPatch {
  url: string | null;
  author: string | null;
  text: string;
  band: RadarBandName;
  views: number;
  replies: number;
  likes: number | null;
  bait: boolean;
  verified: boolean | null;
  postedAt: Date | null;
  sourcePath: string | null;
  lastSeenAt: Date;
  seenCount: number;
}

/** Fold a fresh sighting into the stored row.
 *
 *  Three rules, and each one is a different §7 clause:
 *
 *  1. **Fill-only** (§7.9/§7.11) for `url`/`author`/`verified`/`sourcePath`/
 *     `posted_at` — a stored value is never overwritten. Four of the five are
 *     facts about the tweet or about where it first entered, and the fifth
 *     (`verified`) is what the capture that ADMITTED this row read; a
 *     re-sighting off a collapsed card that could not find the badge must not
 *     be able to rewrite the reason the sweep let it in.
 *  2. **Metrics move only for a newer sighting.** The client throttles per
 *     tweet, not per batch, and batches retry — so rows do arrive out of order,
 *     and an older capture rewinding views/replies is the one way this table
 *     lies about a curve. `likes` additionally keeps the stored value when the
 *     newer sighting could not read one (the page's own rule).
 *  3. **The band ratchets**, by the shared `bandStickiness` — never by a copy. */
export function mergeSightingRow(
  existing: StoredSighting,
  incoming: SightingWireRow,
): SightingPatch {
  // `>=`, not `>`: a tie is two reads of the same card in the same millisecond,
  // and it resolves to the incoming one — the same "the fresher copy wins"
  // tie-break the batch dedup and the band ratchet already use. Only a STRICTLY
  // older sighting is held back, which is the case this guard exists for.
  const newer = incoming.seenAt.getTime() >= existing.lastSeenAt.getTime();
  // An unreadable stored band (a hand-edited row) resolves to the incoming one
  // rather than blocking the upgrade — the lenient direction, matching the
  // legacy folding the parser already does.
  const storedBand = coerceBand(existing.band) ?? incoming.band;
  const band =
    bandStickiness(storedBand) > bandStickiness(incoming.band) ? storedBand : incoming.band;

  return {
    url: existing.url ?? incoming.url,
    author: existing.author ?? incoming.author,
    verified: existing.verified ?? incoming.verified,
    sourcePath: existing.sourcePath ?? incoming.sourcePath,
    postedAt: existing.postedAt ?? derivePostedAt(incoming.seenAt.getTime(), incoming.ageMin),
    text: newer ? incoming.text : existing.text,
    views: newer ? incoming.views : existing.views,
    replies: newer ? incoming.replies : existing.replies,
    bait: newer ? incoming.bait : existing.bait,
    likes: newer ? (incoming.likes ?? existing.likes) : existing.likes,
    band,
    lastSeenAt: newer ? incoming.seenAt : existing.lastSeenAt,
    // "Times the algorithm put this in front of me" — so every accepted
    // re-sighting counts, including one that moved no metric.
    seenCount: existing.seenCount + 1,
  };
}

// ------------------------------------------------------------------ helpers

/** The 4-union, plus the two dead classifier verdicts an extension build older
 *  than RS.2 may still hold in its buffer. The page already folds those onto
 *  'sweep'; being lenient here too is what stops one stale tab 400ing every
 *  batch it ships. */
function coerceBand(value: unknown): RadarBandName | null {
  if (typeof value !== 'string') return null;
  const b = value.trim().toLowerCase();
  if (b === 'hot' || b === 'warm') return 'sweep';
  return BANDS.includes(b) ? (b as RadarBandName) : null;
}

function normalizeHandle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const h = value.trim().replace(/^@/, '').toLowerCase();
  return USERNAME_RE.test(h) ? h : null;
}

function reqInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

/** `null` = absent (a legitimate unknown, §7.11); `false` = present but
 *  unusable, which the caller turns into a `{field}_invalid`. Split this way
 *  because absent and malformed are different client bugs, and only one of them
 *  is a bug at all — `0 !== false`, so a real zero still reads as a value. */
function optInt(value: unknown): number | null | false {
  if (value === undefined || value === null) return null;
  const n = reqInt(value);
  return n === null ? false : n;
}

/** Optional trimmed string: `null` = absent or empty, `false` = wrong type or
 *  too long. Clamping silently would let a 4 KB "url" through as data. */
function optText(value: unknown, max: number): string | null | false {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return false;
  const s = value.trim();
  if (s === '') return null;
  return s.length > max ? false : s;
}
