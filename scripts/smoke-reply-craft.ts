// One-shot smoke for the reply-craft overhaul (RC.1-RC.10,
// plans/2026-08-08-reply-craft-overhaul.md). Runs in-process against the REAL
// DB and costs **$0 by default**:
//
//   1. The six-room taxonomy, keyword detector and five-angle vocabulary.
//   2. The complete mode precedence against a temporary cannon_targets pin:
//      explicit > curated > roster > detected > fallback.
//   3. Template byte-sync, per-post MODE rendering, mode-specific angle trim,
//      the widened strict schema, and the route's pre-spend mode guard.
//   4. The Playbook's room, opening x room and contamination cells on a small
//      pure corpus, including capture rate beside raw yield.
//
//   bun run scripts/smoke-reply-craft.ts          # $0, rerunnable
//   bun run scripts/smoke-reply-craft.ts --live   # + ONE mixed 5-post batch
//
// `--live` exists for one claim a keyless run cannot make: that the configured
// provider accepts the widened five-angle enum in strict mode and returns a
// parseable heterogeneous batch. It makes exactly ONE call. The five posts span
// every non-fallback room, so the schema union is all five angles while the
// route still trims each tweet to its own room. The script asserts the hard
// output contracts (no em dash, no lane-noun contamination outside expertise,
// no banned English opener, only allowed angles) and prints every variant. Read
// those lines: whether football sounds like football and grief sounds like
// grief is model judgement, not a parser contract.
//
// Rerunnable: the temporary roster row is a config the operator owns, so it is
// snapshotted/restored with a sentinel (the smoke-humanizer discipline). Live
// radar_drafts rows use namespaced tweet ids and are deleted on entry, success,
// and fail. cost_events remain: they are the permanent spend ledger.

import { eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../src/db/client.ts';
import { llmConfigured } from '../src/llm/index.ts';
import {
  REPLY_ANGLES,
  REPLY_MODES,
  type ReplyMode,
  type ReplyModeId,
  containsLaneNoun,
  detectReplyMode,
} from '../src/shared/replyMode.ts';
import { cannonTargets, radarDrafts } from '../src/x/db/schema.ts';
import { type OwnReplyRow, buildOwnReplyPerformance, ownReplyOpening } from '../src/x/playbook.ts';
import { resolveReplyMode, trimToModeAngles } from '../src/x/replies/mode.ts';
import {
  REPLY_BATCH_PROMPT_TEMPLATE,
  REPLY_PROMPT_TEMPLATE,
  type ReplyVariant,
  batchReplySchema,
  buildBatchGrokInput,
} from '../src/x/replies/prompt.ts';
import { parseBatchTweets, replies } from '../src/x/routes/replies.ts';

const LIVE = process.argv.includes('--live');
const app = new Hono();
app.route('/x', replies);

const HANDLE = 'smokecraft';
const SENTINEL = '__smoke_craft__';
const LIVE_TWEETS = [
  {
    tweetId: '893000000000000001',
    handle: 'rc10expert',
    author: 'RC10 Expert',
    text: 'Postgres partial indexes cut this query from 900ms to 40ms.',
    curatedMode: 'expertise',
  },
  {
    tweetId: '893000000000000002',
    handle: 'rc10take',
    author: 'RC10 Take',
    text: 'Unpopular opinion: buying flowers once still beats forgetting the request.',
    curatedMode: 'hot-take',
  },
  {
    tweetId: '893000000000000003',
    handle: 'rc10news',
    author: 'RC10 News',
    text: 'BREAKING: Parliament confirms the election result after the final count.',
    curatedMode: 'news',
  },
  {
    tweetId: '893000000000000004',
    handle: 'rc10warm',
    author: 'RC10 Warm',
    text: 'The puppy hears her person come home and the ear twitch at 0:04 gives it away.',
    curatedMode: 'wholesome',
  },
  {
    tweetId: '893000000000000005',
    handle: 'rc10banter',
    author: 'RC10 Banter',
    text: 'Arsenal after that Champions League miss. Football heritage.',
    curatedMode: 'banter',
  },
] as const;
const LIVE_IDS = LIVE_TWEETS.map((t) => t.tweetId);

type TargetRow = typeof cannonTargets.$inferSelect;
const rowBefore = db.select().from(cannonTargets).where(eq(cannonTargets.handle, HANDLE)).get();
// A sentinel row belongs to a run that died before restore. Treat it as debris,
// never as the operator's baseline, or the fixture becomes permanent.
const baseline: TargetRow | undefined = rowBefore?.notes?.includes(SENTINEL)
  ? undefined
  : rowBefore;
let restored = false;

function restoreTarget(): void {
  if (restored) return;
  restored = true;
  if (baseline) {
    db.insert(cannonTargets)
      .values(baseline)
      .onConflictDoUpdate({ target: cannonTargets.handle, set: baseline })
      .run();
  } else {
    db.delete(cannonTargets).where(eq(cannonTargets.handle, HANDLE)).run();
  }
}

function cleanupLive(): void {
  db.delete(radarDrafts).where(inArray(radarDrafts.tweetId, LIVE_IDS)).run();
}

function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  restoreTarget();
  cleanupLive();
  process.exit(1);
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

function ok(message: string): void {
  console.log(`  ok: ${message}`);
}

function mode(id: ReplyModeId): ReplyMode {
  const found = REPLY_MODES.find((m) => m.id === id);
  if (!found) fail(`missing mode ${id}`);
  return found;
}

function schemaKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) schemaKeys(item, out);
    return out;
  }
  if (!value || typeof value !== 'object') return out;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    out.add(key);
    schemaKeys(child, out);
  }
  return out;
}

