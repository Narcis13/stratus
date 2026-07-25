// One-shot smoke for the reply lists (RL.1–RL.8). Mounts the reply-lists +
// playbook routers in-process (no port, no workers, no LLM by default) against
// the real DB: creates a throwaway list with 5 templated items, walks 10 `/use`
// calls asserting the anti-repeat pick (no immediate repeats, ≥3 distinct items)
// and that {name}/{first_name}/{handle} came out filled, proves `preview:true`
// writes nothing, checks the empty-list 409, swaps the whole set with
// mode:'replace', then seeds a published reply matching one use's rendered text
// and asserts the Playbook's `canned` bucket moves by exactly +1 (delta, not an
// absolute — reply_list_uses is FK-free and other rows may exist). Finally
// deletes the list and proves items cascade while the use log survives. Deletes
// every row it created. $0.
// --live adds ONE /generate call (~$0.003–$0.01) asserting a parsed proposal
// that is never persisted.
// Run: bun run scripts/smoke-reply-lists.ts [--live]

import { and, eq, inArray, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../src/db/client.ts';
import { llmConfigured } from '../src/llm/index.ts';
import {
  metricsSnapshots,
  postsPublished,
  replyListItems,
  replyListUses,
  replyLists,
} from '../src/x/db/schema.ts';
import { playbook } from '../src/x/routes/playbook.ts';
import { replyListsRouter } from '../src/x/routes/replyLists.ts';

const LIVE = process.argv.includes('--live');

const LIST_NAME = 'smoke reply list';
const EMPTY_LIST_NAME = 'smoke reply list (empty)';
const LIVE_LIST_NAME = 'smoke reply list (ai)';
const ALL_NAMES = [LIST_NAME, EMPTY_LIST_NAME, LIVE_LIST_NAME];

const TARGET = '970000000000000001'; // the tweet we would be replying to
const PUBLISHED = '970000000000000002'; // my own reply, as the daily pass would store it
const TARGET_HANDLE = 'smokelistuser';

const VARS = { name: 'Ana Pop', handle: 'anapop' };

const TEMPLATES = [
  'Thanks for the early read, {name}!',
  'appreciate the signal boost, @{handle}',
  'this one is going in the swipe file',
  'good to see you here, {first_name}',
  'solid point — noted',
];

const app = new Hono();
app.route('/x', replyListsRouter);
app.route('/x', playbook);

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}
function ok(msg: string): void {
  console.log(`ok: ${msg}`);
}

async function cleanup(): Promise<void> {
  // Uses are FK-free on purpose, so they need deleting by hand — the target id
  // every /use in this script carries is the handle we have on them.
  await db.delete(replyListUses).where(eq(replyListUses.targetTweetId, TARGET));
  await db.delete(metricsSnapshots).where(eq(metricsSnapshots.tweetId, PUBLISHED));
  await db.delete(postsPublished).where(eq(postsPublished.tweetId, PUBLISHED));
  // Items cascade with the list.
  await db.delete(replyLists).where(inArray(replyLists.name, ALL_NAMES));
}

