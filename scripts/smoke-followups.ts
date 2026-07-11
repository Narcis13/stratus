// One-shot smoke test for CIRCLES-PLAN C5 (follow-up queue + Top Fans).
// Mounts the followups + people routers in-process against the real DB: seeds
// a live chain (my reply + their fresh reply to it), a neglected ally, a top
// fan and a voice author with an inflecting follower series, checks the queue
// classification/ranking, the snooze round-trip and the fans window, then
// deletes every row it created. $0 — nothing touches the X API or Grok.
// Run: bun run scripts/smoke-followups.ts

import { eq, like } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../src/db/client.ts';
import {
  followupSnoozes,
  mentions,
  metricsSnapshots,
  people,
  personEvents,
  postsPublished,
  scheduledPosts,
  voiceAuthorSnapshots,
  voiceAuthors,
} from '../src/x/db/schema.ts';
import { logPersonEvents } from '../src/x/people/store.ts';
import { followups } from '../src/x/routes/followups.ts';
import { peopleRouter } from '../src/x/routes/people.ts';

const ALLY = 'smoke_c5_ally';
const FAN = 'smoke_c5_fan';
const CHAIN = 'smoke_c5_chain';
const RISER = 'smoke_c5_riser';
const MY_REPLY_ID = '96000000000000001';
const THEIR_REPLY_ID = '96000000000000002';
const REUP_ID = '96000000000000030';
const REUP_SCHED_ID = 'smoke_c5_reup_sched';
const DAY_MS = 24 * 60 * 60 * 1000;

// Mirror mountX's order — followups must beat the :handle dossier route.
const app = new Hono();
app.route('/x', followups);
app.route('/x', peopleRouter);

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

async function cleanup(): Promise<void> {
  await db.delete(mentions).where(eq(mentions.tweetId, THEIR_REPLY_ID));
  await db.delete(postsPublished).where(eq(postsPublished.tweetId, MY_REPLY_ID));
  await db.delete(metricsSnapshots).where(eq(metricsSnapshots.tweetId, REUP_ID));
  await db.delete(postsPublished).where(eq(postsPublished.tweetId, REUP_ID));
  await db.delete(scheduledPosts).where(eq(scheduledPosts.id, REUP_SCHED_ID));
  await db.delete(followupSnoozes).where(like(followupSnoozes.itemKey, '%smoke_c5_%'));
  await db.delete(followupSnoozes).where(eq(followupSnoozes.itemKey, `reup:${REUP_ID}`));
  await db.delete(voiceAuthorSnapshots).where(eq(voiceAuthorSnapshots.handle, RISER));
  await db.delete(voiceAuthors).where(eq(voiceAuthors.handle, RISER));
  for (const h of [ALLY, FAN, CHAIN, RISER]) {
    await db.delete(personEvents).where(eq(personEvents.handle, h));
    await db.delete(people).where(eq(people.handle, h));
  }
}

interface QueueBody {
  counts: { total: number; snoozed: number; byKind: Record<string, number> };
  items: Array<{ kind: string; handle: string; tweetId?: string; url?: string; reason: string }>;
}

function reupOf(q: QueueBody) {
  return q.items.find((i) => i.kind === 'reup_candidate' && i.tweetId === REUP_ID);
}

async function queue(): Promise<QueueBody> {
  const r = await app.request('/x/people/followups');
  if (r.status !== 200) fail(`GET /people/followups returned ${r.status}`);
  return (await r.json()) as QueueBody;
}

await cleanup(); // start clean in case an earlier run died mid-way

