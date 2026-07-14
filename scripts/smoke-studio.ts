// One-shot smoke test for SURFACES S4 (the AI image layer + asset library).
// Mounts the assets + images routers in-process (no port, no workers) against
// the real DB.
//
//   default ($0): asset base64 round-trip, list-excludes-blobs, 2MB cap, the
//                 budget-refusal 429, and delete — all pre-network, no spend.
//   --live       : additionally fires ONE real generation (~$0.02) and asserts
//                 the base64 image comes back and the ~$0.02 lands under 'xai'
//                 in /cost/today.
//
// Run: bun run scripts/smoke-studio.ts            (default, $0)
//      bun run scripts/smoke-studio.ts --live     (one ~$0.02 generation)

import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../src/db/client.ts';
import { costEvents } from '../src/db/shared-schema.ts';
import { mediaAssets } from '../src/x/db/schema.ts';
import { assets } from '../src/x/routes/assets.ts';
import { images } from '../src/x/routes/images.ts';

const LIVE = process.argv.includes('--live');

const app = new Hono();
app.route('/x', assets);
app.route('/x', images);

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}
function ok(msg: string): void {
  console.log(`  ok: ${msg}`);
}

async function postJson<T = Record<string, unknown>>(
  path: string,
  body: unknown,
): Promise<{ status: number; json: T }> {
  const res = await app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : null) as T };
}

// A known byte sequence — stored verbatim, so the round-trip is exact.
const BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 8, 7, 6, 5]);
const B64 = Buffer.from(BYTES).toString('base64');

console.log('S4 studio smoke — asset library ($0)');

// 1. Save → metadata only.
const saved = await postJson<{ id: string; byteLength: number }>('/x/assets', {
  pngBase64: B64,
  kind: 'quote',
  prompt: 'flat vector, no text',
  width: 1200,
  height: 675,
});
if (saved.status !== 201) fail(`POST /x/assets → ${saved.status}`);
if ('png' in (saved.json as Record<string, unknown>)) fail('save response leaked the blob');
if (saved.json.byteLength !== BYTES.length) fail('byteLength mismatch');
const assetId = saved.json.id;
ok(`saved asset ${assetId} (metadata only, ${saved.json.byteLength} bytes)`);

// 2. Base64 round-trip through the /png stream.
const pngRes = await app.request(`/x/assets/${assetId}/png`);
if (pngRes.status !== 200) fail(`GET /png → ${pngRes.status}`);
const got = new Uint8Array(await pngRes.arrayBuffer());
if (got.length !== BYTES.length || got.some((b, i) => b !== BYTES[i]))
  fail('png stream bytes differ from what was stored');
ok('base64 round-trip is byte-exact');

// 3. List excludes blobs.
const listRes = await app.request('/x/assets');
const list = (await listRes.json()) as { assets: Array<Record<string, unknown>> };
if (!list.assets.some((a) => a.id === assetId)) fail('saved asset missing from list');
if (list.assets.some((a) => 'png' in a)) fail('list leaked a blob');
ok(`list returns ${list.assets.length} rows, no blobs`);

// 4. 2MB cap.
const big = await postJson('/x/assets', {
  pngBase64: Buffer.alloc(2 * 1024 * 1024 + 1, 1).toString('base64'),
  kind: 'quote',
});
if (big.status !== 413) fail(`oversized asset → ${big.status} (expected 413)`);
ok('2MB cap enforced (413)');

// 5. Budget refusal (429) — seed today's image spend over the cap, with a key
//    set so the 503 gate passes and the budget check runs before any network.
const prevKey = process.env.XAI_API_KEY;
const prevBudget = process.env.XAI_IMAGE_DAILY_BUDGET_USD;
if (!LIVE) process.env.XAI_API_KEY = 'smoke-key';
process.env.XAI_IMAGE_DAILY_BUDGET_USD = '0.50';
const marker = `smoke-studio-budget-${Date.now()}`;
db.insert(costEvents)
  .values({
    platform: 'xai',
    endpoint: '/v1/images/generations',
    status: 200,
    items: 8,
    costUsd: 0.6,
    durationMs: 5,
    attempts: 1,
    requestId: marker,
  })
  .run();
const refused = await postJson<{ error: string; spentUsd: number; budgetUsd: number }>(
  '/x/images/generate',
  { prompt: 'a muted flat-vector background' },
);
if (refused.status !== 429 || refused.json.error !== 'image_budget_exceeded')
  fail(
    `over-budget → ${refused.status} ${refused.json?.error} (expected 429 image_budget_exceeded)`,
  );
ok(`budget refusal (429) fires at $${refused.json.spentUsd} ≥ $${refused.json.budgetUsd}`);
db.delete(costEvents).where(eq(costEvents.requestId, marker)).run();
// Restore budget ('' reads as unset → route default); leave the key for --live.
process.env.XAI_IMAGE_DAILY_BUDGET_USD = prevBudget ?? '';
if (!LIVE) process.env.XAI_API_KEY = prevKey ?? '';

// 6. Delete.
const del = await app.request(`/x/assets/${assetId}`, { method: 'DELETE' });
if (del.status !== 200) fail(`DELETE → ${del.status}`);
const gone = await app.request(`/x/assets/${assetId}/png`);
if (gone.status !== 404) fail(`deleted asset /png → ${gone.status} (expected 404)`);
ok('deleted; stream 404s');

// Belt-and-suspenders: nothing this run created should remain.
await db.delete(mediaAssets).where(eq(mediaAssets.id, assetId));

if (!LIVE) {
  console.log('\nPASS ($0). Re-run with --live to fire one real ~$0.02 generation.');
  process.exit(0);
}

// ---- live path: one real generation (~$0.02) ----
if (!process.env.XAI_API_KEY) fail('--live needs XAI_API_KEY set');
console.log('\nLIVE — one real grok-imagine-image generation (~$0.02)…');

async function xaiSpendToday(): Promise<number> {
  const from = new Date();
  from.setUTCHours(0, 0, 0, 0);
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${costEvents.costUsd}), 0)` })
    .from(costEvents)
    .where(sql`${costEvents.platform} = 'xai' and ${costEvents.ts} >= ${from.getTime()}`);
  return Number(row?.total ?? 0);
}

const before = await xaiSpendToday();
const gen = await postJson<{
  images?: Array<{ dataUrl: string; mediaType: string }>;
  costUsd: number;
}>('/x/images/generate', {
  prompt: 'a calm abstract gradient, flat vector, muted palette, no text, no letters',
  n: 1,
});
if (gen.status !== 200) fail(`live generate → ${gen.status} ${JSON.stringify(gen.json)}`);
const img = gen.json.images?.[0];
if (!img?.dataUrl?.startsWith('data:image/')) fail('live generate returned no base64 data URL');
if (img.dataUrl.includes('http')) fail('a raw xAI URL leaked to the client');
ok(
  `generated 1 image (${img.mediaType}, ${Math.round(img.dataUrl.length / 1024)}KB base64), $${gen.json.costUsd}`,
);

const after = await xaiSpendToday();
if (after <= before) fail(`image spend did not increase (${before} → ${after})`);
ok(`/cost 'xai' spend rose $${before.toFixed(3)} → $${after.toFixed(3)}`);

console.log('\nPASS (--live). The ~$0.02 is real and now shows in /cost/today under xai.');
process.exit(0);
