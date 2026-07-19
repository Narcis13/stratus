// One-shot smoke test for the AI layer (AI.1–AI.12). Mounts the /llm, prompts,
// drafter and ideas routers in-process (no port, no workers) against the REAL DB
// and exercises the whole surface at **$0**:
//
//   1. AI settings round-trip over app_settings key 'ai' + per-field 400s +
//      the openrouter-without-key 409 (env unset in-process).
//   2. Prompt override → loadPrompt render marker → reset → restore-defaults,
//      plus the missing-placeholder 400 and unknown-key 404.
//   3. New-surface pre-spend guards: draft-thread / rewrite / ideas-generate
//      input 400s, and the no-key 503 (env unset — askLLM throws before any
//      network, so no spend). draft-thread/ideas may 409 instead if the active
//      niche has no pillars — both are $0 refuse-before-spend, so accept either.
//   4. buildModelEffectiveness bucketing + shape (pure).
//
// It NEVER spends by default: every path either validates before the LLM call
// or runs with both provider keys unset. The DB is left pristine — the 'ai'
// settings row and ALL prompt_overrides rows are snapshotted up front and
// restored on exit (so a real customized prompt is never wiped by the
// restore-defaults step).
//
//   bun run scripts/smoke-ai-layer.ts          # $0
//   bun run scripts/smoke-ai-layer.ts --live   # + ONE OpenRouter call (~$0.003–0.01)
//
// --live requires OPENROUTER_API_KEY: makes one real askLLM call on the
// openrouter provider, asserts text back + provider tag + a cost_events row
// under platform 'openrouter'.

import { and, eq, gte } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../src/db/client.ts';
import { appSettings, costEvents } from '../src/db/shared-schema.ts';
import { askLLM } from '../src/llm/ask.ts';
import { llm } from '../src/llm/routes.ts';
import { promptOverrides } from '../src/x/db/schema.ts';
import { buildModelEffectiveness } from '../src/x/playbook.ts';
import { loadPrompt } from '../src/x/prompts/registry.ts';
import { drafter } from '../src/x/routes/drafter.ts';
import { ideasRouter } from '../src/x/routes/ideas.ts';
import { promptsRouter } from '../src/x/routes/prompts.ts';

const LIVE = process.argv.includes('--live');

const app = new Hono();
app.route('/', llm);
app.route('/x', promptsRouter);
app.route('/x', drafter);
app.route('/x', ideasRouter);

// --- snapshot everything we might mutate, so cleanup restores the DB exactly ---
const aiRowBefore = db.select().from(appSettings).where(eq(appSettings.key, 'ai')).get();
const overridesBefore = db.select().from(promptOverrides).all();
const envBefore = {
  xai: process.env.XAI_API_KEY,
  openrouter: process.env.OPENROUTER_API_KEY,
};

// Reflect.deleteProperty, not the `delete` operator: process.env values are
// strings, so `process.env.X = undefined` would leave the string "undefined"
// (truthy) and defeat the no-key path. Deleting is the only correct unset.
function unsetEnv(key: string): void {
  Reflect.deleteProperty(process.env, key);
}

function restoreEnv(): void {
  if (envBefore.xai === undefined) unsetEnv('XAI_API_KEY');
  else process.env.XAI_API_KEY = envBefore.xai;
  if (envBefore.openrouter === undefined) unsetEnv('OPENROUTER_API_KEY');
  else process.env.OPENROUTER_API_KEY = envBefore.openrouter;
}

function cleanup(): void {
  restoreEnv();
  // Restore the 'ai' settings row (or remove it if there was none).
  if (aiRowBefore) {
    db.insert(appSettings)
      .values(aiRowBefore)
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: aiRowBefore.value, updatedAt: aiRowBefore.updatedAt },
      })
      .run();
  } else {
    db.delete(appSettings).where(eq(appSettings.key, 'ai')).run();
  }
  // Restore prompt_overrides to its exact prior contents.
  db.delete(promptOverrides).run();
  if (overridesBefore.length > 0) db.insert(promptOverrides).values(overridesBefore).run();
}

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  cleanup();
  process.exit(1);
}

