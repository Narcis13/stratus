// One-shot smoke for Radar curated drafting (RC.1–RC.4). Mounts settings +
// replies + radar in-process (no port, no workers) against the REAL DB and
// drives the whole curate → dismiss → draft chain at **$0** by default.
//
//   1. `POST /x/replies/curate`'s pre-spend ladder over the real DB — nine
//      refusals by code, then the full ladder forced to 503 `llm_not_configured`
//      with both provider keys unset. Reaching that gate IS the proof the
//      request rendered the operator's REAL `reply-curate` prompt (override row
//      included) and their real active niche without throwing — the route suite
//      runs on `:memory:`, where both are absent.
//   2. The `x.radar.curatedCount` knob through the settings ROUTES: PATCH →
//      mirrored blob (the panel's only source for the button label) →
//      `curateKeepTarget()`, plus the batch-cap clamp and the range refusals.
//   3. A canned model payload through `parseCurateScores` → `selectCurated`
//      with the keep target the store just returned — so the knob visibly
//      decides the outcome. Also the server half of the ⊕-pin exemption: a
//      pinned id the model volunteered a verdict on, but nobody ASKED about, is
//      neither drafted nor dismissed.
//   4. `curationScore` all the way to `radar_drafts.curation_score` on the real
//      database file: the wire validator's refusals, then a pin + a 91 + a 0
//      persisted and read back as `[null, 91, 0]`.
//
//   bun run scripts/smoke-radar-curate.ts            # $0, rerunnable
//   bun run scripts/smoke-radar-curate.ts --live     # + ONE real scoring call (~$0.003)
//
// `--live` exists because the list of claims a keyless run cannot make is NOT
// empty (D171c): only a real call proves the provider accepts `CURATE_SCHEMA`
// in strict mode, closes its JSON inside the computed `maxOutputTokens`, and
// hands back something `parseCurateScores` survives. It prints the grades so
// the rubric can be eyeballed — the lowValue call on obvious filler is reported
// as a calibration note, never asserted: it is model judgment, not a contract.
//
// What this script deliberately does NOT claim: that a ⊕ pin never reaches the
// curate request. That half is the panel's `partitionForCurate`, which lives in
// `extension/src/shared/radar.ts` and is unit-tested there — `scripts/` may not
// import the extension build (§5 build isolation). The route layer owns the
// other two halves, and both are covered here (steps 3 and 4).
//
// Rerunnable: `radar_drafts` rows are namespaced by tweet id and deleted from
// both the success path and `fail()`; the two settings keys it moves are
// snapshotted by `isDefault` and restored the same way (D113(d) — a reset would
// DELETE an override the operator set on purpose).

import { inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../src/db/client.ts';
import { llmConfigured } from '../src/llm/index.ts';
import { radarDrafts } from '../src/x/db/schema.ts';
import {
  MAX_CURATE_TWEETS,
  MAX_REASON_LENGTH,
  parseCurateScores,
  selectCurated,
} from '../src/x/replies/curate.ts';
import { persistRadarDrafts, radar } from '../src/x/routes/radar.ts';
import { curateKeepTarget, parseBatchTweets, replies } from '../src/x/routes/replies.ts';
import { settingsRouter } from '../src/x/routes/settings.ts';
import { resetSettings, resolveSetting, setSettings } from '../src/x/settings/registry.ts';

const LIVE = process.argv.includes('--live');

const app = new Hono();
app.route('/x', settingsRouter);
app.route('/x', replies);
app.route('/x', radar);

// ------------------------------------------------------- fixtures + cleanup

const PIN = '881000000000000001'; // ⊕ pinned by hand — never scored, always drafted
const HIGH = '881000000000000002'; // a curated survivor, score 91
const ZERO = '881000000000000003'; // a curated survivor, score 0 (a real verdict)
const OWNED = [PIN, HIGH, ZERO];

const L1 = '881000000000000011';
const L2 = '881000000000000012';
const L3 = '881000000000000013';
const LIVE_IDS = [L1, L2, L3];

const KNOBS = ['x.radar.curatedCount', 'x.ai.batchReplyCap'];
const knobSnapshot = new Map<string, { value: unknown; isDefault: boolean }>();
for (const key of KNOBS) knobSnapshot.set(key, resolveSetting(key));

/** Put the operator's own knobs back. Sync (bun:sqlite) so `fail()` can run it. */
function restoreKnobs(): void {
  for (const [key, prev] of knobSnapshot) {
    if (prev.isDefault) resetSettings({ keys: [key] });
    else setSettings({ [key]: prev.value });
  }
}

function cleanupRows(): void {
  db.delete(radarDrafts)
    .where(inArray(radarDrafts.tweetId, [...OWNED, ...LIVE_IDS]))
    .run();
}

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  restoreKnobs();
  cleanupRows();
  process.exit(1);
}

