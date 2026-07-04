// C8 channels: CRUD guards, the tag-write paths on voice tweets / radar
// drafts, and the aggregate room shape — all over the real (in-memory,
// auto-migrated) SQLite DB; bun test runs with SQLITE_PATH=:memory:.

import { afterAll, describe, expect, test } from 'bun:test';
import { inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import {
  channels,
  ideas,
  metricsSnapshots,
  people,
  postsPublished,
  radarDrafts,
  scheduledPosts,
  voiceAuthors,
  voiceTweets,
} from '../db/schema.ts';
import { channelsRouter, parseChannelTags } from './channels.ts';
import { radar } from './radar.ts';
import { createVoiceRouter } from './voice.ts';

const app = new Hono();
app.route('/x', channelsRouter);
app.route('/x', radar);
app.route('/x', createVoiceRouter());

const SLUG = 'ai-agents-test';
const HANDLE = 'channeltester';
const VOICE_TWEET_ID = '990000000000000001';
const RADAR_TWEET_ID = '990000000000000002';
const OWN_TWEET_ID = '990000000000000003';
const PILLAR = 'test-pillar-c8';

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

afterAll(async () => {
  await db.delete(channels).where(inArray(channels.slug, [SLUG, `${SLUG}-2`]));
  await db.delete(metricsSnapshots).where(inArray(metricsSnapshots.tweetId, [OWN_TWEET_ID]));
  await db.delete(postsPublished).where(inArray(postsPublished.tweetId, [OWN_TWEET_ID]));
  await db.delete(scheduledPosts).where(inArray(scheduledPosts.postedTweetId, [OWN_TWEET_ID]));
  await db.delete(radarDrafts).where(inArray(radarDrafts.tweetId, [RADAR_TWEET_ID]));
  await db.delete(voiceTweets).where(inArray(voiceTweets.tweetId, [VOICE_TWEET_ID]));
  await db.delete(voiceAuthors).where(inArray(voiceAuthors.handle, [HANDLE]));
  await db.delete(people).where(inArray(people.handle, [HANDLE]));
  await db.delete(ideas).where(inArray(ideas.text, ['c8 test idea']));
});

describe('channel CRUD', () => {
  test('create → list → patch → duplicate 409', async () => {
    const created = await send<Record<string, unknown>>('/x/channels', 'POST', {
      slug: SLUG,
      label: '#ai-agents',
      color: '#7aa2f7',
      pillar: PILLAR,
      keywords: ['agents', 'claude'],
    });
    expect(created.status).toBe(201);
    expect(created.body.slug).toBe(SLUG);
    expect(created.body.keywords).toEqual(['agents', 'claude']);

    const dup = await send('/x/channels', 'POST', { slug: SLUG, label: 'dup' });
    expect(dup.status).toBe(409);

    const list = await send<{ slug: string }[]>('/x/channels', 'GET');
    expect(list.status).toBe(200);
    expect(list.body.some((ch) => ch.slug === SLUG)).toBe(true);

    const patched = await send<Record<string, unknown>>(`/x/channels/${SLUG}`, 'PATCH', {
      label: '#ai-agents!',
      keywords: ['agents'],
    });
    expect(patched.status).toBe(200);
    expect(patched.body.label).toBe('#ai-agents!');
    expect(patched.body.keywords).toEqual(['agents']);
  });

  test('validation guards', async () => {
    expect((await send('/x/channels', 'POST', { slug: 'Bad Slug', label: 'x' })).status).toBe(400);
    expect((await send('/x/channels', 'POST', { slug: 'ok-slug', label: '' })).status).toBe(400);
    expect((await send(`/x/channels/${SLUG}`, 'PATCH', {})).status).toBe(400);
    expect((await send('/x/channels/nope-not-here', 'GET')).status).toBe(404);
  });
});

describe('tag write paths', () => {
  test('voice tweet tags: replace, additive merge, both-at-once 400', async () => {
    await db
      .insert(voiceAuthors)
      .values({ handle: HANDLE, displayName: 'Channel Tester' })
      .onConflictDoNothing();
    await db
      .insert(voiceTweets)
      .values({
        tweetId: VOICE_TWEET_ID,
        authorHandle: HANDLE,
        text: 'agents are eating software',
        createdAt: new Date(),
      })
      .onConflictDoNothing();

    const replaced = await send<{ tags: string[] | null }>(
      `/x/voice/tweets/${VOICE_TWEET_ID}`,
      'PATCH',
      { tags: [SLUG] },
    );
    expect(replaced.status).toBe(200);
    expect(replaced.body.tags).toEqual([SLUG]);

    const added = await send<{ tags: string[] | null }>(
      `/x/voice/tweets/${VOICE_TWEET_ID}`,
      'PATCH',
      { addTags: ['other-room', SLUG] },
    );
    expect(added.status).toBe(200);
    expect(added.body.tags).toEqual([SLUG, 'other-room']);

    const both = await send(`/x/voice/tweets/${VOICE_TWEET_ID}`, 'PATCH', {
      tags: [SLUG],
      addTags: [SLUG],
    });
    expect(both.status).toBe(400);

    // retired still works alongside tags on the same PATCH surface.
    const retired = await send<{ retired: boolean }>(`/x/voice/tweets/${VOICE_TWEET_ID}`, 'PATCH', {
      retired: false,
    });
    expect(retired.status).toBe(200);
  });

  test('radar draft tags by tweetId', async () => {
    await db.insert(radarDrafts).values({
      tweetId: RADAR_TWEET_ID,
      url: null,
      handle: HANDLE,
      author: null,
      snippet: 'hot take about agents',
      band: 'hot',
      signals: null,
      replyText: 'drafted reply',
      angle: 'extends',
    });

    const tagged = await send<{ updated: number; tags: string[] | null }>(
      `/x/radar/drafts/${RADAR_TWEET_ID}/tags`,
      'PATCH',
      { tags: [SLUG] },
    );
    expect(tagged.status).toBe(200);
    expect(tagged.body.updated).toBe(1);
    expect(tagged.body.tags).toEqual([SLUG]);

    const missing = await send('/x/radar/drafts/990099009900990099/tags', 'PATCH', {
      tags: [SLUG],
    });
    expect(missing.status).toBe(404);

    const bad = await send(`/x/radar/drafts/${RADAR_TWEET_ID}/tags`, 'PATCH', {});
    expect(bad.status).toBe(400);
  });
});

describe('the aggregate room', () => {
  test('GET /channels/:slug returns every tagged surface + pillar posts with outcomes', async () => {
    await db
      .insert(people)
      .values({ handle: HANDLE, displayName: 'Channel Tester', stage: 'engaged', tags: [SLUG] })
      .onConflictDoUpdate({ target: people.handle, set: { tags: [SLUG], retired: false } });
    await db.insert(ideas).values({ text: 'c8 test idea', tags: [SLUG] });

    // A posted own tweet in the mapped pillar, with one measured snapshot.
    const [sp] = await db
      .insert(scheduledPosts)
      .values({
        text: 'my agents post',
        status: 'posted',
        postedTweetId: OWN_TWEET_ID,
        pillar: PILLAR,
      })
      .returning();
    expect(sp).toBeDefined();
    await db.insert(postsPublished).values({
      tweetId: OWN_TWEET_ID,
      text: 'my agents post',
      postedAt: new Date(),
      source: 'test',
    });
    await db.insert(metricsSnapshots).values({
      tweetId: OWN_TWEET_ID,
      publicMetrics: { impression_count: 1200, like_count: 9, reply_count: 3 },
      nonPublicMetrics: { user_profile_clicks: 4 },
    });

    interface Aggregate {
      channel: { slug: string; pillar: string | null };
      people: { handle: string; stage: string }[];
      voiceTweets: { tweetId: string; authorHandle: string }[];
      ideas: { text: string }[];
      radarDrafts: { tweetId: string }[];
      posts: {
        pillar: string;
        count: number;
        measured: number;
        medianViews: number | null;
        items: { postedTweetId: string | null; outcome: { views: number | null } | null }[];
      } | null;
    }

    const res = await send<Aggregate>(`/x/channels/${SLUG}`, 'GET');
    expect(res.status).toBe(200);
    expect(res.body.channel.slug).toBe(SLUG);
    expect(res.body.people.some((p) => p.handle === HANDLE && p.stage === 'engaged')).toBe(true);
    expect(res.body.voiceTweets.some((t) => t.tweetId === VOICE_TWEET_ID)).toBe(true);
    expect(res.body.ideas.some((i) => i.text === 'c8 test idea')).toBe(true);
    expect(res.body.radarDrafts.some((d) => d.tweetId === RADAR_TWEET_ID)).toBe(true);

    expect(res.body.posts).not.toBeNull();
    expect(res.body.posts?.pillar).toBe(PILLAR);
    expect(res.body.posts?.count).toBe(1);
    expect(res.body.posts?.measured).toBe(1);
    expect(res.body.posts?.medianViews).toBe(1200);
    expect(res.body.posts?.items[0]?.outcome?.views).toBe(1200);
  });

  test('a channel without a pillar link has posts: null', async () => {
    const created = await send<Record<string, unknown>>('/x/channels', 'POST', {
      slug: `${SLUG}-2`,
      label: 'no pillar',
    });
    expect(created.status).toBe(201);
    const res = await send<{ posts: unknown }>(`/x/channels/${SLUG}-2`, 'GET');
    expect(res.status).toBe(200);
    expect(res.body.posts).toBeNull();

    const del = await send(`/x/channels/${SLUG}-2`, 'DELETE');
    expect(del.status).toBe(200);
  });
});

describe('parseChannelTags', () => {
  test('trims, lowercases, dedupes; null clears; junk rejected', () => {
    expect(parseChannelTags([' AI-Agents ', 'ai-agents'])).toEqual(['ai-agents']);
    expect(parseChannelTags(null)).toBeNull();
    expect(parseChannelTags(['', 'ok'])).toBe('invalid');
    expect(parseChannelTags('not-an-array')).toBe('invalid');
  });
});
