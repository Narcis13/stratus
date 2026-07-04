// C5 route wiring over the real (in-memory, auto-migrated) SQLite DB. The DB
// is shared across test files, so assertions look for this file's distinctive
// handles instead of exact totals.

import { beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { followupSnoozes, mentions, people, personEvents, postsPublished } from '../db/schema.ts';
import { logPersonEvents } from '../people/store.ts';
import { followups } from './followups.ts';
import { peopleRouter } from './people.ts';

// Mirror mountX's order: followups BEFORE peopleRouter, so the static
// /people/followups and /people/fans paths beat the :handle dossier route.
const app = new Hono();
app.route('/x', followups);
app.route('/x', peopleRouter);

const ALLY = 'c5_quiet_ally';
const FAN = 'c5_top_fan';
const CHAIN = 'c5_chain_fan';
const MY_REPLY_ID = '95000000000000001';
const THEIR_REPLY_ID = '95000000000000002';
const DAY_MS = 24 * 60 * 60 * 1000;

interface FollowupsBody {
  counts: { total: number; snoozed: number; byKind: Record<string, number> };
  items: Array<{ kind: string; handle: string; tweetId?: string; url?: string }>;
}

async function getJson<T>(path: string): Promise<{ status: number; body: T }> {
  const res = await app.request(path);
  return { status: res.status, body: (await res.json()) as T };
}

async function patch<T>(path: string, body: unknown): Promise<{ status: number; body: T }> {
  const res = await app.request(path, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}

function itemsFor(body: FollowupsBody, handle: string) {
  return body.items.filter((i) => i.handle === handle);
}

describe('followups routes', () => {
  beforeAll(async () => {
    // Neglected ally: two old exchange days → mutual, nothing since.
    const old = Date.now() - 40 * DAY_MS;
    await logPersonEvents(
      [
        { handle: ALLY, type: 'my_reply', refTable: 't', refId: 'c5r1', at: new Date(old) },
        {
          handle: ALLY,
          type: 'their_mention',
          refTable: 't',
          refId: 'c5m1',
          at: new Date(old + 3_600_000),
        },
        {
          handle: ALLY,
          type: 'my_reply',
          refTable: 't',
          refId: 'c5r2',
          at: new Date(old + 2 * DAY_MS),
        },
        {
          handle: ALLY,
          type: 'their_reply_to_me',
          refTable: 't',
          refId: 'c5m2',
          at: new Date(old + 2 * DAY_MS + 3_600_000),
        },
      ],
      { source: 'test' },
    );
    // The backfill stamps stageUpdatedAt at recompute time (= now), which
    // would read as a fresh advance (dm_ready). Backdate it to the real
    // promotion moment so the person classifies as a neglected ally.
    await db
      .update(people)
      .set({ stageUpdatedAt: new Date(old + 2 * DAY_MS + 3_600_000) })
      .where(eq(people.handle, ALLY));

    // Top fan: three inbound events in the trailing week, never acknowledged.
    await logPersonEvents(
      [1, 2, 3].map((n) => ({
        handle: FAN,
        type: 'their_mention' as const,
        refTable: 't',
        refId: `c5f${n}`,
        at: new Date(Date.now() - n * DAY_MS),
      })),
      { source: 'test' },
    );

    // Live chain: my published reply + their unanswered reply to it, 1h old.
    await db
      .insert(postsPublished)
      .values({
        tweetId: MY_REPLY_ID,
        text: 'my reply',
        postedAt: new Date(Date.now() - 3 * 3_600_000),
        isReply: true,
        source: 'test',
      })
      .onConflictDoNothing();
    await db
      .insert(mentions)
      .values({
        tweetId: THEIR_REPLY_ID,
        authorUsername: CHAIN,
        authorName: 'Chain Fan',
        text: 'they came back',
        postedAt: new Date(Date.now() - 3_600_000),
        inReplyToTweetId: MY_REPLY_ID,
        status: 'unanswered',
      })
      .onConflictDoNothing();
  });

  test('GET /people/followups is not swallowed by the :handle dossier route', async () => {
    const { status, body } = await getJson<FollowupsBody>('/x/people/followups');
    expect(status).toBe(200);
    expect(Array.isArray(body.items)).toBe(true);
  });

  test('classifies the live chain and the neglected ally', async () => {
    const { body } = await getJson<FollowupsBody>('/x/people/followups');
    const chain = itemsFor(body, CHAIN);
    expect(chain).toHaveLength(1);
    expect(chain[0]?.kind).toBe('chain_live');
    expect(chain[0]?.tweetId).toBe(THEIR_REPLY_ID);
    expect(chain[0]?.url).toBe(`https://x.com/${CHAIN}/status/${THEIR_REPLY_ID}`);

    const ally = itemsFor(body, ALLY);
    expect(ally).toHaveLength(1);
    expect(ally[0]?.kind).toBe('neglected_ally');

    // chain_live ranks above neglected_ally.
    const order = body.items.map((i) => `${i.kind}:${i.handle}`);
    expect(order.indexOf(`chain_live:${CHAIN}`)).toBeLessThan(
      order.indexOf(`neglected_ally:${ALLY}`),
    );
  });

  test('PATCH snooze hides the item; unsnooze (null) brings it back', async () => {
    const until = new Date(Date.now() + 3_600_000).toISOString();
    const snoozeRes = await patch<{ itemKey: string }>('/x/people/followups', {
      kind: 'neglected_ally',
      handle: ALLY,
      snoozedUntil: until,
    });
    expect(snoozeRes.status).toBe(200);
    expect(snoozeRes.body.itemKey).toBe(`neglected_ally:${ALLY}`);

    let { body } = await getJson<FollowupsBody>('/x/people/followups');
    expect(itemsFor(body, ALLY)).toHaveLength(0);
    expect(body.counts.snoozed).toBeGreaterThanOrEqual(1);

    await patch('/x/people/followups', {
      kind: 'neglected_ally',
      handle: ALLY,
      snoozedUntil: null,
    });
    ({ body } = await getJson<FollowupsBody>('/x/people/followups'));
    expect(itemsFor(body, ALLY)).toHaveLength(1);
  });

  test('PATCH validates kind, handle and timestamp', async () => {
    expect(
      (await patch('/x/people/followups', { kind: 'nope', handle: ALLY, snoozedUntil: null }))
        .status,
    ).toBe(400);
    expect(
      (await patch('/x/people/followups', { kind: 'dm_ready', handle: '@@', snoozedUntil: null }))
        .status,
    ).toBe(400);
    expect(
      (
        await patch('/x/people/followups', {
          kind: 'dm_ready',
          handle: ALLY,
          snoozedUntil: 'not-a-date',
        })
      ).status,
    ).toBe(400);
  });

  test('GET /people/fans ranks by trailing inbound and stamps acknowledgement', async () => {
    const { status, body } = await getJson<{
      days: number;
      fans: Array<{
        handle: string;
        inboundCount: number;
        lastOutboundAt: string | null;
        unacknowledged: boolean;
      }>;
    }>('/x/people/fans?days=30&limit=100');
    expect(status).toBe(200);
    expect(body.days).toBe(30);

    const fan = body.fans.find((f) => f.handle === FAN);
    expect(fan).toBeDefined();
    expect(fan?.inboundCount).toBe(3);
    expect(fan?.unacknowledged).toBe(true); // never replied to them

    // The ally's inbound events are 40d old — outside the 30d window.
    expect(body.fans.find((f) => f.handle === ALLY)).toBeUndefined();
  });

  test('GET /people/fans validates days', async () => {
    expect((await app.request('/x/people/fans?days=0')).status).toBe(400);
    expect((await app.request('/x/people/fans?days=nope')).status).toBe(400);
  });

  test('cleanup', async () => {
    // Keep the shared in-memory DB tidy for other suites.
    await db.delete(mentions).where(eq(mentions.tweetId, THEIR_REPLY_ID));
    await db.delete(postsPublished).where(eq(postsPublished.tweetId, MY_REPLY_ID));
    await db.delete(followupSnoozes).where(eq(followupSnoozes.itemKey, `neglected_ally:${ALLY}`));
    for (const h of [ALLY, FAN]) {
      await db.delete(personEvents).where(eq(personEvents.handle, h));
      await db.delete(people).where(eq(people.handle, h));
    }
    expect(true).toBe(true);
  });
});