// 1. Seed: neglected ally (two exchange days 40d ago, silence since).
const old = Date.now() - 40 * DAY_MS;
await logPersonEvents(
  [
    { handle: ALLY, type: 'my_reply', refTable: 'smoke', refId: 'r1', at: new Date(old) },
    {
      handle: ALLY,
      type: 'their_mention',
      refTable: 'smoke',
      refId: 'm1',
      at: new Date(old + 3_600_000),
    },
    {
      handle: ALLY,
      type: 'my_reply',
      refTable: 'smoke',
      refId: 'r2',
      at: new Date(old + 2 * DAY_MS),
    },
    {
      handle: ALLY,
      type: 'their_reply_to_me',
      refTable: 'smoke',
      refId: 'm2',
      at: new Date(old + 2 * DAY_MS + 3_600_000),
    },
  ],
  { source: 'smoke' },
);
// The backfill stamps stageUpdatedAt "now" (reads as a fresh dm_ready advance)
// — backdate to the real promotion moment.
await db
  .update(people)
  .set({ stageUpdatedAt: new Date(old + 2 * DAY_MS + 3_600_000) })
  .where(eq(people.handle, ALLY));

// 2. Seed: top fan — 3 inbound this week, never acknowledged.
await logPersonEvents(
  [1, 2, 3].map((n) => ({
    handle: FAN,
    type: 'their_mention' as const,
    refTable: 'smoke',
    refId: `f${n}`,
    at: new Date(Date.now() - n * DAY_MS),
  })),
  { source: 'smoke' },
);

// 3. Seed: live chain — my published reply + their unanswered reply to it, 1h old.
await db.insert(postsPublished).values({
  tweetId: MY_REPLY_ID,
  text: 'smoke: my reply',
  postedAt: new Date(Date.now() - 3 * 3_600_000),
  isReply: true,
  source: 'smoke',
});
await db.insert(mentions).values({
  tweetId: THEIR_REPLY_ID,
  authorUsername: CHAIN,
  authorName: 'Smoke Chain',
  text: 'smoke: they came back',
  postedAt: new Date(Date.now() - 3_600_000),
  inReplyToTweetId: MY_REPLY_ID,
  status: 'unanswered',
});

// 4. Seed: momentum riser — voice author whose series inflects upward
//    (~+2%/wk for two weeks, then +8%/wk in the latest week).
await db.insert(voiceAuthors).values({ handle: RISER, displayName: 'Smoke Riser' });
for (const [daysAgo, followers] of [
  [21, 960],
  [7, 1000],
  [0, 1080],
] as const) {
  await db.insert(voiceAuthorSnapshots).values({
    handle: RISER,
    followersCount: followers,
    capturedAt: new Date(Date.now() - daysAgo * DAY_MS),
  });
}

// 4b. Seed: re-up candidate — my own non-reply post 21d old, one snapshot far
//     above the winner bar, not yet quote-tweeted.
await db.insert(postsPublished).values({
  tweetId: REUP_ID,
  text: 'smoke: my proven winner',
  postedAt: new Date(Date.now() - 21 * DAY_MS),
  isReply: false,
  source: 'smoke',
});
await db.insert(metricsSnapshots).values({
  tweetId: REUP_ID,
  publicMetrics: { impression_count: 250_000 },
  snapshotAt: new Date(Date.now() - 20 * DAY_MS),
});

// 5. The queue classifies and ranks.
let q = await queue();
const kinds = new Map(q.items.map((i) => [i.handle, i.kind]));
if (kinds.get(CHAIN) !== 'chain_live') fail(`chain not classified (got ${kinds.get(CHAIN)})`);
if (kinds.get(ALLY) !== 'neglected_ally') fail(`ally not classified (got ${kinds.get(ALLY)})`);
if (kinds.get(RISER) !== 'momentum') fail(`riser not classified (got ${kinds.get(RISER)})`);
const order = q.items.map((i) => i.handle);
if (order.indexOf(CHAIN) > order.indexOf(ALLY)) fail('chain_live should outrank neglected_ally');
if (order.indexOf(ALLY) > order.indexOf(RISER)) fail('momentum should ride at the tail');
console.log('queue: chain_live + neglected_ally + momentum classified and ranked OK');
console.log(`  riser line: "${q.items.find((i) => i.handle === RISER)?.reason}"`);

