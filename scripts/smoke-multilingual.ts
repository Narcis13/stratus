// One-shot smoke for the multilingual reply lane (ML.1–ML.5,
// plans/2026-08-05-multilingual-replies.md). Runs the pure core, the roster
// lookup and the resolution ladder against the REAL DB, in-process (no port, no
// workers), at **$0** by default.
//
//   1. `weightedLength` over ja/ar/en/emoji fixtures — the finding that
//      justified the whole table: a Japanese sentence weighs ~2× its codepoints
//      while an Arabic one weighs EXACTLY its codepoints. Plus the table's own
//      invariants (unique codes, a register axis everywhere, ar rtl+280).
//   2. `detectScript` over a real `harvest_rows` row (see the note below when
//      the corpus has none) plus the ambiguity rules a fixture can pin: kana
//      separates ja from zh, Latin answers `null`, quoted English cannot swing
//      a Japanese post.
//   3. The FULL `resolveReplyLanguage` precedence against a temporary
//      `cannon_targets` row: explicit > roster > detection > English, the
//      benched-handle rule (`cannonLanguageFor` ignores `active` on purpose),
//      an unrecognized roster value degrading to a `null` PROFILE rather than a
//      near-miss (§7.11), and the batch's all-or-nothing set semantics.
//   4. The English equivalence guarantee (N.3): a resolved-English call's
//      rendered prompt is BYTE-IDENTICAL to a pre-ML call on both the single
//      and the batch builder, and `replyVariantsSchema()` with no args
//      deep-equals the shipped const. This is the assertion that says the
//      feature is invisible until a non-English language resolves.
//
//   bun run scripts/smoke-multilingual.ts          # $0, rerunnable
//   bun run scripts/smoke-multilingual.ts --live   # + TWO real calls (~$0.01–0.02)
//
// `--live` exists because of D171c's per-surface question: the reply path CAN
// reach `askLLM`, and no keyless run can claim that a model handed a
// tail-stamped register axis actually writes Japanese, returns one variant, and
// fills the gloss. It makes exactly two calls, and they are deliberately made
// through DIFFERENT doors:
//   * Japanese goes DIRECT (buildGrokInput → askLLM → parseReplyVariants →
//     trimToSingleVariant) because that is the only way to see the RAW variant
//     count before the trim discards the extras — through the route those are
//     invisible, and "the model returned three and we paid for two we threw
//     away" is exactly the waste the plan's risk section says to watch.
//   * Arabic goes through `POST /x/replies/generate` because that is the only
//     way to prove the ladder end to end: detection off the post's own script
//     with nobody passing a language, the trim, the persisted row and the
//     echoed `language`/`languageSource`.
// The cost assertion rides on the route call: a provider-call COUNTER wrapped
// around `globalThis.fetch` proves the specificity-gate skip (decision 8) is
// real — one call, not the two a Latin-only gate would have burnt.
// Both print every variant WITH its gloss: whether the register is right is
// model judgement, not a contract, and a human reads those lines. This is what
// supersedes VERIFY-DEBT `0q(b)`.
//
// Rerunnable: the one row it writes is a namespaced `cannon_targets` handle,
// snapshotted before the write and restored after — the roster is a config the
// user owns, so this follows `smoke-humanizer.ts` rather than the
// namespace-then-delete shape, including its `__smoke_lang__` sentinel: a run
// killed mid-way leaves OUR row behind, and the next run must recognize it as
// debris instead of adopting it as "the original" and making it permanent.

import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../src/db/client.ts';
import { type AskLlmResult, askLLM, llmConfigured } from '../src/llm/index.ts';
import {
  LANGUAGE_PROFILES,
  MAX_WEIGHTED,
  detectScript,
  resolveLanguageProfile,
  weightedLength,
} from '../src/shared/language.ts';
import { cannonLanguageFor } from '../src/x/cannon/membership.ts';
import { cannonTargets, harvestRows } from '../src/x/db/schema.ts';
import { resolveReplyLanguage, trimToSingleVariant } from '../src/x/replies/language.ts';
import {
  BATCH_REPLY_SCHEMA,
  type PostContext,
  REPLY_VARIANTS_SCHEMA,
  type ReplyVariant,
  batchReplySchema,
  buildBatchGrokInput,
  buildGrokInput,
  parseReplyVariants,
  passesSpecificityGate,
  replyVariantsSchema,
} from '../src/x/replies/prompt.ts';
import { replies, replyLlmDefaults } from '../src/x/routes/replies.ts';