function ok(msg: string): void {
  console.log(`  ok: ${msg}`);
}

async function req(
  path: string,
  method: string,
  body?: unknown,
  // biome-ignore lint/suspicious/noExplicitAny: smoke walks dynamic JSON payloads
): Promise<{ status: number; body: any }> {
  const res = await app.request(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, body: parsed };
}

// ============================================================================
// 1. AI settings round-trip + validation + provider-without-key 409
// ============================================================================
console.log('1. AI settings');
{
  const got = await req('/llm/settings', 'GET');
  if (got.status !== 200) fail(`GET /llm/settings → ${got.status}`);
  if (typeof got.body.provider !== 'string' || typeof got.body.providers !== 'object')
    fail('GET /llm/settings missing provider/providers');
  ok(
    `GET settings: provider=${got.body.provider}, providers=${JSON.stringify(got.body.providers)}`,
  );

  const patched = await req('/llm/settings', 'PATCH', { temperature: 0.7, maxOutputTokens: 1234 });
  if (patched.status !== 200)
    fail(`PATCH settings → ${patched.status}: ${JSON.stringify(patched.body)}`);
  if (patched.body.temperature !== 0.7 || patched.body.maxOutputTokens !== 1234)
    fail(`PATCH did not merge: ${JSON.stringify(patched.body)}`);
  const reread = await req('/llm/settings', 'GET');
  if (reread.body.temperature !== 0.7) fail('temperature did not persist');
  ok('PATCH temperature/maxOutputTokens persisted (read-through, no cache)');

  for (const [patch, code] of [
    [{ provider: 'gemini' }, 'invalid_provider'],
    [{ temperature: 5 }, 'invalid_temperature'],
    [{ maxOutputTokens: 0 }, 'invalid_max_output_tokens'],
    [{ reasoningEffort: 'insane' }, 'invalid_reasoning_effort'],
  ] as const) {
    const r = await req('/llm/settings', 'PATCH', patch);
    if (r.status !== 400 || r.body.error !== code)
      fail(`PATCH ${JSON.stringify(patch)} expected 400 ${code}, got ${r.status} ${r.body.error}`);
  }
  ok('per-field 400s: invalid provider/temperature/maxOutputTokens/effort');

  // openrouter without its key → 409, decided in the route (env unset in-process).
  unsetEnv('OPENROUTER_API_KEY');
  const noKey = await req('/llm/settings', 'PATCH', { provider: 'openrouter' });
  if (noKey.status !== 409 || noKey.body.error !== 'provider_not_configured')
    fail(
      `openrouter without key expected 409 provider_not_configured, got ${noKey.status} ${noKey.body.error}`,
    );
  restoreEnv();
  ok('selecting openrouter without OPENROUTER_API_KEY → 409 provider_not_configured');
}

