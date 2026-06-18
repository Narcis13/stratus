// One-shot smoke test for §8.6 (editable content pillars). Mounts the pillars
// router in-process (no port, no workers) against the real DB: lists the seeded
// pillars, then exercises full CRUD on a throwaway slug (create → dup 409 →
// patch → activate toggle → delete) and cleans up after itself. $0 by default.
//
//   bun run scripts/smoke-pillars.ts          # CRUD only, no Grok spend
//   bun run scripts/smoke-pillars.ts --live    # + one /pillars/draft call (~$0.003)

import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db, pool } from '../src/db/client.ts';
import { contentPillars } from '../src/x/db/schema.ts';
import { pillars } from '../src/x/routes/pillars.ts';

const SLUG = 'zz-smoke-pillar';
const live = process.argv.includes('--live');
const app = new Hono();
app.route('/x', pillars);

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

// Leftover from a previous aborted run? Drop it (never the last active pillar).
await db.delete(contentPillars).where(eq(contentPillars.slug, SLUG));

// 1. The seed pillars must be present.
const listRes = await app.request('/x/pillars');
if (listRes.status !== 200) fail(`list returned ${listRes.status}`);
const seeded = await json<Array<{ slug: string; active: boolean }>>(listRes);
const slugs = seeded.map((p) => p.slug);
for (const want of ['ai-craft', 'builder-51', 'unsexy-problems']) {
  if (!slugs.includes(want)) fail(`seed pillar "${want}" missing — run db:migrate`);
}
console.log(`list: ${seeded.length} pillars (${slugs.join(', ')})`);

// 2. Invalid slug → 400 (pre-DB).
const bad = await app.request('/x/pillars', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ slug: 'Bad Slug', label: 'L', body: 'B' }),
});
if (bad.status !== 400) fail(`invalid slug should 400, got ${bad.status}`);

// 3. Create.
const created = await app.request('/x/pillars', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    slug: SLUG,
    label: 'Smoke — the TEST',
    body: 'throwaway body',
    sortOrder: 999,
  }),
});
if (created.status !== 201) fail(`create returned ${created.status}: ${await created.text()}`);
console.log('create: 201');

// 4. Duplicate slug → 409.
const dup = await app.request('/x/pillars', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ slug: SLUG, label: 'again', body: 'again' }),
});
if (dup.status !== 409) fail(`duplicate slug should 409, got ${dup.status}`);
console.log('duplicate: 409');

// 5. Patch label + body.
const patched = await app.request(`/x/pillars/${SLUG}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ label: 'Smoke — edited', body: 'edited body' }),
});
if (patched.status !== 200) fail(`patch returned ${patched.status}`);
const pj = await json<{ label: string; body: string }>(patched);
if (pj.label !== 'Smoke — edited' || pj.body !== 'edited body') fail('patch did not persist');
console.log('patch: label/body updated');

// 6. Deactivate → only the throwaway is filtered out of active list.
const deact = await app.request(`/x/pillars/${SLUG}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ active: false }),
});
if (deact.status !== 200) fail(`deactivate returned ${deact.status}`);
const activeOnly = await json<Array<{ slug: string }>>(await app.request('/x/pillars?active=true'));
if (activeOnly.some((p) => p.slug === SLUG)) fail('deactivated pillar still in active list');
console.log('deactivate: dropped from active list');

// 7. Delete → gone.
const del = await app.request(`/x/pillars/${SLUG}`, { method: 'DELETE' });
if (del.status !== 200) fail(`delete returned ${del.status}: ${await del.text()}`);
const [left] = await db.select().from(contentPillars).where(eq(contentPillars.slug, SLUG));
if (left) fail('pillar survived delete');
console.log('delete: removed');

// 8. Optional: one live Grok draft of a new pillar.
if (live) {
  if (!process.env.XAI_API_KEY) fail('--live needs XAI_API_KEY');
  const draft = await app.request('/x/pillars/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'new', idea: 'something about shipping fast with AI' }),
  });
  if (draft.status !== 200) fail(`draft returned ${draft.status}: ${await draft.text()}`);
  const dj = await json<{
    proposal: { slug: string; label: string; body: string };
    costUsd: number;
  }>(draft);
  if (!dj.proposal?.slug || !dj.proposal.label || !dj.proposal.body) fail('draft missing fields');
  console.log(
    `draft: proposed "${dj.proposal.slug}" — ${dj.proposal.label} ($${dj.costUsd.toFixed(4)})`,
  );
}

console.log('SMOKE OK');
await pool.end();
process.exit(0);
