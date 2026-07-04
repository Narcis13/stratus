// Passive hover capture (CIRCLES-PLAN C6): the extension streams hover cards
// X rendered during natural browsing; each sighting upserts the person
// (fill-only — a hover-card glimpse never clobbers enriched data), logs a
// hover_sighting timeline event AT MOST once per UTC day per handle (the
// deterministic-id trick: `hover_sighting:hover:<handle>:<YYYY-MM-DD>` +
// INSERT OR IGNORE), and appends a person_snapshots follower point under the
// same once-a-day gate — momentum is followers/day, so sub-daily points are
// noise the 60s content-script resend would otherwise spam in.

import { and, eq, gte } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { personEvents, personSnapshots } from '../db/schema.ts';
import { normalizePersonHandle, recomputePerson, upsertPerson } from './store.ts';

export const MAX_SIGHTINGS_PER_BATCH = 50;

export interface HoverCard {
  displayName: string | null;
  bio: string | null;
  followersCount: number | null;
  followingCount: number | null;
  xUserId: string | null;
}

export interface PersonSightingInput {
  handle: string;
  card: HoverCard;
  seenAt: Date;
}

export interface SightingResult {
  received: number;
  processed: number;
  skipped: number;
  events: number;
  snapshots: number;
}

// Pure — exported for unit tests. One sighting per handle survives a batch:
// the freshest wins, but null card fields backfill from the older one (a
// re-render may parse only part of the card).
export function dedupeSightings(inputs: PersonSightingInput[]): PersonSightingInput[] {
  const byHandle = new Map<string, PersonSightingInput>();
  for (const s of inputs) {
    const prev = byHandle.get(s.handle);
    if (!prev) {
      byHandle.set(s.handle, s);
      continue;
    }
    const [newer, older] = s.seenAt >= prev.seenAt ? [s, prev] : [prev, s];
    byHandle.set(s.handle, {
      handle: s.handle,
      seenAt: newer.seenAt,
      card: {
        displayName: newer.card.displayName ?? older.card.displayName,
        bio: newer.card.bio ?? older.card.bio,
        followersCount: newer.card.followersCount ?? older.card.followersCount,
        followingCount: newer.card.followingCount ?? older.card.followingCount,
        xUserId: newer.card.xUserId ?? older.card.xUserId,
      },
    });
  }
  return [...byHandle.values()];
}

export function hoverSightingEventId(handle: string, seenAt: Date): string {
  return `hover_sighting:hover:${handle}:${seenAt.toISOString().slice(0, 10)}`;
}

export async function recordSightings(inputs: PersonSightingInput[]): Promise<SightingResult> {
  const result: SightingResult = {
    received: inputs.length,
    processed: 0,
    skipped: 0,
    events: 0,
    snapshots: 0,
  };

  const valid: PersonSightingInput[] = [];
  for (const s of inputs) {
    const handle = normalizePersonHandle(s.handle);
    if (!handle) {
      result.skipped++;
      continue;
    }
    valid.push({ ...s, handle });
  }

  for (const s of dedupeSightings(valid)) {
    await upsertPerson(s.handle, { source: 'hover', fields: s.card, now: s.seenAt });
    result.processed++;

    const inserted = await db
      .insert(personEvents)
      .values({
        id: hoverSightingEventId(s.handle, s.seenAt),
        handle: s.handle,
        type: 'hover_sighting',
        refTable: null,
        refId: null,
        summary: s.card.followersCount !== null ? `${s.card.followersCount} followers` : null,
        at: s.seenAt,
      })
      .onConflictDoNothing()
      .returning({ id: personEvents.id });
    result.events += inserted.length;

    if (s.card.followersCount !== null) {
      const dayStart = new Date(s.seenAt);
      dayStart.setUTCHours(0, 0, 0, 0);
      const [existing] = await db
        .select({ id: personSnapshots.id })
        .from(personSnapshots)
        .where(and(eq(personSnapshots.handle, s.handle), gte(personSnapshots.capturedAt, dayStart)))
        .limit(1);
      if (!existing) {
        await db.insert(personSnapshots).values({
          handle: s.handle,
          followersCount: s.card.followersCount,
          capturedAt: s.seenAt,
        });
        result.snapshots++;
      }
    }

    // hover_sighting advances stranger → noticed (stage engine) and moves the
    // seen watermarks; recompute even when the day's event already existed so
    // lastSeenAt tracks reality.
    await recomputePerson(s.handle, s.seenAt);
  }

  return result;
}
