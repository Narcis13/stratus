// One-shot $0 smoke for the C10 notifications surface (NT.1–NT.7). Mounts the
// followups + people routers in-process against the real DB (no port, no
// workers, no X API, no Grok) and drives the engagement harvest end-to-end:
// POST a synthetic batch of likes/repost/follow -> assert the person rows, the
// three deterministic id shapes and target resolution -> re-POST the identical
// batch and assert zero new events -> assert engagement never moves a stage and
// never makes a fan -> clean up every row it created.
// Sync cleanup (bun:sqlite is synchronous) also runs from fail(), so a mid-run
// abort never leaves rows behind. Run: bun run scripts/smoke-notifications.ts

import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../src/db/client.ts';
import { people, personEvents, postsPublished } from '../src/x/db/schema.ts';
import { logPersonEvents, upsertPerson } from '../src/x/people/store.ts';
import { followups } from '../src/x/routes/followups.ts';
import { peopleRouter } from '../src/x/routes/people.ts';

// Both ≤15 chars: normalizePersonHandle silently skips anything longer, which
// would make every downstream assertion vacuous.
const FAN = 'nt7_notif_fan';
const LURKER = 'nt7_lurker';

const OWN_TWEET = '97100000000000001';
const OWN_TEXT =
  'The unsexy problem nobody writes about is that most of the work is waiting for a form to be approved.';
// What a notification cell actually shows: the post, truncated by X. The server
// prefix-matches this against recent own posts (≥20 chars, else no evidence).
const TARGET_SNIPPET = OWN_TEXT.slice(0, 52);
const NO_MATCH_SNIPPET = 'A post that stratus never published, so nothing can resolve it';

const DAY_MS = 24 * 60 * 60 * 1000;
const SEEN_AT = new Date();
const DAY_BUCKET = SEEN_AT.toISOString().slice(0, 10);

// Mirror mountX's order — the static /people/fans must beat the :handle dossier
// route (§7.20).
const app = new Hono();
app.route('/x', followups);
app.route('/x', peopleRouter);

interface EngagementPayload {
  kind: 'like' | 'repost' | 'follow';
  handle: string;
  targetText: string | null;
  seenAt: string;
}

interface EngagementResult {
  received: number;
  processed: number;
  skipped: number;
  events: number;
}

const BATCH: EngagementPayload[] = [
  { kind: 'like', handle: FAN, targetText: TARGET_SNIPPET, seenAt: SEEN_AT.toISOString() },
  { kind: 'repost', handle: FAN, targetText: NO_MATCH_SNIPPET, seenAt: SEEN_AT.toISOString() },
  { kind: 'follow', handle: FAN, targetText: null, seenAt: SEEN_AT.toISOString() },
  { kind: 'like', handle: LURKER, targetText: TARGET_SNIPPET, seenAt: SEEN_AT.toISOString() },
];

function cleanup(): void {
  try {
    for (const handle of [FAN, LURKER]) {
      db.delete(personEvents).where(eq(personEvents.handle, handle)).run();
      db.delete(people).where(eq(people.handle, handle)).run();
    }
    db.delete(postsPublished).where(eq(postsPublished.tweetId, OWN_TWEET)).run();
  } catch (err) {
    console.error('cleanup failed:', err instanceof Error ? err.message : err);
  }
}

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  cleanup();
  process.exit(1);
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function postEngagements(engagements: unknown): Promise<Response> {
  return app.request('/x/people/engagements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ engagements }),
  });
}

// Leftovers from an aborted run would make the idempotency step lie.
cleanup();

// --------------------------------------------------------------- seed

// The post the like lands on. retired: true is a cost guard, not decoration —
// if this script dies before cleanup, a non-retired own post would be picked up
// by the next daily 03:00 UTC pass and billed a real read (invariant #7).
await db.insert(postsPublished).values({
  tweetId: OWN_TWEET,
  text: OWN_TEXT,
  postedAt: new Date(SEEN_AT.getTime() - 3 * DAY_MS),
  isReply: false,
  source: 'smoke',
  retired: true,
});

// The fan exists BEFORE the harvest, enriched and labelled by another source —
// so the fill-only upsert has something it could wrongly clobber.
await upsertPerson(FAN, { source: 'mention', fields: { displayName: 'NT7 Fan' } });
await logPersonEvents(
  [
    {
      handle: FAN,
      type: 'their_mention',
      id: `their_mention:notif_smoke:${FAN}`,
      summary: 'mentioned you',
      at: new Date(SEEN_AT.getTime() - 2 * DAY_MS),
    },
  ],
  { source: 'mention' },
);

// ------------------------------------------------------- 1. ingest a batch

const res1 = await postEngagements(BATCH);
if (res1.status !== 200) fail(`engagements POST returned ${res1.status}`);
const first = await json<EngagementResult>(res1);
console.log(`ingest: ${JSON.stringify(first)}`);
if (first.received !== 4 || first.processed !== 4 || first.skipped !== 0 || first.events !== 4) {
  fail(`expected received/processed 4, skipped 0, events 4 — got ${JSON.stringify(first)}`);
}

// ------------------------------------- 2. id shapes + target resolution