const LIVE = process.argv.includes('--live');

const app = new Hono();
app.route('/x', replies);

// The roster row this script owns. ≤15 chars because the reply route's
// USERNAME_RE validates the same handle on the live path below.
const HANDLE = 'smokemultiling';
// A SECOND handle for the live route call, and the reason is the feature under
// test: if the live draft used HANDLE, step 3's roster row (or its debris)
// would win the precedence and detection — the thing --live exists to prove —
// would never fire.
const LIVE_HANDLE = 'smokemultilive';
const LIVE_TWEET_PREFIX = '884000000000';

// `cannon_targets.language` is ≤16 chars, which is why the sentinel is short
// enough to live in `notes` OR the language column. It goes in `notes`: the
// language column is what step 3 asserts over, so the ownership marker must sit
// somewhere the assertions never read.
const SENTINEL = '__smoke_lang__';

const jp = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
const ar = /\p{Script=Arabic}/u;

// ------------------------------------------------------- snapshot / restore

type TargetRow = typeof cannonTargets.$inferSelect;

function readTarget(): TargetRow | undefined {
  return db.select().from(cannonTargets).where(eq(cannonTargets.handle, HANDLE)).get();
}

const rowBefore = readTarget();
// A row carrying the sentinel belongs to a run that died before its restore.
// Adopting it as the baseline would make this script's fixture permanent, so
// the honest recovery is to treat the baseline as ABSENT (restore = delete).
const baseline = rowBefore?.notes?.includes(SENTINEL) ? undefined : rowBefore;
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
  db.run(`delete from reply_drafts where source_tweet_id like '${LIVE_TWEET_PREFIX}%'`);
}

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  restoreTarget();
  cleanupLive();
  process.exit(1);
}

function ok(msg: string): void {
  console.log(`  ok: ${msg}`);
}

if (rowBefore && !baseline) {
  console.log(
    `  note: the ${HANDLE} roster row carries ${SENTINEL} — a prior run died mid-way, so it is being dropped rather than preserved.`,
  );
}

// ============================================================================
// 1. weightedLength + the profile table's own invariants
// ============================================================================
console.log('1. weightedLength (twitter-text) + LANGUAGE_PROFILES');
{
  // Hand-computed: every codepoint is weight 2, and there are 5 of them.
  if (weightedLength('こんにちは') !== 10)
    fail(`weightedLength('こんにちは') = ${weightedLength('こんにちは')}, want 10`);
  // The finding the whole table exists for: Arabic sits inside [0,4351], so it
  // is weight 1 and needs NO length change. Halving it would lose half a reply.
  if (weightedLength('مرحبا') !== 5)
    fail(`weightedLength('مرحبا') = ${weightedLength('مرحبا')}, want 5`);
  ok("こんにちは = 10 (2×), مرحبا = 5 (1×) — the 'non-English ⇒ halve it' trap refused");

  const ASCII = 'Shipped it. 900ms to 40ms.';
  if (weightedLength(ASCII) !== ASCII.length) fail('ASCII must weigh exactly its length');
  // The UTF-16 bug this replaces: `.length` counts surrogate PAIRS, so an emoji
  // reads 2 there by accident and 2 here on purpose — a rare kanji is where the
  // two diverge, and the codepoint iteration is what makes them agree.
  const RARE = '𠮷';
  if (RARE.length !== 2 || weightedLength(RARE) !== 2) fail('astral codepoint weighs 2, once');
  const JA_SENTENCE = 'スケジューラを直した。900ミリ秒が40ミリ秒になった。';
  const jaW = weightedLength(JA_SENTENCE);
  const jaCp = [...JA_SENTENCE].length;
  if (jaW <= jaCp) fail('a Japanese sentence must weigh MORE than its codepoint count');
  ok(`ASCII 1×, 𠮷 = 2 over ${RARE.length} UTF-16 units, a ja sentence ${jaCp} cp → ${jaW} weight`);

  if (MAX_WEIGHTED !== 280) fail(`MAX_WEIGHTED = ${MAX_WEIGHTED}, want 280`);
  const codes = new Set<string>();
  for (const p of LANGUAGE_PROFILES) {
    if (codes.has(p.code)) fail(`duplicate profile code ${p.code}`);
    codes.add(p.code);
    if (p.registerAxis.trim() === '') fail(`${p.code} has no register axis`);
    if (p.maxChars !== 140 && p.maxChars !== 280) fail(`${p.code} maxChars ${p.maxChars}`);
  }
  const arabic = resolveLanguageProfile('ar');
  if (!arabic || !arabic.rtl || arabic.maxChars !== 280) fail('the Arabic profile is wrong');
  const japanese = resolveLanguageProfile('  JAPANESE ');
  if (japanese?.code !== 'ja' || japanese.maxChars !== 140)
    fail('ja did not resolve case/space-insensitively');
  if (resolveLanguageProfile('klingon') !== null)
    fail('an unknown language must resolve to null (§7.11)');
  ok(
    `${LANGUAGE_PROFILES.length} profiles, unique codes + a register axis each; ar rtl/280, ja 140; 'klingon' → null`,
  );
  // Done when #4 of the plan: adding a language is ONE table entry. Arabic is
  // the proof — nothing outside LANGUAGE_PROFILES names it.
  ok('adding a language is one LANGUAGE_PROFILES entry (ar is the shipped proof)');
}

