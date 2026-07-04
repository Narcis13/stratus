// Passive hover capture (CIRCLES-PLAN C6) — when X renders a hover card
// because the user hovered naturally, the content script parses it and queues
// an upsert for POST /x/people/sightings. This module is the pure,
// unit-testable core (pending-merge + per-handle resend throttle — the radar.ts
// pattern); the DOM parsing and chrome plumbing live in content.ts.

export interface HoverCardData {
  displayName: string | null;
  bio: string | null;
  followersCount: number | null;
  followingCount: number | null;
  xUserId: string | null;
}

export interface PersonSighting {
  handle: string; // lowercased, no @
  card: HoverCardData;
  seenAt: string; // ISO
}

// Same cadence as radar reports: batch per 2s flush window, re-send a handle
// at most once a minute (the server's once-a-day event gate makes extra sends
// harmless, but they're wasted bytes).
export const SIGHTING_FLUSH_MS = 2000;
export const SIGHTING_RESEND_MS = 60_000;
export const SIGHTING_BATCH_MAX = 50;

/** True when a card carries at least one useful field — an all-null parse is
 *  a skeleton card still loading; the caller should retry on a later scan. */
export function cardHasData(card: HoverCardData): boolean {
  return (
    card.displayName !== null ||
    card.bio !== null ||
    card.followersCount !== null ||
    card.followingCount !== null ||
    card.xUserId !== null
  );
}

/** Merge a fresh sighting into the pending slot for its handle: the newer
 *  seenAt wins, but null fields backfill from the older card — X populates
 *  hover cards progressively, so two parses of one card may each hold half. */
export function mergePendingSighting(
  prev: PersonSighting | undefined,
  next: PersonSighting,
): PersonSighting {
  if (!prev) return next;
  const [newer, older] = next.seenAt >= prev.seenAt ? [next, prev] : [prev, next];
  return {
    handle: next.handle,
    seenAt: newer.seenAt,
    card: {
      displayName: newer.card.displayName ?? older.card.displayName,
      bio: newer.card.bio ?? older.card.bio,
      followersCount: newer.card.followersCount ?? older.card.followersCount,
      followingCount: newer.card.followingCount ?? older.card.followingCount,
      xUserId: newer.card.xUserId ?? older.card.xUserId,
    },
  };
}

/** Per-handle resend throttle: report when never sent, or when the last send
 *  is older than the resend window. */
export function shouldReportSighting(
  sentAtMs: number | undefined,
  nowMs: number,
  resendMs = SIGHTING_RESEND_MS,
): boolean {
  return sentAtMs === undefined || nowMs - sentAtMs >= resendMs;
}
