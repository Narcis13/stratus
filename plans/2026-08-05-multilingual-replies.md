# Multilingual replies — the Reply Master in any language

- **Status:** planned 2026-08-05 · not started
- **Goal fit:** Goal 4 (Circles / the people layer) — the reply lane. It changes *what language* reply effort is spent in, opening the arbitrage the Cannon queue already found to accounts whose audience does not read English. No new goal, no new tab.
- **Cost impact:** **$0 new recurring, and a non-English call gets CHEAPER than today.** Language resolution is pure (script detection over text the request already carries) plus one indexed `cannon_targets` SELECT — no X read, no LLM call, no new table. Two output-token deltas that point in opposite directions, both firing only when a non-English language resolves: **one `extends` variant instead of three ⇒ roughly −⅔ output tokens**, and the literal gloss adds one back-translation ⇒ ~+⅓ of what remains. Net: a Japanese draft costs materially **less** than the English three-variant call it replaces. An English call is unchanged. Third saving, from a finding below: the English-only specificity gate stops burning a wasted regenerate on every non-English call.
- **Invariants touched:** §7.4 (refuse-before-spend — language resolution is $0 and sits *after* the band gate, so a refused call never pays for it) · §7.11 (`null` = unknown, never a guess: an undetected script reads as English, an unrecognized free-text language keeps today's bare clause rather than being coerced into a profile) · **§7.14** (byte-sync — every new instruction rides on a rendered **VALUE**, never a template edit, so `reply prompt.md` and both TS literals stay byte-identical and the anti-drift tests don't move) · §7.15 (variable tail) · **§7.16** (server-stamped — `language` becomes fully server-resolved; `parseContext`/`parseBatchTweets` must keep **refusing** a client-supplied language inside the context object) · §7.19 (no new stats, no new gates, no Playbook cell) · §7.26/§7.27 (the profile table is a zero-dep shared module reached through a shim, never forked) · **§7.35** (a parser over a PAID response is asymmetric — `gloss` is **lenient**, a missing gloss must never cost you a paid variant) · §8 (nothing here touches `mentions`; no billed read anywhere).
- **Codemap sections relevant:** §3.1 (`src/shared/` — `replyBand.ts`/`cannon.ts` are the house style this copies), §3.3 (`replies/prompt.ts`, `cannon/membership.ts`, `settings/registry.ts`, `prompts/registry.ts`), §3.4 (`routes/replies.ts`, `routes/cannon.ts`), §4 (`cannon_targets`, `reply_drafts`), §5 (`content.ts`, `harvester.ts`, `shared/translation.ts`, `shared/types.ts`, `sidepanel/Replies.tsx`, `sidepanel/Radar.tsx`), §7.4/7.11/7.14/7.15/7.16/7.26/7.27/7.35, §8.

---

## Four findings that shaped the brief

All three were verified in the code before this plan was written.

**1. CQ.7 already shipped the hard part — this plan extends it, it does not rebuild it.**
`renderLanguageClause` (`src/x/replies/prompt.ts:96`) stamps one line at the variable
tail; both generate routes validate a body `language` (1–40 chars, 400
`invalid_language`, fired before any spend) and server-stamp it onto the builder opts;
`cannon_targets.language` exists; `Radar.tsx::sharedCannonLanguage` sends one language
per batch when the whole draft set agrees. **None of it has been run live** — the
`--live` Japanese assertion is parked as `VERIFY-DEBT.md` item `0q(b)`, blocked on a
deploy. Every task below builds on these symbols; none replaces them.

**2. X's weighted length makes "under ~280 chars" wrong for CJK and *right* for Arabic — which is exactly why this needs a table, not a Japanese special case.**
twitter-text weights codepoints 0–4351 at 1 and everything else at 2, against a 280
budget. Arabic (U+0600–06FF), Cyrillic, Hebrew and Devanagari are all **weight 1** — an
Arabic reply needs no length change at all, it needs RTL display. Japanese, Korean and
Chinese are **weight 2**, so their real budget is ~140 characters, half what the prompt
asks for at `reply prompt.md:45` and both TS literals. Meanwhile the panel counter is
`TWEET_LIMIT - text.length` (`Replies.tsx:383`) — naive JS length, which under-counts a
Japanese draft by 2× and reads "80 remaining" on a reply X will refuse. Per-language
*needs differ*, so the design is a profile table and the Japanese fix falls out of it.

**3. The specificity gate is English-only, and going to one variant makes its misfire twice as expensive.**
`passesSpecificityGate` (`src/x/replies/prompt.ts:270`) passes a reply that has a digit, a
first-person marker, or a named tool. All three tests are Latin-alphabet by construction:
`/\d/` is ASCII-only so 全角 digits (`１２３`) fail it, `/\b(i|my|me|we|our)\b/i` can never
match 私 or أنا (and `\b` is meaningless in a script without spaces), and the tool list is
English spellings. So **a Japanese reply fails the gate almost every time**, and
`routes/replies.ts:370` burns exactly one extra regenerate when *every* variant fails —
silently doubling the cost of every non-English single-path draft. Today three variants
give three chances for one to pass by accident; **at one variant that accident is gone**,
so the user's change turns an occasional waste into a systematic one unless the gate is
skipped. An English-tuned heuristic applied to Japanese is not a failing verdict, it is an
inapplicable one (§7.11) — Task 3 skips the regen rather than "fixing" the regexes.