// ============================================================================
// 2. detectScript — over the real corpus first, then the ambiguity rules
// ============================================================================
console.log('2. detectScript');
{
  const corpus = db
    .select({ tweetId: harvestRows.tweetId, handle: harvestRows.handle, text: harvestRows.text })
    .from(harvestRows)
    .all();
  const detected = corpus
    .map((r) => ({ ...r, profile: detectScript(r.text) }))
    .filter((r): r is typeof r & { profile: NonNullable<typeof r.profile> } => r.profile !== null);

  if (detected.length > 0) {
    const byCode = new Map<string, number>();
    for (const r of detected) byCode.set(r.profile.code, (byCode.get(r.profile.code) ?? 0) + 1);
    const sample = detected[0];
    if (sample) {
      // The real-row claim: whatever script the corpus row is in, the profile
      // that comes back must actually own text of that script (a `ja` verdict
      // on a row with no kana/kanji would be the bug this asserts against).
      if (sample.profile.code === 'ja' && !jp.test(sample.text)) {
        fail(`a 'ja' verdict on a row with no kana/kanji: ${sample.tweetId}`);
      }
      if (sample.profile.code === 'ar' && !ar.test(sample.text)) {
        fail(`an 'ar' verdict on a row with no Arabic script: ${sample.tweetId}`);
      }
      console.log(
        `     @${sample.handle} ${sample.tweetId} → ${sample.profile.code}: ${sample.text.slice(0, 60)}`,
      );
    }
    ok(
      `${detected.length}/${corpus.length} harvested rows detect non-Latin: ${[...byCode]
        .map(([c, n]) => `${c}×${n}`)
        .join(', ')}`,
    );
  } else {
    // NOT a failure and not silently skipped either (§7.11 — absence is a fact
    // of its own). Two honest reasons the corpus can be empty of them: this DB
    // is a dev copy with no harvest runs, or every foreign row predates TR.1
    // and therefore stores X's ENGLISH machine translation rather than the
    // original — which is precisely the bug Task 4 fixed on the reply path, and
    // it means old rows CANNOT detect as Japanese however Japanese they were.
    console.log(
      `  note: ${corpus.length} harvest_rows, none in a non-Latin script — nothing to prove detection against here. Rerun on a DB with a real foreign-language harvest (and remember pre-TR.1 rows hold X's English translation, not the original).`,
    );
  }

  // The rules a fixture pins regardless of what the corpus holds.
  const JA =
    '新しいスケジューラを試した。書き込みを1つのトランザクションにまとめるだけで速くなった。';
  const ZH = '我们把写入合并到一个事务里，速度快了很多。';
  const KO = '스케줄러를 고쳤습니다. 쓰기를 한 트랜잭션으로 묶었어요.';
  const AR = 'أعدت كتابة المجدول ليجمع كل عمليات الكتابة في معاملة واحدة.';
  const RU = 'Переписал планировщик: все записи теперь в одной транзакции.';
  const EN = 'Rewrote the scheduler so every write lands in one transaction.';
  const cases: Array<[string, string, string | null]> = [
    ['ja', JA, 'ja'],
    ['zh', ZH, 'zh'],
    ['ko', KO, 'ko'],
    ['ar', AR, 'ar'],
    ['ru', RU, 'ru'],
    ['en', EN, null],
    // Han is SHARED: without the kana rule this reads `zh`.
    ['ja (kanji-heavy)', '本番環境で確認した。', 'ja'],
    // A Japanese post quoting an English product name must not drift to Latin.
    ['ja + quoted English', '「Claude Code」を使って書き直した。', 'ja'],
    // Nothing voted / no majority.
    ['digits only', '900ms → 40ms (2026)', null],
    ['empty', '', null],
  ];
  for (const [label, text, want] of cases) {
    const got = detectScript(text)?.code ?? null;
    if (got !== want) fail(`detectScript(${label}) = ${got}, want ${want}`);
  }
  ok(`${cases.length} fixtures: kana separates ja from zh; Latin and digit-only answer null`);
}