cleanupLive();
if (rowBefore && !baseline) {
  console.log(`note: dropping debris from a prior ${SENTINEL} run`);
}

// ============================================================================
// 1. Canonical taxonomy + detection
// ============================================================================
console.log('1. reply rooms + detector');
{
  const ids = REPLY_MODES.map((m) => m.id);
  check(
    JSON.stringify(ids) ===
      JSON.stringify(['expertise', 'hot-take', 'news', 'wholesome', 'banter', 'general']),
    `mode order drifted: ${JSON.stringify(ids)}`,
  );
  check(new Set(ids).size === ids.length, 'reply mode ids are not unique');
  check(new Set(REPLY_ANGLES).size === 5, 'reply angle vocabulary is not five unique values');
  for (const m of REPLY_MODES) {
    check(m.minChars > 0 && m.maxChars >= m.minChars, `${m.id} has an invalid char range`);
    check(m.angles.length > 0, `${m.id} has no angles`);
    check(
      m.angles.every((a) => REPLY_ANGLES.includes(a)),
      `${m.id} names an unknown angle`,
    );
  }

  const fixtures: Array<[string, ReplyModeId | null]> = [
    [LIVE_TWEETS[0].text, 'expertise'],
    [LIVE_TWEETS[1].text, 'hot-take'],
    [LIVE_TWEETS[2].text, 'news'],
    [LIVE_TWEETS[3].text, 'wholesome'],
    [LIVE_TWEETS[4].text, 'banter'],
    ['A thought without category markers', null],
  ];
  for (const [text, expected] of fixtures) {
    const actual = detectReplyMode(text)?.id ?? null;
    check(
      actual === expected,
      `detectReplyMode(${JSON.stringify(text)}) = ${actual}, want ${expected}`,
    );
  }
  ok('6 ordered rooms, 5 angles, valid budgets; all five detector fixtures + unknown hold');
}

// ============================================================================
// 2. Full resolver precedence on the real DB
// ============================================================================
console.log('2. mode resolution precedence');
{
  db.insert(cannonTargets)
    .values({ handle: HANDLE, topic: 'banter', notes: SENTINEL })
    .onConflictDoUpdate({
      target: cannonTargets.handle,
      set: { topic: 'banter', notes: SENTINEL, updatedAt: new Date() },
    })
    .run();

  const explicit = await resolveReplyMode({
    explicit: 'wholesome',
    targets: [{ handle: HANDLE, text: LIVE_TWEETS[0].text, curated: 'news' }],
  });
  check(explicit[0]?.mode.id === 'wholesome' && explicit[0].source === 'explicit', 'explicit lost');

  const resolved = await resolveReplyMode({
    targets: [
      { handle: HANDLE, text: LIVE_TWEETS[0].text, curated: 'news' },
      { handle: HANDLE, text: LIVE_TWEETS[0].text },
      { handle: 'rc10detect', text: LIVE_TWEETS[0].text },
      { handle: 'rc10unknown', text: 'A thought without category markers' },
    ],
  });
  const got = resolved.map((r) => `${r.mode.id}/${r.source}`);
  check(
    JSON.stringify(got) ===
      JSON.stringify(['news/curated', 'banter/roster', 'expertise/detected', 'general/fallback']),
    `resolver precedence drifted: ${JSON.stringify(got)}`,
  );
  ok('explicit > curated > roster > detected > general/fallback');
}
restoreTarget();
ok(baseline ? 'operator roster row restored' : 'temporary roster row removed');