**4. The reply path reads X's English machine translation, not the original — the TR.1 bug, unfixed on this lane.**
`revealOriginals()` (TR.1) runs before every harvester sweep, but it is **harvester-only**
(codemap §5 says so explicitly: `shared/translation.ts` is "consumed by `harvester.ts`
only"). Every reply-side reader in `content.ts` is a bare
`article.querySelector('[data-testid="tweetText"]')?.textContent` (lines 1363, 1378,
2168, 2694, 2792). X replaces a tweet's text **in place** with a translation, so on a
translated Japanese tweet the Reply Master is already drafting against English prose the
author never wrote — and script auto-detection would read that English and conclude
"reply in English". Fixing this is a **precondition** for detection, not a nice-to-have.

---

## Why / what changes for the user

You reply to a big Japanese account the same way you reply to anyone: hit Reply Master.
The server works out that the post is Japanese — from the roster if you've pinned that
handle's language, otherwise from the post's own script — and drafts **one** reply in
Japanese, on the `extends` angle only, at the ~140-character budget X actually enforces
there, told to pick a register on Japanese's own axis (だ・である / です・ます / 敬語)
instead of being told to use English contractions. Under it sits a **literal English
back-translation**, so you can see it is over-familiar before you paste rather than after.
The character counter counts the way X counts. A chip says which language it picked and
why, and one click redrafts in English if it guessed wrong.

No contrarian, no debate: picking a fight in a language you cannot read, under an account
whose audience you cannot read either, is the one reply on X you cannot walk back. The
English lane keeps all three angles.

The day you need Arabic, you add one row to a table. Nothing else in this plan is
Japanese-specific.

## Design

### Data

**No new table, no migration.** `cannon_targets.language` (CQ.2, free text, max 16 chars)
stays the only stored per-handle language and keeps its current values — the test corpus
holds `'ro'`, and the resolver normalizes free text rather than demanding a code.

### Pure logic

**`src/shared/language.ts`** (NEW, dependency-free, IIFE-safe — the `replyBand.ts` /
`cannon.ts` twin, reached from the extension through the shim `extension/src/language.ts`,
§7.27):

```ts
interface LanguageProfile {
  code: string;              // 'ja' — canonical
  name: string;              // 'Japanese' — what the prompt clause interpolates
  aliases: readonly string[];// 'ja','jpn','japanese','日本語'
  scriptRanges: readonly [number, number][]; // for detection
  maxChars: number;          // the weighted budget in THIS language's chars (ja 140, ar 280)
  registerAxis: string;      // one sentence naming the politeness axis
  rtl: boolean;
}
```

- `LANGUAGE_PROFILES` — ja, zh, ko, ar, he, ru, es, pt, fr, de, ro to start.
- `resolveLanguageProfile(freeText) → LanguageProfile | null` — case/space-insensitive
  over `code` + `name` + `aliases`. **`null` for anything unrecognized** (§7.11): a
  roster row reading `'ro'` that matched nothing must fall back to today's bare clause,
  never to a wrong profile.
- `detectScript(text) → LanguageProfile | null` — majority-script vote over codepoints,
  ignoring ASCII/punctuation/digits/emoji so a Japanese tweet quoting an English product
  name still reads `ja`. **Detects SCRIPT, resolves to the profile that owns it**;
  ambiguity is answered `null`, and the header must say that Hiragana/Katakana are what
  separate `ja` from `zh` (shared Han alone is not enough to call it).
- `weightedLength(text) → number` — the twitter-text rule, **iterating codepoints**
  (`[...text]`, never `.length`): weight 1 for 0–4351 plus the four punctuation ranges
  (8192–8205, 8208–8223, 8242–8247), weight 2 otherwise. `MAX_WEIGHTED = 280`.

### Prompt (no template edit — every byte rides on a rendered value, §7.14)

`renderLanguageClause(language, profile?)` grows a second argument and returns:

- today's exact sentence when `profile` is null (equivalence preserved for `'ro'`);
- plus, when a profile resolves, its register axis and its real character budget.

`gloss` joins `REPLY_VARIANTS_SCHEMA` and `BATCH_REPLY_SCHEMA` as `type: ['string','null']`
**and is listed in `required`** — strict-mode json_schema has no optional properties, so a
nullable-and-required field is the only shape that works (the D164b keyword discipline,
one level over). English calls come back `"gloss": null`.

**The single-angle narrowing is enforced in three layers, because no one of them is a
guarantee.** (1) A schema variant whose `angle` enum is `['extends']` rather than
`[...REPLY_ANGLES]` — provider-enforced, so contrarian and debate are unrepresentable.
(2) One line in the rendered language clause scoping the count down. (3) A deterministic
**server-side trim to the first variant** after parsing. Layer 3 is the actual contract;
1 and 2 exist so the model does not waste output tokens generating variants we discard.
Note what is *not* available: `maxItems` is in the D164b unsupported-keyword set
(`replies/curate.ts` carries the walked list), so the array length cannot be capped in the
schema — which is exactly why the trim is not optional.

The templates state "exactly three variants, one per angle" in their **stable prefix**, and
the tail clause deliberately contradicts it. That is safe only because of layer 3, and the
clause must read as a scoped narrowing ("in this language, produce only the `extends`
variant") rather than a flat "ignore the rule above" — models comply with the first far
more reliably than the second. Editing the prefix instead would mean a byte-sync migration
across `reply prompt.md`, `REPLY_PROMPT_TEMPLATE` and `REPLY_BATCH_PROMPT_TEMPLATE` to buy
nothing the trim does not already guarantee.

### Routes

`src/x/routes/replies.ts` — both generate paths gain one $0 resolution step, **after the
band gate** so a refused call never pays for it (§7.4):

```
resolveReplyLanguage(handle, text):
  explicit body `language`            // Radar's roster pick, or a panel override
  ?? cannonLanguageFor(handle)        // $0 indexed SELECT, cannon/membership.ts's sibling
  ?? detectScript(text)?.name         // the post's own script
  ?? undefined                        // English
```

The resolved value is stamped into `contextSnapshot` (§7.16 — persist exactly what the
model saw) and **echoed in the response** so the panel can show what it picked without
re-deriving the rule client-side.

### Extension

`Replies.tsx` counter switches to `weightedLength`; variants render their gloss; a
resolved-language chip with a one-click "draft in English" override. `Radar.tsx` keeps
`sharedCannonLanguage` (an explicit batch pick still wins) and renders the gloss.
`content.ts` reveals originals before reading tweet text on the reply/radar path.

### Measurement

**None, deliberately.** No playbook cell, no gate, no stat (§7.19). There is no honest
denominator here yet — a handful of Japanese replies is not a cohort, and a "language
effectiveness" cell computed on n=3 would be exactly the fabricated number rule 33
exists to refuse. Revisit at n≥20 replies placed in any one non-English language.

**One measurement trap this plan creates and must therefore name.** Every non-English
reply is stored `angle: 'extends'` *by construction*. The Playbook's angle-effectiveness
reading must never see that as evidence that `extends` outperforms — it is a selection
effect, not a result. When non-English replies become numerous enough to matter, the
angle cells need to exclude them (or split by language); until then the honest mitigation
is this paragraph. Same class as the §7.19 rule that queue-metadata bands never become
Playbook hot/warm cells.

## Decisions taken

1. **Auto-detect from the post's script, with the roster as an explicit override** (user-
   confirmed). The alternative — roster column only — would mean a Japanese account you
   meet organically drafts in English until you remember to add it, and the whole point
   of the Cannon lane is that it surfaces accounts you have never heard of.
2. **Resolution is server-side, not per-surface.** The server already receives
   `context.text` and `context.handle` on every reply path. Resolving there fixes the
   in-page Reply Master, the Replies tab, Conversations and LaunchRoom **in one place**,
   keeps `language` server-stamped (§7.16), and means no surface hand-threads a field.
   Per-surface client wiring was the obvious design and it is the wrong one.
3. **Literal back-translation, not a natural one** (user-confirmed). A fluent gloss reads
   better and hides precisely the register and nuance errors the gloss exists to catch.
4. **A per-language register axis in the profile table**, not a per-language persona
   (user-confirmed). One table entry per language beats a second persona to maintain, and
   it keeps the niche system the only owner of who I am.
5. **No migration, no new column.** `cannon_targets.language` keeps its free-text values;
   `resolveLanguageProfile` normalizes at read time. A code column would be a migration
   that buys nothing a lookup doesn't.
6. **`gloss` is nullable-and-required in the schema, lenient in the parser** (§7.35). The
   schema shape is forced by strict mode; the leniency is a choice — a variant whose
   gloss came back malformed is still a paid variant and must survive.
7. **One `extends` variant only, for every non-English language** (user-confirmed). The
   three-angle set exists to give a choice of stance; contrarian and debate are the two
   that can go badly wrong, and their failure mode in a language you cannot read is
   unrecoverable — you would not know you had been rude until the quote-tweets arrived.
   `extends` is also the angle whose register is most forgiving. English keeps all three.
8. **The gate that decides "is this reply specific enough" is SKIPPED for non-English, not
   ported.** Rewriting `passesSpecificityGate`'s three regexes per language would be
   inventing a heuristic per script with nothing to validate it against — the existing one
   is eval-validated for English (OVERHAUL-PLAN §7.1) and that validation does not
   transfer. An inapplicable heuristic yields unknown, not fail (§7.11), so the regen
   simply does not fire. Revisit only with non-English replies to eval against.
9. **The Composer's counter is NOT changed.** `Composer.tsx:76` has the same naive
   `TWEET_LIMIT - text.length`, and it is equally wrong for a CJK original — but originals
   are drafted in English and fixing it would widen this plan into the authoring lane for
   no observed problem. `weightedLength` is placed where Composer can adopt it later.

## Done when

1. A reply drafted to a Japanese post comes back in Japanese **without anyone passing a
   language** — the server detected it from the post — as **exactly one `extends`
   variant** carrying a literal English gloss. The same post in English still returns
   three variants across all three angles.
2. The same post, drafted while X is showing its English machine translation, still comes
   back in Japanese: the reply path reveals the original before reading the text.
3. A Japanese variant that would exceed X's real 280-weighted budget reads as over-limit
   in the panel counter; an Arabic reply of the same character count does not (they are
   weighted differently, and the counter proves the table is doing the work).
4. Adding a language is one entry in `LANGUAGE_PROFILES` — demonstrated by Arabic being
   in the shipped table with a register axis and `rtl: true`, having required no code
   outside that table.
5. An English reply's prompt bytes are **identical** to today's, and its parsed variants
   are unchanged apart from a `gloss: null` (the N.3 equivalence discipline).
6. `bun run scripts/smoke-multilingual.ts` passes $0; `--live` drafts one Japanese and one
   Arabic reply and prints variants + glosses for a human read.

---

## Task 1: The language profile table + script detection  [parallel-ok]
**Depends on:** none
**Session budget:** ~320 lines (1 new module + 1 new test file + 1 shim), 3 files

**Read first:**
- codemap header + §3.1 (the `src/shared/replyBand.ts` and `src/shared/cannon.ts` rows —
  this module is their third sibling and must match their header-comment discipline)
- `src/shared/cannon.ts` — read the whole file. It is the closest exemplar: zero runtime
  imports, thresholds as an argument, a header that records *why* each number is what it is.
- codemap §7.26 (content-script IIFE), §7.27 (shims), §7.11 (null = unknown)

**Edit:**
- `src/shared/language.ts` — NEW, the whole pure core.
- `src/shared/language.test.ts` — NEW.
- `extension/src/language.ts` — NEW, a bare re-export shim (top level, not `shared/` —
  it adds nothing to its re-export; §5's rule).
- `extension/tsconfig.app.json` — add the shim to `include` (it lists seven today; this
  makes eight).

**How:**
Export exactly: `LanguageProfile`, `LANGUAGE_PROFILES`, `resolveLanguageProfile`,
`detectScript`, `weightedLength`, `MAX_WEIGHTED = 280`.

`weightedLength` implements twitter-text's rule and the header must say so with the
ranges spelled out: iterate **codepoints** (`for (const ch of text)` — `.length` counts
UTF-16 units and is the bug this replaces), weight **1** for codepoints in `[0,4351]`,
`[8192,8205]`, `[8208,8223]`, `[8242,8247]`, weight **2** for everything else. Record in
the header the consequence that motivated the whole table: **Arabic, Cyrillic, Hebrew and
Devanagari are weight 1 (no length change) while CJK/Kana/Hangul are weight 2 (~140 real
characters)** — a later reader who assumes "non-English ⇒ halve it" will otherwise halve
Arabic for no reason.

`detectScript` votes over codepoints, **skipping ASCII, digits, whitespace, punctuation
and emoji** (a Japanese tweet quoting "Claude Code" must still read `ja`). Return the
profile owning the majority script, `null` on a tie or when no non-Latin script clears a
simple majority. The header must state the Han ambiguity rule explicitly: **presence of
Hiragana or Katakana ⇒ `ja`; Han alone ⇒ `zh`; Hangul ⇒ `ko`** — shared Han cannot
separate Japanese from Chinese on its own.

`resolveLanguageProfile` matches case- and space-insensitively against `code`, `name` and
`aliases`, and returns `null` for anything unrecognized. **Do not coerce a near-miss** —
`'ro'` must resolve to the Romanian profile via its alias, but an unknown string must come
back null so the caller falls through to today's bare clause (§7.11).

Ship these profiles: `ja`, `zh`, `ko`, `ar`, `he`, `ru`, `es`, `pt`, `fr`, `de`, `ro`.
Each carries a `registerAxis` naming that language's own politeness/formality axis in one
sentence — ja `だ・である / です・ます / 敬語`, ar Modern Standard vs dialect, ko
`해체 / 해요체 / 합니다체`, ru/fr/de/es/pt/ro the T–V distinction. `rtl: true` for `ar`
and `he`. `maxChars` = the weighted budget expressed in that language's own characters
(140 for ja/zh/ko, 280 for the rest).

Do NOT: import anything at runtime (`verbatimModuleSyntax` makes `import type` free, a
value import breaks the IIFE); read a settings store (the profile table is code, the
`bandThresholds` pattern does not apply — these are not tunable knobs); add a language
you cannot write a register axis for.

**Tests:** `weightedLength` against hand-computed fixtures — pure ASCII, a Japanese
sentence (assert it is ~2× its `.length`), an Arabic sentence (assert it **equals** its
codepoint count — the finding that justifies the table), an emoji, a mixed string;
`detectScript` over ja/zh/ko/ar/ru/en fixtures plus the Japanese-quoting-English case,
plus a `null` on a tie; `resolveLanguageProfile` over `'ja'`/`'Japanese'`/`'JAPANESE'`/
`'  japanese '`/`'ro'` and a `null` on `'klingon'`; one test asserting every profile has a
non-empty `registerAxis` and that `code` values are unique.

**Done when:**
- [ ] `weightedLength('こんにちは')` is 10 and `weightedLength('مرحبا')` is 5
- [ ] `detectScript` separates ja from zh via kana, and answers `null` for English
- [ ] Every profile has a register axis; the Arabic profile is `rtl: true`, `maxChars: 280`
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(shared): language profile table + X-weighted length`

**Cost note:** $0 — pure module, no I/O.

---

## Task 2: The prompt rider, the gloss, and the single-angle schema
**Depends on:** Task 1
**Session budget:** ~330 lines, 4 files

**Read first:**
- codemap header + §3.3 (`replies/prompt.ts` row — the whole row; it lists every rule the
  builders already obey) + §7.14 (byte-sync), §7.15 (variable tail), §7.35 (asymmetric parsers)
- `src/x/replies/prompt.ts:70-140` — `UNTRUSTED_CONTEXT_MARKER`, `renderLanguageClause`,
  `languageBlock`. **The header comments there state the constraint this task must not
  break**; read them before touching anything.
- `src/x/replies/prompt.ts:184-260` (`ReplyVariant`, `REPLY_SCHEMA`, `parseReplyVariants`)
  and `:453-525` (`BATCH_REPLY_SCHEMA`, `parseBatchReplies`)
- `src/test.test.ts:1341-1450` — the CQ.7 suite. Its equivalence tests are the contract
  this task extends, not replaces.

**Edit:**
- `src/x/replies/prompt.ts` — `renderLanguageClause(language, profile?)`; `gloss` on both
  schemas, both parsers, and the `ReplyVariant` type.
- `extension/src/shared/types.ts` — `ReplyVariant.gloss` (mirror the server type).
- `src/test.test.ts` — extend the CQ.7 describe block.
- `src/x/replies/prompt.test.ts` (or the existing suite that owns the schemas) — parser cases.

**How:**
`renderLanguageClause(language: string, profile?: LanguageProfile | null): string` keeps
its **current sentence byte-identical as the first sentence**, then appends — only when a
profile is given — the register axis and the character budget, and the gloss instruction.
The whole thing stays a **rendered value** appended by `languageBlock` at the variable
tail: `reply prompt.md` and both TS literals must not gain a single byte, or the byte-sync
and anti-drift tests move and this task has broken invariant §7.14. Keep it tight — the
tail varies the cache bucket, and the existing header comment already warns that a
paragraph there is a paragraph paid for on every call.

The clause must tell the model the gloss is a **literal, word-faithful** English rendering
whose job is to expose register and nuance — explicitly *not* a polished translation.

The clause also carries the **single-angle narrowing** when a profile resolves: phrase it
as a scoped narrowing ("in this language, produce only the `extends` variant — one entry
in `replies`, no contrarian, no debate"), **never** as "ignore the rule above". The stable
prefix still says three, and models honor a scoped override far more reliably than a flat
contradiction. The trim in Task 3 is what makes the count a guarantee; this line only
stops the model spending output tokens on variants that get discarded.

`gloss` goes into `REPLY_VARIANTS_SCHEMA` and `BATCH_REPLY_SCHEMA` as
`{ type: ['string','null'] }` **and must be added to that object's `required` array** —
strict json_schema mode has no optional properties, so nullable-and-required is the only
shape the provider accepts. Leave `additionalProperties: false` alone. Do not add
`minLength`/`maxLength`/`minItems`/`maxItems` (the D164b unsupported-keyword set —
`replies/curate.ts` carries the walked list, and its schema test walks it).

Add **`replyVariantsSchema(opts?: {angles?: readonly ReplyAngle[]})`** and the batch
equivalent — a function returning the schema with `angle.enum` set to the given angles,
defaulting to `[...REPLY_ANGLES]` so today's callers are byte-identical. The non-English
path passes `['extends']`, making the other two angles **unrepresentable** rather than
merely discouraged. Keep the existing `REPLY_VARIANTS_SCHEMA`/`BATCH_REPLY_SCHEMA` consts
exported as the default-angle result so no existing import moves. Note in the header that
`maxItems` being unavailable is why the *count* still needs a server-side trim while the
*angle* does not.

Both parsers treat `gloss` **leniently** (§7.35): a missing, null, non-string or blank
gloss becomes `null` and the variant survives. This is the deliberate asymmetry — `text`
and `angle` stay strict because a bad one poisons what you paste, while a bad gloss costs
you a convenience on a variant you already paid for. Clip a long gloss rather than
rejecting it.

Do NOT: touch the `.md` files; edit the prefix's three-variant instruction; make `gloss`
strict; add a `gloss` field or an angle option to the curate schema (scoring is not
drafting); change `parseContext`/`parseBatchTweets` — they must keep refusing a
client-supplied `language`, and that whitelist test is the model. **Do not trim the
variant array in the parser** — the parser's job is shape, and a parser that silently
drops paid variants is the wrong place for a product rule; the trim is Task 3's, in the
route, where the resolved language is known.

**Tests:** absent language + absent profile ⇒ `renderLanguageClause` output byte-identical
to today (extend the existing equivalence test rather than writing a new one); a language
with **no** profile (`'ro'` pre-alias, or a nonsense string) ⇒ still the bare sentence; a
language **with** a profile ⇒ contains the register axis, the character budget, and the
single-`extends` narrowing; the tail order relationship → me → language → guidance is
unchanged; `parseReplyVariants` and `parseBatchReplies` each keep a variant whose gloss is
missing/null/non-string (asserting `gloss === null`) and keep one whose gloss is a real
string; **`parseReplyVariants` still returns all three when handed three** (the trim is
not here); a schema-shape test asserting `gloss` is in `required` on both schemas and typed
`['string','null']`, that `replyVariantsSchema()` with no args deep-equals the exported
default const, and that `replyVariantsSchema({angles:['extends']})` has a one-element
`angle.enum`; the D164b unsupported-keyword walk still passes on both schema shapes.

**Done when:**
- [ ] An English call's rendered prompt is byte-identical to today's
- [ ] A Japanese call's tail carries the register axis, the ~140-char budget, and the
      single-`extends` narrowing
- [ ] `replyVariantsSchema({angles:['extends']})` makes contrarian/debate unrepresentable
- [ ] A variant with a malformed gloss survives parsing with `gloss: null`
- [ ] The byte-sync and anti-drift tests are **untouched and passing**
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(replies): per-language register rider, gloss, single-angle schema`

**Cost note:** $0 to implement. At runtime a non-English call now generates **one** variant
plus one gloss where it used to generate three variants — comfortably inside the existing
`MAX_OUTPUT_TOKENS=520` (single) and `min(9000, 200+n*420)` (batch) caps, and cheaper than
today. The English path's token profile is unchanged.

---

## Task 3: Server-side language resolution, the single-angle trim, and the gate skip
**Depends on:** Tasks 1, 2
**Session budget:** ~320 lines, 4 files

**Read first:**
- codemap header + §3.4 (`replies.ts` row — the full row; it documents the band gate,
  GT.6's carve-out and the exact order the ladder runs in) + §3.3 (`cannon/membership.ts`)
- `src/x/routes/replies.ts:110-180` (`parseReplyLanguage`, the body types), `:240-400`
  (the single-path ladder — **including the specificity regen at `:370` and the
  `primary` pick at `:398`**) and `:440-610` (the batch path, whose primary is
  `variants[0]` at `:604`)
- `src/x/replies/prompt.ts:258-272` — `passesSpecificityGate` and its three regexes. Read
  them before deciding anything about the gate; finding 3 above is derived from them.
- `src/x/cannon/membership.ts` — the whole file. `loadCannonHandles`/`isCannonHandleSafe`
  are the exemplar for the new lookup, including the §7.8 safe-wrapper discipline.
- codemap §7.4 (refuse-before-spend), §7.16 (server-stamped fields), §7.8 (best-effort)

**Edit:**
- `src/x/cannon/membership.ts` — add `cannonLanguageFor(handle)` + a safe wrapper.
- `src/x/replies/language.ts` — NEW, pure-ish `resolveReplyLanguage` (the precedence rule
  in one place, so single and batch cannot fork).
- `src/x/routes/replies.ts` — call it on both generate paths; stamp + echo.
- `src/x/routes/replies.test.ts` — the resolution cases.

**How:**
`cannonLanguageFor(handle)` is one indexed SELECT over `cannon_targets` returning
`language` for a lowercased handle, `null` when absent. Wrap it the way
`isCannonHandleSafe` is wrapped (§7.8): **any error returns null**, so a DB hiccup drafts
in English rather than failing a paid call. Note in the file that unlike
`loadCannonHandles` this one does **not** filter on `active` — a benched handle is still a
Japanese account, and benching means "stop camping", not "start replying in English".

`resolveReplyLanguage({explicit, handle, text})` implements the precedence exactly:
explicit body value → roster value → `detectScript(text)?.name` → `undefined`. Return
both the resolved language string **and** the `LanguageProfile | null` (so the route
passes the profile straight to `renderLanguageClause` without resolving twice) **and** a
`source: 'explicit' | 'roster' | 'detected'` discriminator — the panel renders *why* it
picked, and a resolution you cannot explain is one you will not trust.

Call order in the route is the whole point: **after** the band gate and after
`loadActiveNicheSafe()`, i.e. inside the refuse-before-spend ladder but before the
`askLLM` call (§7.4). A 422'd post must never pay for a `cannon_targets` read, cheap as it
is — the rule is about order, not amount.

Stamp the resolved language into `contextSnapshot` on the single path (§7.16 — persist
exactly what the model saw; the batch path has no DB row, same as CQ.7's niche stamp) and
add `language`/`languageSource` to both responses.

The batch path resolves **per call, not per tweet** — the batch prompt has one instruction
block, which is why `Radar.tsx` already only sends a language when the whole set agrees.
Detection over a mixed batch must therefore be **all-or-nothing**: resolve from the set
only when every tweet detects the same language, else English. Say so in a comment; a
later reader will otherwise "fix" it into a per-tweet field and need a template change.

**The single-angle trim (decision 7).** When a non-English language resolved, pass
`replyVariantsSchema({angles:['extends']})` (batch equivalent likewise) to the call, and
after parsing **keep only the first variant** — on the single path, and per tweet on the
batch path. Do it in one small helper both paths call, so they cannot fork. This trim is
the contract; the schema and the clause are optimizations that stop the model producing
what we would throw away. English resolution changes nothing: default schema, all three
variants, byte-identical behavior.

**The specificity-gate skip (decision 8, and the finding that motivates it).**
`passesSpecificityGate` is Latin-alphabet by construction — `/\d/` misses 全角 digits,
`/\b(i|my|me|we|our)\b/i` cannot match 私 or أنا and `\b` is meaningless in a script
without spaces. Applied to a Japanese reply it fails ~always, so `:370`'s
"every variant failed ⇒ burn one regenerate" fires on essentially every non-English call
and then falls back to the same variant anyway. With one variant there is no sibling that
might pass by accident, so this goes from occasional waste to systematic. **When a
non-English language resolved, skip the regen entirely** and take the single variant as
primary. Do NOT rewrite the regexes per script — the gate is eval-validated for English
(OVERHAUL-PLAN §7.1) and that validation does not transfer; an inapplicable heuristic
yields unknown, not fail (§7.11). Leave the English path's gate and regen untouched.

Do NOT: let `parseContext`/`parseBatchTweets` accept a language (the whitelist stays);
resolve before the band gate; make the roster lookup respect `active`; add a settings knob
(the profile table is code, decision 5); trim inside the parser (Task 2 says why); apply
the trim or the gate skip when the resolved language is English.

**Tests:** explicit body language wins over both roster and detection; roster wins over
detection; detection fires when neither is present; an English post resolves to
`undefined` and renders byte-identically to today; a mixed-language batch resolves to
English; a DB error in the roster lookup degrades to detection rather than throwing; the
resolution happens **after** the band gate (assert a `skip`-band post 422s **without** the
roster being consulted — the CQ.7 suite's "refuses before any spend" test is the model);
`contextSnapshot` carries the resolved language. For the trim: a non-English call whose
model response carries three variants returns **exactly one**, and it is the `extends`
one; the same response on an English call returns all three (the trim is language-gated,
not global); the batch path trims **per tweet** and every tweet still appears. For the
gate skip: a non-English draft that fails `passesSpecificityGate` makes **one** LLM call,
not two (stub the provider and count calls — that count *is* the cost assertion); an
English draft that fails it still makes two.

**Done when:**
- [ ] A Japanese post with no roster entry and no body language drafts in Japanese, as
      exactly one `extends` variant
- [ ] A roster handle's pinned language beats detection; an explicit body value beats both
- [ ] A band-refused post 422s without consulting the roster
- [ ] A failing-specificity non-English draft costs one call, not two; English unchanged
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(replies): server-side language resolution, single extends variant`

**Cost note:** $0 to implement, and **net negative at runtime**: one indexed SELECT plus
pure detection inside the existing ladder, against one variant instead of three and one
fewer regenerate per non-English call. No new LLM call, no X read.

---

## Task 4: Reveal originals on the reply path  [parallel-ok]
**Depends on:** none (independent of Tasks 1–3; land it whenever)
**Session budget:** ~120 lines, 1–2 files

**Read first:**
- codemap header + §5 (the `harvester.ts` row's **TR.1 un-translation** paragraph and the
  `shared/translation.ts` entry in the `src/shared/` row — read both fully; they explain
  the in-place swap, the 60ms settle and why it is per-sweep)
- `extension/src/shared/translation.ts` — the whole module (it is small and already tested)
- `extension/src/harvester.ts` — `revealOriginals()` and its two call sites, the exemplar
- `extension/src/content.ts:1363`, `:1378`, `:2168` — the reply-context and signal readers

**Edit:**
- `extension/src/content.ts` — reveal the original before the reply-path text reads.

**How:**
This is TR.1's fix applied to the lane it missed. Reuse
`findShowOriginalButtons`/`showOriginalButton` from `shared/translation.ts` — **do not
write a second detector**, and do not identify the banner by its wording (it is localized;
the module identifies it structurally and the header says why).

Scope it to the reply path: the focused-article readers behind the Reply Master
(`:1363`, `:1378`) and `readTweetSignals`' text read (`:2168`). Await the same
`TRANSLATION_SETTLE_MS` (60ms) the harvester awaits — the swap lands on the next
macrotask, from X's own client-side copy, with **no network call and no billed read**.

The perf contract matters as much as the fix: a `showOriginalButton` lookup on **every**
article of **every** scan would be a new per-scan DOM cost on the timeline's hot path.
Gate it the way `content.ts` gates everything else — only for the article actually being
read for a reply/sighting, never in the `scan` loop at large. State that in a comment.

`content.ts` is browser-verified by convention, not unit-tested (§5) — so if any logic
worth testing falls out of this, it belongs in `shared/translation.ts` beside its existing
11 fixture tests, not in a new content-script suite.

Do NOT: call `revealOriginals()` (the harvester's whole-page sweep) from content.ts —
that clicks every button on the page and fights the harvester's own sweep when one is
running; check `isHarvestActive()` if you find yourself near that.

**Tests:** any new pure helper goes in `extension/src/shared/translation.test.ts`. The
behavioral proof is the browser check below — this task's real verification is item 2 of
"Done when" at the top of this plan, and it must be walked before the plan closes.

**Done when:**
- [ ] Drafting a reply on a tweet X is currently showing translated sends the **original**
      text to the server (Network tab: the request body carries Japanese, not English)
- [ ] No new per-article work in the general `scan` loop
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green; `cd extension && bun run build`
- [ ] Committed: `fix(content): read the original, not X's translation, on the reply path`

**Cost note:** $0 — X restores the original from a client-side copy; no network call, no
billed read. (This is TR.1's own verified finding, not an assumption.)

---

## Task 5: The panel — weighted counter, gloss, language chip
**Depends on:** Tasks 1, 2, 3
**Session budget:** ~300 lines, 4–5 files

**Read first:**
- codemap header + §5 (`sidepanel/api.ts` and `App.tsx` rows) + §7 chip taxonomy (UI.14/15)
  and UI primitives (UI.10) — a new chip uses an existing tone, it does not mint a colour
- `extension/src/sidepanel/Replies.tsx:370-400` (the counter) and `:540-600` (variant rendering)
- `extension/src/sidepanel/Radar.tsx:180-200` (`sharedCannonLanguage`) and `:380-450`
  (`draftReplies` and the note line)
- `extension/src/shared/types.ts:800-830` (`ReplyVariant`)

**Edit:**
- `extension/src/sidepanel/Replies.tsx` — weighted counter, gloss, language chip + override.
- `extension/src/sidepanel/Radar.tsx` — gloss in the Cannon/Queue cards; keep the existing
  note line honest now that the server can resolve a language the panel did not send.
- `extension/src/shared/types.ts` — `language`/`languageSource` on the reply responses.
- `extension/src/sidepanel/api.ts` — carry the two new response fields.
- `extension/src/sidepanel/styles.css` — gloss + RTL rules.

**How:**
Counter: `TWEET_LIMIT - text.length` becomes `MAX_WEIGHTED - weightedLength(text)` via the
Task 1 shim. Keep the existing `.counter.over` class and its behavior — this changes the
**number**, not the affordance. Leave `Composer.tsx` alone (decision 7).

Gloss renders under its variant, muted and visually subordinate — and **never inside the
copy path**. The copy button must keep yielding exactly the target-language text; a gloss
that can be pasted by accident is worse than no gloss. `gloss: null` renders nothing at
all (no empty row, no placeholder).

The language chip reads from the server's `language`/`languageSource`, uses an existing
`.chip-*` tone, and its tooltip says which rule fired ("detected from the post" / "pinned
on the cannon roster" / "you chose it"). The override is one click that redrafts with an
explicit `language` of English — i.e. it takes the `explicit` branch of Task 3's
precedence, no new server concept.

**RTL:** when the resolved profile is `rtl`, the variant text and its counter get
`dir="rtl"`. The **gloss stays `dir="ltr"`** — it is English. Set `dir` as an attribute on
the specific elements; do **not** flip a container's direction, which would mirror the
card's whole layout including controls that are not text.

**The one-variant case needs no new code and you must verify that rather than assume it.**
`Replies.tsx:554` already gates the variant tab strip on `draft.variants.length > 1`, and
`isReplyVariants` (`shared/variantChips.ts`) requires only a **non-empty** array — so a
single-variant draft renders as a plain reply with no empty tab strip, and the on-page
chips render one chip. Walk both surfaces; if either renders a stray affordance, fix it
here rather than padding the array server-side.

Do NOT: re-derive the language client-side (the server echoes it — §7.4c's rule is
reproduce the RULE or read the server's answer, and here we read it); mint a new chip
colour; make the gloss copyable; change `sharedCannonLanguage` (an explicit batch pick
still wins by design); add a UI affordance for picking an angle in a non-English draft
(there is one angle by construction — decision 7).

**Tests:** the pure bits only, in the suite that owns the panel's shared cores — a
`weightedLength`-backed counter helper if you extract one. Component rendering is
browser-verified by convention; the build greps below are the mechanical check.

**Done when:**
- [ ] A Japanese draft's counter reads ~140 remaining at 140 characters, not 280
- [ ] The single non-English variant shows a muted literal gloss; copy yields only the
      Japanese; **no empty variant tab strip renders** in the panel or on-page
- [ ] An Arabic variant renders RTL while its gloss renders LTR
- [ ] The chip explains its source; the English override redrafts
- [ ] `grep -F 'weightedLength' dist/sidepanel.js` hits (the shim actually inlined)
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green; `cd extension && bun run build`
- [ ] Committed: `feat(panel): weighted counter, literal gloss, language chip`

**Cost note:** $0 — the override redraft costs exactly one normal drafting call, the same
as any regenerate.

---

## Task 6 (final): docs-sync + smoke
**Depends on:** all prior.

- [ ] `scripts/smoke-multilingual.ts` — rerunnable, $0 default: asserts `weightedLength`
      over ja/ar fixtures, `detectScript` over a real harvested Japanese row from
      `harvest_rows`, the full `resolveReplyLanguage` precedence against a temporary
      `cannon_targets` row (snapshot/restore with a `__smoke_lang__` sentinel — the
      `smoke-humanizer.ts` discipline for a config the user owns), and that an English
      call's rendered prompt is byte-identical to the pre-plan fixture.
      **`--live` (~$0.01–0.02, two calls):** draft one Japanese and one Arabic reply,
      assert kana/kanji and Arabic script in the variants, **exactly one variant with
      `angle: 'extends'`**, a non-null gloss on each, and — the cost assertion — that a
      draft failing the specificity gate made **one** provider call, then **print every
      variant with its gloss** and its raw variant count before the trim (so a model
      returning three and having two discarded is visible rather than silent). The register
      question is model judgement, not a contract, and a human reads those lines. This
      supersedes `VERIFY-DEBT.md` item `0q(b)`, which should be struck and replaced with a
      pointer here.
- [ ] `docs/PHASE-HISTORY.md`: the phase entry (what shipped, date, cost, gotchas) — **not**
      CLAUDE.md, which changes only when a guardrail changes (§7.29).
- [ ] `CIRCLES-PLAN.md`: status line for this lane.
- [ ] `docs/replies-tab.md` + `docs/radar-tab.md`: the gloss, the chip, the weighted counter.
- [ ] `.claude/skills/plan-feature/references/codemap.md`: §3.1 (new `language.ts`), §3.3
      (`replies/prompt.ts` rider + gloss, new `replies/language.ts`, `cannon/membership.ts`),
      §3.4 (`replies.ts` resolution step), §5 (new shim — **the tsconfig `include` count
      goes seven → eight**, the `content.ts` un-translation fix, the panel surfaces), §7.35
      (the gloss as a second exemplar of the asymmetric parser), + header re-stamp.
- [ ] `VERIFY-DEBT.md`: strike `0q(b)`, and park the browser halves of Tasks 4 and 5
      (they need a deploy — fold them into the pending `0o`/`0p`/`0q` session, one deploy
      pays for all of them).

## Out of scope (do NOT build)

- **A language column on `people`.** The roster override plus detection covers it;
  decision 5.
- **Per-tweet language in a batch.** One instruction block per call, by construction.
  Changing it needs a template change, which needs a byte-sync migration.
- **Translating the persona, pillars, or `me` blocks.** The persona is who I am; only the
  *output* changes language.
- **`Composer.tsx`'s counter**, thread splitting by weighted length, or anything in the
  authoring lane (decision 7).
- **Auto-posting, auto-detecting the reply's own language after the fact, or a
  round-trip translation check.** Posting stays manual paste (§7.28).
- **A "language effectiveness" playbook cell or any per-language stat.** No denominator
  yet; §7.19 and rule 33.
- **Per-language specificity regexes.** Decision 8 skips the gate; inventing a Japanese
  heuristic with nothing to eval it against is worse than not gating.
- **A configurable angle set per language, or a UI to pick an angle for a non-English
  draft.** One angle by construction (decision 7). If a second language ever wants
  contrarian, that is a `LanguageProfile` field and a plan of its own.
- **Editing the templates' three-variant instruction.** The trim guarantees the count
  without a byte-sync migration; see the escalation note under Risks before reconsidering.
- **Language settings knobs.** The profile table is code, not `app_settings`.

## Risks / watch items

- **Detection on short posts is the weak spot.** A three-word Japanese reply-bait post may
  not clear the majority vote, and a `null` there drafts in English — the safe direction,
  but worth watching. If it misfires often in practice, the fix is the roster pin, not a
  looser threshold: a wrong-language draft under a big account is far more expensive than
  an English one.
- **The gloss is model judgement, not a contract.** A model can produce a fluent gloss
  while the Japanese is subtly off-register — the gloss narrows the risk, it does not
  eliminate it. The `--live` print exists so a human calibrates the clause wording; if the
  variants read as translationese, **the clause is what to recalibrate, not the code**
  (`0q(b)` already flagged this and it stays true).
- **`blankLineBetweenPropositions` is a silent no-op on non-Latin text.** Its sentence
  splitter looks for `[.!?]` followed by `[A-Z0-9]` (`prompt.ts:295`) — Japanese sentences
  end in `。` and have no capitals, so the formatter never fires. Low impact at one
  variant (the prompt asks for one proposition anyway) and the failure is "no reformatting"
  rather than "wrong reformatting", which is the safe direction. Left unfixed on purpose;
  revisit only if live Japanese drafts come back as run-on blocks.
- **The three-layer angle narrowing has one soft layer.** The schema enum makes contrarian
  and debate unrepresentable and the trim guarantees the count, but between them the model
  is reading a prefix that says "three" and a tail that says "one". Expect it to sometimes
  return three `extends` variants and pay for two we discard — wasteful, never wrong. If
  the `--live` run shows it happening every time, the escalation is a byte-sync edit making
  the count a placeholder in the templates, which this plan deliberately deferred.
- **The register axes are opening guesses**, written from general knowledge of each
  language rather than measured. They are the kind of thing a native speaker corrects in
  one sitting — treat a correction as a table edit, not a redesign.
- **Two browser verifications are owed** (Tasks 4 and 5) and both need a deploy. They join
  the three already-pending cannon items; do not close this plan claiming end-to-end
  verification until the Task 4 check — original text, not translation, on the wire — has
  actually been walked.

**Rollback:** every intermediate state is coherent and every task is independently
revertable. Task 1 ships an unconsumed module (inert — a shim with no importer typechecks
but does not bundle). Task 2 is the only one that changes an English call at all, and only
by adding `"gloss": null` to a response nobody reads yet; reverting it restores today's
schema. Task 3's resolution collapses to `undefined` — i.e. English, today's behavior — if
`LANGUAGE_PROFILES` is emptied, so the feature can be defanged without a deploy of its
callers. Task 4 is a pure bug fix with no dependents. If the plan stalls after any task,
the reply lane still drafts exactly as it does today.