// ============================================================================
// 3. resolveReplyLanguage — the whole precedence, against a real roster row
// ============================================================================
console.log('3. resolveReplyLanguage precedence (temporary cannon_targets row)');
const JA_POST = '新しいスケジューラを試した。書き込みを1つのトランザクションにまとめた。';
const AR_POST = 'أعدت كتابة المجدول ليجمع كل عمليات الكتابة في معاملة واحدة.';
const EN_POST = 'Rewrote the scheduler so every write lands in one transaction.';
{
  const writeRow = (language: string | null, active = true): void => {
    db.insert(cannonTargets)
      .values({ handle: HANDLE, language, active, notes: SENTINEL })
      .onConflictDoUpdate({
        target: cannonTargets.handle,
        set: { language, active, notes: SENTINEL },
      })
      .run();
  };

  // --- no roster row at all: detection, then English.
  db.delete(cannonTargets).where(eq(cannonTargets.handle, HANDLE)).run();
  const detected = await resolveReplyLanguage({ targets: [{ handle: HANDLE, text: JA_POST }] });
  if (
    detected.language !== 'Japanese' ||
    detected.source !== 'detected' ||
    detected.profile?.code !== 'ja'
  ) {
    fail(`detection: ${JSON.stringify(detected)}`);
  }
  const english = await resolveReplyLanguage({ targets: [{ handle: HANDLE, text: EN_POST }] });
  if (english.language !== undefined || english.source !== undefined || english.profile !== null) {
    fail(`an English post must resolve to nothing at all: ${JSON.stringify(english)}`);
  }
  ok('no roster row: a Japanese post detects → Japanese/detected; an English post → undefined');

  // --- roster beats detection. The post is ARABIC and the pin says Japanese,
  //     so a passing assertion can only come from the roster.
  writeRow('Japanese');
  if ((await cannonLanguageFor(`@${HANDLE.toUpperCase()}`)) !== 'Japanese') {
    fail('cannonLanguageFor did not normalize the handle');
  }
  const roster = await resolveReplyLanguage({ targets: [{ handle: HANDLE, text: AR_POST }] });
  if (
    roster.language !== 'Japanese' ||
    roster.source !== 'roster' ||
    roster.profile?.code !== 'ja'
  ) {
    fail(`roster must beat detection: ${JSON.stringify(roster)}`);
  }
  ok('roster pin beats detection (Japanese pin over an Arabic post)');

  // --- benched is still Japanese. `cannonLanguageFor` deliberately does NOT
  //     filter on `active`: benching means "stop camping", not "start replying
  //     in English".
  writeRow('Japanese', false);
  const benched = await resolveReplyLanguage({ targets: [{ handle: HANDLE, text: AR_POST }] });
  if (benched.source !== 'roster' || benched.profile?.code !== 'ja') {
    fail(`a benched handle lost its language: ${JSON.stringify(benched)}`);
  }
  ok('a BENCHED roster row keeps its language (active is not the question being asked)');

  // --- explicit beats both, and it short-circuits before the DB is touched.
  const explicit = await resolveReplyLanguage({
    explicit: 'Arabic',
    targets: [{ handle: HANDLE, text: JA_POST }],
  });
  if (
    explicit.language !== 'Arabic' ||
    explicit.source !== 'explicit' ||
    explicit.profile?.code !== 'ar'
  ) {
    fail(`explicit must win outright: ${JSON.stringify(explicit)}`);
  }
  ok('an explicit body language beats the roster pin AND the post script');

  // --- §7.11: an unrecognized value names the language and carries NO profile,
  //     rather than being coerced to a near-miss. The clause degrades to the
  //     bare CQ.7 sentence and the draft keeps all three angles.
  writeRow(SENTINEL);
  const unknown = await resolveReplyLanguage({ targets: [{ handle: HANDLE, text: EN_POST }] });
  if (unknown.language !== SENTINEL || unknown.source !== 'roster' || unknown.profile !== null) {
    fail(`an unrecognized roster value was coerced: ${JSON.stringify(unknown)}`);
  }
  const bareClause = buildGrokInput(ctxFor(HANDLE, EN_POST), undefined, undefined, undefined, {
    language: unknown.language,
    languageProfile: unknown.profile,
  })[0]?.content;
  if (!bareClause?.includes(`Write all variants in ${SENTINEL}.`))
    fail('the bare clause did not render');
  if (bareClause.includes('Register axis:'))
    fail('an unrecognized language must carry no register axis');
  ok('an unrecognized roster value → language named, profile null, the bare CQ.7 clause (§7.11)');

  // --- an EMPTY language column is not a pin.
  writeRow('   ');
  const blank = await resolveReplyLanguage({ targets: [{ handle: HANDLE, text: JA_POST }] });
  if (blank.source !== 'detected')
    fail(`a blank language column acted as a pin: ${JSON.stringify(blank)}`);
  ok('a blank language column falls through to detection');

  // --- batch set semantics: all-or-nothing, per CALL not per tweet.
  db.delete(cannonTargets).where(eq(cannonTargets.handle, HANDLE)).run();
  const agreeing = await resolveReplyLanguage({
    targets: [
      { handle: HANDLE, text: JA_POST },
      { handle: 'someoneelse', text: '本番環境で確認した。書き込みは1つにまとめた。' },
    ],
  });
  if (agreeing.language !== 'Japanese') fail(`an all-Japanese batch: ${JSON.stringify(agreeing)}`);
  const mixed = await resolveReplyLanguage({
    targets: [
      { handle: HANDLE, text: JA_POST },
      { handle: 'someoneelse', text: AR_POST },
    ],
  });
  if (mixed.language !== undefined || mixed.profile !== null) {
    fail(`a mixed batch must fall to English: ${JSON.stringify(mixed)}`);
  }
  const partly = await resolveReplyLanguage({
    targets: [
      { handle: HANDLE, text: JA_POST },
      { handle: 'someoneelse', text: EN_POST },
    ],
  });
  if (partly.language !== undefined)
    fail(`one undetectable tweet must sink the set: ${JSON.stringify(partly)}`);
  ok('batch is all-or-nothing: agreeing → that language, mixed or partly-undetectable → English');

  // The DB half is done — restore now rather than at exit, so the window in
  // which a crash could leave debris on the roster is microseconds wide.
  restoreTarget();
  console.log(
    baseline
      ? `  ok: restored the original ${HANDLE} roster row`
      : `  ok: no ${HANDLE} roster row before this run — removed`,
  );
}

