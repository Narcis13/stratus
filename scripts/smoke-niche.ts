// One-shot smoke test for Niche N0. Mounts the niche/pillars/drafter/brief/voice
// routers in-process (no port, no workers, no X API) against the real DB and walks
// the full second-niche story at $0: create a throwaway `smoke-nutrition` niche
// with a doctored doctrine, activate it, and assert the interference guards fire —
// zero active pillars, the drafter's `no_pillars_for_niche` refusal (before any
// Grok spend), doctrine-driven brief quota/ratio + voice band, and a
// buildGrokInput/buildPostDraftInput assembly grounded in the nutrition persona
// with NO builder §1/§5 biography. Then reactivate `builder` and assert everything
// reads exactly as before. Restores builder-active + deletes the smoke niche in a
// finally-style cleanup even on failure, so a mid-run abort never leaves a
// non-builder niche active (which would skew every other route + test suite).
//
//   bun run scripts/smoke-niche.ts          # $0 CRUD/guard walk
//   bun run scripts/smoke-niche.ts --live    # + one wizard call (~$0.01)
//
// The live `contextSnapshot.niche.slug === 'nutrition'` proof rides the reply
// route + a real Grok call (D29b) and is deliberately NOT in this $0 default; the
// buildGrokInput assembly assertion below is its $0 proxy.

import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../src/db/client.ts';
import { accountSnapshots, niches } from '../src/x/db/schema.ts';
import { loadActiveNicheSafe } from '../src/x/niche/store.ts';
import { buildPostDraftInput } from '../src/x/posts/prompt.ts';
import { buildGrokInput } from '../src/x/replies/prompt.ts';
import { brief } from '../src/x/routes/brief.ts';
import { drafter } from '../src/x/routes/drafter.ts';
import { nicheRouter } from '../src/x/routes/niche.ts';
import { pillars } from '../src/x/routes/pillars.ts';
import { createVoiceRouter } from '../src/x/routes/voice.ts';

const SLUG = 'smoke-nutrition';
const live = process.argv.includes('--live');

// Custom doctrine so the brief/targets assertions are unambiguous (distinct from
// the 10/20/70/2/10 defaults builder reads back to).
const DOCTRINE = {
  replyTargetMin: 5,
  replyTargetMax: 8,
  weekReplyTargetPct: 55,
  targetBandMinX: 4,
  targetBandMaxX: 12,
};
// Sentinels chosen to be unique to this niche's grounding, so an assembled prompt
// containing them proves the niche fields substituted in.
const PERSONA = 'NUTRITION_SMOKE_PERSONA — a registered dietitian who cooks for a living.';
const BELIEFS = 'NUTRITION_SMOKE_BELIEFS — whole foods beat supplements, evidence over hype.';
const REPLY_PERSONA = 'NUTRITION_SMOKE_REPLY\n- I help people eat better.';

const app = new Hono();
app.route('/x', nicheRouter);
app.route('/x', pillars);
app.route('/x', drafter);
app.route('/x', brief);
app.route('/x', createVoiceRouter());

let seededAccountId: number | null = null;

// Sync cleanup (bun:sqlite is synchronous): always leave builder the single active
// niche and drop the smoke row + any account snapshot we seeded.
function cleanup(): void {
  try {
    db.transaction((tx) => {
      tx.update(niches).set({ active: false }).where(eq(niches.active, true)).run();
      tx.update(niches).set({ active: true }).where(eq(niches.slug, 'builder')).run();
    });
    db.delete(niches).where(eq(niches.slug, SLUG)).run();
    if (seededAccountId !== null)
      db.delete(accountSnapshots).where(eq(accountSnapshots.id, seededAccountId)).run();
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

// Leftover from an aborted run? Drop it (it may be active — cleanup restores builder).
cleanup();

// The voice band needs my own follower count from the latest account_snapshots row
// (written by the daily getMe). A fresh DB has none — seed a throwaway one, guarded
// so an established DB with a real snapshot for today is never given a second row.
const t0 = await app.request('/x/voice/targets');
const base0 = await json<{ myFollowers: number | null }>(t0);
if (base0.myFollowers === null) {
  const [seed] = await db
    .insert(accountSnapshots)
    .values({ followersCount: 100, followingCount: 50, tweetCount: 10, listedCount: 0 })
    .returning({ id: accountSnapshots.id });
  seededAccountId = seed?.id ?? null;
}

// 1. Create the smoke niche (inactive). Doctored doctrine + sentinel grounding.
const created = await app.request('/x/niches', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    slug: SLUG,
    label: 'Smoke — nutrition',
    persona: PERSONA,
    beliefs: BELIEFS,
    replyPersona: REPLY_PERSONA,
    description: 'A throwaway nutrition niche for the smoke test.',
    doctrine: DOCTRINE,
  }),
});
if (created.status !== 201) fail(`create returned ${created.status}: ${await created.text()}`);
const createdRow = await json<{ slug: string; active: boolean }>(created);
if (createdRow.active !== false) fail('newly created niche should be inactive');
console.log(`create: 201, ${SLUG} (inactive)`);

