// The sighting corpus — the pure half of the `/x/radar/sightings` routes.
//
// RA.1, the WRITE half: what a wire row has to look like, and what a
// re-sighting does to a row that is already stored. RA.3, the READ half:
// `buildSightingViews` turns stored rows into the answers only the server can
// give (`vpm`, `admitted`, `worked`, `stage`, `isTarget` — none of them a
// column, §7.12/§7.16) and `summarizeSightings` counts them. RA.4 adds
// `composeDraftSignals`, the same corpus read one step further on: what a stored
// sighting looks like as the `signals` blob a draft row has to carry.
//
// No db import and no clock of its own (the write half takes `nowMs`, the read
// half derives every age from the rows' own timestamps), so the rules are
// unit-testable and the routes stay transport.
//
// Twin of two existing modules, one on each side of the wire: `parseIngestRow`
// in `routes/harvest.ts` (the passive-harvest parser) and `mergeSightings` in
// `extension/src/shared/radar.ts` (the page's own queue merge). Where the two
// could disagree this file follows the extension — it is merging the same
// sightings, one storage layer down — and the band ratchet is not re-stated at
// all: it is imported from `src/shared/radarSweep.ts` (§7.27).

import {
  type RadarBandName,
  type SweepConfig,
  bandStickiness,
  passesSweep,
} from '../../shared/radarSweep.ts';
import type { TweetSignals } from '../../shared/replyBand.ts';

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
 *  from erasing it.
 *
 *  `dismissedAt` is OPTIONAL and only ever `null` — the key is present only on
 *  a `manual` re-pin, which clears the tombstone. Absent is not the same as
 *  `undefined`: an absent key writes no column at all, which is what leaves a
 *  dismissal standing across every ordinary re-sighting. */
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
  dismissedAt?: null;
}

/** Fold a fresh sighting into the stored row.
 *
 *  Four rules, and each one is a different §7 clause:
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
 *  3. **The band ratchets**, by the shared `bandStickiness` — never by a copy.
 *  4. **A dismissal survives every re-sighting except a `manual` one.** The
 *     content script re-sights a rendered tweet for as long as it is on screen,
 *     so a tombstone that any capture could clear would not be a tombstone at
 *     all; a ⊕ pin is the human changing their mind, and it is the only thing
 *     that puts the row back in the queue. The extension's `mergeSightings`
 *     makes exactly this exception one storage layer up. */
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
    // Spread, not `dismissedAt: incoming.band === 'manual' ? null : undefined`:
    // drizzle writes an explicitly-`undefined` key as nothing on some paths and
    // as NULL on others, and this rule cannot depend on which.
    ...(incoming.band === 'manual' ? { dismissedAt: null } : {}),
  };
}

// --------------------------------------------------------- the reader (RA.3)

/** One stored sighting as the reader pulls it back out. Wider than
 *  `StoredSighting` (which is only what the merge reads) and deliberately a
 *  separate interface: the merge must never grow a dependency on a column it
 *  has no business folding. `band` is free text here for the same reason it is
 *  free text in the column — a row written by an older build can hold a legacy
 *  verdict, and a reader that typed it as the union would be making a claim the
 *  table cannot keep. */
export interface StoredSightingRow {
  tweetId: string;
  url: string | null;
  handle: string;
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
  firstSeenAt: Date;
  lastSeenAt: Date;
  seenCount: number;
}

/** What `people` says about this handle. Passed in rather than resolved here so
 *  the retired rule (below) lives in the tested pure layer, not in the route. */
export interface SightingPerson {
  stage: string;
  retired: boolean;
}

/** Everything the view needs that is NOT on the sighting row. All four are the
 *  server's own answers (§7.16) — none of them is ever accepted from a client,
 *  and none is a column (§7.12). */
export interface SightingViewContext {
  /** Tweet ids with a `radar_drafts` row of ANY status. */
  drafted: ReadonlySet<string>;
  /** Tweet ids with a POSTED `reply_drafts` row — the paste actually happened. */
  replied: ReadonlySet<string>;
  /** Lowercased handle → the people-layer row, when there is one. */
  people: ReadonlyMap<string, SightingPerson>;
  /** The 2–10x target roster, lowercased (`loadTargetHandles()`). */
  targets: ReadonlySet<string>;
}

/** One sighting, enriched with every read-time answer. Dates are ISO strings
 *  so the shape is the wire shape and a unit test asserts what the caller gets. */