async function req(path: string, method: string, body?: unknown): Promise<Response> {
  return app.request(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

interface ListRow {
  id: string;
  name: string;
  humanizer: unknown;
  active: boolean;
}
interface ItemRow {
  id: string;
  text: string;
  enabled: boolean;
  source: string;
  useCount: number;
}
interface UseRow {
  itemId: string;
  text: string;
  missingVars: string[];
  applied: string[];
}
interface OutcomeCell {
  posted: number;
  n: number;
}
interface PlaybookBody {
  batchVsSingle: {
    single: OutcomeCell;
    radar: OutcomeCell;
    canned: OutcomeCell;
    unattributed: number;
  };
}

// Start clean in case an earlier run died mid-way.
await cleanup();

// 1. Create the list.
let r = await req('/x/reply-lists', 'POST', {
  name: LIST_NAME,
  description: 'throwaway list created by scripts/smoke-reply-lists.ts',
});
if (r.status !== 201) fail(`POST /reply-lists returned ${r.status}: ${await r.text()}`);
const list = (await r.json()) as ListRow;
if (list.humanizer !== null)
  fail('a fresh list must start on the engine defaults (humanizer null)');
if (!list.active) fail('a fresh list must be active');
ok(`list created ${list.id.slice(0, 8)}… (humanizer null = engine defaults)`);

// 2. Five templated items.
r = await req(`/x/reply-lists/${list.id}/items`, 'POST', {
  mode: 'append',
  items: TEMPLATES.map((text) => ({ text })),
});
if (r.status !== 200) fail(`POST /items returned ${r.status}: ${await r.text()}`);
const added = (await r.json()) as { items: ItemRow[] };
if (added.items.length !== 5) fail(`expected 5 items, got ${added.items.length}`);
if (added.items.some((i) => !i.enabled || i.source !== 'manual'))
  fail('appended items must default to enabled + source manual');
const templateById = new Map(added.items.map((i) => [i.id, i.text]));
if (added.items.map((i) => i.text).join('\n') !== TEMPLATES.join('\n'))
  fail('items came back out of insertion order');
ok('5 templated items appended, insertion order preserved');

// 3. Ten uses — the anti-repeat pick and the var fill.
const seen: string[] = [];
for (let i = 0; i < 10; i++) {
  r = await req(`/x/reply-lists/${list.id}/use`, 'POST', {
    vars: VARS,
    targetTweetId: TARGET,
    targetHandle: TARGET_HANDLE,
  });
  if (r.status !== 200) fail(`/use #${i + 1} returned ${r.status}: ${await r.text()}`);
  const used = (await r.json()) as UseRow;
  const template = templateById.get(used.itemId);
  if (!template) fail(`/use #${i + 1} returned an itemId that isn't in this list`);
  if (seen.length > 0 && seen[seen.length - 1] === used.itemId)
    fail(`/use #${i + 1} repeated the previous item — the exclusion window failed`);
  if (used.missingVars.length > 0)
    fail(`/use #${i + 1} reported missing vars ${used.missingVars.join(',')} with both supplied`);
  if (/\{(name|first_name|handle)\}/.test(used.text))
    fail(`/use #${i + 1} left a raw template var in the text`);
  if (used.text.length > 280) fail(`/use #${i + 1} produced ${used.text.length} chars`);
  // Typos never touch a protected value (Decision 5), so the filled name/handle
  // survives humanization byte-for-byte.
  if (template.includes('{name}') && !used.text.includes(VARS.name))
    fail(`/use #${i + 1} did not fill {name}: ${used.text}`);
  if (template.includes('{first_name}') && !used.text.includes('Ana'))
    fail(`/use #${i + 1} did not fill {first_name}: ${used.text}`);
  if (template.includes('{handle}') && !used.text.includes(VARS.handle))
    fail(`/use #${i + 1} did not fill {handle}: ${used.text}`);
  seen.push(used.itemId);
}
const distinct = new Set(seen).size;
if (distinct < 3) fail(`10 uses only touched ${distinct} distinct items`);
const usedText = (
  await db
    .select({ renderedText: replyListUses.renderedText })
    .from(replyListUses)
    .where(eq(replyListUses.targetTweetId, TARGET))
).map((u) => u.renderedText);
if (usedText.length !== 10) fail(`expected 10 reply_list_uses rows, got ${usedText.length}`);
const [counted] = await db
  .select({ total: sql<number>`sum(${replyListItems.useCount})` })
  .from(replyListItems)
  .where(eq(replyListItems.listId, list.id));
if (Number(counted?.total ?? 0) !== 10) fail(`use_count sums to ${counted?.total}, expected 10`);
ok(`10 uses: no immediate repeats, ${distinct} distinct items, vars filled, 10 use rows logged`);

// 4. preview:true composes without spending an item.
r = await req(`/x/reply-lists/${list.id}/use`, 'POST', { vars: VARS, preview: true });
if (r.status !== 200) fail(`preview /use returned ${r.status}`);
const previewed = (await r.json()) as UseRow;
if (previewed.text.trim() === '') fail('preview returned empty text');
const [afterPreview] = await db
  .select({ total: sql<number>`sum(${replyListItems.useCount})` })
  .from(replyListItems)
  .where(eq(replyListItems.listId, list.id));
const previewUses = await db
  .select({ id: replyListUses.id })
  .from(replyListUses)
  .where(eq(replyListUses.targetTweetId, TARGET));
if (Number(afterPreview?.total ?? 0) !== 10 || previewUses.length !== 10)
  fail('preview:true wrote state (use_count or reply_list_uses moved)');
ok('preview:true composes text and writes nothing');

// 5. A list with nothing to pick refuses with 409 rather than an empty string.
r = await req('/x/reply-lists', 'POST', { name: EMPTY_LIST_NAME });
if (r.status !== 201) fail(`creating the empty list returned ${r.status}`);
const emptyList = (await r.json()) as ListRow;
r = await req(`/x/reply-lists/${emptyList.id}/use`, 'POST', {});
if (r.status !== 409) fail(`/use on an empty list returned ${r.status}, expected 409`);
const emptyErr = (await r.json()) as { error: string };
if (emptyErr.error !== 'no_enabled_items') fail(`expected no_enabled_items, got ${emptyErr.error}`);
ok('empty list → 409 no_enabled_items');

// 6. replace swaps the whole set in one txn.
r = await req(`/x/reply-lists/${list.id}/items`, 'POST', {
  mode: 'replace',
  items: [{ text: 'generated ack one, {name}' }, { text: 'generated ack two' }],
  source: 'ai',
});
if (r.status !== 200) fail(`replace returned ${r.status}: ${await r.text()}`);
const replaced = (await r.json()) as { items: ItemRow[] };
if (replaced.items.length !== 2) fail(`replace left ${replaced.items.length} items, expected 2`);
if (replaced.items.some((i) => templateById.has(i.id))) fail('replace kept an old item row');
if (replaced.items.some((i) => i.source !== 'ai')) fail('replace did not stamp source=ai');
ok('replace swapped the set (2 ai items, old rows gone)');

// 7. The Playbook `canned` bucket. Snapshot first, then publish a reply whose
//    text is exactly what a use composed — the only evidence a canned reply
//    leaves (RL.7). Delta, never an absolute: the DB may already hold uses.
r = await app.request('/x/playbook');
if (r.status !== 200) fail(`GET /x/playbook returned ${r.status}`);
const before = ((await r.json()) as PlaybookBody).batchVsSingle;

const cannedText = usedText[0];
if (!cannedText) fail('no rendered text to publish');
const nowMs = Date.now();
await db.insert(postsPublished).values({
  tweetId: PUBLISHED,
  text: cannedText,
  postedAt: new Date(nowMs - 3_600_000),
  isReply: true,
  inReplyToTweetId: TARGET,
  source: 'smoke',
});
await db.insert(metricsSnapshots).values({
  tweetId: PUBLISHED,
  publicMetrics: { impression_count: 640, like_count: 4, reply_count: 1 },
  nonPublicMetrics: { user_profile_clicks: 7 },
});

r = await app.request('/x/playbook');
if (r.status !== 200) fail(`GET /x/playbook (after) returned ${r.status}`);
const after = ((await r.json()) as PlaybookBody).batchVsSingle;
if (after.canned.posted !== before.canned.posted + 1)
  fail(`canned.posted moved ${before.canned.posted} → ${after.canned.posted}, expected +1`);
if (after.canned.n !== before.canned.n + 1)
  fail(`canned.n moved ${before.canned.n} → ${after.canned.n}, expected +1 (measured)`);
if (after.unattributed !== before.unattributed) fail('the canned reply leaked into unattributed');
ok(`playbook canned bucket: posted ${before.canned.posted}→${after.canned.posted}, measured +1`);

// 8. Generating without a provider key must refuse cleanly, never half-write.
if (!llmConfigured()) {
  r = await req(`/x/reply-lists/${list.id}/generate`, 'POST', { prompt: 'short thanks replies' });
  if (r.status !== 503) fail(`/generate without a key returned ${r.status}, expected 503`);
  const genErr = (await r.json()) as { error: string };
  if (genErr.error !== 'llm_not_configured')
    fail(`expected llm_not_configured, got ${genErr.error}`);
  ok('/generate without an LLM key → 503 llm_not_configured (CRUD unaffected)');
} else {
  // The unknown-list 404 fires before any spend, key or no key (§7.4).
  r = await req('/x/reply-lists/99999999-0000-4000-8000-000000000000/generate', 'POST', {
    prompt: 'short thanks replies',
  });
  if (r.status !== 404) fail(`/generate on an unknown list returned ${r.status}, expected 404`);
  ok('/generate on an unknown list → 404 before any spend (key is set; no call made)');
}

// 9. Delete: items cascade, the use log survives it (that's the whole point of
//    the FK-free table — attribution outlives the list).
r = await req(`/x/reply-lists/${list.id}`, 'DELETE');
if (r.status !== 200) fail(`DELETE returned ${r.status}`);
r = await app.request(`/x/reply-lists/${list.id}`);
if (r.status !== 404) fail(`GET after DELETE returned ${r.status}, expected 404`);
const orphanItems = await db
  .select({ id: replyListItems.id })
  .from(replyListItems)
  .where(eq(replyListItems.listId, list.id));
if (orphanItems.length !== 0) fail(`${orphanItems.length} items survived the cascade`);
const survivingUses = await db
  .select({ id: replyListUses.id })
  .from(replyListUses)
  .where(and(eq(replyListUses.targetTweetId, TARGET), eq(replyListUses.listId, list.id)));
if (survivingUses.length !== 10) fail(`${survivingUses.length} use rows survived, expected 10`);
ok('delete: items cascaded, all 10 use rows survived (attribution outlives the list)');

if (LIVE) {
  if (!llmConfigured()) fail('--live needs an LLM provider (XAI_API_KEY or OPENROUTER_API_KEY)');
  console.log('--live: one /generate call (~$0.003–$0.01)…');
  r = await req('/x/reply-lists', 'POST', { name: LIVE_LIST_NAME });
  if (r.status !== 201) fail(`creating the live list returned ${r.status}`);
  const liveList = (await r.json()) as ListRow;

  r = await req(`/x/reply-lists/${liveList.id}/generate`, 'POST', {
    prompt: 'short thanks replies to someone who read my post early, some using {name}, no emoji',
    count: 3,
  });
  if (r.status !== 200) fail(`/generate returned ${r.status}: ${await r.text()}`);
  const gen = (await r.json()) as {
    items: Array<{ text: string }>;
    count: number;
    requested: number;
    model: string;
    costUsd: number;
  };
  if (gen.requested !== 3) fail(`/generate echoed requested=${gen.requested}`);
  if (gen.items.length === 0 || gen.items.length > 3)
    fail(`/generate returned ${gen.items.length} items for a request of 3`);
  if (gen.items.some((i) => i.text.trim() === '' || i.text.length > 280))
    fail('/generate returned an empty or over-long item');

  r = await app.request(`/x/reply-lists/${liveList.id}`);
  const liveDetail = (await r.json()) as { items: ItemRow[] };
  if (liveDetail.items.length !== 0) fail('/generate persisted items — it must be proposal-only');
  ok(
    `/generate: ${gen.items.length} items proposed, nothing persisted, cost $${gen.costUsd} model=${gen.model}`,
  );
}

// 10. Cleanup.
await cleanup();
ok('cleanup');

console.log('SMOKE PASS');
process.exit(0);
