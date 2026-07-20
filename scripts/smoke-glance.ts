// One-shot $0 smoke for AX.1 (GET /x/people/glance — the timeline-decoration
// map). Mounts the people router in-process (no port, no workers, no X API)
// against the real DB: seeds a throwaway non-retired person plus one unanswered
// mention from them, asserts the glance map entry (stage + openLoops), then
// deletes the rows and verifies they're gone. Rerunnable — cleans up first in
// case a prior run crashed mid-way. Run: bun run scripts/smoke-glance.ts

import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../src/db/client.ts';
import { mentions, people } from '../src/x/db/schema.ts';
import { peopleRouter } from '../src/x/routes/people.ts';

const HANDLE = 'glance_smoke';
const MENTION_ID = 'glance_smoke_m1';
const app = new Hono();
app.route('/x', peopleRouter);

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

async function cleanup(): Promise<void> {
  await db.delete(mentions).where(eq(mentions.tweetId, MENTION_ID));
  await db.delete(people).where(eq(people.handle, HANDLE));
}

// Idempotent: clear any leftovers from a crashed prior run before seeding.
await cleanup();

const lastOutboundAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
await db.insert(people).values({
  handle: HANDLE,
  stage: 'mutual',
  lastOutboundAt,
  followersCount: 4200,
  retired: false,
});
// Mixed-case author exercises the lower() grouping; status='unanswered' → an
// open loop.
await db.insert(mentions).values({
  tweetId: MENTION_ID,
  authorUsername: 'Glance_Smoke',
  text: 'ping',
  postedAt: new Date(),
  status: 'unanswered',
});

const res = await app.request('/x/people/glance');
if (res.status !== 200) {
  await cleanup();
  fail(`glance returned ${res.status}`);
}
const body = (await res.json()) as {
  count: number;
  map: Record<
    string,
    {
      stage: string;
      isTarget: boolean;
      openLoops: number;
      lastOutboundAt: string | null;
      lastInboundAt: string | null;
      followersCount: number | null;
    }
  >;
};

const entry = body.map[HANDLE];
if (!entry) {
  await cleanup();
  fail(`seeded person missing from glance map (count=${body.count})`);
}
console.log(`glance entry: ${JSON.stringify(entry)}`);
if (entry.stage !== 'mutual') {
  await cleanup();
  fail(`expected stage 'mutual', got '${entry.stage}'`);
}
if (entry.openLoops !== 1) {
  await cleanup();
  fail(`expected openLoops 1, got ${entry.openLoops}`);
}
if (entry.lastOutboundAt !== lastOutboundAt.toISOString()) {
  await cleanup();
  fail(`lastOutboundAt mismatch: ${entry.lastOutboundAt}`);
}
if (entry.followersCount !== 4200) {
  await cleanup();
  fail(`followersCount mismatch: ${entry.followersCount}`);
}

// Cleanup and verify the person is gone from the next read.
await cleanup();
const after = (await (await app.request('/x/people/glance')).json()) as {
  map: Record<string, unknown>;
};
if (after.map[HANDLE]) fail('person survived cleanup');
console.log('cleanup: person + mention removed, absent from glance');

console.log('SMOKE OK');
process.exit(0);