export interface SightingView {
  tweetId: string;
  /** Null = the capture never read a permalink (§7.11). Deliberately NOT
   *  back-filled with `https://x.com/<handle>/status/<id>`: unknown is a fact
   *  about the capture, and a synthesised URL would erase it. */
  url: string | null;
  handle: string;
  author: string | null;
  text: string;
  band: string;
  views: number;
  replies: number;
  likes: number | null;
  bait: boolean;
  verified: boolean | null;
  /** Minutes between the post going up and the LAST time the queue saw it.
   *  Null when `posted_at` is unknown (a hand-written row — the ingest always
   *  derives one). */
  ageMinAtLastSeen: number | null;
  /** Views per minute at that same moment, 2dp. Null with the age. */
  vpm: number | null;
  /** Would TODAY's sweep filters have admitted this capture? Judged at the age
   *  the row had when it was last seen — the same reading `deriveTimelineBucket`
   *  takes over the passive corpus, and for the same reason: a post is only ever
   *  replyable at the moment it was in front of you, so judging it at "now"
   *  would make every row older than `maxAgeMin` read false and say nothing.
   *
   *  Unlike the funnel this does NOT force `verifiedOnly` off — `verified` is
   *  stored here, so the badge gate is evaluated exactly as configured and the
   *  answer is exact rather than approximate. `null` = unjudgeable (no age).
   *
   *  The two CONTENT gates (media, ads) are the funnel's case, not this one:
   *  `radar_sightings` carries no media or promoted column, so they are forced
   *  off rather than guessed. The consequence, stated so it isn't discovered:
   *  with the media gate set to `with`/`without`, this flag can read `true` for
   *  a stored row a live sweep would refuse today. It answers "would the METRIC,
   *  age and badge filters admit this", which is what it has always answered. */
  admitted: boolean | null;
  drafted: boolean;
  replied: boolean;
  /** Drafted OR replied — "I have already done something about this one". */
  worked: boolean;
  /** The CRM stage, or null when unknown. A RETIRED person reads null too: they
   *  have no current stage, which is the `GET /harvest/affinity` rule verbatim. */
  stage: string | null;
  isTarget: boolean;
  sourcePath: string | null;
  postedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  seenCount: number;
}

/** Views per minute, 2dp. ONE copy of the formula: the view's `vpm` field, the
 *  `signals.vpm` a composed draft carries (RA.4) and any later reader all read
 *  the same number for the same row, which they would not if each spelled out
 *  `views / max(ageMin, 1)` itself. `max(…, 1)` is what keeps a post sighted in
 *  its first minute from reading as infinite velocity. */
export function sightingVpm(views: number, ageMin: number): number {
  return round2(views / Math.max(ageMin, 1));
}

/** The `signals` blob a composed draft carries (RA.4) — the classifier inputs a
 *  live Radar capture would have attached, rebuilt from the stored sighting.
 *
 *  `ageMin` is recomputed at COMPOSE time and is deliberately NOT the view's
 *  `ageMinAtLastSeen`: `POST /radar/drafts/:tweetId/confirm` derives the source
 *  post time back out as `draftedAt − ageMin`, so a draft written six hours
 *  after the last sighting would place the post six hours late — and the
 *  Playbook's latency reader would believe it.
 *
 *  `posted_at` is null only on a hand-written row (the ingest always derives
 *  one). It then falls back to the age since the LAST SIGHTING — a lower bound,
 *  since the post demonstrably existed at that moment — rather than to null,
 *  because a null `signals` makes the whole draft invisible to
 *  `draftRowToSighting` (D186): a defensible age beats a row the panel drops. */
export function composeDraftSignals(row: StoredSightingRow, nowMs: number): TweetSignals {
  const from = row.postedAt ?? row.lastSeenAt;
  const ageMin = Math.max(0, Math.round((nowMs - from.getTime()) / 60_000));
  return {
    views: row.views,
    replies: row.replies,
    ageMin,
    vpm: sightingVpm(row.views, ageMin),
    bait: row.bait,
  };
}

/** Enrich stored rows into views. Pure — the clock only enters through the
 *  rows' own timestamps, so `admitted` is reproducible from a fixture. */
