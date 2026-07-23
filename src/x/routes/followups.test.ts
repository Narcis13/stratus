// C5 route wiring over the real (in-memory, auto-migrated) SQLite DB. The DB
// is shared across test files, so assertions look for this file's distinctive
// handles instead of exact totals.

import { beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import {
  followupSnoozes,
  mentions,
  metricsSnapshots,
  people,
  personEvents,
  postsPublished,
  scheduledPosts,
} from '../db/schema.ts';
import { rankFans } from '../people/followups.ts';
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
// C10 pair: `hi` has more inbound, `lo` has more engagement. If engagement ever
// leaked into rankFans, `lo` (2 + 3 = 5) would outrank `hi` (3).
const FAN_HI = 'c10_fan_hi';
const FAN_LO = 'c10_fan_lo';
const MY_REPLY_ID = '95000000000000001';
const THEIR_REPLY_ID = '95000000000000002';
// §S0.6 re-up winner: 21d old, huge measured views so it's the single best
// candidate regardless of what other suites left in the shared DB.
const REUP_ID = '95000000000000030';
const REUP_SCHED_ID = 'c5_reup_sched';
const DAY_MS = 24 * 60 * 60 * 1000;

interface FollowupsBody {
  counts: { total: number; snoozed: number; byKind: Record<string, number> };
  items: Array<{ kind: string; handle: string; tweetId?: string; url?: string; reason?: string }>;
}

function reupItem(body: FollowupsBody) {
  return body.items.find((i) => i.kind === 'reup_candidate' && i.tweetId === REUP_ID);
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

    // C10 engagement pair. FAN_LO also carries one like 40d back, outside the
    // 30d window the count must respect.
    await logPersonEvents(
      [
        ...[1, 2, 3].map((n) => ({
          handle: FAN_HI,
          type: 'their_mention' as const,
          refTable: 't',
          refId: `c10hi_m${n}`,
          at: new Date(Date.now() - n * DAY_MS),
        })),
        ...[1, 2].map((n) => ({
          handle: FAN_LO,
          type: 'their_mention' as const,
          refTable: 't',
          refId: `c10lo_m${n}`,
          at: new Date(Date.now() - n * DAY_MS),
        })),
        ...[1, 2, 3].map((n) => ({
          handle: FAN_LO,
          type: 'their_like' as const,
          refTable: 't',
          refId: `c10lo_l${n}`,
          at: new Date(Date.now() - n * DAY_MS),
        })),
        {
          handle: FAN_LO,
          type: 'their_like' as const,
          refTable: 't',
          refId: 'c10lo_old',
          at: new Date(Date.now() - 40 * DAY_MS),
        },
      ],
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

    // Re-up candidate: my own non-reply post, 21d old, one snapshot far above
    // the winner bar, not yet quote-tweeted.
    await db
      .insert(postsPublished)
      .values({
        tweetId: REUP_ID,
        text: 'my proven winner',
        postedAt: new Date(Date.now() - 21 * DAY_MS),
        isReply: false,
        source: 'test',
      })
      .onConflictDoNothing();
    await db
      .insert(metricsSnapshots)
      .values({
        tweetId: REUP_ID,
        publicMetrics: { impression_count: 250_000 },
        snapshotAt: new Date(Date.now() - 20 * DAY_MS),
      })
      .onConflictDoNothing();
  });

  test('surfaces the best re-up candidate, ranked above momentum', async () => {
    const { body } = await getJson<FollowupsBody>('/x/people/followups');
    const reup = reupItem(body);
    expect(reup).toBeDefined();
    expect(reup?.handle).toBe('');
    expect(reup?.url).toBe(`https://x.com/i/web/status/${REUP_ID}`);
    expect(reup?.reason).toContain('quote-tweet re-up');
    expect(reup?.reason).toContain('250k views');

    // reup ranks after every person kind and before any momentum item.
    const order = body.items.map((i) => i.kind);
    const reupIdx = body.items.findIndex((i) => i.tweetId === REUP_ID);
    const firstMomentum = order.indexOf('momentum');
    if (firstMomentum !== -1) expect(reupIdx).toBeLessThan(firstMomentum);
    for (const personKind of ['chain_live', 'dm_ready', 'neglected_target', 'neglected_ally']) {
      const last = order.lastIndexOf(personKind);
      if (last !== -1) expect(reupIdx).toBeGreaterThan(last);
    }
  });

  test('a winner already carrying a quote_tweet_id row is excluded', async () => {
    await db.insert(scheduledPosts).values({
      id: REUP_SCHED_ID,
      text: 'quote draft',
      status: 'draft',
      source: 'drafter',
      quoteTweetId: REUP_ID,
    });
    try {
      const { body } = await getJson<FollowupsBody>('/x/people/followups');
      expect(reupItem(body)).toBeUndefined();
    } finally {
      await db.delete(scheduledPosts).where(eq(scheduledPosts.id, REUP_SCHED_ID));
    }
  });

  test('PATCH snooze by tweetId hides the re-up; unsnooze brings it back', async () => {
    const until = new Date(Date.now() + 3_600_000).toISOString();
    const snoozeRes = await patch<{ itemKey: string }>('/x/people/followups', {
      kind: 'reup_candidate',
      tweetId: REUP_ID,
      snoozedUntil: until,
    });
    expect(snoozeRes.status).toBe(200);
    expect(snoozeRes.body.itemKey).toBe(`reup:${REUP_ID}`);

    let { body } = await getJson<FollowupsBody>('/x/people/followups');
    expect(reupItem(body)).toBeUndefined();
    expect(body.counts.snoozed).toBeGreaterThanOrEqual(1);

    await patch('/x/people/followups', {
      kind: 'reup_candidate',
      tweetId: REUP_ID,
      snoozedUntil: null,
    });
    ({ body } = await getJson<FollowupsBody>('/x/people/followups'));
    expect(reupItem(body)).toBeDefined();
  });

  test('PATCH reup_candidate requires a numeric tweetId', async () => {
    expect(
      (await patch('/x/people/followups', { kind: 'reup_candidate', snoozedUntil: null })).status,
    ).toBe(400);
    expect(
      (
        await patch('/x/people/followups', {
          kind: 'reup_candidate',
          tweetId: 'nope',
          snoozedUntil: null,
        })
      ).status,
    ).toBe(400);
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

  test('GET /people/fans counts engagements in-window without ranking on them', async () => {
    const { body } = await getJson<{
      fans: Array<{
        handle: string;
        inboundCount: number;
        engagementCount: number;
        lastInboundAt: string;
        lastOutboundAt: string | null;
      }>;
    }>('/x/people/fans?days=30&limit=100');

    const lo = body.fans.find((f) => f.handle === FAN_LO);
    expect(lo?.inboundCount).toBe(2);
    // 3 in-window likes; the 40d-old one is outside the window.
    expect(lo?.engagementCount).toBe(3);

    const hi = body.fans.find((f) => f.handle === FAN_HI);
    expect(hi?.inboundCount).toBe(3);
    expect(hi?.engagementCount).toBe(0);

    // Ranking is inbound-only: more engagement must not lift FAN_LO.
    const iHi = body.fans.findIndex((f) => f.handle === FAN_HI);
    const iLo = body.fans.findIndex((f) => f.handle === FAN_LO);
    expect(iHi).toBeGreaterThanOrEqual(0);
    expect(iHi).toBeLessThan(iLo);

    // Stronger than the pair: re-rank the returned rows with engagementCount
    // stripped and assert the whole page comes back in the same order.
    const reranked = rankFans(
      body.fans.map((f) => ({
        handle: f.handle,
        inboundCount: f.inboundCount,
        lastInboundAt: new Date(f.lastInboundAt),
        lastOutboundAt: f.lastOutboundAt === null ? null : new Date(f.lastOutboundAt),
      })),
    );
    expect(reranked.map((f) => f.handle)).toEqual(body.fans.map((f) => f.handle));
  });

  test('GET /people/fans validates days', async () => {
    expect((await app.request('/x/people/fans?days=0')).status).toBe(400);
    expect((await app.request('/x/people/fans?days=nope')).status).toBe(400);
  });

  test('cleanup', async () => {
    // Keep the shared in-memory DB tidy for other suites.
    await db.delete(mentions).where(eq(mentions.tweetId, THEIR_REPLY_ID));
    await db.delete(postsPublished).where(eq(postsPublished.tweetId, MY_REPLY_ID));
    await db.delete(metricsSnapshots).where(eq(metricsSnapshots.tweetId, REUP_ID));
    await db.delete(postsPublished).where(eq(postsPublished.tweetId, REUP_ID));
    await db.delete(scheduledPosts).where(eq(scheduledPosts.id, REUP_SCHED_ID));
    await db.delete(followupSnoozes).where(eq(followupSnoozes.itemKey, `neglected_ally:${ALLY}`));
    await db.delete(followupSnoozes).where(eq(followupSnoozes.itemKey, `reup:${REUP_ID}`));
    for (const h of [ALLY, FAN, FAN_HI, FAN_LO]) {
      await db.delete(personEvents).where(eq(personEvents.handle, h));
      await db.delete(people).where(eq(people.handle, h));
    }
    expect(true).toBe(true);
  });
});