// ============================================================================
// 4. The English equivalence guarantee (N.3) + the schema shapes
// ============================================================================
console.log('4. English equivalence + schema shapes');
{
  const ctx = ctxFor('someoneelse', EN_POST);
  // The pre-plan fixture: a call built exactly the way it was built before any
  // of this shipped. Everything below has to reproduce it byte for byte.
  const cold = buildGrokInput(ctx)[0]?.content ?? '';
  if (cold === '') fail('the cold prompt is empty');

  const resolved = await resolveReplyLanguage({
    targets: [{ handle: ctx.handle, text: ctx.text }],
  });
  // Exactly what routes/replies.ts spreads: nothing at all when English resolved.
  const warm = buildGrokInput(ctx, undefined, undefined, undefined, {
    ...(resolved.language !== undefined
      ? { language: resolved.language, languageProfile: resolved.profile }
      : {}),
  })[0]?.content;
  if (warm !== cold)
    fail('a resolved-English single call is NOT byte-identical to the pre-plan fixture');
  if (
    buildGrokInput(ctx, undefined, undefined, undefined, { language: '   ' })[0]?.content !== cold
  ) {
    fail('a whitespace-only language changed the prompt');
  }

  const batchTweets = [
    { tweetId: ctx.tweetId, handle: ctx.handle, author: ctx.author, text: ctx.text },
  ];
  const coldBatch = buildBatchGrokInput(batchTweets)[0]?.content ?? '';
  const warmBatch = buildBatchGrokInput(batchTweets, undefined, undefined, undefined, undefined, {
    ...(resolved.language !== undefined
      ? { language: resolved.language, languageProfile: resolved.profile }
      : {}),
  })[0]?.content;
  if (warmBatch !== coldBatch) fail('a resolved-English batch call is not byte-identical either');
  ok('a resolved-English call renders the pre-plan prompt byte-for-byte (single + batch)');

  // And the non-English tail actually carries the three things it promises,
  // appended — the prefix is untouched, which is what keeps §7.14 intact.
  const ja = resolveLanguageProfile('Japanese');
  const jaPrompt =
    buildGrokInput(ctx, undefined, undefined, undefined, {
      language: 'Japanese',
      languageProfile: ja,
    })[0]?.content ?? '';
  if (!jaPrompt.startsWith(cold))
    fail('the Japanese clause is not a pure APPEND to the cold prompt');
  for (const needle of [
    'Register axis:',
    'under 140 Japanese characters',
    'produce only the extends variant',
    '"gloss"',
  ]) {
    if (!jaPrompt.includes(needle)) fail(`the Japanese tail is missing: ${needle}`);
  }
  ok(
    'the Japanese tail appends the register axis, the 140-char budget, the extends narrowing and the gloss',
  );

  // Schema shapes. `replyVariantsSchema()` with no args IS the shipped const,
  // so no existing caller moved; the narrowed one makes the other two angles
  // unrepresentable rather than merely discouraged.
  if (JSON.stringify(replyVariantsSchema()) !== JSON.stringify(REPLY_VARIANTS_SCHEMA)) {
    fail('replyVariantsSchema() drifted from REPLY_VARIANTS_SCHEMA');
  }
  if (JSON.stringify(batchReplySchema()) !== JSON.stringify(BATCH_REPLY_SCHEMA)) {
    fail('batchReplySchema() drifted from BATCH_REPLY_SCHEMA');
  }
  const narrowed = replyVariantsSchema({ angles: ['extends'] });
  const item = narrowed.properties.replies.items;
  if (JSON.stringify(item.properties.angle.enum) !== JSON.stringify(['extends'])) {
    fail(`the narrowed angle enum is ${JSON.stringify(item.properties.angle.enum)}`);
  }
  if (
    !item.required.includes('gloss') ||
    JSON.stringify(item.properties.gloss.type) !== JSON.stringify(['string', 'null'])
  ) {
    fail('gloss must be nullable-AND-required (strict mode has no optional properties)');
  }
  // D164b: the walked unsupported-keyword set. A schema that grows one of these
  // is rejected by the provider at call time, which is a paid failure.
  const banned = ['minItems', 'maxItems', 'minLength', 'maxLength', 'pattern', 'format'];
  for (const schema of [REPLY_VARIANTS_SCHEMA, BATCH_REPLY_SCHEMA, narrowed]) {
    const json = JSON.stringify(schema);
    for (const kw of banned)
      if (json.includes(`"${kw}"`)) fail(`schema carries D164b keyword ${kw}`);
  }
  ok(
    'replyVariantsSchema() == the shipped const; ["extends"] narrows the enum; gloss nullable+required; no D164b keywords',
  );

  // The trim is the CONTRACT (maxItems cannot cap an array in strict mode).
  const three: ReplyVariant[] = [
    { text: 'a', angle: 'contrarian', gloss: null },
    { text: 'b', angle: 'extends', gloss: 'B' },
    { text: 'c', angle: 'debate', gloss: null },
  ];
  const trimmed = trimToSingleVariant(three);
  if (trimmed.length !== 1 || trimmed[0]?.angle !== 'extends') {
    fail(`the trim kept ${JSON.stringify(trimmed)}`);
  }
  if (trimToSingleVariant([]).length !== 0) fail('the trim invented a variant from nothing');
  ok('trimToSingleVariant keeps the extends variant out of three, and never invents one');

  // §7.35: the gloss parser is LENIENT — a bad gloss costs a convenience, not a
  // paid variant. `text`/`angle` stay strict.
  const lenient = parseReplyVariants(
    JSON.stringify({
      replies: [
        { text: 'kept, no gloss key', angle: 'extends' },
        { text: 'kept, null gloss', angle: 'extends', gloss: null },
        { text: 'kept, numeric gloss', angle: 'extends', gloss: 42 },
        { text: 'kept, real gloss', angle: 'extends', gloss: 'a literal rendering' },
      ],
    }),
  );
  if (lenient?.length !== 4)
    fail(`a malformed gloss cost a paid variant: ${JSON.stringify(lenient)}`);
  if (lenient.slice(0, 3).some((v) => v.gloss !== null))
    fail('a malformed gloss did not become null');
  if (lenient[3]?.gloss !== 'a literal rendering') fail('a real gloss was dropped');
  ok('§7.35: missing/null/non-string gloss → null and the variant SURVIVES; a real gloss is kept');
}

