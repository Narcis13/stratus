// C7 Launch Room ingest: validation guards + the deterministic-id contract
// with the mention pull, over the real (in-memory) SQLite DB.

import { afterAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { people, personEvents } from '../db/schema.ts';
import { launch } from './launch.ts';

const app = new Hono();
app.route('/x', launch);

const H = 'c7_replier'; // must fit the 15-char X username cap

async function post<T>(body: unknown): Promise<{ status: number; body: T }> {
  const res = await app.request('/x/launch/replies', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}

afterAll(async () => {
  await db.delete(personEvents).where(eq(personEvents.handle, H));
  await db.delete(people).where(eq(people.handle, H));
});

describe('POST /x/launch/replies', () => {
  test('rejects malformed bodies', async () => {
    expect((await post([])).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await post({ replies: [] })).status).toBe(400);
    expect((await post({ replies: [{ tweetId: 'abc', handle: H, text: 'x' }] })).status).toBe(400);
    expect((await post({ replies: [{ tweetId: '1', handle: H }] })).status).toBe(400);
    const tooMany = Array.from({ length: 51 }, (_, i) => ({
      tweetId: String(i + 1),
      handle: H,
      text: 'x',
    }));
    expect((await post({ replies: tooMany })).status).toBe(400);
  });

  test('bad handles are skipped, not fatal to the batch', async () => {
    const { status, body } = await post<{ processed: number; skipped: number }>({
      replies: [
        { tweetId: '900001', handle: 'not a handle!!', text: 'hello' },
        { tweetId: '900002', handle: H, author: 'C7 Tester', text: 'great post' },
      ],
    });
    expect(status).toBe(200);
    expect(body.skipped).toBe(1);
    expect(body.processed).toBe(1);
  });

  test('upserts the person (source launch, displayName filled) and logs the inbound event', async () => {
    const [person] = await db.select().from(people).where(eq(people.handle, H));
    expect(person).toBeDefined();
    expect(person?.source).toBe('launch');
    expect(person?.displayName).toBe('C7 Tester');
    expect(person?.lastInboundAt).not.toBeNull();

    const events = await db.select().from(personEvents).where(eq(personEvents.handle, H));
    expect(events.length).toBe(1);
    // The SAME id the mention pull would use — the two paths must never
    // double-log the physical reply.
    expect(events[0]?.id).toBe('their_mention:mentions:900002');
    expect(events[0]?.type).toBe('their_mention');
  });

  test('re-posting the same reply is idempotent (deterministic event id)', async () => {
    const again = await post<{ processed: number }>({
      replies: [
        { tweetId: '900002', handle: H, text: 'great post' },
        { tweetId: '900002', handle: H, text: 'great post (dupe in batch)' },
      ],
    });
    expect(again.status).toBe(200);
    expect(again.body.processed).toBe(1); // in-batch dedupe by tweetId
    const events = await db.select().from(personEvents).where(eq(personEvents.handle, H));
    expect(events.length).toBe(1);
  });
});
