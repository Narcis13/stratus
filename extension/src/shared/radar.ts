// The Radar (OVERHAUL-PLAN §7.2) — band verdicts used to evaporate as you
// scrolled past them. The content script streams every hot/warm sighting to
// the background, which keeps a session-scoped ring buffer in
// chrome.storage.session; the side panel's Today tab renders it as a ranked
// worked queue. $0 — pure presentation of what the badge already computes.
//
// This module is the pure, unit-testable core (merge + cap + rank). The
// chrome plumbing lives in background.ts (single writer) and
// sidepanel/Radar.tsx (reader).

import type { TweetSignals } from '../replyBand.ts';
import type { ReplyVariant } from './types.ts';

export type RadarBand = 'hot' | 'warm';

// Who the author is, as far as the people layer knows (S0.3). A warm post from
// an ally/mutual compounds a real relationship; a hot post from a rando is a
// lottery ticket — so tier beats band/vpm in the queue order.
export type PersonTier = 'ally' | 'mutual' | 'target';

// One entry of GET /x/people/rankmap: the author's relationship stage (for
// stage ≥ engaged) plus whether they're in the current 2–10x targets roster.
// Keyed by lowercased handle. The background caches the whole map (10 min TTL)
// and derives each sighting's personTier from it.
export interface RankMapEntry {
  stage: string;
  isTarget: boolean;
}
export type RankMap = Record<string, RankMapEntry>;

export interface RadarSighting {
  tweetId: string;
  url: string;
  handle: string;
  author: string | null;
  text: string; // snippet, clipped at capture time
  band: RadarBand;
  signals: TweetSignals; // as measured at lastSeenAt — age keeps ticking after
  firstSeenAt: string;
  lastSeenAt: string;
  // Batch-drafted Grok reply (§7.2 Radar reply drafting), attached client-side
  // by the background after a "Draft replies" run. Survives re-sightings so a
  // drafted reply isn't wiped when the content script re-reports the tweet.
  reply?: string;
  // All 3 angle variants (RU.4) from the batch draft — extends/contrarian/debate.
  // `reply` stays the primary (variants[0].text); the full set rides for the
  // on-page variant chips (Task 7). Survives re-sightings like `reply`.
  variants?: ReplyVariant[];
  // ISO time the user clicked a reply-ready row (its reply was copied). A
  // clicked sighting leaves the live queue for the "Clicked" view so the queue
  // stays the not-yet-worked set. Survives re-sightings like `reply`.
  clickedAt?: string;
  // The reply_drafts row id (RU.6), stamped by the background after the confirm
  // endpoint promotes this radar draft into a measured reply row. The on-page
  // paste flow (RU.7) PATCHes it to `posted`. Survives re-sightings like `reply`.
  draftId?: string;
  // Roster tier of the author (S0.3), stamped by the background from the cached
  // rankmap after every buffer write — always re-derived, never merged, so a
  // stage change is reflected on the next write.
  personTier?: PersonTier;
}

// chrome.storage.session keys — cleared when the browser closes, which is
// exactly the queue's intended lifetime.
export const RADAR_SIGHTINGS_KEY = 'radar:sightings';
export const RADAR_DISMISSED_KEY = 'radar:dismissed';

export const RADAR_CAP = 100;
export const RADAR_DISMISSED_CAP = 500;

// Merge a report batch into the stored queue, keyed by tweetId: fresher
// signals/band/lastSeenAt win, firstSeenAt survives from the earlier entry.
// Dismissed ids never re-enter — the content script keeps re-sighting a tweet
// for as long as it's rendered, so a worked item must stay gone. Past the cap,
// least-recently-seen entries are evicted.
export function mergeSightings(
  existing: RadarSighting[],
  incoming: RadarSighting[],
  dismissed: string[],
): RadarSighting[] {
  const byId = new Map(existing.map((s) => [s.tweetId, s]));
  const gone = new Set(dismissed);
  for (const s of incoming) {
    if (gone.has(s.tweetId)) continue;
    const prev = byId.get(s.tweetId);
    if (!prev) {
      byId.set(s.tweetId, s);
      continue;
    }
    // Re-sighting from the content script carries no reply/clickedAt — keep the
    // ones the panel/background set earlier (incoming wins only if it has one).
    const reply = s.reply ?? prev.reply;
    const variants = s.variants ?? prev.variants;
    const clickedAt = s.clickedAt ?? prev.clickedAt;
    const draftId = s.draftId ?? prev.draftId;
    const merged: RadarSighting = { ...s, firstSeenAt: prev.firstSeenAt };
    if (reply !== undefined) merged.reply = reply;
    if (variants !== undefined) merged.variants = variants;
    if (clickedAt !== undefined) merged.clickedAt = clickedAt;
    if (draftId !== undefined) merged.draftId = draftId;
    byId.set(s.tweetId, merged);
  }
  const all = [...byId.values()];
  if (all.length <= RADAR_CAP) return all;
  all.sort((a, b) => a.lastSeenAt.localeCompare(b.lastSeenAt));
  return all.slice(all.length - RADAR_CAP);
}

// Append ids to the dismissed set; past the cap, the oldest dismissals fall
// off (their tweets are long out of the buffer anyway).
export function appendDismissed(dismissed: string[], ids: string[]): string[] {
  const merged = [...new Set([...dismissed, ...ids])];
  return merged.length <= RADAR_DISMISSED_CAP
    ? merged
    : merged.slice(merged.length - RADAR_DISMISSED_CAP);
}

