// One-shot $0 smoke for Harvest 2.0 — the passive timeline tap and its two
// readers (HV.1–HV.6). Mounts the harvest + playbook routers in-process against
// the real DB (no port, no workers, no X API, no Grok) and drives the phase
// end-to-end: POST a passive batch -> a server-created run per UTC day + rows;
// re-POST the same batch -> skippedRecent (the 30-min recapture gate); a
// same-batch duplicate -> skippedRecent too; an oversized batch -> 400 with
// nothing written; a 61-day-old passive run -> pruned by the next POST;
// GET /harvest/affinity -> the multi-day author ranks and the one-day authors
// are floored; GET /playbook -> timelineFunnel carries the seeded rows in the
// `unknown` band (no tweet_time => no age => nothing to classify, and never the
// real `null` band).
//
// Real-DB safety: every row this script writes carries an 888-prefixed tweet id
// (no real snowflake id starts there) and every run it seeds carries an hv6_*
// handle, so cleanup can never touch a genuine passive run or a hand harvest.
// If today's passive run already existed, it is kept and its row_count is
// recomputed from the surviving rows. Cleanup is synchronous (bun:sqlite is)
// and also runs from fail(), so a mid-run abort leaves nothing behind.
// Run: bun run scripts/smoke-passive-harvest.ts

import { and, desc, eq, gte, inArray, like } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../src/db/client.ts';
import { harvestRows, harvestRuns } from '../src/x/db/schema.ts';
import { harvest, utcDayStart } from '../src/x/routes/harvest.ts';
import { playbook } from '../src/x/routes/playbook.ts';

const app = new Hono();
app.route('/x', harvest);
app.route('/x', playbook);

// 18 digits, all ours: real tweet ids are 19-digit snowflakes starting 1/2, so
// the LIKE in cleanup() can never sweep a genuine row.
const TWEET_PREFIX = '888000000000000';
const tid = (n: number): string => `${TWEET_PREFIX}${String(n).padStart(3, '0')}`;

// ≤15 chars each (the USERNAME_RE the wire rows are validated against) and
// lowercase (handles are lowercased on every side, so seeds must be too).
const INGEST = 'hv6_ingest';
const SEEN = 'hv6_seen';
const SOLO = 'hv6_solo';
// Run handles no real harvest can produce — the whole cleanup key for runs.
const STALE_HANDLE = 'hv6_stale';
const SEED_HANDLE = 'hv6_seed';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_BATCH = 100;
const SEED_VIEWS = 1500;
const TWEET_TIME = new Date(Date.now() - 45 * 60 * 1000).toISOString();

// Today's passive run as it was before this script ran, if any — kept, never
// deleted; only its row_count is restored.
let preRunId: string | null = null;
// The run the route created for us (null when it reused preRunId).
let createdRunId: string | null = null;

function cleanup(): void {
  try {
    db.delete(harvestRows)
      .where(like(harvestRows.tweetId, `${TWEET_PREFIX}%`))
      .run();
    db.delete(harvestRuns)
      .where(inArray(harvestRuns.handle, [STALE_HANDLE, SEED_HANDLE]))
      .run();
    if (createdRunId) {
      db.delete(harvestRuns).where(eq(harvestRuns.id, createdRunId)).run();
      createdRunId = null;
    }
    if (preRunId) {
      // The route bumped row_count for rows that no longer exist — recompute it
      // from what survived rather than trusting a remembered number.
      const left = db
        .select({ id: harvestRows.id })
        .from(harvestRows)
        .where(eq(harvestRows.runId, preRunId))
        .all();
      db.update(harvestRuns)
        .set({ rowCount: left.length })
        .where(eq(harvestRuns.id, preRunId))
        .run();
    }
  } catch (err) {
    console.error('cleanup failed:', err instanceof Error ? err.message : err);
  }
}

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  cleanup();
  process.exit(1);
}

interface PassiveBody {
  runId: string;
  inserted: number;
  skippedRecent: number;
  skippedCap: number;
}

