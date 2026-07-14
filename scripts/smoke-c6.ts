// One-shot smoke test for CIRCLES-PLAN C6 (passive contact capture + Idea
// Inbox). Mounts the people/ideas/calendar routers in-process (no port, no
// workers, no Grok) against the real DB: walks a hover-sighting batch through
// the once-a-day event/snapshot gates, then the full idea lifecycle including
// the consume backlink and the calendar "seeded by" join. Deletes everything
// it created. $0.
// Run: bun run scripts/smoke-c6.ts

import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../src/db/client.ts';
import {
  ideas,
  people,
  personEvents,
  personSnapshots,
  scheduledPosts,
} from '../src/x/db/schema.ts';
import { calendar } from '../src/x/routes/calendar.ts';
import { consumeIdeaSafe, ideasRouter } from '../src/x/routes/ideas.ts';
import { peopleRouter } from '../src/x/routes/people.ts';

const HANDLE = 'smoke_c6_hover';

const app = new Hono();
app.route('/x', peopleRouter);
app.route('/x', ideasRouter);
app.route('/x', calendar);

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

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

async function cleanup(): Promise<void> {
  await db.delete(personSnapshots).where(eq(personSnapshots.handle, HANDLE));
  await db.delete(personEvents).where(eq(personEvents.handle, HANDLE));
  await db.delete(people).where(eq(people.handle, HANDLE));
}

// Start clean in case an earlier run died mid-way.
await cleanup();

// 1. Hover sightings: first of the day creates person + event + snapshot.
type SightRes = { processed: number; events: number; snapshots: number; skipped: number };
let sight = await send<SightRes>('/x/people/sightings', 'POST', {
  sightings: [
    {
      handle: `@${HANDLE}`,
      card: { displayName: 'Smoke Hover', bio: 'ships agents', followersCount: 3200 },
      seenAt: new Date().toISOString(),
    },
  ],
});
if (sight.status !== 200) fail(`sightings POST returned ${sight.status}`);
if (sight.body.events !== 1 || sight.body.snapshots !== 1) {
  fail(`first sighting expected 1 event + 1 snapshot, got ${JSON.stringify(sight.body)}`);
}
const [person] = await db.select().from(people).where(eq(people.handle, HANDLE));
if (!person || person.source !== 'hover' || person.stage !== 'noticed') {
  fail(`person row wrong: ${JSON.stringify(person)}`);
}
console.log('sighting #1: person created (source=hover, stage=noticed), event + snapshot logged');

// 2. Same-day re-sighting: no new event, no new snapshot.
sight = await send<SightRes>('/x/people/sightings', 'POST', {
  sightings: [{ handle: HANDLE, card: { followersCount: 3210 }, seenAt: new Date().toISOString() }],
});
if (sight.body.events !== 0 || sight.body.snapshots !== 0) {
  fail(`same-day resend should gate to 0/0, got ${JSON.stringify(sight.body)}`);
}
console.log('sighting #2 (same day): once-a-day gates held');

// 3. Idea lifecycle: create → consume (backlinked to a draft post) → seededBy.
type IdeaRow = { id: string; status: string; consumedByTable: string | null };
const created = await send<IdeaRow>('/x/ideas', 'POST', {
  text: 'smoke: Monday idea seeds Thursday post',
  sourceUrl: 'https://example.com/smoke',
});
if (created.status !== 201) fail(`idea create returned ${created.status}`);

const [post] = await db
  .insert(scheduledPosts)
  .values({ text: 'smoke seeded post', status: 'draft', source: 'drafter' })
  .returning();
if (!post) fail('scheduled post insert failed');

await consumeIdeaSafe(created.body.id, 'scheduled_posts', post.id);
const consumed = await send<{ ideas: IdeaRow[] }>('/x/ideas?status=consumed', 'GET');
if (!consumed.body.ideas.some((i) => i.id === created.body.id)) fail('idea not consumed');

const detail = await send<{ seededBy: { id: string } | null }>(
  `/x/posts/scheduled/${post.id}`,
  'GET',
);
if (detail.body.seededBy?.id !== created.body.id) fail('calendar seededBy join missing');
console.log('idea: created → consumed with backlink → calendar detail shows "seeded by"');

// 4. Reopen clears provenance; delete removes the row.
const reopened = await send<IdeaRow>(`/x/ideas/${created.body.id}`, 'PATCH', { status: 'open' });
if (reopened.body.status !== 'open' || reopened.body.consumedByTable !== null) {
  fail('reopen did not clear provenance');
}
const del = await send(`/x/ideas/${created.body.id}`, 'DELETE');
if (del.status !== 204) fail(`idea delete returned ${del.status}`);
console.log('idea: reopen cleared backlink, delete OK');

// 5. Cleanup.
await db.delete(scheduledPosts).where(eq(scheduledPosts.id, post.id));
await cleanup();
console.log('cleanup done');
console.log('SMOKE PASS');
process.exit(0);