export function buildSightingViews(
  rows: readonly StoredSightingRow[],
  cfg: SweepConfig,
  ctx: SightingViewContext,
): SightingView[] {
  return rows.map((r) => {
    const ageMinAtLastSeen =
      r.postedAt === null
        ? null
        : Math.max(0, Math.round((r.lastSeenAt.getTime() - r.postedAt.getTime()) / 60_000));
    const drafted = ctx.drafted.has(r.tweetId);
    const replied = ctx.replied.has(r.tweetId);
    const person = ctx.people.get(r.handle);
    return {
      tweetId: r.tweetId,
      url: r.url,
      handle: r.handle,
      author: r.author,
      text: r.text,
      band: r.band,
      views: r.views,
      replies: r.replies,
      likes: r.likes,
      bait: r.bait,
      verified: r.verified,
      ageMinAtLastSeen,
      vpm: ageMinAtLastSeen === null ? null : sightingVpm(r.views, ageMinAtLastSeen),
      admitted:
        ageMinAtLastSeen === null
          ? null
          : passesSweep(
              {
                views: r.views,
                // Unknown likes read as 0 — the LENIENT direction, opposite to
                // `verified` above it, and it is the page's own reading: the
                // capture passes `cap.likes`, which is 0 when X renders no like
                // count. Failing on unknown here would filter out exactly the
                // quiet posts the sweep exists to find.
                likes: r.likes ?? 0,
                replies: r.replies,
                ageMin: ageMinAtLastSeen,
                verified: r.verified,
                hasMedia: null,
                promoted: false,
              },
              { ...cfg, media: 'any', excludeAds: false },
            ),
      drafted,
      replied,
      worked: drafted || replied,
      stage: person && !person.retired ? person.stage : null,
      isTarget: ctx.targets.has(r.handle),
      sourcePath: r.sourcePath,
      postedAt: r.postedAt === null ? null : r.postedAt.toISOString(),
      firstSeenAt: r.firstSeenAt.toISOString(),
      lastSeenAt: r.lastSeenAt.toISOString(),
      seenCount: r.seenCount,
    };
  });
}

/** The `source_path` bucket for a row that never recorded one. A real path
 *  always starts with '/', so this can never collide with one. */
export const SIGHTING_PATH_UNKNOWN = 'unknown';

/** COUNTS ONLY, deliberately — no rates (§7.19). A reply-rate over this corpus
 *  would be an inference needing the n≥20 gate, and `GET /playbook`'s
 *  `timelineFunnel` already owns the gated version of that question. */
export interface SightingSummary {
  /** The whole filtered population — `sightings[]` may be a `limit`ed slice of it. */
  total: number;
  admitted: number;
  worked: number;
  /** Admitted and NOT worked: the reply I could still have written. The finding. */
  unworkedAdmitted: number;
  byBand: Record<string, number>;
  bySourcePath: Record<string, number>;
  topHandles: { handle: string; sightings: number }[];
}

/** How many authors the summary names. A display bound, not a judgement. */
const SUMMARY_TOP_HANDLES = 10;

export function summarizeSightings(views: readonly SightingView[]): SightingSummary {
  const byBand: Record<string, number> = {};
  const bySourcePath: Record<string, number> = {};
  const byHandle = new Map<string, number>();
  let admitted = 0;
  let worked = 0;
  let unworkedAdmitted = 0;

  for (const v of views) {
    byBand[v.band] = (byBand[v.band] ?? 0) + 1;
    const path = v.sourcePath ?? SIGHTING_PATH_UNKNOWN;
    bySourcePath[path] = (bySourcePath[path] ?? 0) + 1;
    byHandle.set(v.handle, (byHandle.get(v.handle) ?? 0) + 1);
    if (v.admitted === true) admitted++;
    if (v.worked) worked++;
    if (v.admitted === true && !v.worked) unworkedAdmitted++;
  }

  const topHandles = [...byHandle.entries()]
    // Handle asc as the tie-break, so two authors with the same count come back
    // in the same order on every call (the list is read by a diffing agent).
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, SUMMARY_TOP_HANDLES)
    .map(([handle, sightings]) => ({ handle, sightings }));

  return {
    total: views.length,
    admitted,
    worked,
    unworkedAdmitted,
    byBand,
    bySourcePath,
    topHandles,
  };
}

// ------------------------------------------------------------------ helpers

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** The 4-union, plus the two dead classifier verdicts an extension build older
 *  than RS.2 may still hold in its buffer. The page already folds those onto
 *  'sweep'; being lenient here too is what stops one stale tab 400ing every
 *  batch it ships.
 *
 *  Exported since RA.4: the compose route has to narrow the stored band (free
 *  text in the column, on purpose) before stamping it onto a draft row, and a
 *  third copy of "a legacy verdict means sweep" is exactly the fork §7.27
 *  forbids. */
export function coerceBand(value: unknown): RadarBandName | null {
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