function wireRow(n: number, handle = INGEST): Record<string, unknown> {
  return {
    tweetId: tid(n),
    handle,
    text: 'hv6 smoke — an ambient home-timeline sighting',
    comments: 4,
    reposts: 1,
    likes: 21,
    bookmarks: 2,
    views: 3200,
    time: TWEET_TIME,
    hasPhoto: false,
    hasVideo: false,
    isQuote: false,
    textLen: 44,
    lineBreaks: 0,
  };
}

// `app.request` is typed Response | Promise<Response> — the helper must be
// async or root typecheck (which covers scripts/) rejects the return type.
async function postPassive(body: unknown): Promise<{ status: number; body: PassiveBody }> {
  const res = await app.request('/x/harvest/passive', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as PassiveBody };
}

async function countRows(): Promise<number> {
  const rows = await db
    .select({ id: harvestRows.id })
    .from(harvestRows)
    .where(like(harvestRows.tweetId, `${TWEET_PREFIX}%`));
  return rows.length;
}

// Leftovers from an aborted run would turn the first insert into a skippedRecent.
cleanup();

// ------------------------------------------------- 1. ingest: run + rows

const [existing] = await db
  .select()
  .from(harvestRuns)
  .where(and(eq(harvestRuns.mode, 'timeline'), gte(harvestRuns.createdAt, utcDayStart(new Date()))))
  .orderBy(desc(harvestRuns.createdAt))
  .limit(1);
preRunId = existing?.id ?? null;

const first = await postPassive({ rows: [wireRow(1), wireRow(2), wireRow(3)] });
if (first.status !== 201) fail(`POST /harvest/passive returned ${first.status}, expected 201`);
if (first.body.inserted !== 3) fail(`expected 3 inserted, got ${first.body.inserted}`);
if (first.body.skippedRecent !== 0)
  fail(`expected 0 skippedRecent, got ${first.body.skippedRecent}`);
if (first.body.skippedCap !== 0) {
  fail(`skippedCap ${first.body.skippedCap} — today's passive run is at the 2,000-row daily cap`);
}
const runId = first.body.runId;
if (runId !== preRunId) createdRunId = runId;

const [run] = await db.select().from(harvestRuns).where(eq(harvestRuns.id, runId));
if (!run) fail('the passive run the route returned does not exist');
if (run.mode !== 'timeline' || run.scope !== 'passive' || run.handle !== 'timeline') {
  fail(`passive run has the wrong shape: ${run.handle}/${run.mode}/${run.scope}`);
}
const stored = await db
  .select({ mode: harvestRows.mode, runId: harvestRows.runId })
  .from(harvestRows)
  .where(like(harvestRows.tweetId, `${TWEET_PREFIX}%`));
if (stored.length !== 3) fail(`expected 3 stored rows, got ${stored.length}`);
// mode is the ONLY discriminator between the ambient corpus and a hand harvest.
if (stored.some((r) => r.mode !== 'timeline')) fail("passive rows must store mode='timeline'");
if (stored.some((r) => r.runId !== runId)) fail('passive rows landed outside the returned run');
console.log(
  `ingest: 3 rows under one server-created run per UTC day (${createdRunId ? 'created' : 'reused'} ${runId})`,
);

// ------------------------------------- 2. the 30-min recapture gate holds

const again = await postPassive({ rows: [wireRow(1), wireRow(2), wireRow(3)] });
if (again.status !== 201) fail(`re-POST returned ${again.status}, expected 201`);
if (again.body.inserted !== 0) fail(`re-POST inserted ${again.body.inserted}, expected 0`);
if (again.body.skippedRecent !== 3) {
  fail(`re-POST skippedRecent ${again.body.skippedRecent}, expected 3`);
}
if (again.body.runId !== runId) fail('a second POST on the same UTC day forked a new run');
console.log('recapture: an immediate re-POST of the same tweets skips all 3 (skippedRecent)');