// ============================================================================
// 3. Templates, schemas, trim and route guard
// ============================================================================
console.log('3. rendered modes + widened strict schema');
{
  const markdown = await Bun.file(new URL('../reply prompt.md', import.meta.url)).text();
  check(REPLY_PROMPT_TEMPLATE.trimEnd() === markdown.trimEnd(), 'reply prompt.md byte-sync failed');
  for (const template of [REPLY_PROMPT_TEMPLATE, REPLY_BATCH_PROMPT_TEMPLATE]) {
    check(
      template.includes('## Sounding like a person, not a model'),
      'humanization block missing',
    );
    check(template.includes('No em dashes. Not one.'), 'em-dash ban missing');
    check(template.includes('background, not material'), 'persona-scope heading missing');
    check(template.includes('aim for 40–90 characters'), 'length target missing');
  }

  const parsed = parseBatchTweets(LIVE_TWEETS);
  check('tweets' in parsed, `live fixtures failed the route parser: ${JSON.stringify(parsed)}`);
  const resolved = await resolveReplyMode({
    targets: parsed.tweets.map((t) => ({
      handle: t.handle,
      text: t.text,
      curated: t.curatedMode ?? null,
    })),
  });
  const tweets = parsed.tweets.map((t, i) => {
    const resolution = resolved[i];
    check(resolution, `fixture ${t.tweetId} has no mode resolution`);
    return { ...t, mode: resolution.mode };
  });
  const prompt = buildBatchGrokInput(tweets)[0]?.content ?? '';
  for (const m of REPLY_MODES.slice(0, -1)) {
    check(prompt.includes(`MODE: ${m.id}`), `batch post lost MODE: ${m.id}`);
    check(prompt.includes(`\`${m.id}\` — Persona:`), `batch legend lost ${m.id}`);
  }
  check(
    (prompt.match(/Each post above carries a MODE line/g) ?? []).length === 1,
    'mode note repeats',
  );

  const schema = batchReplySchema({ angles: REPLY_ANGLES });
  const angleEnum = schema.properties.replies.items.properties.variants.items.properties.angle.enum;
  check(
    JSON.stringify(angleEnum) === JSON.stringify(REPLY_ANGLES),
    'strict schema angle enum drifted',
  );
  const forbidden = ['minimum', 'maximum', 'minItems', 'maxItems', 'minLength', 'maxLength'];
  const keys = schemaKeys(schema);
  check(
    forbidden.every((key) => !keys.has(key)),
    'strict schema contains an unsupported keyword',
  );

  const allVariants: ReplyVariant[] = REPLY_ANGLES.map((angle) => ({
    text: `fixture ${angle}`,
    angle,
    gloss: null,
  }));
  const wholesome = trimToModeAngles(allVariants, mode('wholesome'));
  check(
    JSON.stringify(wholesome.map((v) => v.angle)) ===
      JSON.stringify(['extends', 'observation', 'question']),
    `per-room trim drifted: ${JSON.stringify(wholesome.map((v) => v.angle))}`,
  );

  const invalid = await app.request('/x/replies/generate-batch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tweets: LIVE_TWEETS, mode: 42 }),
  });
  check(invalid.status === 400, `invalid mode reached ${invalid.status}, want 400`);
  const invalidBody = (await invalid.json()) as { error?: string };
  check(invalidBody.error === 'invalid_mode', `mode guard returned ${invalidBody.error}`);
  ok('byte-sync + mode lines/legend + five-angle strict schema + trim + pre-spend guard');
}

