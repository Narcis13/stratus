// C6 passive hover capture: batch dedupe, the once-a-day event + snapshot
// gates, and the route validation — over the real (in-memory, auto-migrated)
// SQLite DB; bun test runs with SQLITE_PATH=:memory:.

import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { people, personEvents, personSnapshots } from '../db/schema.ts';
import { peopleRouter } from '../routes/people.ts';
import { dedupeSightings, hoverSightingEventId, recordSightings } from './sightings.ts';

const app = new Hono();
app.route('/x', peopleRouter);

const card = (over: Partial<Parameters<typeof dedupeSightings>[0][number]['card']> = {}) => ({
  displayName: null,
  bio: null,
  followersCount: null,
  followingCount: null,
  xUserId: null,
  ...over,
});

describe('dedupeSightings', () => {
  test('one sighting per handle: freshest wins, null fields backfill', () => {
    const out = dedupeSightings([
      {
        handle: 'alice',
        seenAt: new Date('2026-07-04T10:00:00Z'),
        card: card({ bio: 'builds agents', followersCount: 500 }),
      },
      {
        handle: 'alice',
        seenAt: new Date('2026-07-04T10:05:00Z'),
        card: card({ displayName: 'Alice', followersCount: 510 }),
      },
      { handle: 'bob', seenAt: new Date('2026-07-04T10:01:00Z'), card: card() },
    ]);
    expect(out.length).toBe(2);
    const alice = out.find((s) => s.handle === 'alice');
    expect(alice?.card.followersCount).toBe(510); // newer wins
    expect(alice?.card.bio).toBe('builds agents'); // null backfilled from older
    expect(alice?.card.displayName).toBe('Alice');
    expect(alice?.seenAt.toISOString()).toBe('2026-07-04T10:05:00.000Z');
  });
});

describe('recordSightings', () => {
  const H = 'c6_hover_person';

  test('creates the person (source hover), event + snapshot once a day, stage noticed', async () => {
    const seenAt = new Date('2026-07-01T09:00:00Z');
    const first = await recordSightings([
      { handle: H, card: card({ displayName: 'Hovered', followersCount: 1200 }), seenAt },
    ]);
    expect(first).toMatchObject({ processed: 1, skipped: 0, events: 1, snapshots: 1 });

    const [person] = await db.select().from(people).where(eq(people.handle, H));
    expect(person?.source).toBe('hover');
    expect(person?.displayName).toBe('Hovered');
    expect(person?.stage).toBe('noticed');

    // Same UTC day → no new event, no new snapshot (deterministic id + gate).
    const again = await recordSightings([
      {
        handle: H,
        card: card({ followersCount: 1250 }),
        seenAt: new Date('2026-07-01T18:00:00Z'),
      },
    ]);
    expect(again).toMatchObject({ processed: 1, events: 0, snapshots: 0 });

    // Next day → one more of each.
    const nextDay = await recordSightings([
      {
        handle: H,
        card: card({ followersCount: 1300 }),
        seenAt: new Date('2026-07-02T08:00:00Z'),
      },
    ]);
    expect(nextDay).toMatchObject({ events: 1, snapshots: 1 });

    const events = await db.select().from(personEvents).where(eq(personEvents.handle, H));
    expect(events.length).toBe(2);
    expect(events.map((e) => e.id)).toContain(hoverSightingEventId(H, seenAt));
    const snaps = await db.select().from(personSnapshots).where(eq(personSnapshots.handle, H));
    expect(snaps.map((s) => s.followersCount).sort()).toEqual([1200, 1300]);

    await db.delete(personSnapshots).where(eq(personSnapshots.handle, H));
    await db.delete(personEvents).where(eq(personEvents.handle, H));
    await db.delete(people).where(eq(people.handle, H));
  });

  test('invalid handles are skipped, not fatal; a follower-less card logs no snapshot', async () => {
    const res = await recordSightings([
      { handle: 'not!a!handle', card: card(), seenAt: new Date() },
      { handle: 'c6_hover_thin', card: card({ bio: 'just a bio' }), seenAt: new Date() },
    ]);
    expect(res.skipped).toBe(1);
    expect(res.processed).toBe(1);
    expect(res.snapshots).toBe(0);

    await db.delete(personEvents).where(eq(personEvents.handle, 'c6_hover_thin'));
    await db.delete(people).where(eq(people.handle, 'c6_hover_thin'));
  });
});

describe('POST /x/people/sightings', () => {
  const send = async (body: unknown) => {
    const res = await app.request('/x/people/sightings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  test('ingests a batch and reports counts', async () => {
    const { status, body } = await send({
      sightings: [
        {
          handle: '@C6_Route_Person',
          card: { displayName: 'Router', followersCount: 42 },
          seenAt: new Date().toISOString(),
        },
      ],
    });
    expect(status).toBe(200);
    expect(body.processed).toBe(1);
    expect(body.events).toBe(1);

    // Normalized (lowercased, @ stripped) person exists.
    const [person] = await db.select().from(people).where(eq(people.handle, 'c6_route_person'));
    expect(person).toBeDefined();

    await db.delete(personSnapshots).where(eq(personSnapshots.handle, 'c6_route_person'));
    await db.delete(personEvents).where(eq(personEvents.handle, 'c6_route_person'));
    await db.delete(people).where(eq(people.handle, 'c6_route_person'));
  });

  test('validation: empty batch, oversize batch, bad seenAt, bad card', async () => {
    expect((await send({ sightings: [] })).status).toBe(400);
    expect(
      (
        await send({
          sightings: Array.from({ length: 51 }, (_, i) => ({
            handle: `h${i}`,
            card: {},
            seenAt: new Date().toISOString(),
          })),
        })
      ).status,
    ).toBe(400);
    expect(
      (await send({ sightings: [{ handle: 'x', card: {}, seenAt: 'not-a-date' }] })).status,
    ).toBe(400);
    expect(
      (
        await send({
          sightings: [
            { handle: 'x', card: { followersCount: -5 }, seenAt: new Date().toISOString() },
          ],
        })
      ).status,
    ).toBe(400);
  });
});