// The roster tier for a rankmap entry (S0.3). ally/mutual are relationships
// worth compounding; a target is an in-band account worth building; everyone
// else is null. An entry can be a target below mutual stage (a saved voice
// author I've never talked to) — stage wins when it's ally/mutual, else the
// target flag decides.
export function personTierFor(entry: RankMapEntry | undefined): PersonTier | null {
  if (!entry) return null;
  if (entry.stage === 'ally') return 'ally';
  if (entry.stage === 'mutual') return 'mutual';
  if (entry.isTarget) return 'target';
  return null;
}

// Re-derive personTier on every sighting from the current rankmap. Returns a
// new array; only rows whose tier actually changed are cloned. Handles are
// matched case-insensitively (rankmap keys are lowercased people handles; a
// sighting's handle is the raw scraped username).
export function stampTiers(sightings: RadarSighting[], map: RankMap): RadarSighting[] {
  return sightings.map((s) => {
    const tier = personTierFor(map[s.handle.toLowerCase()]);
    if (tier === (s.personTier ?? null)) return s;
    // Rebuild without personTier when it clears — exactOptionalPropertyTypes
    // forbids assigning `undefined`, biome forbids `delete`.
    const { personTier: _prev, ...rest } = s;
    return tier ? { ...rest, personTier: tier } : rest;
  });
}

// Higher tier ranks first: ally/mutual (an existing relationship) beat a target,
// which beats an unknown author. ally and mutual share the top rung.
function tierWeight(t: PersonTier | undefined): number {
  if (t === 'ally' || t === 'mutual') return 2;
  if (t === 'target') return 1;
  return 0;
}

// Queue order (S0.3): who the author is first (roster tier), THEN band (hot over
// warm), then views-per-minute, then recency — the original order preserved
// within a tier.
export function rankSightings(sightings: RadarSighting[]): RadarSighting[] {
  return [...sightings].sort((a, b) => {
    const tw = tierWeight(b.personTier) - tierWeight(a.personTier);
    if (tw !== 0) return tw;
    if (a.band !== b.band) return a.band === 'hot' ? -1 : 1;
    if (a.signals.vpm !== b.signals.vpm) return b.signals.vpm - a.signals.vpm;
    return b.lastSeenAt.localeCompare(a.lastSeenAt);
  });
}

// A clicked sighting (its reply was copied) leaves the live queue for the
// "Clicked" view, most-recently-clicked first. The queue keeps the caller's
// existing rank.
export function splitClicked(ranked: RadarSighting[]): {
  queue: RadarSighting[];
  clicked: RadarSighting[];
} {
  const queue: RadarSighting[] = [];
  const clicked: RadarSighting[] = [];
  for (const s of ranked) (s.clickedAt ? clicked : queue).push(s);
  clicked.sort((a, b) => (b.clickedAt ?? '').localeCompare(a.clickedAt ?? ''));
  return { queue, clicked };
}

// Within the live queue, keep reply-ready and freshly-discovered tweets in
// separate blocks so they don't interleave. Order inside each block is the
// caller's rank.
export function groupQueue(queue: RadarSighting[]): {
  ready: RadarSighting[];
  fresh: RadarSighting[];
} {
  const ready: RadarSighting[] = [];
  const fresh: RadarSighting[] = [];
  for (const s of queue) (s.reply ? ready : fresh).push(s);
  return { ready, fresh };
}

// --- server rehydration (CIRCLES-PLAN C0) ---

// A radar_drafts row as GET /x/radar/drafts returns it (timestamps as ISO).
export interface RadarDraftRow {
  id: string;
  tweetId: string;
  url: string | null;
  handle: string;
  author: string | null;
  snippet: string;
  band: RadarBand | null;
  signals: TweetSignals | null;
  replyText: string;
  angle: string;
  // All 3 angle variants (RU.2 column); null on pre-feature / CLI-primary rows.
  // replyText/angle stay the primary (variants[0]).
  variants: ReplyVariant[] | null;
  status: 'ready' | 'clicked' | 'expired';
  draftedAt: string;
  createdAt: string;
}

// Rebuild a sighting from the server copy after a browser restart wiped the
// session buffer. Rows without band/signals (CLI-originated drafts) can't be
// ranked or given a "why" line, so they don't rehydrate. seen-at times are the
// draft time — displayAgeMin keeps ticking from there, same as a live capture.
export function draftRowToSighting(row: RadarDraftRow): RadarSighting | null {
  if (!row.band || !row.signals) return null;
  const s: RadarSighting = {
    tweetId: row.tweetId,
    url: row.url ?? `https://x.com/${row.handle}/status/${row.tweetId}`,
    handle: row.handle,
    author: row.author,
    text: row.snippet,
    band: row.band,
    signals: row.signals,
    firstSeenAt: row.draftedAt,
    lastSeenAt: row.draftedAt,
    reply: row.replyText,
  };
  if (row.variants && row.variants.length > 0) s.variants = row.variants;
  return s;
}

export function isRadarSightings(v: unknown): v is RadarSighting[] {
  if (!Array.isArray(v)) return false;
  return v.every((s) => {
    if (!s || typeof s !== 'object') return false;
    const r = s as Record<string, unknown>;
    return (
      typeof r.tweetId === 'string' &&
      typeof r.url === 'string' &&
      (r.band === 'hot' || r.band === 'warm') &&
      typeof r.signals === 'object' &&
      r.signals !== null
    );
  });
}
