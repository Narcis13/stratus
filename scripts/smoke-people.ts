// One-shot smoke test for CIRCLES-PLAN C1 (people + dossier). Mounts the
// people router in-process (no port, no workers) against the real DB: creates
// a throwaway person, walks the full stage ladder event by event, checks the
// dossier + list + PATCH + manual-event routes and idempotent re-logging, then
// deletes every row it created. $0.
// Run: bun run scripts/smoke-people.ts

import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../src/db/client.ts';
import { people, personEvents, personSnapshots } from '../src/x/db/schema.ts';
import { type PersonEventInput, logPersonEvents } from '../src/x/people/store.ts';
import { peopleRouter } from '../src/x/routes/people.ts';

const H = 'smoke_c1_person';
const H2 = 'smoke_c1_manual';
const DAY_MS = 24 * 60 * 60 * 1000;

const app = new Hono();
app.route('/x', peopleRouter);

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

async function cleanup(): Promise<void> {
  for (const h of [H, H2]) {
    await db.delete(personEvents).where(eq(personEvents.handle, h));
    await db.delete(personSnapshots).where(eq(personSnapshots.handle, h));
    await db.delete(people).where(eq(people.handle, h));
  }
}

async function stageOf(handle: string): Promise<string> {
  const [row] = await db
    .select({ stage: people.stage })
    .from(people)
    .where(eq(people.handle, handle));
  if (!row) fail(`person ${handle} missing`);
  return row.stage;
}

function ev(
  type: PersonEventInput['type'],
  refId: string,
  daysAgo: number,
  hourUtc: number,
): PersonEventInput {
  const at = new Date(Date.now() - daysAgo * DAY_MS);
  at.setUTCHours(hourUtc, 0, 0, 0);
  return { handle: H, type, refTable: 'smoke', refId, at, summary: `smoke ${type}` };
}

// Start clean in case an earlier run died mid-way.
await cleanup();

// 1. Walk the ladder: noticed → engaged → responded → mutual → ally.
await logPersonEvents([ev('saved_tweet', 's1', 90, 10)], { source: 'voice' });
if ((await stageOf(H)) !== 'noticed') fail('saved_tweet should notice');

await logPersonEvents([ev('my_reply', 'r1', 40, 9)], { source: 'reply' });
if ((await stageOf(H)) !== 'engaged') fail('my_reply should engage');

await logPersonEvents([ev('their_mention', 'm1', 40, 12)], { source: 'mention' });
if ((await stageOf(H)) !== 'mutual') {
  // day -40 has both directions = 1 exchange day → responded; need a second.
  if ((await stageOf(H)) !== 'responded') fail('inbound after reply should respond');
}

await logPersonEvents([ev('my_reply', 'r2', 30, 9), ev('their_reply_to_me', 'm2', 30, 13)], {
  source: 'mention',
});
if ((await stageOf(H)) !== 'mutual') fail('2 exchange days should be mutual');

await logPersonEvents(
  [
    ev('my_reply', 'r3', 20, 9),
    ev('their_mention', 'm3', 20, 13),
    ev('my_reply', 'r4', 10, 9),
    ev('their_mention', 'm4', 10, 13),
  ],
  { source: 'mention' },
);
if ((await stageOf(H)) !== 'ally') fail('4 exchange days in 60d should be ally');
console.log('stage ladder: noticed → engaged → responded → mutual → ally OK');

// 2. Idempotency — re-log everything; event count must not move.
const countEvents = async () =>
  (await db.select().from(personEvents).where(eq(personEvents.handle, H))).length;
const before = await countEvents();
await logPersonEvents(
  [ev('saved_tweet', 's1', 90, 10), ev('my_reply', 'r1', 40, 9), ev('their_mention', 'm1', 40, 12)],
  { source: 'voice' },
);
if ((await countEvents()) !== before) fail('re-log duplicated events');
console.log(`idempotent re-log OK (${before} events)`);

// 3. List + dossier.
let r = await app.request(`/x/people?stage=ally&q=${H}`);
if (r.status !== 200) fail(`GET /people returned ${r.status}`);
const list = (await r.json()) as { people: Array<{ handle: string; inboundCount: number }> };
const listed = list.people.find((p) => p.handle === H);
if (!listed) fail('ally not in filtered list');
if (listed.inboundCount !== 4) fail(`expected 4 inbound, got ${listed.inboundCount}`);

r = await app.request(`/x/people/${H}`);
if (r.status !== 200) fail(`dossier returned ${r.status}`);
const dossier = (await r.json()) as {
  person: { stage: string; lastInboundAt: string | null; lastOutboundAt: string | null };
  events: unknown[];
  replies: { outcomes: unknown[] };
  followerSeries: unknown[];
};
if (dossier.person.stage !== 'ally') fail('dossier stage wrong');
if (dossier.events.length !== before) fail('dossier timeline incomplete');
if (!dossier.person.lastInboundAt || !dossier.person.lastOutboundAt) {
  fail('inbound/outbound watermarks not stamped');
}
console.log('list + dossier OK');

// 4. PATCH: notes, tags, manual demote.
r = await app.request(`/x/people/${H}`, {
  method: 'PATCH',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ notes: 'smoke note', tags: ['smoke'], stage: 'mutual' }),
});
if (r.status !== 200) fail(`PATCH returned ${r.status}`);
if ((await stageOf(H)) !== 'mutual') fail('manual demote did not stick');
console.log('PATCH notes/tags/demote OK');

// 5. Manual event creates a person.
r = await app.request(`/x/people/${H2}/events`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ type: 'manual_dm_logged', summary: 'smoke DM' }),
});
if (r.status !== 201) fail(`POST events returned ${r.status}`);
if ((await stageOf(H2)) !== 'stranger') fail('manual event should not advance stage');
console.log('manual event + person create OK');

// 6. Cleanup.
await cleanup();
console.log('cleanup: removed throwaway people');
console.log('SMOKE PASS');
process.exit(0);
