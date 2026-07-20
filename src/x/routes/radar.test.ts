// RU.5: the confirm endpoint promotes a radar draft into a measured
// reply_drafts row, plus the ?tweetId= list filter — over the real (in-memory,
// auto-migrated) SQLite DB; bun test runs with SQLITE_PATH=:memory:.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { radarDrafts, replyDrafts } from '../db/schema.ts';
import { radar } from './radar.ts';

const app = new Hono();
app.route('/x', radar);

// Distinct high ids so we never collide with another suite's radar rows.
const T_WITH = '991000000000000001'; // full signals + 3 variants + model
const T_NULL = '991000000000000002'; // CLI-shaped: null signals/variants/model
const T_OTHER = '991000000000000003'; // filter-isolation sentinel
const T_UNKNOWN = '991999999999999999'; // no row — 404
const IDS = [T_WITH, T_NULL, T_OTHER];

const PRIMARY_TEXT = 'v1 extends: I shipped mine in 3 days';
const VARIANTS = [
  { text: PRIMARY_TEXT, angle: 'extends' },
  { text: 'v2 contrarian: that never scales', angle: 'contrarian' },
  { text: 'v3 debate: define "done" first', angle: 'debate' },
];

async function send<T>(
  path: string,
  method: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const res = await app.request(path, {
    method,
    ...(body !== undefined
      ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
  const parsed = res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  return { status: res.status, body: parsed };
}

beforeAll(async () => {
  await db.delete(replyDrafts).where(inArray(replyDrafts.sourceTweetId, IDS));
  await db.delete(radarDrafts).where(inArray(radarDrafts.tweetId, IDS));
  await db.insert(radarDrafts).values([
    {
      tweetId: T_WITH,
      url: `https://x.com/alice/status/${T_WITH}`,
      handle: 'alice',
      author: 'Alice Builder',
      snippet: 'shipping is a skill you learn by shipping',
      band: 'hot',
      signals: { views: 1500, replies: 8, ageMin: 22, vpm: 68, bait: false },
      replyText: PRIMARY_TEXT,
      angle: 'extends',
      variants: VARIANTS,
      model: 'grok-4.3',
    },
    {
      // CLI/smoke-shaped: no signals, no variants, no model, no url.
      tweetId: T_NULL,
      handle: 'bob',
      snippet: 'cold tweet, no captured signals',
      replyText: 'a plain reply',
      angle: 'extends',
    },
    {
      tweetId: T_OTHER,
      handle: 'carol',
      snippet: 'another tweet',
      replyText: 'r',
      angle: 'debate',
    },
  ]);
});

afterAll(async () => {
  await db.delete(replyDrafts).where(inArray(replyDrafts.sourceTweetId, IDS));
  await db.delete(radarDrafts).where(inArray(radarDrafts.tweetId, IDS));
});

interface DraftRow {
  tweetId: string;
  status: string;
  replyDraftId: string | null;
}
interface ReplyRow {
  id: string;
  source: string | null;
  status: string;
  model: string;
  replyText: string;
  sourceUrl: string;
  sourcePostedAt: string | null; // Date column → ISO string over JSON
  variants: { text: string; angle: string }[] | null;
  contextSnapshot: {
    signals?: { band: string; views: number; ageMin: number };
    metrics: { views: number; replies: number; reposts: number; likes: number };
    topComments: unknown[];
  };
}

describe('GET /radar/drafts?tweetId=', () => {
  test('filter returns only that tweet’s rows', async () => {
    const { status, body } = await send<{ drafts: DraftRow[] }>(
      `/x/radar/drafts?tweetId=${T_WITH}`,
      'GET',
    );
    expect(status).toBe(200);
    expect(body.drafts.length).toBeGreaterThanOrEqual(1);
    expect(body.drafts.every((d) => d.tweetId === T_WITH)).toBe(true);
  });

  test('malformed tweetId → 400', async () => {
    const { status, body } = await send<{ error: string }>(
      '/x/radar/drafts?tweetId=not-a-number',
      'GET',
    );
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_tweet_id');
  });
});

describe('POST /radar/drafts/:tweetId/confirm', () => {
  let createdId = '';

  test('malformed tweetId → 400', async () => {
    const { status, body } = await send<{ error: string }>(
      '/x/radar/drafts/not-a-number/confirm',
      'POST',
    );
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_tweet_id');
  });

  test('unknown tweet → 404', async () => {
    const { status, body } = await send<{ error: string }>(
      `/x/radar/drafts/${T_UNKNOWN}/confirm`,
      'POST',
    );
    expect(status).toBe(404);
    expect(body.error).toBe('not_found');
  });

  test('creates a measured reply_drafts row and ratchets the radar draft', async () => {
    const { status, body } = await send<ReplyRow>(`/x/radar/drafts/${T_WITH}/confirm`, 'POST');
    expect(status).toBe(201);
    createdId = body.id;
    expect(body.source).toBe('radar');
    expect(body.status).toBe('copied');
    expect(body.model).toBe('grok-4.3');
    expect(body.replyText).toBe(PRIMARY_TEXT);
    expect(body.variants).toHaveLength(3);
    expect(body.sourceUrl).toBe(`https://x.com/alice/status/${T_WITH}`);
    // contextSnapshot parse-shapes like PostContext (band from the column,
    // metrics from signals, topComments []).
    expect(body.contextSnapshot.signals?.band).toBe('hot');
    expect(body.contextSnapshot.signals?.views).toBe(1500);
    expect(body.contextSnapshot.metrics).toEqual({
      views: 1500,
      replies: 8,
      reposts: 0,
      likes: 0,
    });
    expect(body.contextSnapshot.topComments).toEqual([]);
    // sourcePostedAt derived back from draftedAt − ageMin (ISO string on the wire).
    expect(body.sourcePostedAt).not.toBeNull();

    // The radar draft is now clicked and soft-linked.
    const [draftRow] = await db
      .select()
      .from(radarDrafts)
      .where(inArray(radarDrafts.tweetId, [T_WITH]));
    expect(draftRow?.status).toBe('clicked');
    expect(draftRow?.replyDraftId).toBe(createdId);
  });

  test('second confirm is idempotent (returns the same draft)', async () => {
    const { status, body } = await send<ReplyRow>(`/x/radar/drafts/${T_WITH}/confirm`, 'POST');
    expect(status).toBe(200);
    expect(body.id).toBe(createdId);
  });

  test('signals-null row confirms with no signals block and the primary as variants', async () => {
    const { status, body } = await send<ReplyRow>(`/x/radar/drafts/${T_NULL}/confirm`, 'POST');
    expect(status).toBe(201);
    expect(body.contextSnapshot.signals).toBeUndefined();
    expect(body.contextSnapshot.metrics.views).toBe(0);
    expect(body.sourcePostedAt).toBeNull();
    expect(body.model).toBe('radar-batch'); // fallback for a null-model row
    expect(body.sourceUrl).toBe(`https://x.com/bob/status/${T_NULL}`); // constructed
    expect(body.variants).toEqual([{ text: 'a plain reply', angle: 'extends' }]);
  });
});
