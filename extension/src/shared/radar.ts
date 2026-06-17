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

export type RadarBand = 'hot' | 'warm';

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
    // Re-sighting from the content script carries no reply — keep the one the
    // background attached earlier (incoming.reply wins only if it has one).
    const reply = s.reply ?? prev.reply;
    byId.set(
      s.tweetId,
      reply !== undefined
        ? { ...s, firstSeenAt: prev.firstSeenAt, reply }
        : { ...s, firstSeenAt: prev.firstSeenAt },
    );
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

// Queue order per the plan: band first (hot over warm), then views-per-minute,
// then recency.
export function rankSightings(sightings: RadarSighting[]): RadarSighting[] {
  return [...sightings].sort((a, b) => {
    if (a.band !== b.band) return a.band === 'hot' ? -1 : 1;
    if (a.signals.vpm !== b.signals.vpm) return b.signals.vpm - a.signals.vpm;
    return b.lastSeenAt.localeCompare(a.lastSeenAt);
  });
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
