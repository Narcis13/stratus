// C10 notification engagement harvest: the pure dedupe/id/prefix-match core and
// the ingest over the real (in-memory, auto-migrated) SQLite DB; bun test runs
// with SQLITE_PATH=:memory:.
//
// Shared-DB discipline (§9): the seeded posts_published rows carry a January
// postedAt and no metrics snapshot, so they fall outside every window/measured
// aggregation other suites assert over, and they are deleted again here.

import { afterAll, describe, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { people, personEvents, postsPublished } from '../db/schema.ts';
import { peopleRouter } from '../routes/people.ts';
import {
  type EngagementInput,
  dedupeEngagements,
  engagementEventId,
  engagementSummary,
  isEngagementKind,
  matchTargetTweetId,
  recordEngagements,
  resolveTargetTweetId,
} from './engagements.ts';

const app = new Hono();
app.route('/x', peopleRouter);

const at = (iso: string) => new Date(iso);

const eng = (over: Partial<EngagementInput> = {}): EngagementInput => ({
  kind: 'like',
  handle: 'someone',
  targetText: null,
  seenAt: at('2026-07-20T10:00:00Z'),
  ...over,
});

describe('dedupeEngagements', () => {
  test('one row per (kind, handle, target); freshest seenAt wins', () => {
    const out = dedupeEngagements([
      eng({ handle: 'alice', targetText: 'the same post', seenAt: at('2026-07-20T10:00:00Z') }),
      eng({ handle: 'alice', targetText: 'the same post', seenAt: at('2026-07-20T10:04:00Z') }),
      eng({ handle: 'alice', targetText: 'a different post' }),
      eng({ handle: 'alice', kind: 'repost', targetText: 'the same post' }),
      eng({ handle: 'bob', targetText: 'the same post' }),
    ]);
    expect(out.length).toBe(4);
    const alicesLike = out.find(
      (e) => e.handle === 'alice' && e.kind === 'like' && e.targetText === 'the same post',
    );
    expect(alicesLike?.seenAt.toISOString()).toBe('2026-07-20T10:04:00.000Z');
  });

  test('follows collapse by handle (targetText is always null)', () => {
    const out = dedupeEngagements([
      eng({ kind: 'follow', handle: 'alice' }),
      eng({ kind: 'follow', handle: 'alice', seenAt: at('2026-07-20T11:00:00Z') }),
    ]);
    expect(out.length).toBe(1);
  });
});

describe('engagementEventId', () => {
  const seenAt = at('2026-07-20T23:30:00Z');

  test('resolved target → the tweet id; unresolved → the UTC day bucket', () => {
    expect(engagementEventId('like', 'alice', '1234', seenAt)).toBe('their_like:notif:alice:1234');
    expect(engagementEventId('like', 'alice', null, seenAt)).toBe(
      'their_like:notif:alice:2026-07-20',
    );
    expect(engagementEventId('repost', 'alice', '1234', seenAt)).toBe(
      'their_repost:notif:alice:1234',
    );
  });

  test('a follow logs once, ever — no date, no target', () => {
    expect(engagementEventId('follow', 'alice', '1234', seenAt)).toBe('their_follow:notif:alice');
    expect(engagementEventId('follow', 'alice', null, at('2027-01-01T00:00:00Z'))).toBe(
      'their_follow:notif:alice',
    );
  });
});

describe('engagementSummary', () => {
  test('reads as a timeline line', () => {
    expect(engagementSummary('like', 'Ship it, then fix it')).toBe('liked: "Ship it, then fix it"');
    expect(engagementSummary('repost', null)).toBe('reposted a post');
    expect(engagementSummary('follow', null)).toBe('followed you');
  });
});

describe('matchTargetTweetId', () => {
  const posts = [
    { tweetId: 'new', text: 'The unsexy problems are\n\nwhere the money is' },
    { tweetId: 'old', text: 'The unsexy problems are boring and that is the point' },
  ];

  test('prefix match across collapsed whitespace, newest post wins', () => {
    expect(matchTargetTweetId('The unsexy problems are where the money', posts)).toBe('new');
    expect(matchTargetTweetId('The unsexy problems are boring and that', posts)).toBe('old');
  });

  test('a short snippet is never evidence (<20 chars)', () => {
    expect(matchTargetTweetId('The unsexy', posts)).toBeNull();
  });

  test('no prefix hit and null input resolve to null', () => {
    expect(matchTargetTweetId('Something else entirely here', posts)).toBeNull();
    expect(matchTargetTweetId(null, posts)).toBeNull();
  });
});

describe('isEngagementKind', () => {
  test("accepts the three wire kinds and refuses the parser's 'other'", () => {
    expect(isEngagementKind('like')).toBe(true);
    expect(isEngagementKind('repost')).toBe(true);
    expect(isEngagementKind('follow')).toBe(true);
    expect(isEngagementKind('other')).toBe(false);
    expect(isEngagementKind(undefined)).toBe(false);
  });
});

describe('recordEngagements', () => {
  const H = 'nt2_engager';
  // Both handles must satisfy USERNAME_RE (≤15 chars) or normalizePersonHandle
  // skips them and every assertion below goes vacuous.
  const MUTUAL = 'nt2_mutual';
  const POSTS = ['nt2_post_new', 'nt2_post_old'];
  const TARGET_TEXT = 'The unsexy problems are where the money actually is';

  const seedPosts = async () => {
    await db
      .insert(postsPublished)
      .values([
        {
          tweetId: 'nt2_post_old',
          text: 'Something entirely different that nobody liked',
          postedAt: at('2026-01-10T09:00:00Z'),
          isReply: false,
          source: 'test',
        },
        {
          tweetId: 'nt2_post_new',
          text: `${TARGET_TEXT}\n\nand the boring work compounds`,
          postedAt: at('2026-01-20T09:00:00Z'),
          isReply: false,
          source: 'test',
        },
      ])
      .onConflictDoNothing();
  };

  const cleanup = async () => {
    await db.delete(personEvents).where(inArray(personEvents.handle, [H, MUTUAL]));
    await db.delete(people).where(inArray(people.handle, [H, MUTUAL]));
    await db.delete(postsPublished).where(inArray(postsPublished.tweetId, POSTS));
  };

  afterAll(cleanup);

  test('creates the person (source notification, stage stranger), resolves the target, is idempotent', async () => {
    await cleanup();
    await seedPosts();
    const seenAt = at('2026-07-20T10:00:00Z');
    const batch: EngagementInput[] = [
      { kind: 'like', handle: `@${H}`, targetText: `${TARGET_TEXT} and the boring`, seenAt },
      { kind: 'repost', handle: H, targetText: 'a post stratus has never published', seenAt },
      { kind: 'follow', handle: H, targetText: null, seenAt },
    ];

    const first = await recordEngagements(batch);
    expect(first).toMatchObject({ received: 3, processed: 3, skipped: 0, events: 3 });

    const [person] = await db.select().from(people).where(eq(people.handle, H));
    expect(person?.source).toBe('notification');
    // Decision 1: engagement is timeline-only — no stage movement, ever.
    expect(person?.stage).toBe('stranger');
    expect(person?.lastSeenAt?.toISOString()).toBe(seenAt.toISOString());
    expect(person?.lastInboundAt).toBeNull();

    const events = await db.select().from(personEvents).where(eq(personEvents.handle, H));
    expect(events.map((e) => e.id).sort()).toEqual([
      `their_follow:notif:${H}`,
      `their_like:notif:${H}:nt2_post_new`, // snippet prefix-matched the seeded post
      `their_repost:notif:${H}:2026-07-20`, // unresolved → day bucket
    ]);
    expect(events.find((e) => e.type === 'their_follow')?.summary).toBe('followed you');
    expect(events.every((e) => e.refTable === null && e.refId === null)).toBe(true);

    // Same batch again (a re-scroll of the same page) → no new events.
    const second = await recordEngagements(batch);
    expect(second).toMatchObject({ processed: 3, events: 0 });
    const after = await db.select().from(personEvents).where(eq(personEvents.handle, H));
    expect(after.length).toBe(3);

    // Next day, still unresolved → one new day-bucket event; the follow never repeats.
    const nextDay = await recordEngagements([
      {
        kind: 'repost',
        handle: H,
        targetText: 'a post stratus has never published',
        seenAt: at('2026-07-21T09:00:00Z'),
      },
      { kind: 'follow', handle: H, targetText: null, seenAt: at('2026-07-21T09:00:00Z') },
    ]);
    expect(nextDay.events).toBe(1);

    await cleanup();
  });

  test('invalid handles are skipped, not fatal; the upsert is fill-only', async () => {
    await cleanup();
    await db.insert(people).values({ handle: H, displayName: 'Enriched', source: 'voice' });

    const res = await recordEngagements([
      {
        kind: 'like',
        handle: 'not!a!handle',
        targetText: null,
        seenAt: at('2026-07-20T10:00:00Z'),
      },
      { kind: 'like', handle: H, targetText: null, seenAt: at('2026-07-20T10:00:00Z') },
    ]);
    expect(res).toMatchObject({ received: 2, processed: 1, skipped: 1, events: 1 });

    const [person] = await db.select().from(people).where(eq(people.handle, H));
    expect(person?.displayName).toBe('Enriched'); // a notification glimpse never clobbers
    expect(person?.source).toBe('voice');

    await cleanup();
  });

  test('a mutual person liking posts stays mutual (ratchet holds)', async () => {
    await cleanup();
    await db.insert(people).values({ handle: MUTUAL, stage: 'mutual', source: 'reply' });
    await db.insert(personEvents).values([
      {
        id: `my_reply:test:${MUTUAL}:1`,
        handle: MUTUAL,
        type: 'my_reply',
        at: at('2026-07-01T09:00:00Z'),
      },
      {
        id: `their_mention:test:${MUTUAL}:1`,
        handle: MUTUAL,
        type: 'their_mention',
        at: at('2026-07-01T12:00:00Z'),
      },
    ]);

    const res = await recordEngagements([
      { kind: 'like', handle: MUTUAL, targetText: null, seenAt: at('2026-07-20T10:00:00Z') },
      { kind: 'follow', handle: MUTUAL, targetText: null, seenAt: at('2026-07-20T10:00:00Z') },
    ]);
    expect(res).toMatchObject({ processed: 2, skipped: 0, events: 2 });

    const [person] = await db.select().from(people).where(eq(people.handle, MUTUAL));
    expect(person?.stage).toBe('mutual');
    // Their inbound watermark is untouched by the engagement events.
    expect(person?.lastInboundAt?.toISOString()).toBe('2026-07-01T12:00:00.000Z');

    await cleanup();
  });

  test('resolveTargetTweetId reads the own-post window from the DB', async () => {
    await cleanup();
    await seedPosts();
    expect(await resolveTargetTweetId(`${TARGET_TEXT} and`)).toBe('nt2_post_new');
    expect(await resolveTargetTweetId('nothing stratus ever posted here')).toBeNull();
    expect(await resolveTargetTweetId(null)).toBeNull();
    await cleanup();
  });

  test('an empty batch does nothing', async () => {
    expect(await recordEngagements([])).toEqual({
      received: 0,
      processed: 0,
      skipped: 0,
      events: 0,
    });
  });
});

describe('POST /x/people/engagements', () => {
  // ≤15 chars or normalizePersonHandle skips it and the assertions go vacuous.
  const H = 'nt3_route_eng';

  const send = async (body: unknown) => {
    const res = await app.request('/x/people/engagements', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  const at = new Date('2026-07-20T10:00:00Z').toISOString();

  const cleanup = async () => {
    await db.delete(personEvents).where(eq(personEvents.handle, H));
    await db.delete(people).where(eq(people.handle, H));
  };

  afterAll(cleanup);

  test('ingests a batch, creates the normalized person, reports counts', async () => {
    await cleanup();
    const { status, body } = await send({
      engagements: [
        { kind: 'like', handle: `@${H}`, targetText: 'a post stratus never published', seenAt: at },
        { kind: 'follow', handle: H, targetText: null, seenAt: at },
      ],
    });
    expect(status).toBe(200);
    expect(body).toMatchObject({ received: 2, processed: 2, skipped: 0, events: 2 });

    const [person] = await db.select().from(people).where(eq(people.handle, H));
    expect(person?.source).toBe('notification');
    expect(person?.stage).toBe('stranger');

    // Re-posting the same batch (a re-scroll) logs nothing new.
    expect(
      (await send({ engagements: [{ kind: 'follow', handle: H, seenAt: at }] })).body,
    ).toMatchObject({
      processed: 1,
      events: 0,
    });

    await cleanup();
  });

  test('an invalid handle is skipped, not fatal', async () => {
    await cleanup();
    const { status, body } = await send({
      engagements: [
        { kind: 'like', handle: 'not!a!handle', seenAt: at },
        { kind: 'like', handle: H, seenAt: at },
      ],
    });
    expect(status).toBe(200);
    expect(body).toMatchObject({ received: 2, processed: 1, skipped: 1 });
    await cleanup();
  });

  test('targetText is forced null on a follow, so two follow cells collapse to one', async () => {
    await cleanup();
    const { body } = await send({
      engagements: [
        {
          kind: 'follow',
          handle: H,
          targetText: 'their bio, which X sometimes renders',
          seenAt: at,
        },
        { kind: 'follow', handle: H, targetText: null, seenAt: at },
      ],
    });
    expect(body).toMatchObject({ received: 2, processed: 1, events: 1 });
    await cleanup();
  });

  test('validation: body, empty/oversize batch, bad kind, handle, targetText, seenAt', async () => {
    expect((await send([])).status).toBe(400);
    expect((await send({})).status).toBe(400);
    expect((await send({ engagements: [] })).status).toBe(400);

    const oversize = await send({
      engagements: Array.from({ length: 51 }, (_, i) => ({
        kind: 'like',
        handle: `h${i}`,
        seenAt: at,
      })),
    });
    expect(oversize.status).toBe(400);
    expect(oversize.body.error).toBe('too_many_engagements');

    // The parser's 'other' kind is dropped client-side; the server refuses it.
    const badKind = await send({ engagements: [{ kind: 'other', handle: H, seenAt: at }] });
    expect(badKind.status).toBe(400);
    expect(badKind.body.error).toBe('invalid_engagement_kind_0');

    expect((await send({ engagements: [null] })).status).toBe(400);
    expect((await send({ engagements: [{ kind: 'like', handle: 42, seenAt: at }] })).status).toBe(
      400,
    );
    expect(
      (await send({ engagements: [{ kind: 'like', handle: H, targetText: 7, seenAt: at }] }))
        .status,
    ).toBe(400);
    expect(
      (await send({ engagements: [{ kind: 'like', handle: H, seenAt: 'not-a-date' }] })).status,
    ).toBe(400);
    expect((await send({ engagements: [{ kind: 'like', handle: H }] })).status).toBe(400);

    // Every guard fires pre-DB — nothing was written.
    const rows = await db.select().from(people).where(eq(people.handle, H));
    expect(rows.length).toBe(0);
  });
});