// 5b. Re-up candidate surfaces, ranked between neglected_ally and momentum.
const reup = reupOf(q);
if (!reup) fail('re-up candidate missing from the queue');
if (reup.url !== `https://x.com/i/web/status/${REUP_ID}`) fail(`bad re-up url: ${reup.url}`);
const kindOrder = q.items.map((i) => i.kind);
const reupIdx = q.items.findIndex((i) => i.tweetId === REUP_ID);
if (kindOrder.lastIndexOf('neglected_ally') > reupIdx) fail('re-up should follow neglected_ally');
if (kindOrder.indexOf('momentum') !== -1 && reupIdx > kindOrder.indexOf('momentum')) {
  fail('re-up should rank above momentum');
}
console.log(`re-up candidate classified and ranked OK: "${reup.reason}"`);

// 5c. A winner already carrying a quote_tweet_id row is excluded.
await db.insert(scheduledPosts).values({
  id: REUP_SCHED_ID,
  text: 'smoke: quote draft',
  status: 'draft',
  source: 'drafter',
  quoteTweetId: REUP_ID,
});
if (reupOf(await queue())) fail('already-quoted winner should be excluded');
await db.delete(scheduledPosts).where(eq(scheduledPosts.id, REUP_SCHED_ID));
console.log('re-up exclusion (already quoted) OK');

// 5d. Re-up snooze round-trip (keyed on the tweet, not a handle).
let r = await app.request('/x/people/followups', {
  method: 'PATCH',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    kind: 'reup_candidate',
    tweetId: REUP_ID,
    snoozedUntil: new Date(Date.now() + 3_600_000).toISOString(),
  }),
});
if (r.status !== 200) fail(`PATCH reup snooze returned ${r.status}`);
if (reupOf(await queue())) fail('snoozed re-up still in queue');
r = await app.request('/x/people/followups', {
  method: 'PATCH',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ kind: 'reup_candidate', tweetId: REUP_ID, snoozedUntil: null }),
});
if (r.status !== 200) fail(`PATCH reup unsnooze returned ${r.status}`);
if (!reupOf(await queue())) fail('unsnoozed re-up missing from queue');
console.log('re-up snooze/unsnooze round-trip OK');

// 6. Snooze round-trip.
r = await app.request('/x/people/followups', {
  method: 'PATCH',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    kind: 'neglected_ally',
    handle: ALLY,
    snoozedUntil: new Date(Date.now() + 3_600_000).toISOString(),
  }),
});
if (r.status !== 200) fail(`PATCH snooze returned ${r.status}`);
q = await queue();
if (q.items.some((i) => i.handle === ALLY)) fail('snoozed ally still in queue');
r = await app.request('/x/people/followups', {
  method: 'PATCH',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ kind: 'neglected_ally', handle: ALLY, snoozedUntil: null }),
});
if (r.status !== 200) fail(`PATCH unsnooze returned ${r.status}`);
q = await queue();
if (!q.items.some((i) => i.handle === ALLY)) fail('unsnoozed ally missing from queue');
console.log('snooze/unsnooze round-trip OK');

// 7. Fans window.
r = await app.request('/x/people/fans?days=30&limit=100');
if (r.status !== 200) fail(`GET /people/fans returned ${r.status}`);
const fans = (await r.json()) as {
  fans: Array<{ handle: string; inboundCount: number; unacknowledged: boolean }>;
};
const fan = fans.fans.find((f) => f.handle === FAN);
if (!fan) fail('top fan missing');
if (fan.inboundCount !== 3) fail(`expected 3 inbound, got ${fan.inboundCount}`);
if (!fan.unacknowledged) fail('never-acknowledged fan should be flagged');
if (fans.fans.some((f) => f.handle === ALLY)) fail('40d-old inbound leaked into the 30d window');
console.log('fans ranking + acknowledgement OK');

// 8. Cleanup.
await cleanup();
console.log('cleanup: removed smoke rows');
console.log('SMOKE PASS');
process.exit(0);