const EXPECTED_IDS = [
  // Resolved: the snippet is a prefix of a real own post, so the event is
  // anchored to that tweet forever.
  `their_like:notif:${FAN}:${OWN_TWEET}`,
  // Unresolved: day bucket, so the same like re-logs at most once a day.
  `their_repost:notif:${FAN}:${DAY_BUCKET}`,
  // A follow logs once, ever.
  `their_follow:notif:${FAN}`,
  `their_like:notif:${LURKER}:${OWN_TWEET}`,
];

const rows = await db
  .select({ id: personEvents.id, type: personEvents.type, summary: personEvents.summary })
  .from(personEvents)
  .where(eq(personEvents.handle, FAN));
const lurkerRows = await db
  .select({ id: personEvents.id })
  .from(personEvents)
  .where(eq(personEvents.handle, LURKER));

const ids = new Set([...rows.map((r) => r.id), ...lurkerRows.map((r) => r.id)]);
for (const id of EXPECTED_IDS) {
  if (!ids.has(id)) fail(`missing event id ${id} (have: ${[...ids].join(', ')})`);
}
console.log(`ids: ${EXPECTED_IDS.join(' | ')}`);

const followSummary = rows.find((r) => r.type === 'their_follow')?.summary;
if (followSummary !== 'followed you') fail(`follow summary was ${followSummary}`);

// ---------------------------------------------- 3. person rows + fill-only

const [fanRow] = await db
  .select({ source: people.source, displayName: people.displayName, stage: people.stage })
  .from(people)
  .where(eq(people.handle, FAN));
const [lurkerRow] = await db
  .select({ source: people.source, stage: people.stage })
  .from(people)
  .where(eq(people.handle, LURKER));

if (!fanRow || !lurkerRow) fail('person rows missing after ingest');
if (lurkerRow.source !== 'notification') {
  fail(`expected the harvested person's source 'notification', got '${lurkerRow.source}'`);
}
if (fanRow.source !== 'mention' || fanRow.displayName !== 'NT7 Fan') {
  fail(`fill-only violated: source=${fanRow.source} displayName=${fanRow.displayName}`);
}
console.log(`people: ${LURKER} source=notification · ${FAN} kept source=mention + displayName`);

// ------------------------------------------------------- 4. idempotency

const second = await json<EngagementResult>(await postEngagements(BATCH));
console.log(`re-ingest: ${JSON.stringify(second)}`);
if (second.processed !== 4 || second.events !== 0) {
  fail(`re-posting the identical batch wrote ${second.events} events (expected 0)`);
}

// ------------------------------------------ 5. stage is untouched (decision 1)

for (const handle of [FAN, LURKER]) {
  const dossier = await json<{ person: { stage: string }; events: { summary: string | null }[] }>(
    await app.request(`/x/people/${handle}`),
  );
  if (dossier.person.stage !== 'stranger') {
    fail(`${handle} advanced to '${dossier.person.stage}' — engagement must be timeline-only`);
  }
  if (!dossier.events.some((e) => e.summary?.startsWith('liked'))) {
    fail(`${handle}'s timeline is missing the like`);
  }
}
console.log('stage: both people still stranger, engagements visible on the timeline');

// ------------------------------------ 6. fans — count shown, ranking untouched

interface FanRow {
  handle: string;
  inboundCount: number;
  engagementCount: number;
}
const fans = await json<{ fans: FanRow[] }>(await app.request('/x/people/fans?days=30&limit=100'));
const fan = fans.fans.find((f) => f.handle === FAN);
if (!fan) fail(`${FAN} missing from /x/people/fans`);
if (fan.inboundCount !== 1) fail(`inboundCount ${fan.inboundCount} — engagement leaked into it`);
if (fan.engagementCount !== 3) fail(`expected engagementCount 3, got ${fan.engagementCount}`);
// The lurker has three engagements and not one word exchanged: fans is an
// inbound-only list, so it must not appear at all.
if (fans.fans.some((f) => f.handle === LURKER)) {
  fail(`${LURKER} ranked as a fan on engagement alone`);
}
console.log(`fans: ${FAN} inbound=1 engagements=3 · ${LURKER} absent (display-only holds)`);

// ------------------------------------------- 7. the kind whitelist is the gate

const bad = await postEngagements([
  { kind: 'other', handle: LURKER, targetText: null, seenAt: SEEN_AT.toISOString() },
]);
if (bad.status !== 400) fail(`kind 'other' returned ${bad.status}, expected 400`);
console.log("guard: kind 'other' rejected 400 (the parser's drop is re-enforced server-side)");

// ------------------------------------------------------------- 8. cleanup

cleanup();
const after = await app.request(`/x/people/${FAN}`);
if (after.status !== 404) fail(`${FAN} survived cleanup (${after.status})`);
const fansAfter = await json<{ fans: FanRow[] }>(
  await app.request('/x/people/fans?days=30&limit=100'),
);
if (fansAfter.fans.some((f) => f.handle === FAN)) fail('fan survived cleanup');
console.log('cleanup: people, events and the seeded post removed');

console.log('SMOKE OK');
process.exit(0);