const dupe = await postPassive({ rows: [wireRow(4), wireRow(4)] });
if (dupe.body.inserted !== 1 || dupe.body.skippedRecent !== 1) {
  fail(`in-batch dupe: inserted ${dupe.body.inserted} / skipped ${dupe.body.skippedRecent}`);
}
console.log('recapture: the same tweet twice in one batch is one sighting');

// -------------------------------------------- 3. oversized batch refused

const before = await countRows();
const oversized = await app.request('/x/harvest/passive', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ rows: Array.from({ length: MAX_BATCH + 1 }, (_, i) => wireRow(900 + i)) }),
});
if (oversized.status !== 400) fail(`${MAX_BATCH + 1}-row batch returned ${oversized.status}`);
const oversizedBody = (await oversized.json()) as { error: string; max: number };
if (oversizedBody.error !== 'too_many_rows' || oversizedBody.max !== MAX_BATCH) {
  fail(`oversized batch answered ${JSON.stringify(oversizedBody)}`);
}
if ((await countRows()) !== before)
  fail('an oversized batch wrote rows — the guard must be pre-DB');
console.log(`guard: a ${MAX_BATCH + 1}-row batch is refused 400 too_many_rows, nothing written`);

// ----------------------------------------------- 4. lazy retention prune

const staleAt = new Date(Date.now() - 61 * DAY_MS);
const [stale] = await db
  .insert(harvestRuns)
  .values({ handle: STALE_HANDLE, mode: 'timeline', scope: 'passive', createdAt: staleAt })
  .returning();
if (!stale) fail('could not seed the stale passive run');
await db.insert(harvestRows).values({
  runId: stale.id,
  tweetId: tid(50),
  handle: INGEST,
  mode: 'timeline',
  text: 'hv6 smoke — a 61-day-old sighting',
  views: 100,
  capturedAt: staleAt,
});

const prunes = await postPassive({ rows: [wireRow(5)] });
if (prunes.status !== 201) fail(`the pruning POST returned ${prunes.status}`);
const [staleAfter] = await db.select().from(harvestRuns).where(eq(harvestRuns.id, stale.id));
if (staleAfter) fail('a 61-day-old passive run survived the lazy prune');
const staleRows = await db
  .select()
  .from(harvestRows)
  .where(eq(harvestRows.tweetId, tid(50)));
if (staleRows.length > 0) fail('the stale run was deleted but its rows were orphaned');
console.log('retention: the next POST pruned a 61-day-old passive run and its rows');

// ------------------------------------------------------- 5. affinity read

// Multi-day histories are unbuildable through the route (the 30-min recapture
// gate), so they are seeded directly — under a run created NOW with backdated
// rows, so the prune above can never take them out mid-run.
const [seedRun] = await db
  .insert(harvestRuns)
  .values({ handle: SEED_HANDLE, mode: 'timeline', scope: 'passive' })
  .returning();
if (!seedRun) fail('could not seed the affinity run');
const seedRunId = seedRun.id;

let seedTweet = 100;
async function seed(handle: string, dayOffsets: number[]): Promise<void> {
  await db.insert(harvestRows).values(
    dayOffsets.map((d) => ({
      runId: seedRunId,
      tweetId: tid(seedTweet++),
      handle,
      mode: 'timeline',
      text: 'hv6 smoke — a backdated sighting',
      views: SEED_VIEWS,
      capturedAt: new Date(Date.now() - d * DAY_MS),
      // Deliberately no tweetTime: no age => no velocity => nothing to ask the
      // classifier, so these land in the funnel's `unknown` band below.
      tweetTime: null,
    })),
  );
}
await seed(SEEN, [1, 2, 3, 4]);
await seed(SOLO, [1, 1]);

