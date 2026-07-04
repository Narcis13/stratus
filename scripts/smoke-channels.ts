// One-shot smoke test for CIRCLES-PLAN C8 (channels). Mounts the channels,
// voice and radar routers in-process (no port, no workers, no Grok) against
// the real DB: creates a channel with keywords + a pillar link, tags a voice
// tweet / person / idea / radar draft into it, verifies the aggregate room
// shows all of them plus the pillar's own-post outcomes, walks the tag-write
// PATCHes and the channel PATCH/DELETE, then deletes every row it created. $0.
// Run: bun run scripts/smoke-channels.ts

import { eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../src/db/client.ts';
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
} from '../src/x/db/schema.ts';
import { channelsRouter } from '../src/x/routes/channels.ts';
import { radar } from '../src/x/routes/radar.ts';
import { createVoiceRouter } from '../src/x/routes/voice.ts';

const SLUG = 'smoke-channel-c8';
const HANDLE = 'smoke_channels';
const VOICE_TWEET = '980000000000000001';
const RADAR_TWEET = '980000000000000002';
const OWN_TWEET = '980000000000000003';
const PILLAR = 'smoke-pillar-c8';

const app = new Hono();
app.route('/x', channelsRouter);
app.route('/x', radar);
app.route('/x', createVoiceRouter());

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

const send = (path: string, method = 'GET', body?: unknown) =>
  app.request(path, {
    method,
    ...(body !== undefined
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });

async function cleanup(): Promise<void> {
  await db.delete(channels).where(eq(channels.slug, SLUG));
  await db.delete(metricsSnapshots).where(eq(metricsSnapshots.tweetId, OWN_TWEET));
  await db.delete(scheduledPosts).where(eq(scheduledPosts.postedTweetId, OWN_TWEET));
  await db.delete(postsPublished).where(eq(postsPublished.tweetId, OWN_TWEET));
  await db.delete(radarDrafts).where(eq(radarDrafts.tweetId, RADAR_TWEET));
  await db.delete(voiceTweets).where(eq(voiceTweets.tweetId, VOICE_TWEET));
  await db.delete(voiceAuthors).where(eq(voiceAuthors.handle, HANDLE));
  await db.delete(people).where(eq(people.handle, HANDLE));
  await db.delete(ideas).where(inArray(ideas.text, ['smoke c8 idea']));
}

// Start clean in case an earlier run died mid-way.
await cleanup();

// 1. Create the channel (keywords + pillar link).
let r = await send('/x/channels', 'POST', {
  slug: SLUG,
  label: '#smoke-c8',
  color: '#7aa2f7',
  pillar: PILLAR,
  keywords: ['smokeword'],
});
if (r.status !== 201) fail(`POST /channels returned ${r.status}`);
console.log(`channel created: #${SLUG}`);

// 2. Seed one row per surface and tag them in.
await db.insert(voiceAuthors).values({ handle: HANDLE, displayName: 'Smoke Channels' });
await db.insert(voiceTweets).values({
  tweetId: VOICE_TWEET,
  authorHandle: HANDLE,
  text: 'a smokeword tweet worth stealing structure from',
  createdAt: new Date(),
});
r = await send(`/x/voice/tweets/${VOICE_TWEET}`, 'PATCH', { addTags: [SLUG] });
if (r.status !== 200) fail(`voice addTags returned ${r.status}`);

await db.insert(people).values({ handle: HANDLE, stage: 'engaged', tags: [SLUG] });
await db.insert(ideas).values({ text: 'smoke c8 idea', tags: [SLUG] });

await db.insert(radarDrafts).values({
  tweetId: RADAR_TWEET,
  handle: HANDLE,
  snippet: 'smoke radar sighting',
  band: 'warm',
  replyText: 'smoke radar reply',
  angle: 'extends',
});
r = await send(`/x/radar/drafts/${RADAR_TWEET}/tags`, 'PATCH', { tags: [SLUG] });
if (r.status !== 200) fail(`radar tags returned ${r.status}`);

// Own post in the mapped pillar, with one measured snapshot.
await db.insert(scheduledPosts).values({
  text: 'my smoke pillar post',
  status: 'posted',
  postedTweetId: OWN_TWEET,
  pillar: PILLAR,
});
await db.insert(postsPublished).values({
  tweetId: OWN_TWEET,
  text: 'my smoke pillar post',
  postedAt: new Date(),
  source: 'smoke',
});
await db.insert(metricsSnapshots).values({
  tweetId: OWN_TWEET,
  publicMetrics: { impression_count: 777, like_count: 5 },
  nonPublicMetrics: { user_profile_clicks: 2 },
});
console.log('seeded: voice tweet, person, idea, radar draft, pillar post');

// 3. The room shows all of it.
r = await send(`/x/channels/${SLUG}`);
if (r.status !== 200) fail(`GET /channels/${SLUG} returned ${r.status}`);
const room = (await r.json()) as {
  people: { handle: string }[];
  voiceTweets: { tweetId: string }[];
  ideas: { text: string }[];
  radarDrafts: { tweetId: string }[];
  posts: { measured: number; medianViews: number | null } | null;
};
if (!room.people.some((p) => p.handle === HANDLE)) fail('person missing from room');
if (!room.voiceTweets.some((t) => t.tweetId === VOICE_TWEET)) fail('voice tweet missing');
if (!room.ideas.some((i) => i.text === 'smoke c8 idea')) fail('idea missing');
if (!room.radarDrafts.some((d) => d.tweetId === RADAR_TWEET)) fail('radar draft missing');
if (!room.posts || room.posts.measured !== 1 || room.posts.medianViews !== 777) {
  fail(`pillar posts wrong: ${JSON.stringify(room.posts)}`);
}
console.log('aggregate room OK: people + swipe file + ideas + radar + pillar outcomes');

// 4. Untag (replace) drops the row from the room.
r = await send(`/x/voice/tweets/${VOICE_TWEET}`, 'PATCH', { tags: [] });
if (r.status !== 200) fail(`voice tags replace returned ${r.status}`);
r = await send(`/x/channels/${SLUG}`);
const after = (await r.json()) as { voiceTweets: { tweetId: string }[] };
if (after.voiceTweets.some((t) => t.tweetId === VOICE_TWEET)) fail('untagged tweet still in room');
console.log('untag OK');

// 5. Channel PATCH + clean DELETE (tags on rows stay behind, harmlessly).
r = await send(`/x/channels/${SLUG}`, 'PATCH', { active: false });
if (r.status !== 200) fail(`PATCH channel returned ${r.status}`);
r = await send(`/x/channels/${SLUG}`, 'DELETE');
if (r.status !== 200) fail(`DELETE channel returned ${r.status}`);
r = await send(`/x/channels/${SLUG}`);
if (r.status !== 404) fail('deleted channel still resolves');
const [orphan] = await db
  .select({ tags: people.tags })
  .from(people)
  .where(eq(people.handle, HANDLE));
if (!orphan?.tags?.includes(SLUG)) fail('person tag should survive channel delete');
console.log('channel PATCH/DELETE OK (row tags survive as plain strings)');

// 6. Cleanup.
await cleanup();
console.log('cleanup done');
console.log('SMOKE PASS');
process.exit(0);