// Still builder until we explicitly activate.
const stillBuilder = await json<{ niche: { slug: string } }>(await app.request('/x/niche'));
if (stillBuilder.niche.slug !== 'builder')
  fail(`active niche should still be builder, got ${stillBuilder.niche.slug}`);

// 2. Activate → atomic swap.
const act = await app.request(`/x/niches/${SLUG}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ active: true }),
});
if (act.status !== 200) fail(`activate returned ${act.status}: ${await act.text()}`);
const nowActive = await json<{ niche: { slug: string }; doctrine: typeof DOCTRINE }>(
  await app.request('/x/niche'),
);
if (nowActive.niche.slug !== SLUG)
  fail(`active niche should be ${SLUG}, got ${nowActive.niche.slug}`);
for (const [k, v] of Object.entries(DOCTRINE)) {
  if ((nowActive.doctrine as Record<string, number>)[k] !== v)
    fail(
      `resolved doctrine.${k} = ${(nowActive.doctrine as Record<string, number>)[k]}, want ${v}`,
    );
}
console.log('activate: 200, GET /niche reflects nutrition + doctored doctrine');

// 3. Zero active pillars for the new niche (builder's 3 are niche-filtered out).
const activePillars = await json<Array<{ slug: string }>>(
  await app.request('/x/pillars?active=true'),
);
if (activePillars.length !== 0)
  fail(
    `nutrition should have 0 active pillars, got ${activePillars.length}: ${activePillars.map((p) => p.slug).join(',')}`,
  );
console.log('pillars: GET /pillars?active=true → 0 rows (niche-filtered)');

// 4. Drafter refuses BEFORE any Grok spend ($0, no XAI key needed).
const draftRefusal = await app.request('/x/posts/draft', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ idea: 'anything' }),
});
if (draftRefusal.status !== 409) fail(`drafter should 409, got ${draftRefusal.status}`);
const refusalBody = await json<{ error: string; niche: string }>(draftRefusal);
if (refusalBody.error !== 'no_pillars_for_niche' || refusalBody.niche !== SLUG)
  fail(`unexpected refusal body: ${JSON.stringify(refusalBody)}`);
console.log('drafter: POST /posts/draft → 409 no_pillars_for_niche (no Grok spend)');

// 5. Prompt assembly grounded in the nutrition persona, zero builder §1/§5 biography.
//    §1/§5 markers only: 'Alteramens'/'Naval-derived' are the extracted-into-niche
//    bodies. §6/§9 builder texture (Pitești/386/hospital) is NOT extracted and WILL
//    still appear in the post prompt — do NOT assert its absence (D28b).
const niche = loadActiveNicheSafe();
if (niche.slug !== SLUG) fail(`loadActiveNicheSafe returned ${niche.slug}, expected ${SLUG}`);

const postPrompt =
  buildPostDraftInput({
    winners: [],
    persona: niche.persona,
    beliefs: niche.beliefs,
  })[0]?.content ?? '';
if (!postPrompt.includes('NUTRITION_SMOKE_PERSONA')) fail('post prompt missing nutrition persona');
if (!postPrompt.includes('NUTRITION_SMOKE_BELIEFS')) fail('post prompt missing nutrition beliefs');
if (postPrompt.includes('Alteramens')) fail('post prompt still carries builder §1 (Alteramens)');
if (postPrompt.includes('Naval-derived'))
  fail('post prompt still carries builder §5 (Naval-derived)');
console.log('post assembly: nutrition persona/beliefs present, builder §1/§5 gone');

const ctx = {
  url: 'https://x.com/someone/status/1',
  tweetId: '1',
  author: 'Someone',
  handle: 'someone',
  text: 'What should I eat before a workout?',
  postedAt: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
  metrics: { views: 100, replies: 2, reposts: 0, likes: 5 },
  topComments: [],
};
const replyPrompt =
  buildGrokInput(ctx, undefined, undefined, undefined, {
    replyPersona: niche.replyPersona,
  })[0]?.content ?? '';
if (!replyPrompt.includes('NUTRITION_SMOKE_REPLY'))
  fail('reply prompt missing nutrition reply persona');
if (replyPrompt.includes('{{REPLY_PERSONA}}'))
  fail('reply prompt left {{REPLY_PERSONA}} unsubstituted');
if (replyPrompt.includes('build in public'))
  fail('reply prompt still carries builder reply persona');
console.log('reply assembly: nutrition reply persona substituted, builder reply persona gone');

// 6. Doctrine drives the brief quota/ratio and the voice band.
const briefRes = await app.request('/x/brief?tzOffsetMin=0');
if (briefRes.status !== 200) fail(`brief returned ${briefRes.status}: ${await briefRes.text()}`);
const briefBody = await json<{
  replyQuota: { target: { min: number; max: number } };
  week: { targetReplyPct: number };
}>(briefRes);
if (briefBody.replyQuota.target.min !== 5 || briefBody.replyQuota.target.max !== 8)
  fail(
    `brief replyQuota.target = ${JSON.stringify(briefBody.replyQuota.target)}, want {min:5,max:8}`,
  );
if (briefBody.week.targetReplyPct !== 55)
  fail(`brief week.targetReplyPct = ${briefBody.week.targetReplyPct}, want 55`);
console.log('brief: replyQuota 5–8 + week ratio 55% reflect doctored doctrine');

const targetsRes = await json<{
  myFollowers: number | null;
  band: { min: number; max: number } | null;
}>(await app.request('/x/voice/targets'));
if (targetsRes.myFollowers === null || !targetsRes.band)
  fail('voice/targets has no band (no account snapshot)');
const wantMin = targetsRes.myFollowers * DOCTRINE.targetBandMinX;
const wantMax = targetsRes.myFollowers * DOCTRINE.targetBandMaxX;
if (targetsRes.band.min !== wantMin || targetsRes.band.max !== wantMax)
  fail(
    `voice band = ${JSON.stringify(targetsRes.band)}, want {min:${wantMin},max:${wantMax}} (4–12x)`,
  );
console.log(
  `voice: band ${wantMin}–${wantMax} (${DOCTRINE.targetBandMinX}–${DOCTRINE.targetBandMaxX}x myFollowers=${targetsRes.myFollowers})`,
);

// 7. Reactivate builder → everything reads exactly as before.
const back = await app.request('/x/niches/builder', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ active: true }),
});
if (back.status !== 200) fail(`reactivate builder returned ${back.status}: ${await back.text()}`);
const restored = await json<{ niche: { slug: string }; doctrine: { replyTargetMin: number } }>(
  await app.request('/x/niche'),
);
if (restored.niche.slug !== 'builder')
  fail(`active niche should be builder, got ${restored.niche.slug}`);
if (restored.doctrine.replyTargetMin !== 10) fail('builder doctrine did not read back to defaults');
const builderPillars = await json<Array<{ slug: string }>>(
  await app.request('/x/pillars?active=true'),
);
if (builderPillars.length < 3)
  fail(`builder should have its 3 seed pillars back, got ${builderPillars.length}`);
const briefBack = await json<{ replyQuota: { target: { min: number; max: number } } }>(
  await app.request('/x/brief?tzOffsetMin=0'),
);
if (briefBack.replyQuota.target.min !== 10 || briefBack.replyQuota.target.max !== 20)
  fail(`brief quota did not restore to 10–20: ${JSON.stringify(briefBack.replyQuota.target)}`);
console.log('reactivate: builder active, pillars + doctrine back to defaults');

// 8. Delete the smoke niche.
const del = await app.request(`/x/niches/${SLUG}`, { method: 'DELETE' });
if (del.status !== 200) fail(`delete returned ${del.status}: ${await del.text()}`);
const gone = db.select({ slug: niches.slug }).from(niches).where(eq(niches.slug, SLUG)).get();
if (gone) fail('smoke niche survived delete');
console.log('delete: smoke niche removed');

// 9. Optional live wizard call (~$0.01): assert a valid proposal parses.
if (live) {
  if (!process.env.XAI_API_KEY) fail('--live needs XAI_API_KEY');
  const wiz = await app.request('/x/niche/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      description:
        'I post about home cooking and evidence-based nutrition for busy parents — quick weeknight meals, meal prep, and cutting through supplement hype.',
    }),
  });
  if (wiz.status !== 200) fail(`wizard returned ${wiz.status}: ${await wiz.text()}`);
  const wj = await json<{
    proposal: {
      slug: string;
      label: string;
      persona: string;
      beliefs: string;
      replyPersona: string;
      pillars: Array<{ slug: string }>;
      channels: unknown[];
    };
    costUsd: number;
  }>(wiz);
  const p = wj.proposal;
  if (!p?.slug || !p.label || !p.persona || !p.beliefs || !p.replyPersona)
    fail(`wizard proposal missing required fields: ${JSON.stringify(p)}`);
  if (!Array.isArray(p.pillars) || p.pillars.length !== 3)
    fail(`wizard proposal should have 3 pillars, got ${p.pillars?.length}`);
  console.log(
    `wizard: proposed "${p.slug}" — ${p.label}, ${p.pillars.length} pillars ($${wj.costUsd.toFixed(4)})`,
  );
}

cleanup();
console.log('SMOKE OK');
process.exit(0);
