// C1 people layer: dossier/route shape + store idempotency over the real
// (in-memory, auto-migrated) SQLite DB — bun test runs with SQLITE_PATH=:memory:.

import { beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { personEvents } from '../db/schema.ts';
import { logPersonEvents } from '../people/store.ts';
import { buildAngleCrosstab, peopleRouter } from './people.ts';

const app = new Hono();
app.route('/x', peopleRouter);

const H = 'c1_test_person';
const DAY_MS = 24 * 60 * 60 * 1000;

async function getJson<T>(path: string): Promise<{ status: number; body: T }> {
  const res = await app.request(path);
  return { status: res.status, body: (await res.json()) as T };
}

async function send<T>(
  path: string,
  method: string,
  body: unknown,
): Promise<{ status: number; body: T }> {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}

describe('people routes', () => {
  beforeAll(async () => {
    // Two exchange days → mutual; deterministic ids keep re-runs idempotent.
    const base = Date.now() - 10 * DAY_MS;
    await logPersonEvents(
      [
        { handle: H, type: 'my_reply', refTable: 't', refId: 'r1', at: new Date(base) },
        {
          handle: H,
          type: 'their_mention',
          refTable: 't',
          refId: 'm1',
          at: new Date(base + 3_600_000),
        },
        {
          handle: H,
          type: 'my_reply',
          refTable: 't',
          refId: 'r2',
          at: new Date(base + 5 * DAY_MS),
        },
        {
          handle: H,
          type: 'their_reply_to_me',
          refTable: 't',
          refId: 'm2',
          at: new Date(base + 5 * DAY_MS + 3_600_000),
        },
      ],
      { source: 'test' },
    );
  });

  test('event logging is idempotent on deterministic ids (backfill re-run safe)', async () => {
    const before = await db.select().from(personEvents).where(eq(personEvents.handle, H));
    await logPersonEvents(
      [{ handle: H, type: 'my_reply', refTable: 't', refId: 'r1', at: new Date() }],
      { source: 'test' },
    );
    const after = await db.select().from(personEvents).where(eq(personEvents.handle, H));
    expect(after.length).toBe(before.length);
  });

  test('stage advanced to mutual from two exchange days', async () => {
    const { status, body } = await getJson<{ person: { stage: string } }>(`/x/people/${H}`);
    expect(status).toBe(200);
    expect(body.person.stage).toBe('mutual');
  });

  test('list returns counts and filters by stage', async () => {
    const { status, body } = await getJson<{
      people: Array<{ handle: string; inboundCount: number; outboundCount: number }>;
    }>('/x/people?stage=mutual');
    expect(status).toBe(200);
    const row = body.people.find((p) => p.handle === H);
    expect(row).toBeDefined();
    expect(row?.inboundCount).toBe(2);
    expect(row?.outboundCount).toBe(2);
  });

  test('dossier shape carries every section', async () => {
    const { body } = await getJson<Record<string, unknown>>(`/x/people/${H}`);
    for (const key of [
      'person',
      'voiceAuthor',
      'events',
      'replies',
      'angles',
      'mentions',
      'savedTweets',
      'followerSeries',
    ]) {
      expect(body).toHaveProperty(key);
    }
    const replies = body.replies as { count: number; measured: number; outcomes: unknown[] };
    expect(Array.isArray(replies.outcomes)).toBe(true);
    expect(Array.isArray(body.events)).toBe(true);
  });

  test('dossier 404 on unknown person, 400 on bad handle', async () => {
    expect((await app.request('/x/people/nobody_here_xyz')).status).toBe(404);
    expect((await app.request('/x/people/not!a!handle')).status).toBe(400);
  });

  test('PATCH updates notes/tags and allows manual demote', async () => {
    const { status, body } = await send<{ notes: string; tags: string[]; stage: string }>(
      `/x/people/${H}`,
      'PATCH',
      { notes: 'met at conf', tags: ['ai-agents'], stage: 'engaged' },
    );
    expect(status).toBe(200);
    expect(body.notes).toBe('met at conf');
    expect(body.tags).toEqual(['ai-agents']);
    expect(body.stage).toBe('engaged');
  });

  test('PATCH validation: bad stage / empty patch → 400', async () => {
    expect((await send(`/x/people/${H}`, 'PATCH', { stage: 'bestie' })).status).toBe(400);
    expect((await send(`/x/people/${H}`, 'PATCH', {})).status).toBe(400);
  });

  test('manual note event creates a person when missing', async () => {
    const { status, body } = await send<{ person: { handle: string; source: string } }>(
      '/x/people/c1_manual_add/events',
      'POST',
      { type: 'note', summary: 'DM about the eval harness' },
    );
    expect(status).toBe(201);
    expect(body.person.handle).toBe('c1_manual_add');
    expect(body.person.source).toBe('manual');
  });

  test('manual event validation: bad type / missing summary → 400', async () => {
    expect(
      (await send(`/x/people/${H}/events`, 'POST', { type: 'my_reply', summary: 'x' })).status,
    ).toBe(400);
    expect((await send(`/x/people/${H}/events`, 'POST', { type: 'note' })).status).toBe(400);
  });
});

describe('buildAngleCrosstab', () => {
  const out = (views: number, profileVisits: number) => ({
    views,
    likes: null,
    replies: null,
    retweets: null,
    quotes: null,
    bookmarks: null,
    profileVisits,
  });

  test('groups by angle with medians; unmeasured rows counted but not averaged', () => {
    const cells = buildAngleCrosstab([
      { angle: 'contrarian', outcome: out(100, 2) },
      { angle: 'contrarian', outcome: out(300, 4) },
      { angle: 'contrarian', outcome: null },
      { angle: 'extends', outcome: out(50, 1) },
      { angle: null, outcome: null },
    ]);
    const contrarian = cells.find((c) => c.angle === 'contrarian');
    expect(contrarian?.posted).toBe(3);
    expect(contrarian?.measured).toBe(2);
    expect(contrarian?.medianViews).toBe(200);
    expect(contrarian?.medianProfileVisits).toBe(3);
    const unknown = cells.find((c) => c.angle === null);
    expect(unknown?.measured).toBe(0);
    expect(unknown?.medianViews).toBeNull();
  });
});