// ============================================================================
// 2. Prompt override → render → reset → restore-defaults
// ============================================================================
console.log('2. Prompt registry + editor');
{
  const list = await req('/x/prompts', 'GET');
  if (list.status !== 200 || !Array.isArray(list.body) || list.body.length !== 10)
    fail(`GET /x/prompts expected 10 keys, got ${list.status} len=${list.body?.length}`);
  for (const row of list.body) {
    if (!row.key || !row.name || !Array.isArray(row.required))
      fail(`prompt list row malformed: ${JSON.stringify(row)}`);
  }
  ok(`GET /x/prompts → 10 keys (${list.body.map((r) => r.key).join(', ')})`);

  const one = await req('/x/prompts/reply', 'GET');
  if (one.status !== 200 || typeof one.body.defaultBody !== 'string')
    fail(`GET /x/prompts/reply → ${one.status}`);
  const marker = '\n<!-- SMOKE MARKER -->';
  const edited = one.body.defaultBody + marker; // still contains {{TWEET_CONTEXT}}/{{IDEA}}

  const saved = await req('/x/prompts/reply', 'PATCH', { body: edited });
  if (saved.status !== 200 || saved.body.customized !== true)
    fail(`PATCH /x/prompts/reply → ${saved.status}: ${JSON.stringify(saved.body)}`);
  const loaded = loadPrompt('reply');
  if (!loaded.customized || !loaded.body.includes('SMOKE MARKER'))
    fail('loadPrompt did not reflect the override');
  ok('PATCH reply → loadPrompt sees the edited body + customized=true');

  const relisted = await req('/x/prompts', 'GET');
  if (
    !relisted.body.find((r: { key: string; customized?: boolean }) => r.key === 'reply')?.customized
  )
    fail('list did not mark reply customized');
  ok('list marks reply customized');

  const bad = await req('/x/prompts/reply', 'PATCH', { body: 'no placeholders at all' });
  if (
    bad.status !== 400 ||
    bad.body.error !== 'missing_placeholder' ||
    !bad.body.missing?.includes('{{TWEET_CONTEXT}}')
  )
    fail(`missing-placeholder save expected 400, got ${bad.status} ${JSON.stringify(bad.body)}`);
  ok('override dropping a required placeholder → 400 missing_placeholder');

  const unknown = await req('/x/prompts/does-not-exist', 'GET');
  if (unknown.status !== 404 || unknown.body.error !== 'unknown_prompt')
    fail(`unknown key expected 404 unknown_prompt, got ${unknown.status}`);
  ok('unknown key → 404 unknown_prompt');

  const reset = await req('/x/prompts/reply/reset', 'POST');
  if (reset.status !== 200 || reset.body.customized !== false) fail('reset failed');
  if (loadPrompt('reply').customized) fail('reset left the override in place');
  ok('reset removes the single override');

  // Re-override two keys, then restore-defaults wipes all overrides.
  await req('/x/prompts/reply', 'PATCH', { body: edited });
  await req('/x/prompts/post', 'GET').then((r) =>
    req('/x/prompts/post', 'PATCH', { body: `${r.body.defaultBody}\n<!-- x -->` }),
  );
  const restored = await req('/x/prompts/restore-defaults', 'POST');
  if (restored.status !== 200 || typeof restored.body.restored !== 'number')
    fail(`restore-defaults → ${restored.status}`);
  if (loadPrompt('reply').customized || loadPrompt('post').customized)
    fail('restore-defaults left overrides behind');
  ok(`restore-defaults removed ${restored.body.restored} override(s); all keys back to default`);
}

// ============================================================================
// 3. New-surface pre-spend guards (400s + no-key 503/409, $0)
// ============================================================================
console.log('3. New AI surfaces — refuse before spend');
{
  // 3a. Input 400s (validated before any LLM call, key-independent).
  const guards: Array<[string, unknown, string]> = [
    ['/x/posts/rewrite', { text: '   ' }, 'invalid_text'],
    ['/x/ideas/generate', { count: 0 }, 'invalid_count'],
    ['/x/ideas/generate', { provider: 'gemini' }, 'invalid_provider'],
    ['/x/posts/draft-thread', { tweetCount: 0 }, 'invalid_tweet_count'],
  ];
  for (const [path, body, code] of guards) {
    const r = await req(path, 'POST', body);
    // draft-thread checks pillars first; if the active niche has none it 409s
    // before reaching the tweetCount guard — still a $0 pre-spend refusal.
    if (
      path === '/x/posts/draft-thread' &&
      r.status === 409 &&
      r.body.error === 'no_pillars_for_niche'
    ) {
      ok(`POST ${path} ${JSON.stringify(body)} → 409 no_pillars_for_niche (pre-spend)`);
      continue;
    }
    if (r.status !== 400 || r.body.error !== code)
      fail(
        `POST ${path} ${JSON.stringify(body)} expected 400 ${code}, got ${r.status} ${r.body.error}`,
      );
    ok(`POST ${path} ${JSON.stringify(body)} → 400 ${code}`);
  }

  // 3b. No-key 503: unset BOTH provider keys so askLLM throws
  // LlmNotConfiguredError before any network — valid input, zero spend.
  unsetEnv('XAI_API_KEY');
  unsetEnv('OPENROUTER_API_KEY');
  const rw = await req('/x/posts/rewrite', 'POST', { text: 'Ship the thing, then talk about it.' });
  if (rw.status !== 503 || rw.body.error !== 'llm_not_configured')
    fail(`rewrite with no key expected 503 llm_not_configured, got ${rw.status} ${rw.body.error}`);
  ok('rewrite (valid input, no provider key) → 503 llm_not_configured (no spend)');

  // draft-thread / ideas: 503 (no key) OR 409 (empty-niche) — both $0.
  for (const [path, body] of [
    ['/x/posts/draft-thread', {}],
    ['/x/ideas/generate', {}],
  ] as const) {
    const r = await req(path, 'POST', body);
    const acceptable =
      (r.status === 503 && r.body.error === 'llm_not_configured') ||
      (r.status === 409 && r.body.error === 'no_pillars_for_niche');
    if (!acceptable)
      fail(
        `${path} (no key) expected 503 llm_not_configured or 409 no_pillars_for_niche, got ${r.status} ${r.body.error}`,
      );
    ok(`POST ${path} (valid, no key) → ${r.status} ${r.body.error} (pre-spend)`);
  }
  restoreEnv();
}