// ============================================================================
// 4. Measurement cells
// ============================================================================
console.log('4. Playbook room/opening/contamination measurement');
{
  const base = {
    likes: 0,
    comments: 0,
    tweetTimeMs: 1_000_000,
    parentViews: 1_000,
    parentComments: 5,
    parentTimeMs: 700_000,
  };
  const rows: OwnReplyRow[] = [
    {
      ...base,
      tweetId: 'craft-measure-1',
      text: 'I build apps for this exact problem',
      views: 10,
      parentHandle: 'take-one',
      parentText: LIVE_TWEETS[1].text,
    },
    {
      ...base,
      tweetId: 'craft-measure-2',
      text: 'Flowers once still counts',
      views: 30,
      parentHandle: 'take-two',
      parentText: LIVE_TWEETS[1].text,
    },
    {
      ...base,
      tweetId: 'craft-measure-3',
      text: 'While markets wait, the second vote matters',
      views: 20,
      parentHandle: 'news-one',
      parentText: LIVE_TWEETS[2].text,
    },
  ];
  const perf = buildOwnReplyPerformance(rows, new Map(), 1);
  const hotTake = perf.modes.find((c) => c.mode === 'hot-take');
  const news = perf.modes.find((c) => c.mode === 'news');
  check(hotTake?.n === 2 && news?.n === 1, 'mode cells did not partition the corpus');
  check(perf.contamination.n === 3, `contamination denominator=${perf.contamination.n}, want 3`);
  check(perf.contamination.contaminated === 1, 'lane-noun contamination was not counted');
  check(perf.contamination.pct === 33.33, `contamination pct=${perf.contamination.pct}`);
  check(perf.captureBp !== null, 'corpus capture rate is missing');
  check(
    perf.openingsByMode.some((c) => c.mode === 'hot-take' && c.opening === 'i-my') &&
      perf.openingsByMode.some((c) => c.mode === 'news' && c.opening === 'subordinate'),
    'opening x mode cells are missing',
  );
  ok('mode cells, opening x mode, capture rate and 1/3 contamination all land');
}

// ============================================================================
// 5. --live: exactly one real heterogeneous strict-schema batch
// ============================================================================
if (LIVE) {
  console.log('5. --live: one five-room batch (one provider call)');
  if (!llmConfigured()) {
    fail('--live needs an LLM provider (set XAI_API_KEY or OPENROUTER_API_KEY)');
  }

  const response = await app.request('/x/replies/generate-batch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tweets: LIVE_TWEETS }),
  });
  if (response.status !== 200) {
    fail(`generate-batch → ${response.status}: ${(await response.text()).slice(0, 400)}`);
  }
  const body = (await response.json()) as {
    replies: Array<{
      tweetId: string;
      mode: ReplyModeId | null;
      modeSource: string | null;
      variants: ReplyVariant[];
    }>;
    count: number;
    costUsd: number;
    model: string;
  };
  check(body.count === LIVE_TWEETS.length, `live batch returned ${body.count}/5 replies`);

  const lengths: number[] = [];
  for (const fixture of LIVE_TWEETS) {
    const reply = body.replies.find((r) => r.tweetId === fixture.tweetId);
    check(reply, `live batch omitted ${fixture.tweetId}`);
    check(reply.mode === fixture.curatedMode, `${fixture.tweetId} mode=${reply.mode}`);
    check(reply.modeSource === 'curated', `${fixture.tweetId} source=${reply.modeSource}`);
    check(reply.variants.length > 0, `${fixture.tweetId} returned no variants`);
    const room = mode(fixture.curatedMode);
    for (const variant of reply.variants) {
      console.log(`     [${reply.mode}/${variant.angle}] ${variant.text}`);
      check(
        room.angles.includes(variant.angle),
        `${reply.mode} returned forbidden ${variant.angle}`,
      );
      check(!variant.text.includes('—'), `${reply.mode} returned an em dash: ${variant.text}`);
      if (room.personaUse !== 'full') {
        check(!containsLaneNoun(variant.text), `${reply.mode} contaminated: ${variant.text}`);
      }
      const opening = ownReplyOpening(variant.text);
      check(
        opening !== 'i-my' && opening !== 'subordinate' && opening !== 'determiner',
        `${reply.mode} used banned opener ${opening}: ${variant.text}`,
      );
      lengths.push([...variant.text].length);
    }
  }
  lengths.sort((a, b) => a - b);
  const median = lengths[Math.floor(lengths.length / 2)] ?? 0;
  check(median >= 40 && median <= 90, `median generated length=${median}, want 40-90`);
  ok(
    `${body.count}/5 rooms, allowed angles only, no em dash/contamination/banned opener; median ${median} chars; cost $${body.costUsd} model=${body.model}`,
  );
  cleanupLive();
  ok('live radar_drafts rows dropped (cost_events stay)');
  console.log(
    "\n  READ THE VARIANTS ABOVE. Register and humour are model judgement. A room that sounds wrong means recalibrate that room's registerNote/moves after enough measured replies, not the parser.",
  );
}

restoreTarget();
cleanupLive();
console.log(
  LIVE
    ? 'SMOKE PASS (--live: one mixed-topic batch)'
    : 'SMOKE PASS ($0 - rerun with --live for one mixed-topic batch)',
);
process.exit(0);
