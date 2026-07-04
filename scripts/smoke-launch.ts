// One-shot smoke test for CIRCLES-PLAN C7 (Launch Room ingest). Mounts the
// launch router in-process (no port, no workers) against the real DB: posts a
// batch of fake early repliers, checks the person upsert + the deterministic
// inbound event id (shared with the mention pull), re-posts to prove
// idempotency, then deletes every row it created. $0.
// Run: bun run scripts/smoke-launch.ts

import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../src/db/client.ts';
import { people, personEvents } from '../src/x/db/schema.ts';
import { launch } from '../src/x/routes/launch.ts';

const H = 'smoke_c7_fan';
const TWEET_ID = '999900000000000001';

const app = new Hono();
app.route('/x', launch);

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

async function cleanup(): Promise<void> {
  await db.delete(personEvents).where(eq(personEvents.handle, H));
  await db.delete(people).where(eq(people.handle, H));
}

async function post(body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app.request('/x/launch/replies', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

// Start clean in case an earlier run died mid-way.
await cleanup();

// 1. Validation guards.
if ((await post({})).status !== 400) fail('missing replies should 400');
if ((await post({ replies: [{ tweetId: 'nope', handle: H, text: 'x' }] })).status !== 400) {
  fail('non-numeric tweetId should 400');
}

// 2. First batch: person created (source launch), inbound event logged with
// the mention-pull-compatible deterministic id.
const first = await post({
  replies: [
    {
      tweetId: TWEET_ID,
      handle: H,
      author: 'Smoke Fan',
      text: 'first!',
      postedAt: new Date().toISOString(),
    },
    { tweetId: TWEET_ID, handle: H, text: 'dupe in batch' },
    { tweetId: '999900000000000002', handle: '!!bad handle!!', text: 'skipped row' },
  ],
});
if (first.status !== 200) fail(`ingest should 200, got ${first.status}`);
if (first.body.processed !== 1) fail(`processed should be 1, got ${first.body.processed}`);
if (first.body.skipped !== 1) fail(`skipped should be 1, got ${first.body.skipped}`);

const [person] = await db.select().from(people).where(eq(people.handle, H));
if (!person) fail('person row missing');
if (person.source !== 'launch') fail(`source should be launch, got ${person.source}`);
if (person.displayName !== 'Smoke Fan') fail('displayName not filled from author');
if (!person.lastInboundAt) fail('lastInboundAt not stamped');

const events = await db.select().from(personEvents).where(eq(personEvents.handle, H));
if (events.length !== 1) fail(`expected 1 event, got ${events.length}`);
if (events[0]?.id !== `their_mention:mentions:${TWEET_ID}`) {
  fail(`event id should share the mention pull's id space, got ${events[0]?.id}`);
}

// 3. Re-post the same replier — INSERT OR IGNORE keeps one event.
const again = await post({ replies: [{ tweetId: TWEET_ID, handle: H, text: 'first!' }] });
if (again.status !== 200) fail('re-post should 200');
const after = await db.select().from(personEvents).where(eq(personEvents.handle, H));
if (after.length !== 1) fail(`re-post should not double-log, got ${after.length} events`);

await cleanup();
console.log(
  'OK: C7 launch ingest — guards, person upsert, deterministic event id, idempotent re-post, cleaned up.',
);