interface AffinityAuthorBody {
  handle: string;
  distinctDays: number;
  sightings: number;
  lastSeenAt: string;
  avgViews: number;
  stage: string | null;
  inRoster: boolean;
}
const affinityRes = await app.request('/x/harvest/affinity');
if (affinityRes.status !== 200) fail(`GET /harvest/affinity returned ${affinityRes.status}`);
const affinity = (await affinityRes.json()) as {
  days: number;
  minDays: number;
  authors: AffinityAuthorBody[];
};
if (affinity.days !== 30 || affinity.minDays !== 3) {
  fail(`affinity defaults drifted: days=${affinity.days} minDays=${affinity.minDays}`);
}
const seenAuthor = affinity.authors.find((a) => a.handle === SEEN);
if (!seenAuthor) fail(`${SEEN} (4 separate days) is missing from the affinity roster`);
if (seenAuthor.distinctDays !== 4 || seenAuthor.sightings !== 4) {
  fail(
    `${SEEN}: ${seenAuthor.distinctDays} days / ${seenAuthor.sightings} sightings, expected 4/4`,
  );
}
if (seenAuthor.avgViews !== SEED_VIEWS) fail(`${SEEN}: avgViews ${seenAuthor.avgViews}`);
if (seenAuthor.stage !== null || seenAuthor.inRoster) {
  fail(`${SEEN} should read as an unknown handle (stage null, inRoster false)`);
}
if (affinity.authors.some((a) => a.handle === SOLO)) fail(`${SOLO} (1 day) beat the ≥3-day floor`);
if (affinity.authors.some((a) => a.handle === INGEST)) {
  fail(`${INGEST} (1 day) beat the ≥3-day floor`);
}
console.log(
  `affinity: @${SEEN} ranks on 4 distinct days; the one-day handles are floored out (minDays 3)`,
);

// ------------------------------------------------------- 6. playbook cell

interface FunnelCellBody {
  band: string | null;
  seen: number;
  replied: number;
  rate: number | null;
  sufficient: boolean;
}
const pbRes = await app.request('/x/playbook');
if (pbRes.status !== 200) fail(`GET /playbook returned ${pbRes.status}`);
const pb = (await pbRes.json()) as {
  timelineFunnel?: { cells: FunnelCellBody[]; totalSeen: number; totalReplied: number };
};
const funnel = pb.timelineFunnel;
if (!funnel) fail('GET /playbook no longer carries timelineFunnel');
if (!Array.isArray(funnel.cells)) fail('timelineFunnel.cells is not an array');
if (typeof funnel.totalReplied !== 'number') fail('timelineFunnel.totalReplied is not a number');
// 4 ingest tweets + the pruning POST's one + 6 backdated seeds, all distinct.
if (funnel.totalSeen < 11) fail(`timelineFunnel.totalSeen ${funnel.totalSeen}, expected ≥ 11`);
// `unknown` (no tweet_time) is its own bucket and never the real `null` band,
// which means "classified, and not worth replying to".
const unknown = funnel.cells.find((c) => c.band === 'unknown');
if (!unknown) fail("the 6 rows seeded without a tweet_time produced no 'unknown' cell");
if (unknown.seen < 6) fail(`'unknown' cell saw ${unknown.seen}, expected ≥ 6`);
if (funnel.cells.filter((c) => c.band === 'unknown').length > 1) fail('duplicate unknown cells');
console.log(
  `playbook: timelineFunnel ${funnel.totalReplied}/${funnel.totalSeen} replied, ` +
    `${funnel.cells.length} band cells, unknown seen=${unknown.seen}`,
);

// ------------------------------------------------------------ 7. cleanup

cleanup();
if ((await countRows()) !== 0) fail('smoke rows survived cleanup');
const leftoverRuns = await db
  .select({ id: harvestRuns.id })
  .from(harvestRuns)
  .where(inArray(harvestRuns.handle, [STALE_HANDLE, SEED_HANDLE]));
if (leftoverRuns.length > 0) fail('seeded runs survived cleanup');
console.log('cleanup: every seeded row and run removed; a pre-existing run keeps its own data');

console.log('SMOKE PASS ($0 — no X API, no LLM)');
process.exit(0);
