// One-shot smoke test for CIRCLES-PLAN C0 (radar draft persistence). Mounts
// the radar router in-process (no port, no workers, no Grok) against the real
// DB: persists a fake batch the way /replies/generate-batch does, walks the
// ready → clicked / expired status flips, verifies lazy 48h expiry, then
// deletes every row it created. $0.
// Run: bun run scripts/smoke-radar-drafts.ts

import { inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../src/db/client.ts';
import { radarDrafts } from '../src/x/db/schema.ts';
import { RADAR_DRAFT_TTL_MS, persistRadarDrafts, radar } from '../src/x/routes/radar.ts';

const T1 = '990000000000000001';
const T2 = '990000000000000002';
const T3 = '990000000000000003';
const IDS = [T1, T2, T3];

const app = new Hono();
app.route('/x', radar);

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

type DraftRow = { tweetId: string; status: string; replyText: string; signals: unknown };
async function fetchDrafts(status: string): Promise<DraftRow[]> {
  const r = await app.request(`/x/radar/drafts?status=${status}`);
  if (r.status !== 200) fail(`GET drafts?status=${status} returned ${r.status}`);
  const body = (await r.json()) as { drafts: DraftRow[] };
  return body.drafts.filter((d) => IDS.includes(d.tweetId));
}

// Start clean in case an earlier run died mid-way.
await db.delete(radarDrafts).where(inArray(radarDrafts.tweetId, IDS));

// 1. Persist a batch exactly as /replies/generate-batch does.
await persistRadarDrafts(
  [
    {
      tweetId: T1,
      handle: 'smoke_alice',
      author: 'Smoke Alice',
      text: 'smoke tweet one',
      url: `https://x.com/smoke_alice/status/${T1}`,
      band: 'hot',
      signals: { views: 1500, replies: 8, ageMin: 22, vpm: 68, bait: false },
    },
    { tweetId: T2, handle: 'smoke_bob', author: 'smoke_bob', text: 'smoke tweet two' },
  ],
  [
    { tweetId: T1, text: 'smoke reply one', angle: 'contrarian' },
    { tweetId: T2, text: 'smoke reply two', angle: 'extends' },
  ],
);

const ready = await fetchDrafts('ready');
if (ready.length !== 2) fail(`expected 2 ready drafts, got ${ready.length}`);
const withSignals = ready.find((d) => d.tweetId === T1);
if (!withSignals || withSignals.signals === null) fail('signals were not persisted');
console.log(`persisted: ${ready.length} ready drafts (signals kept)`);

// 2. Click one, dismiss (expire) the other.
const patch = (tweetIds: string[], status: string) =>
  app.request('/x/radar/drafts', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tweetIds, status }),
  });

let r = await patch([T1], 'clicked');
if (r.status !== 200) fail(`PATCH clicked returned ${r.status}`);
if (((await r.json()) as { updated: number }).updated !== 1) fail('clicked flip updated != 1');
r = await patch([T2], 'expired');
if (r.status !== 200) fail(`PATCH expired returned ${r.status}`);

if ((await fetchDrafts('ready')).length !== 0) fail('ready queue not empty after flips');
if ((await fetchDrafts('clicked')).map((d) => d.tweetId).join() !== T1) fail('clicked view wrong');
if ((await fetchDrafts('expired')).map((d) => d.tweetId).join() !== T2) fail('expired view wrong');
console.log('status flips: ready → clicked / expired OK');

// 3. Clicked never moves backwards, dismiss closes clicked rows.
r = await patch([T1], 'clicked');
if (((await r.json()) as { updated: number }).updated !== 0) fail('re-click should update 0');
r = await patch([T1], 'expired');
if (((await r.json()) as { updated: number }).updated !== 1) fail('dismissing clicked failed');

// 4. Lazy expiry: a ready row drafted 49h ago flips on the next GET.
await db.insert(radarDrafts).values({
  tweetId: T3,
  handle: 'smoke_old',
  snippet: 'stale smoke tweet',
  replyText: 'stale reply',
  angle: 'extends',
  status: 'ready',
  draftedAt: new Date(Date.now() - RADAR_DRAFT_TTL_MS - 3_600_000),
});
if ((await fetchDrafts('ready')).length !== 0) fail('stale ready row did not expire on GET');
if (!(await fetchDrafts('expired')).some((d) => d.tweetId === T3)) {
  fail('stale row missing from expired view');
}
console.log('lazy 48h expiry OK');

// 5. Cleanup.
const gone = await db
  .delete(radarDrafts)
  .where(inArray(radarDrafts.tweetId, IDS))
  .returning({ id: radarDrafts.id });
console.log(`cleanup: removed ${gone.length} rows`);
console.log('SMOKE PASS');
process.exit(0);