// ============================================================================
// 5. --live — two calls, and the only proof the model honors any of it
// ============================================================================
if (LIVE) {
  console.log('5. --live: one Japanese draft (direct) + one Arabic draft (route) — ~$0.01–0.02');
  if (!llmConfigured())
    fail('--live needs an LLM provider (set XAI_API_KEY or OPENROUTER_API_KEY)');

  // ---------------------------------------------------------------- Japanese
  // Direct, because the route trims before it answers and the RAW count is the
  // thing the plan's risk section asks a human to watch: the prefix still says
  // "three variants" and the tail says "one", so a model returning three costs
  // us two we discard. Wasteful, never wrong — but it has to be VISIBLE.
  const jaProfile = resolveLanguageProfile('Japanese');
  const jaCtx = ctxFor(LIVE_HANDLE, JA_POST);
  const jaResolved = await resolveReplyLanguage({
    targets: [{ handle: jaCtx.handle, text: jaCtx.text }],
  });
  if (jaResolved.source !== 'detected' || jaResolved.profile?.code !== 'ja') {
    fail(`the live Japanese post did not detect: ${JSON.stringify(jaResolved)}`);
  }
  const jaResult: AskLlmResult = await askLLM(
    {
      messages: buildGrokInput(jaCtx, undefined, undefined, undefined, {
        language: jaResolved.language ?? 'Japanese',
        languageProfile: jaProfile,
      }),
      jsonSchema: { name: 'reply_variants', schema: replyVariantsSchema({ angles: ['extends'] }) },
    },
    { defaults: replyLlmDefaults() },
  );
  const jaRaw = parseReplyVariants(jaResult.text);
  if (jaRaw === null) fail(`the Japanese call did not parse: ${jaResult.text.slice(0, 200)}`);
  const jaVariants = trimToSingleVariant(jaRaw);
  const jaPrimary = jaVariants[0];
  if (!jaPrimary) fail('the Japanese call returned no variants');
  if (jaVariants.length !== 1 || jaPrimary.angle !== 'extends') {
    fail(`want exactly one extends variant, got ${JSON.stringify(jaVariants.map((v) => v.angle))}`);
  }
  if (!jp.test(jaPrimary.text)) fail(`no kana/kanji in the Japanese variant: ${jaPrimary.text}`);
  if (jaPrimary.gloss === null) fail('the Japanese variant came back with no gloss');
  console.log(
    `     raw variants before the trim: ${jaRaw.length}${jaRaw.length > 1 ? ' ← paid for and discarded (the soft layer; see the plan risk note)' : ''}`,
  );
  printVariants('ja', jaRaw, jaResult);
  ok(
    `Japanese: 1 extends variant, ${weightedLength(jaPrimary.text)}/${MAX_WEIGHTED} weighted (${[...jaPrimary.text].length} chars vs a ${jaProfile?.maxChars} budget), gloss present, cost $${jaResult.costUsd.toFixed(4)}`,
  );
  // The gate skip, stated as a fact rather than assumed: this is WHY the regen
  // is skipped for a non-English draft (decision 8), and the route half below
  // is what proves the skip actually happened.
  console.log(
    `     passesSpecificityGate(ja) = ${passesSpecificityGate(jaPrimary.text)} — the English-tuned regexes are inapplicable here, which is the skip's whole justification`,
  );

  // ------------------------------------------------------------------ Arabic
  // Through the route, because the ladder is the claim: nobody passes a
  // language, the server detects it off the post's own script, trims, persists
  // and echoes. The fetch counter is the cost assertion — a Latin-only gate
  // would have burnt a second call here.
  const realFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (/api\.x\.ai|openrouter\.ai/.test(url)) providerCalls++;
    return realFetch(input, init);
  }) as typeof fetch;

  let arBody: {
    id?: string;
    variants?: ReplyVariant[];
    replyText?: string;
    costUsd?: string;
    model?: string;
    language?: string | null;
    languageSource?: string | null;
  };
  try {
    const res = await app.request('/x/replies/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        // No `language` field on purpose — detection is the thing under test.
        // `override: true` is the band gate's documented escape hatch: this
        // fixture post has no real engagement and the gate is not what we are
        // measuring (it already refused before spend in step 3's ladder order).
        override: true,
        context: {
          tweetId: `${LIVE_TWEET_PREFIX}0001`,
          handle: LIVE_HANDLE,
          author: 'Smoke Multilingual',
          text: AR_POST,
          url: `https://x.com/${LIVE_HANDLE}/status/${LIVE_TWEET_PREFIX}0001`,
          postedAt: new Date(Date.now() - 12 * 60_000).toISOString(),
          metrics: { views: 9000, replies: 4, reposts: 2, likes: 40 },
          topComments: [],
        },
      }),
    });
    if (res.status !== 201) fail(`generate → ${res.status}: ${(await res.text()).slice(0, 240)}`);
    arBody = (await res.json()) as typeof arBody;
  } finally {
    globalThis.fetch = realFetch;
  }

  const arVariants = arBody.variants ?? [];
  const arPrimary = arVariants[0];
  if (!arPrimary) fail('the Arabic draft came back with no variants');
  if (arVariants.length !== 1 || arPrimary.angle !== 'extends') {
    fail(`want exactly one extends variant, got ${JSON.stringify(arVariants.map((v) => v.angle))}`);
  }
  if (!ar.test(arPrimary.text)) fail(`no Arabic script in the Arabic variant: ${arPrimary.text}`);
  if (arPrimary.gloss === null) fail('the Arabic variant came back with no gloss');
  if (arBody.language !== 'Arabic' || arBody.languageSource !== 'detected') {
    fail(`the route echoed ${arBody.language}/${arBody.languageSource}, want Arabic/detected`);
  }
  if (arBody.replyText !== arPrimary.text) fail('the persisted primary is not the single variant');
  // THE cost assertion. `passesSpecificityGate` is Latin-alphabet by
  // construction, so an Arabic reply fails it ~always; before decision 8 that
  // meant a second, wasted call on essentially every non-English draft.
  if (providerCalls !== 1) {
    fail(
      `the Arabic draft made ${providerCalls} provider calls — the specificity-gate skip (decision 8) is not firing`,
    );
  }
  printVariants('ar', arVariants, null);
  ok(
    `Arabic: 1 extends variant, ${weightedLength(arPrimary.text)}/${MAX_WEIGHTED} weighted (${[...arPrimary.text].length} chars — weight 1, the full 280), gloss present, echoed language=${arBody.language}/${arBody.languageSource}, cost $${arBody.costUsd}`,
  );
  ok(
    `ONE provider call for a draft that fails passesSpecificityGate (${passesSpecificityGate(arPrimary.text)}) — the regen skip is real`,
  );

  cleanupLive();
  ok('live reply_drafts rows dropped (cost_events are the ledger and stay)');
  console.log(
    '\n  READ THE LINES ABOVE. Whether the register is right — です・ます vs 敬語, MSA vs dialect — is model judgement, not a contract. If a variant reads as translationese, the thing to recalibrate is the clause wording in renderLanguageClause, not the code.',
  );
}

