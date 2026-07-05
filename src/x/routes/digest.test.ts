// C9 digest route wiring over the real (in-memory, auto-migrated) SQLite DB.
// XAI_API_KEY is forced off for these tests — the route must degrade to
// facts-with-a-note, and the cached path must never call Grok at all.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { digests, postsPublished } from '../db/schema.ts';
import type { DigestFacts } from '../digest.ts';
import { digest } from './digest.ts';

const app = new Hono();
app.route('/x', digest);

const WEEK_KEY = '2025-11-03'; // a Monday, far from other tests' data
const CACHED_WEEK_KEY = '2025-11-10';
const TWEET_ID = '98000000000000001';

let savedKey: string | undefined;

interface DigestBody {
  weekKey: string;
  facts: DigestFacts;
  narrative: string | null;
  narrativeError?: string;
  cached: boolean;
}

async function get(path: string): Promise<{ status: number; body: DigestBody }> {
  const res = await app.request(path);
  return { status: res.status, body: (await res.json()) as DigestBody };
}

describe('digest route', () => {
  beforeAll(async () => {
    savedKey = process.env.XAI_API_KEY;
    // '' is falsy for the route's runtime check; assigning undefined would
    // coerce to the string "undefined" and read as configured.
    process.env.XAI_API_KEY = '';
    await db
      .insert(postsPublished)
      .values({
        tweetId: TWEET_ID,
        text: 'c9 digest test post',
        postedAt: new Date('2025-11-05T10:00:00Z'),
        isReply: false,
        source: 'test',
      })
      .onConflictDoNothing();
    await db
      .insert(digests)
      .values({
        weekKey: CACHED_WEEK_KEY,
        facts: { weekKey: CACHED_WEEK_KEY } as never,
        narrative: 'A cached coach note.',
        model: 'test-model',
        costUsd: 0.01,
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    process.env.XAI_API_KEY = savedKey ?? '';
    await db.delete(digests).where(eq(digests.weekKey, CACHED_WEEK_KEY));
    await db.delete(postsPublished).where(eq(postsPublished.tweetId, TWEET_ID));
  });

  test('rejects malformed params', async () => {
    expect((await get('/x/digest?week=nope')).status).toBe(400);
    expect((await get('/x/digest?tzOffsetMin=abc')).status).toBe(400);
    expect((await get('/x/digest?tzOffsetMin=5000')).status).toBe(400);
  });

  test('builds the week facts and degrades gracefully without a Grok key', async () => {
    const { status, body } = await get(`/x/digest?week=${WEEK_KEY}&tzOffsetMin=0`);
    expect(status).toBe(200);
    expect(body.weekKey).toBe(WEEK_KEY);
    expect(body.narrative).toBeNull();
    expect(body.narrativeError).toBe('grok_not_configured');
    expect(body.facts.activity.posts).toBeGreaterThanOrEqual(1);
    expect(body.facts.followers).toBeDefined();
  });

  test('any day of the week resolves to the same weekKey', async () => {
    const { body } = await get('/x/digest?week=2025-11-09&tzOffsetMin=0'); // the Sunday
    expect(body.weekKey).toBe(WEEK_KEY);
  });

  test('factsOnly never attempts narration', async () => {
    const { status, body } = await get(`/x/digest?week=${WEEK_KEY}&factsOnly=true`);
    expect(status).toBe(200);
    expect(body.narrative).toBeNull();
    expect(body.narrativeError).toBeUndefined();
  });

  test('a stored digest is served from cache', async () => {
    const { status, body } = await get(`/x/digest?week=${CACHED_WEEK_KEY}&tzOffsetMin=0`);
    expect(status).toBe(200);
    expect(body.cached).toBe(true);
    expect(body.narrative).toBe('A cached coach note.');
  });
});