function ok(msg: string): void {
  console.log(`  ok: ${msg}`);
}

async function post(path: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const res = await app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function patch(path: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const res = await app.request(path, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

function errorCode(body: unknown): string {
  return typeof body === 'object' && body !== null && 'error' in body
    ? String((body as { error: unknown }).error)
    : `<no error field: ${JSON.stringify(body)}>`;
}

/** A tweet the wire validator accepts — numeric ids, handles ≤15 chars. */
function gradeable(n: number): Record<string, unknown> {
  return {
    tweetId: String(882000000000000000 + n),
    handle: `person${n}`,
    author: `Person ${n}`,
    text: `A post worth grading, number ${n}.`,
  };
}

// Start clean in case an earlier run died mid-way.
cleanupRows();

// ============================================================================
// 1. The pre-spend ladder, against the operator's real prompt + niche rows
// ============================================================================
console.log('1. POST /x/replies/curate — every refusal fires before the call');
{
  const rowsBefore = db.select().from(radarDrafts).all().length;

  const ladder: Array<[unknown, string]> = [
    [['not', 'an', 'object'], 'invalid_body'],
    [{ tweets: 'nope' }, 'invalid_tweets'],
    [{ tweets: [] }, 'empty_tweets'],
    // The cap here is the radar ring buffer (100), NOT `x.ai.batchReplyCap`: a
    // queue bigger than what we will draft is the precondition for curating.
    [
      { tweets: Array.from({ length: MAX_CURATE_TWEETS + 1 }, (_, i) => gradeable(i)) },
      'too_many_tweets',
    ],
    [
      { tweets: [gradeable(0), { tweetId: 'abc', handle: 'someone', text: 'x' }] },
      'invalid_tweet_id_1',
    ],
    [{ tweets: [{ tweetId: PIN, handle: 'someone', text: '   ' }] }, 'invalid_tweet_text_0'],
    [{ tweets: [gradeable(0)], model: '  ' }, 'invalid_model'],
    [{ tweets: [gradeable(0)], provider: 'gemini' }, 'invalid_provider'],
    [{ tweets: [gradeable(0)], reasoningEffort: 'extreme' }, 'invalid_reasoning_effort'],
  ];
  for (const [body, code] of ladder) {
    const r = await post('/x/replies/curate', body);
    if (r.status !== 400 || errorCode(r.body) !== code) {
      const sent = JSON.stringify(body).slice(0, 70);
      fail(`curate ${sent} expected 400 ${code}, got ${r.status} ${errorCode(r.body)}`);
    }
  }
  ok(`${ladder.length} refusals, each by its own code`);

  // Both provider keys unset, so the request 503s even on a machine with a key
  // — and reaching that gate is the proof it got all the way through
  // `loadPromptSafe('reply-curate')` + `loadActiveNicheSafe()` + the render,
  // against the REAL `prompt_overrides` / `niches` rows, without a network call.
  const xai = process.env.XAI_API_KEY;
  const openrouter = process.env.OPENROUTER_API_KEY;
  process.env.XAI_API_KEY = '';
  process.env.OPENROUTER_API_KEY = '';
  let gated: { status: number; body: unknown };
  try {
    gated = await post('/x/replies/curate', {
      tweets: [gradeable(0), gradeable(1), gradeable(2)],
      model: 'grok-4-fast',
      provider: 'grok',
      reasoningEffort: 'low',
    });
  } finally {
    process.env.XAI_API_KEY = xai ?? '';
    process.env.OPENROUTER_API_KEY = openrouter ?? '';
  }
  if (gated.status !== 503 || errorCode(gated.body) !== 'llm_not_configured') {
    fail(
      `the full ladder wanted 503 llm_not_configured, got ${gated.status} ${errorCode(gated.body)}`,
    );
  }
  ok('the full ladder reaches the LLM gate — the real prompt + niche rendered, nothing spent');

  // The route writes NOTHING by contract: the queue is the extension's session
  // buffer, and the score only reaches the DB on the follow-up batch call.
  const rowsAfter = db.select().from(radarDrafts).all().length;
  if (rowsAfter !== rowsBefore) fail(`curate wrote ${rowsAfter - rowsBefore} radar_drafts rows`);
  ok('radar_drafts is untouched — the scoring route persists nothing');
}

// ============================================================================
// 2. The knob, through the settings routes the panel actually reads
// ============================================================================
console.log('2. x.radar.curatedCount → the mirrored blob → curateKeepTarget()');
const KEEP_TARGET = 5;
{
  const applied = await patch('/x/settings', {
    'x.radar.curatedCount': KEEP_TARGET,
    'x.ai.batchReplyCap': 25,
  });
  if (applied.status !== 200)
    fail(`PATCH /x/settings → ${applied.status} ${errorCode(applied.body)}`);

  // The panel never imports the registry; it reads exactly this blob, and the
  // knob is `mirrored` precisely so the button can be labelled before any call.
  const res = await app.request('/x/settings/values?scope=mirrored');
  const mirrored = (await res.json()) as Record<string, unknown>;
  if (mirrored['x.radar.curatedCount'] !== KEEP_TARGET) {
    fail(`the mirrored blob carries ${mirrored['x.radar.curatedCount']}, not ${KEEP_TARGET}`);
  }
  if (mirrored['x.ai.batchReplyCap'] !== 25) fail('the batch cap fell out of the mirrored blob');
  ok(`mirrored blob: curatedCount=${KEEP_TARGET}, batchReplyCap=25`);

  if (curateKeepTarget() !== KEEP_TARGET) {
    fail(`curateKeepTarget() = ${curateKeepTarget()}, want ${KEEP_TARGET}`);
  }
  // The clamp: raising the knob past the cap the drafting call enforces must
  // not move the refusal one click later.
  setSettings({ 'x.radar.curatedCount': 40, 'x.ai.batchReplyCap': 30 });
  if (curateKeepTarget() !== 30) fail(`the batch cap did not clamp: ${curateKeepTarget()}`);
  ok('curateKeepTarget() is min(curatedCount, batchReplyCap) — the lower always wins');

  // The registry floors/ceilings are the guard an MCP agent hits too.
  for (const bad of [4, 51, 'lots']) {
    const r = await patch('/x/settings', { 'x.radar.curatedCount': bad });
    if (r.status !== 400 || errorCode(r.body) !== 'invalid_setting_value') {
      fail(
        `curatedCount=${bad} wanted 400 invalid_setting_value, got ${r.status} ${errorCode(r.body)}`,
      );
    }
  }
  if (resolveSetting('x.radar.curatedCount').value !== 40) {
    fail('a refused PATCH changed the stored knob');
  }
  ok('out-of-range values refused (5..50), the stored knob unchanged');

  setSettings({ 'x.radar.curatedCount': KEEP_TARGET, 'x.ai.batchReplyCap': 25 });
}

// ============================================================================
// 3. A canned model payload, selected with the keep target the store returned
// ============================================================================
console.log('3. parseCurateScores → selectCurated at the live keep target');
{
  // What the panel asked about: the fresh queue MINUS the ⊕ pin.
  const wanted = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  // A model response carrying every degradation the contract has to survive: a
  // high-scoring piece of filler, a real 0, a tie, an id nobody asked about
  // (the ⊕ pin — the model volunteering a verdict on a tweet it never saw is
  // exactly what anchoring exists for), a duplicate, and one id left ungraded.
  const raw = JSON.stringify({
    scores: [
      { id: 'A', score: 91, lowValue: false, reason: 'concrete p99 number to argue with' },
      { id: 'B', score: 0, lowValue: false, reason: 'nothing to add' },
      { id: 'C', score: 77, lowValue: false, reason: 'unsettled claim in my lane' },
      { id: 'D', score: 88, lowValue: true, reason: 'big account, but it is a follow train' },
      { id: 'E', score: 64, lowValue: false, reason: 'decent question' },
      { id: 'F', score: 64, lowValue: false, reason: 'decent question' },
      { id: 'H', score: 45, lowValue: false, reason: 'thin, but repliable' },
      { id: PIN, score: 99, lowValue: true, reason: 'never asked about this one' },
      { id: 'A', score: 3, lowValue: true, reason: 'a second verdict that must not win' },
    ],
  });

  const scores = parseCurateScores(raw);
  if (scores === null) fail('parseCurateScores rejected a well-formed payload');
  if (scores.length !== 9) fail(`parseCurateScores returned ${scores.length} rows, want 9`);

  const sel = selectCurated(scores, wanted, curateKeepTarget());
  // Best-first, and the E/F tie keeps the PANEL's order (the sort is stable on
  // the wanted index, not on however the model ordered its array).
  if (sel.keep.join(',') !== 'A,C,E,F,H') fail(`keep = [${sel.keep.join(', ')}], want A,C,E,F,H`);
  if (sel.keep.length !== KEEP_TARGET) fail('the keep set ignored the knob');
  // D drops on the flag at score 88; B drops for being past the cut at score 0.
  if ([...sel.drop].sort().join(',') !== 'B,D') fail(`drop = [${sel.drop.join(', ')}], want B,D`);
  if (sel.unscored.join(',') !== 'G') fail(`unscored = [${sel.unscored.join(', ')}], want G`);
  ok(
    `keep=${sel.keep.join('>')} · drop=${sel.drop.join(',')} · unscored=${sel.unscored.join(',')}`,
  );

  // The ⊕-pin exemption, server side: a pinned tweet the panel never sent
  // cannot be dismissed, however confidently the model flagged it.
  const everywhere = [...sel.keep, ...sel.drop, ...sel.unscored];
  if (everywhere.includes(PIN)) fail('a verdict on an id nobody asked about reached the selection');
  ok(
    'a lowValue:true verdict on an unasked ⊕ pin is inert — selection is anchored to what we sent',
  );

  // Nothing asked about is silently lost: a truncated response costs coverage,
  // never queue rows (decision 6).
  if ([...everywhere].sort().join(',') !== [...wanted].sort().join(',')) {
    fail('keep ∪ drop ∪ unscored is not the asked-for set');
  }
  ok('keep ∪ drop ∪ unscored = exactly what was asked — no queue row is lost or invented');
}

restoreKnobs();
ok("restored the operator's curatedCount / batchReplyCap");

// ============================================================================
// 4. curationScore → radar_drafts.curation_score, on the real database file
// ============================================================================
console.log('4. the score reaches radar_drafts (and 0 survives the trip)');
{
  // Exactly what the panel posts to generate-batch after a curated pass: the
  // ⊕ pin carries NO score (it was never graded), the survivors carry theirs.
  const pinned = {
    tweetId: PIN,
    handle: 'pinned_hand',
    author: 'Pinned By Hand',
    text: 'a tweet I pinned with the ⊕ button',
    url: `https://x.com/pinned_hand/status/${PIN}`,
    band: 'manual',
  };
  const high = {
    tweetId: HIGH,
    handle: 'smoke_high',
    author: 'Smoke High',
    text: 'a concrete claim worth replying under',
    url: `https://x.com/smoke_high/status/${HIGH}`,
    band: 'hot',
    curationScore: 91,
  };
  const zero = {
    tweetId: ZERO,
    handle: 'smoke_zero',
    author: 'Smoke Zero',
    text: 'graded, and graded a zero',
    url: `https://x.com/smoke_zero/status/${ZERO}`,
    band: 'warm',
    curationScore: 0,
  };

  // The wire refusals first — a fractional, out-of-range or stringly score is a
  // caller that isn't speaking this contract, and a silently clamped number
  // would poison the very measurement the column exists for.
  for (const bad of [50.5, 101, -1, '91']) {
    const r = parseBatchTweets([pinned, { ...high, curationScore: bad }]);
    if (!('error' in r) || r.error !== 'invalid_tweet_curation_score_1') {
      const got = JSON.stringify(r).slice(0, 70);
      fail(
        `curationScore=${JSON.stringify(bad)} wanted invalid_tweet_curation_score_1, got ${got}`,
      );
    }
  }
  ok('fractional / out-of-range / stringly scores are refused, indexed');

  const parsed = parseBatchTweets([pinned, high, zero]);
  if ('error' in parsed) fail(`the panel's own payload was refused: ${parsed.error}`);
  const tweets = parsed.tweets;
  if (tweets.length !== 3) fail(`parseBatchTweets kept ${tweets.length} tweets, want 3`);
  const pinTweet = tweets.find((t) => t.tweetId === PIN);
  if (pinTweet === undefined || pinTweet.curationScore !== undefined) {
    fail('the ⊕ pin came out of the validator carrying a score');
  }
  ok('the pin rides the batch with no score; the survivors keep 91 and 0');

  // persistRadarDrafts is best-effort by design (§7.8) — it SWALLOWS an insert
  // failure so the paid batch response still returns. So a `curation_score`
  // column missing from the operator's database shows up here as zero rows,
  // not as a throw: this read-back is what proves migration 0025 landed.
  const primary = { text: 'smoke primary — extends the point', angle: 'extends' };
  const variants = [
    primary,
    { text: 'smoke contrarian take', angle: 'contrarian' },
    { text: 'smoke debate prompt', angle: 'debate' },
  ];
  await persistRadarDrafts(
    tweets,
    tweets.map((t) => ({
      tweetId: t.tweetId,
      text: primary.text,
      angle: primary.angle,
      variants,
    })),
    'grok-smoke',
  );

  const stored = db.select().from(radarDrafts).where(inArray(radarDrafts.tweetId, OWNED)).all();
  if (stored.length !== 3) {
    fail(`radar_drafts holds ${stored.length} of our 3 rows — migration 0025 may not be applied`);
  }
  const byId = new Map(stored.map((r) => [r.tweetId, r]));
  const pinRow = byId.get(PIN);
  const highRow = byId.get(HIGH);
  const zeroRow = byId.get(ZERO);
  if (pinRow === undefined || highRow === undefined || zeroRow === undefined) {
    fail('a persisted row went missing between insert and read-back');
  }
  if (pinRow.curationScore !== null) fail(`the pin stored ${pinRow.curationScore}, want null`);
  if (highRow.curationScore !== 91) fail(`the 91 stored as ${highRow.curationScore}`);
  // The whole point of the column: `null` (never curated) and `0` (curated and
  // judged worthless) must not collapse into each other.
  if (zeroRow.curationScore !== 0) fail(`the 0 stored as ${zeroRow.curationScore} — 0 became null`);
  if (pinRow.band !== 'manual') fail(`the pin lost its band: ${pinRow.band}`);
  ok('curation_score = [null (pin), 91, 0] — a real 0 is not a missing score');

  // And the pin is a normal drafted row the queue rehydrates from.
  const res = await app.request(`/x/radar/drafts?tweetId=${PIN}`);
  const list = (await res.json()) as { drafts: Array<{ tweetId: string; band: string | null }> };
  if (!list.drafts.some((d) => d.tweetId === PIN && d.band === 'manual')) {
    fail('the pinned draft does not come back from GET /x/radar/drafts');
  }
  ok('GET /x/radar/drafts returns the pinned row — a pin is always drafted');
}

cleanupRows();
ok('cleanup');

// ============================================================================
// 5. --live — the only way to prove the model answers on contract
// ============================================================================
if (LIVE) {
  console.log('5. --live: ONE real scoring call on 3 tweets (~$0.003)');
  if (!llmConfigured()) {
    fail('--live needs an LLM provider (set XAI_API_KEY or OPENROUTER_API_KEY)');
  }
  const liveTweets = [
    {
      tweetId: L1,
      handle: 'smoke_perf',
      author: 'Smoke Perf',
      text: 'Rewrote our billing service in Rust. p99 went 340ms → 28ms, but the build got 4x slower. Ask me anything about the tradeoffs.',
    },
    {
      tweetId: L2,
      handle: 'smoke_pod',
      author: 'Smoke Pod',
      text: "drop your link below and let's connect 🚀 I follow everyone back, comment your handle and I'll check out your build",
    },
    {
      tweetId: L3,
      handle: 'smoke_ts',
      author: 'Smoke TS',
      text: "Is TypeScript's `satisfies` operator actually pulling its weight, or is it sugar people cargo-cult from a conference talk?",
    },
  ];

  const r = await post('/x/replies/curate', { tweets: liveTweets });
  if (r.status !== 200) fail(`curate returned ${r.status}: ${JSON.stringify(r.body)}`);
  const res = r.body as {
    scored: Array<{ tweetId: string; score: number; lowValue: boolean; reason: string }>;
    keep: string[];
    drop: string[];
    unscored: string[];
    keepTarget: number;
    costUsd: number;
    model: string;
  };

  if (res.scored.length === 0) fail('a live call came back with zero grades');
  for (const s of res.scored) {
    if (!LIVE_IDS.includes(s.tweetId)) fail(`the response graded an unasked id: ${s.tweetId}`);
    if (!Number.isInteger(s.score) || s.score < 0 || s.score > 100) {
      fail(`score out of contract for ${s.tweetId}: ${s.score}`);
    }
    if (s.reason.length > MAX_REASON_LENGTH) fail(`reason not clipped for ${s.tweetId}`);
  }
  const covered = [...res.keep, ...res.drop, ...res.unscored].sort().join(',');
  if (covered !== [...LIVE_IDS].sort().join(',')) {
    fail(`keep ∪ drop ∪ unscored (${covered}) is not the asked-for set`);
  }
  if (res.costUsd <= 0 || res.model === '') fail('a live call reported no cost or no model');
  ok(
    `${res.scored.length}/3 graded, keepTarget=${res.keepTarget}, cost $${res.costUsd.toFixed(4)} model=${res.model}`,
  );

  const label = new Map(liveTweets.map((t) => [t.tweetId, t.handle]));
  for (const s of res.scored) {
    const who = label.get(s.tweetId) ?? s.tweetId;
    const flag = s.lowValue ? 'lowValue' : '        ';
    console.log(`     @${who}  ${String(s.score).padStart(3)}  ${flag}  ${s.reason}`);
  }
  // Calibration, not a contract: whether the rubric fires on obvious filler is
  // model judgment, and an opening-guess category list is exactly the thing a
  // live run is here to inform. Reported, never asserted.
  const pod = res.scored.find((s) => s.tweetId === L2);
  if (pod !== undefined && !pod.lowValue) {
    console.log(
      '     note: the follow-train post was NOT flagged lowValue — a calibration signal.',
    );
  }
  cleanupRows();
  ok('live cleanup (the scoring route writes nothing, so there is nothing to undo)');
}

console.log('SMOKE PASS');
process.exit(0);