restoreTarget();
cleanupLive();
console.log(
  LIVE ? 'SMOKE PASS (--live)' : 'SMOKE PASS ($0 — rerun with --live for the two real calls)',
);
process.exit(0);

// ------------------------------------------------------------------ helpers

/** A minimal PostContext — the same shape `parseContext` builds, so a prompt
 *  rendered from it is the prompt the route would have rendered. */
function ctxFor(handle: string, text: string): PostContext {
  return {
    url: `https://x.com/${handle}/status/${LIVE_TWEET_PREFIX}0001`,
    tweetId: `${LIVE_TWEET_PREFIX}0001`,
    author: 'Smoke Multilingual',
    handle,
    text,
    postedAt: '2026-08-05T10:00:00.000Z',
    metrics: { views: 9000, replies: 4, reposts: 2, likes: 40 },
    topComments: [],
  };
}

function printVariants(
  tag: string,
  variants: readonly ReplyVariant[],
  result: AskLlmResult | null,
): void {
  console.log(`     --- ${tag} variants${result ? ` (model=${result.model})` : ''} ---`);
  for (const [i, v] of variants.entries()) {
    console.log(`     [${i}] (${v.angle}) ${v.text}`);
    console.log(`         gloss: ${v.gloss ?? '(none)'}`);
  }
}
