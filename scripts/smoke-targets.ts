// One-shot smoke test for OVERHAUL-PLAN §7.4 (target roster). Mounts the voice
// router in-process (no port, no workers, no X API) against the real DB:
// enriches a throwaway author twice, checks the snapshot series + momentum in
// GET /voice/targets, then deletes the author and verifies the series went too.
// Run: bun run scripts/smoke-targets.ts

import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../src/db/client.ts';
import { accountSnapshots, voiceAuthorSnapshots } from '../src/x/db/schema.ts';
import { createVoiceRouter } from '../src/x/routes/voice.ts';

const HANDLE = 'stratus_smoke';
const app = new Hono();
app.route('/x', createVoiceRouter());

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

// Baseline roster + my size. `/voice/targets` needs my own follower count from
// the latest account_snapshots row (written by the daily getMe). A fresh DB has
// none, so seed a throwaway one here and drop it at the end — keeps this smoke
// self-contained like the others. (Guarded on null, so an established DB with a
// real snapshot for today is never given a second same-day row.)
type Baseline = {
  myFollowers: number | null;
  band: { min: number; max: number } | null;
  targets: Array<{ handle: string }>;
};
let seededAccountId: number | null = null;
let t0 = await app.request('/x/voice/targets');
if (t0.status !== 200) fail(`targets returned ${t0.status}`);
let base = (await t0.json()) as Baseline;
if (base.myFollowers === null || !base.band) {
  const [seed] = await db
    .insert(accountSnapshots)
    .values({ followersCount: 100, followingCount: 50, tweetCount: 10, listedCount: 0 })
    .returning({ id: accountSnapshots.id });
  seededAccountId = seed?.id ?? null;
  t0 = await app.request('/x/voice/targets');
  base = (await t0.json()) as Baseline;
}
console.log(
  `targets: myFollowers=${base.myFollowers} band=${JSON.stringify(base.band)} targets=${base.targets.length}`,
);
if (base.myFollowers === null || !base.band) fail('no account snapshot even after seeding');

// Enrich twice with in-band counts → two snapshot points, +40 delta.
const f1 = base.myFollowers * 3;
for (const [i, followersCount] of [f1, f1 + 40].entries()) {
  const r = await app.request(`/x/voice/authors/${HANDLE}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName: 'Smoke Test', followersCount }),
  });
  if (r.status !== 200) fail(`enrich #${i + 1} returned ${r.status}`);
}

const snaps = await db
  .select()
  .from(voiceAuthorSnapshots)
  .where(eq(voiceAuthorSnapshots.handle, HANDLE));
if (snaps.length !== 2) fail(`expected 2 snapshots, got ${snaps.length}`);
console.log(`enrich x2: ${snaps.length} snapshot rows appended (${f1} → ${f1 + 40})`);

// Roster must now contain the smoke author with momentum (+40 over <1d → 40/day).
const t1 = await app.request('/x/voice/targets');
const after = (await t1.json()) as {
  targets: Array<{
    handle: string;
    followersCount: number;
    ratio: number;
    momentum: { delta: number; perDay: number } | null;
    snapshotCount: number;
    lastRepliedAt: string | null;
    postedReplies: number;
  }>;
};
const mine = after.targets.find((t) => t.handle === HANDLE);
if (!mine) fail(`smoke author missing from targets: ${JSON.stringify(after.targets.slice(0, 3))}`);
console.log(`roster row: ${JSON.stringify(mine)}`);
if (mine.momentum?.delta !== 40 || mine.momentum.perDay !== 40) {
  fail(`unexpected momentum ${JSON.stringify(mine.momentum)}`);
}
const wantRatio = Math.round(((f1 + 40) / base.myFollowers) * 10) / 10;
if (mine.snapshotCount !== 2 || mine.ratio !== wantRatio) fail('snapshotCount/ratio wrong');
if (mine.lastRepliedAt !== null || mine.postedReplies !== 0) fail('reply join should be empty');
if (after.targets[0]?.handle !== HANDLE) {
  // 40/day should outrank everything seeded (single-point authors have no momentum).
  console.warn(`note: smoke author ranked #${after.targets.findIndex((t) => t.handle === HANDLE)}`);
}

// Cleanup: delete must take the snapshot series with the author.
const del = await app.request(`/x/voice/authors/${HANDLE}`, { method: 'DELETE' });
if (del.status !== 200) fail(`delete returned ${del.status}: ${await del.text()}`);
const [left] = await db
  .select({ n: sql<number>`count(*)` })
  .from(voiceAuthorSnapshots)
  .where(eq(voiceAuthorSnapshots.handle, HANDLE));
if (left?.n !== 0) fail(`${left?.n} snapshot rows survived the delete`);
console.log('delete: author + snapshot series removed');

if (seededAccountId !== null) {
  await db.delete(accountSnapshots).where(eq(accountSnapshots.id, seededAccountId));
  console.log('cleanup: removed seeded account snapshot');
}

console.log('SMOKE OK');
process.exit(0);
