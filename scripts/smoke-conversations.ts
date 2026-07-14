// One-shot smoke test for CIRCLES-PLAN C2 (conversations & open loops). Mounts
// the conversations router in-process (no port, no workers) against the real
// DB: seeds one chain exchange (my reply → their reply to it) and one settled
// thread, checks grouping/ranking/chain flag, walks read → snooze → mute meta
// flips, then deletes every row it created. $0.
// Run: bun run scripts/smoke-conversations.ts

import { eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../src/db/client.ts';
import { conversationMeta, mentions, postsPublished } from '../src/x/db/schema.ts';
import { conversations } from '../src/x/routes/conversations.ts';

const CONV_CHAIN = '997000000000000001';
const CONV_SETTLED = '997000000000000002';
const MY_REPLY = '997100000000000001';
const THEIR_REPLY = '997200000000000001';
const THEIR_PRAISE = '997200000000000002';

const app = new Hono();
app.route('/x', conversations);

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

interface ThreadJson {
  conversationId: string;
  items: Array<{ kind: string; tweetId: string }>;
  openLoop: boolean;
  chain: boolean;
  owedSince: string | null;
  unread: boolean;
  snoozed: boolean;
  muted: boolean;
}

async function fetchThreads(): Promise<ThreadJson[]> {
  const r = await app.request('/x/conversations');
  if (r.status !== 200) fail(`GET /x/conversations returned ${r.status}`);
  const body = (await r.json()) as { threads: ThreadJson[] };
  return body.threads.filter((t) => [CONV_CHAIN, CONV_SETTLED].includes(t.conversationId));
}

async function cleanup(): Promise<number> {
  const m = await db
    .delete(mentions)
    .where(inArray(mentions.tweetId, [THEIR_REPLY, THEIR_PRAISE]))
    .returning({ id: mentions.tweetId });
  const p = await db
    .delete(postsPublished)
    .where(eq(postsPublished.tweetId, MY_REPLY))
    .returning({ id: postsPublished.tweetId });
  const c = await db
    .delete(conversationMeta)
    .where(inArray(conversationMeta.conversationId, [CONV_CHAIN, CONV_SETTLED]))
    .returning({ id: conversationMeta.conversationId });
  return m.length + p.length + c.length;
}

// Start clean in case an earlier run died mid-way.
await cleanup();

const now = Date.now();

// 1. Seed: my reply 2h ago, their unanswered reply to it 1h ago (chain loop);
// plus an answered mention in a second conversation (settled).
await db.insert(postsPublished).values({
  tweetId: MY_REPLY,
  text: 'smoke: my reply',
  postedAt: new Date(now - 2 * 3_600_000),
  isReply: true,
  conversationId: CONV_CHAIN,
  source: 'smoke',
});
await db.insert(mentions).values([
  {
    tweetId: THEIR_REPLY,
    authorUsername: 'smoke_chainer',
    authorName: 'Smoke Chainer',
    text: 'smoke: replying to your reply',
    postedAt: new Date(now - 3_600_000),
    conversationId: CONV_CHAIN,
    inReplyToTweetId: MY_REPLY,
    status: 'unanswered',
  },
  {
    tweetId: THEIR_PRAISE,
    authorUsername: 'smoke_fan',
    authorName: null,
    text: 'smoke: nice post',
    postedAt: new Date(now - 30 * 60_000),
    conversationId: CONV_SETTLED,
    inReplyToTweetId: null,
    status: 'answered',
  },
]);

// 2. Grouping, interleave, open loop + chain flag.
let threads = await fetchThreads();
if (threads.length !== 2) fail(`expected 2 threads, got ${threads.length}`);
const chain = threads.find((t) => t.conversationId === CONV_CHAIN);
if (!chain) fail('chain thread missing');
if (chain.items.map((i) => i.kind).join() !== 'outbound,inbound') {
  fail(`chain thread items wrong: ${chain.items.map((i) => i.kind).join()}`);
}
if (!chain.openLoop || !chain.chain) fail('chain thread not flagged openLoop+chain');
if (!chain.unread) fail('fresh thread should be unread');
if (threads[0]?.conversationId !== CONV_CHAIN) fail('chain loop did not rank first');
const settled = threads.find((t) => t.conversationId === CONV_SETTLED);
if (!settled || settled.openLoop) fail('answered mention should not be an open loop');
console.log('grouping: chain loop first, settled thread quiet OK');

// 3. Meta flips: read, snooze, mute — and their effect on the next GET.
const patch = (id: string, body: unknown) =>
  app.request(`/x/conversations/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

let r = await patch(CONV_CHAIN, { read: true });
if (r.status !== 200) fail(`PATCH read returned ${r.status}`);
threads = await fetchThreads();
if (threads.find((t) => t.conversationId === CONV_CHAIN)?.unread !== false) {
  fail('read marker did not clear unread');
}

r = await patch(CONV_CHAIN, { snoozedUntil: new Date(now + 3_600_000).toISOString() });
if (r.status !== 200) fail(`PATCH snooze returned ${r.status}`);
threads = await fetchThreads();
const snoozed = threads.find((t) => t.conversationId === CONV_CHAIN);
if (!snoozed?.snoozed) fail('snooze did not stick');
if (threads[0]?.conversationId === CONV_CHAIN) fail('snoozed loop should not rank first');

r = await patch(CONV_CHAIN, { snoozedUntil: null, muted: true });
if (r.status !== 200) fail(`PATCH mute returned ${r.status}`);
threads = await fetchThreads();
const muted = threads.find((t) => t.conversationId === CONV_CHAIN);
if (!muted?.muted || muted.snoozed) fail('mute/unsnooze did not stick');
console.log('meta flips: read / snooze / mute OK');

// 4. Cleanup.
const gone = await cleanup();
console.log(`cleanup: removed ${gone} rows`);
console.log('SMOKE PASS');
process.exit(0);
