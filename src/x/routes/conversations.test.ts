// C2 conversations routes over the real (in-memory, auto-migrated) SQLite DB —
// bun test runs with SQLITE_PATH=:memory:. Pure grouping logic is covered in
// ../conversations.test.ts; this checks the route wiring: joins, meta upsert,
// person chip, counts.

import { beforeAll, describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { mentions, people, postsPublished } from '../db/schema.ts';
import { conversations } from './conversations.ts';

const app = new Hono();
app.route('/x', conversations);

const NOW = Date.now();
const at = (min: number): Date => new Date(NOW - min * 60_000);

interface ThreadJson {
  conversationId: string;
  items: Array<{ kind: string; tweetId: string }>;
  openLoop: boolean;
  chain: boolean;
  unread: boolean;
  muted: boolean;
  person: { handle: string; stage: string } | null;
}
interface ListJson {
  counts: { threads: number; openLoops: number; chains: number; unread: number };
  threads: ThreadJson[];
}

describe('conversations routes', () => {
  beforeAll(async () => {
    // Thread c2_conv_1: my reply → their unanswered reply to it (a chain loop).
    await db
      .insert(postsPublished)
      .values({
        tweetId: 'c2t_myreply',
        text: 'my reply',
        postedAt: at(120),
        isReply: true,
        conversationId: '8881',
        source: 'test',
      })
      .onConflictDoNothing();
    await db
      .insert(mentions)
      .values([
        {
          tweetId: '88810001',
          authorUsername: 'c2_counterpart',
          authorName: 'Counter Part',
          text: 'replying to your reply',
          postedAt: at(60),
          conversationId: '8881',
          inReplyToTweetId: 'c2t_myreply',
          status: 'unanswered',
        },
        // Thread 8882: settled (answered).
        {
          tweetId: '88820001',
          authorUsername: 'c2_other',
          authorName: null,
          text: 'nice post',
          postedAt: at(30),
          conversationId: '8882',
          inReplyToTweetId: null,
          status: 'answered',
        },
      ])
      .onConflictDoNothing();
    await db
      .insert(people)
      .values({ handle: 'c2_counterpart', stage: 'mutual' })
      .onConflictDoNothing();
  });

  test('GET groups into threads, flags the chain loop, joins the person chip', async () => {
    const res = await app.request('/x/conversations');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListJson;

    const chain = body.threads.find((t) => t.conversationId === '8881');
    expect(chain).toBeDefined();
    expect(chain?.openLoop).toBe(true);
    expect(chain?.chain).toBe(true);
    expect(chain?.items.map((i) => i.kind)).toEqual(['outbound', 'inbound']);
    expect(chain?.person).toEqual({
      handle: 'c2_counterpart',
      stage: 'mutual',
      displayName: null,
    } as never);
    // Chain sorts to the very top.
    expect(body.threads[0]?.conversationId).toBe('8881');

    const settled = body.threads.find((t) => t.conversationId === '8882');
    expect(settled?.openLoop).toBe(false);
    expect(settled?.person).toBeNull();

    expect(body.counts.openLoops).toBeGreaterThanOrEqual(1);
    expect(body.counts.chains).toBeGreaterThanOrEqual(1);
  });

  test('PATCH upserts read state and the next GET reflects it', async () => {
    const res = await app.request('/x/conversations/8881', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ read: true, muted: true }),
    });
    expect(res.status).toBe(200);
    const meta = (await res.json()) as { conversationId: string; muted: boolean };
    expect(meta.conversationId).toBe('8881');
    expect(meta.muted).toBe(true);

    const list = (await (await app.request('/x/conversations')).json()) as ListJson;
    const t = list.threads.find((x) => x.conversationId === '8881');
    expect(t?.unread).toBe(false);
    expect(t?.muted).toBe(true);
    // Muted → no longer counted as an open loop, sinks off the top.
    expect(list.counts.chains).toBe(0);

    // Unmute for idempotent re-runs against a file-backed DB.
    await app.request('/x/conversations/8881', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ muted: false }),
    });
  });

  test('PATCH validates its body', async () => {
    for (const body of [{}, { read: false }, { snoozedUntil: 'not-a-date' }, { muted: 'yes' }]) {
      const res = await app.request('/x/conversations/8881', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
    }
    const bad = await app.request('/x/conversations/not-numeric', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ read: true }),
    });
    expect(bad.status).toBe(400);
  });
});