// ============================================================================
// 4. Model-effectiveness shape (pure)
// ============================================================================
console.log('4. buildModelEffectiveness');
{
  const eff = buildModelEffectiveness(
    [
      { model: 'grok-4.3', outcome: { views: 500, profileVisits: 10 } },
      { model: 'grok-4.3', outcome: { views: 300, profileVisits: 6 } },
      { model: 'grok-4.3', outcome: null }, // posted, unmeasured
      { model: 'anthropic/claude-sonnet-4.5', outcome: { views: 200, profileVisits: 4 } },
    ],
    2,
  );
  if (eff.totalMeasured !== 3) fail(`totalMeasured expected 3, got ${eff.totalMeasured}`);
  const grok = eff.cells.find((c) => c.model === 'grok-4.3');
  if (!grok || grok.n !== 2 || grok.posted !== 3 || grok.medianViews !== 400)
    fail(`grok cell wrong: ${JSON.stringify(grok)}`);
  if (eff.cells[0]?.model !== 'grok-4.3') fail('most-sampled bucket not first');
  if (!eff.cells.some((c) => c.model === 'anthropic/claude-sonnet-4.5'))
    fail('provider-slash model id not kept as-is');
  // Partition invariant: Σ bucket n = totalMeasured.
  if (eff.cells.reduce((s, c) => s + c.n, 0) !== eff.totalMeasured)
    fail('partition invariant broken');
  ok('bucketing/gate/most-sampled-first/provider-slash/partition invariant');
}

// ============================================================================
// 5. --live: ONE real OpenRouter call
// ============================================================================
if (LIVE) {
  console.log('5. --live OpenRouter call');
  if (!process.env.OPENROUTER_API_KEY) fail('--live needs OPENROUTER_API_KEY');
  const since = new Date(Date.now() - 60_000);
  const res = await askLLM(
    {
      provider: 'openrouter',
      prompt: 'Reply with exactly three words of greeting.',
      maxOutputTokens: 40,
    },
    { defaults: { temperature: 0.3 } },
  );
  if (res.provider !== 'openrouter') fail(`provider tag wrong: ${res.provider}`);
  if (!res.text || res.text.trim() === '') fail('no text back from OpenRouter');
  ok(
    `OpenRouter replied: "${res.text.trim().slice(0, 60)}" — $${res.costUsd.toFixed(4)}, model ${res.model}`,
  );
  // The cost log is fire-and-forget; give it a beat to land.
  await new Promise((r) => setTimeout(r, 500));
  const rows = db
    .select()
    .from(costEvents)
    .where(and(eq(costEvents.platform, 'openrouter'), gte(costEvents.ts, since)))
    .all();
  if (rows.length === 0) fail('no cost_events row under platform openrouter');
  ok(`cost_events: ${rows.length} openrouter row(s) logged this run`);
}

cleanup();
console.log('SMOKE OK');
process.exit(0);
