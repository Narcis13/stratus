# Reply craft overhaul — the drafter follows the Cannon off-lane

- **Status:** planned 2026-08-08 · not started
- **Goal fit:** Goal 4 (relationship-aware drafting) in service of `x-growth-plan-v3.md` §4 Engine 1. The Cannon re-targeted the *queue* (CQ, 2026-08-05); the drafting prompt behind it was never re-targeted and is still written for one niche. This closes that gap.
- **Cost impact:** **net negative.** No new X call, no new LLM call — one call's schema gains a field (Task 8), one systematic paid regeneration is removed (Task 7). The humanization block adds ~450 tokens to a cacheable prefix.
- **Invariants touched:** §7.14 (prompt byte-sync — Task 1 is a three-file edit, .md + both TS literals, in one commit); §7.11 (null = unknown — an unresolvable mode is `general`, never a guess); §7.16/ML.3 (resolve server-side, one function, single and batch cannot fork); §7.19 (thresholds are opening guesses, recalibrated at stated sample sizes); §7.33 (a borrowed threshold gets replayed before it ships). **§7.4 refuse-before-spend:** mode resolution is $0 SQL + pure detection and runs inside the ladder, after the band gate.
- **Codemap sections relevant:** §2 (`reply prompt.md`), §3 (`replies/prompt.ts`, `replies/language.ts`, `replies/curate.ts`, `routes/replies.ts`, `routes/playbook.ts`, `prompts/registry.ts`), §4 (`cannonTargets`, `replyDrafts`, `radarDrafts`, `harvestRows`), §5 (`Radar.tsx`, `variantChips.ts`), §7.11/7.14/7.16/7.19/7.26 (patterns above), §9 (test/smoke map).

---

## Why / what changes for the user

### The measurement, from the 182 own replies harvested 2026-08-06→07

| split | n | avg yield | total | share of impressions |
|---|---|---|---|---|
| parent post **in my lane** (dev / AI / build / SaaS) | 42 | **27** | 1,153 | **3.5%** |
| parent post **off lane** (relationships, football, news, JP, art) | 140 | **229** | 32,086 | **96.5%** |

**96.5% of the day's reply impressions came from posts the drafting prompt is not built for, and that the curation prompt is built to reject.** Every build-in-public handle in the corpus — `@thegbreaker` 8, `@kevinszabo14` 9, `@stevbuilds` 11, `@onebusinessclub` 11, `@jonbuildshq` 24 — sits under 30 views per reply. The money is `@ayesha_diaries1` (19,088 on one reply), `@sxhealth101` (1,125 avg), `@hiiragi2280` (3,486), `@latinacasanova` (123).

The day was a big win in absolute terms — **183 views/reply against the 22.6 baseline in `x-growth-plan-v3.md` §1**, which puts the ladder at rung three of four (39 → 150 → **183** → 400 → 800+). The Cannon works. What follows is about the replies it puts into those slots.

### The mechanism, not a guess

`reply prompt.md` stamps the niche under a heading that reads **"Who I am (the COMPLETE persona — infer nothing beyond these three facts)"**, and the body is:

> - I'm a **solopreneur**. — I'm **passionate about programming, AI, and marketing**. — I **build in public**.

Three sections later, rule 5 orders **"Specific beats generic … a named tool, a concrete scenario"**, and rule 2 orders **"Take a side"**. Under a cat video, a grief post or a Reuters wire story, the model has exactly one well of specificity in the entire prompt, and it is the persona. So it bridges. The prompt never once says the post might be about something else.

The corpus carries the signature, with the yields:

| reply | parent | yield |
|---|---|---|
| "Private airport security means more code for booking flows that actually work." | @reuters, 27,533 views, **9 replies** | **2** |
| "i track migration stories the same way I track model updates" | @reuters, 102,401 views | 22 |
| "Side quests keep the main build from turning into the only thing I stare at" | @mindmatter28, **1,342,497 views** | 44 |
| 「治らなくてもいいやの開き直り。**AIやマーケティングの継続にも**、このゆるさが必要だと思う。」 | @yoshi_majime (adjustment disorder), 41,559 views, 4 replies | 116 |

The Reuters row is the whole plan in one line: **27k views with 9 replies is a top-decile Cannon slot**, and it returned 2 views because the reply was an advert.

Against the best reply of the day, 19,088 views, under a 1.1M-view relationship post:

> "IMO buying flowers once still beats forgetting tha request entirely"

66 characters. A typo. No terminal period. "IMO". Zero persona. One detail lifted out of a ten-bullet post, with a position taken on it.

### Four defects, each fixable

1. **The persona is unconditional and it is the only identity material in the prompt.** (Task 1, 3, 5)
2. **The curator scores *lane fit*, so it drops exactly what pays.** `CURATE_PROMPT_TEMPLATE` rewards "sits in or near my lane" and penalises "far outside my lane, so any reply I write comes out generic". That second clause was *true* — it correctly described the drafter's weakness. Fix the drafter, then flip the curator. (Task 8)
3. **The output shape is calibrated for the wrong game.** The prompt says "usually under ~280 chars"; the top five replies of the day are 66, 34, 110, 67, 76 characters. And the three fixed angles are a build-in-public taxonomy: `contrarian` and `debate` under a funeral post or a cat video are a report risk, and they forfeit the strongest ranking signal there is — the OP replying to you. (Task 1, 4, 5)
4. **Nothing in the pipeline asks for human writing.** The forbidden-words list bans 2023 marketing copy ("supercharge", "game-changer"), not the 2026 tells: the em dash, the tricolon, "not X but Y", the summarizing closer, the flat middlebrow register under every kind of post. The `debate` angle has already collapsed into one mould — "A or B: which one actually …?" appears 7 times in 182 replies. (Task 1, 6)

**After this plan:** every reply is drafted against a *resolved mode* for that specific post, the persona is on only when the post is genuinely about my lane, angles that would misfire in a room are not offered at all, length targets match the measured winners, and the humanization rules are in the prompt with concrete examples. The measurement of whether it worked is free and already banked.

---

## Design

### The architectural key: this is mostly a rendered VALUE, not a template rewrite

`renderLanguageClause` (ML.2) is the shipped precedent and it is exactly the right shape — a per-call instruction carrying register axis, character budget and angle narrowing, rendered at the variable tail, with `reply prompt.md` and both TS literals byte-untouched. `renderBatchTweet` is the second precedent: a per-post `RELATIONSHIP` line inside `{{POSTS}}`, with one how-to-use-it instruction at the tail (`BATCH_RELATIONSHIP_NOTE`).

The mode **must** be per-post, not per-call: ML.3's all-or-nothing set semantics work for language because a mixed queue can fall back to English, but a Cannon queue is *deliberately* heterogeneous (football + Apple news + a Japanese grief post in the same 25). So the mode rides where `relationship` rides — a line per post inside `{{POSTS}}` — and the instruction block rides once at the tail.

The split, and the reason for it:

| what | where | why |
|---|---|---|
| Persona-scope rule, humanization block, length targets, opener bans | **the template head** (byte-sync edit, Tasks 1) | constant on every call ⇒ cacheable prefix. A 450-token block at the variable tail is 450 tokens paid uncached, every call. |
| Mode, its angles, its character budget, its register note | **rendered per post + one tail block** (Task 5) | varies per post ⇒ cannot be static, and must not bust the prefix cache. |

### Task 1 is worth shipping alone

The mode resolver is what makes the fix *reliable and measurable*. But the model can already tell a cat video is not about SaaS — it has simply never been told to make that judgment. A single instruction in the head ("most posts I reply to have nothing to do with this") buys most of the win with no new module, no migration and no route change. **Task 1 ships tonight; Tasks 2–5 make it a system.**

### `ReplyMode` — modeled on `LanguageProfile`

New pure module `src/shared/replyMode.ts`, `src/shared/language.ts`'s twin: zero-dep, fixture-tested, inlined into the extension build through a `tsconfig` shim (which makes **ten** shared files in the `include` array — count it, do not trust this number).

```ts
export type PersonaUse = 'full' | 'stance' | 'off';

export interface ReplyMode {
  id: 'expertise' | 'hot-take' | 'news' | 'wholesome' | 'banter' | 'general';
  personaUse: PersonaUse;
  angles: readonly ReplyAngle[];   // ordered: the first is the primary pick
  minChars: number;
  maxChars: number;
  registerNote: string;            // one line: how this room talks
  moves: string;                   // 2–3 concrete opening moves, this mode only
}
```

`personaUse` is the field that fixes the contamination, and the three levels are deliberately distinguishable in SQL later:

- **`full`** — biography and lane nouns are the material. Use them hard.
- **`stance`** — I may hold an opinion in first person, but no lane nouns (code, ship, build, SaaS, solopreneur, AI, marketing, startup) and no biography.
- **`off`** — no first-person claim about my work at all. The post is the material; I am not.

**The table. Every number is an opening guess (§7.19) — recalibrate at ≥30 harvested replies per mode, from `loadOwnReplyPerformance`, never by feel.**

| mode | fires on | `personaUse` | angles | chars |
|---|---|---|---|---|
| `expertise` | dev, AI, solo business, marketing, retro/vintage computing, hospital & enterprise IT, SMB accounting — the §8 Arm B lane | `full` | extends, contrarian, debate | 80–200 |
| `hot-take` | opinion posts: relationships, masculinity, money, self-improvement, culture | `off` | contrarian, debate, extends | 60–120 |
| `news` | reported events: Reuters, 9to5mac, zerohedge, transfers, launches | `stance` | observation, extends, question | 50–110 |
| `wholesome` | animals, kids, grief, wins, art, aesthetic, motivation | `off` | observation, question, extends | 30–90 |
| `banter` | football, memes, no-context, chaos | `off` | observation, extends | 20–60 |
| `general` | fallback — unresolvable is `general`, never a guess (§7.11) | `stance` | extends, observation, contrarian | 40–140 |

The character ranges come from the winners, not from a regression: the top five replies of the day are 34–110 characters. **The 40–79 band's 339 avg yield vs the 80–139 band's 99 is confounded** — the short band's parents average 45,280 views against 6,066 — so it is not evidence and it does not go in the prompt. What goes in the prompt is the unconfounded description: *my best replies run 34–110 characters.*

### The opening move — the `moves` field, per mode

**The hook rule in the template is currently a no-op and has to be replaced, not tightened.** It reads *"ONE punchy proposition is the default. Add a second (own line, blank line between)"* and *"The first line is the hook and must stand alone."* Both are 280-char machinery: **0 of 180 harvested replies are multi-line**, so at the 40–90 target the reply *is* the first line and the rule resolves to "make the reply a reply". `blankLineBetweenPropositions` has never fired in the Cannon corpus.

Replacement, in the head (Task 1):

> **The reply opens on its strongest word.** If the sharpest thing in the reply is at the end, move it to the front and cut what was there. At this length the hook and the reply are the same words — there is no second line to carry the payload.

Keep the two-line option for `expertise` only; every other mode is one proposition, full stop. Do not delete `blankLineBetweenPropositions` — the non-Cannon Replies tab still reaches it.

**What a hook IS differs by room.** This is the `moves` field content. Every line below is an **opening guess** (§7.19) — see the honest note after the table.

| mode | opening move |
|---|---|
| `expertise` | The mechanism or the counter-number. The credential lives in the specificity — never state it. *"Postgres does this with a partial index and 4 lines"*, not *"As someone who's coded 30 years…"* |
| `hot-take` | The contradiction, inside the first four words. *"Five years apart isn't predatory."* (2,248 views.) Never open by conceding. |
| `news` | The second-order consequence. The event is already in the post; restating it is dead air — which is what killed *"i track migration stories the same way I track model updates"* (22 views on a 102k parent). |
| `wholesome` | The specific detail: a timestamp, a body part, a corner of the frame, a number from the post. Nothing else proves I looked. *"The ear twitch at 0:04."* Never an adjective, never an emotion word. |
| `banter` | The punchline. No setup at all — the reply is the last four words of a joke. |
| `general` | The noun the post is actually about, then the turn. |

Universal opening bans, in the head with the humanization block:

- **Never open with "I" or "my"** unless the reply *is* the anecdote. A self-referential opening tells a scanner the reply is about me, and they scroll.
- **Never open with a subordinate clause** — "While X…", "Although…", "Given that…". The scanner leaves before the main clause arrives.
- **Never open with determiner + abstraction** — "The reality of…", "This kind of…", "That moment when…".
- **Never open by restating the post.**

**Honest status of the evidence.** The corpus does *not* yet support a hook-shape claim, and the table above is argued from scanning mechanics, not measured. Opening-word class over 180 replies:

| opens with | n | avg yield | avg parent views | capture (bp) |
|---|---|---|---|---|
| stance marker (IMO/lol/yep/ngl) | 11 | 1,831 | **154,792** | 2,309 |
| content word | 138 | 91 | 18,569 | 2,648 |
| I / my | 18 | 19 | 6,766 | 2,725 |
| determiner / pronoun | 13 | 15 | 32,539 | 3,845 |

The stance-marker group's 20× raw lead is **entirely parent size** — those 11 replies landed under parents averaging 8× the corpus, and on capture rate the four classes do not separate (2,309–3,845 bp), with the best raw group scoring the *worst* capture. Controlled to parents ≥10k views the whole corpus is 27 rows. **This is the §7.33 discipline applied to itself: the opening rules ship as guesses and Task 9 makes them measurable.** Do not quote the 1,831 anywhere.

### Resolution precedence — `resolveReplyLanguage`'s twin

`src/x/replies/mode.ts`, called by both generate routes and nothing else, so single and batch cannot fork:

```
explicit (panel override)
  ?? the curate pass's classification     free rider on a call already paid for (Task 8)
  ?? the roster pin (cannon_targets.topic) $0 PK lookup, highest precision
  ?? heuristic detection                   pure, src/shared/replyMode.ts
  ?? 'general'
```

The roster pin is the important one and it is nearly free: the Cannon doctrine is *camp a roster*, so the same handles recur. `@fabrizioromano` is always football, `@9to5mac` is always Apple news, `@hiiragi2280` is always wholesome. Pin once, correct forever. This mirrors `cannon_targets.language`, which already exists and is `NULL` on all 9 rows today.

**Migration `0027`** (the journal is free from `0027`): one nullable column, `cannon_targets.topic text`. Inspect the emitted SQL — drizzle-kit drops seed INSERTs.

### The new angles

Two additions to `ReplyAngle`: **`observation`** (one specific noticed detail, no argument — the wholesome/banter workhorse) and **`question`** (a genuine question the OP would want to answer). `question` exists because the research is unambiguous that OP engagement is the single strongest ranking signal, and today nothing in the pipeline optimises for it.

**`story` is deliberately not added.** A one-line lived parallel is the strongest move in the reference templates, but under `personaUse: 'off'` it would require inventing a life, and the persona block's hardest rule is that a fabricated anecdote is worse than no specific at all. Revisit only behind "the steer supplied the fact".

Angle narrowing needs no new machinery: `replyVariantsSchema({angles})` and `batchReplySchema({angles})` already take the option, and `trimToSingleVariant` is the route-level guarantee (a strict schema cannot cap array length — `maxItems` is in the D164b unsupported set). Widening the union is the real work: schema enum, `reply_drafts.angle`, `radar_drafts.variants`, `Playbook.tsx` angle crosstab, `variantChips.ts`.

**This contaminates the Playbook angle cells** in exactly the way ML.6 flagged for language — post-overhaul `observation` rows are not comparable with pre-overhaul `extends` rows, and every non-English row before ML.6 is `extends` by construction. Split by mode and by date; never compare across the boundary.

### The humanization block — full text

This is the content the plan exists to deliver. It goes in the head of all three templates verbatim, replacing nothing (the existing forbidden-openers and LLM-isms lists stay; they are still correct, just insufficient).

```markdown
## Sounding like a person, not a model

Every rule here exists because it is what gives an LLM away in an X reply. A reply that
reads as AI gets scrolled past at best and reported at worst.

**Sentence machinery — never:**
- **No em dashes. Not one.** Use a comma, a period, or nothing. This is the loudest tell there is.
- **No antithesis.** Not "not X, but Y", not "it isn't X. It's Y.", not "less X, more Y",
  not "X is the problem. Y is the answer." The whole family, not just the banned phrase.
- **No three-item lists.** No "fast, cheap, and reliable". One thing, or two. Three is a model counting.
- **No connectives:** however, moreover, therefore, ultimately, that said, at the end of the day,
  the reality is, truth is, here's the thing.
- **No summarizing closer.** Never restate the point at the end. Stop on the sharpest word,
  mid-thought if necessary.
- **No "A or B — which one actually …?"** That construction is a tell and it is already
  the most overused shape in my replies.
- **No rhetorical question as a closer**, unless the question IS the whole reply.

**Words that mark a reply as generated:** delve, tapestry, testament, realm, landscape, nuanced,
underscore, pivotal, crucial, foster, resonate, meticulous, navigate (figurative), leverage (verb),
speaks volumes, hits different, "the fact that X is wild", "this is why X matters", absolutely,
truly, genuinely, incredibly, "a masterclass in".

**Rhythm — this is what actually sells it:**
- **One idea.** Grab the single detail that struck me and react to that. A model answers the whole
  post; a person picks one thing out of it. My best reply of last week pulled one word — "flowers" —
  out of a ten-bullet post.
- **Uneven sentences.** A long one, then two words. Never two sentences of similar length in a row.
- **No setup.** Cut "I think that", "it seems like", "one thing I've noticed is". Start at the claim.
- **Have a position with a hole in it.** "probably wrong but" reads more human than a balanced take.
- **Never explain the joke** and never state the subtext. If the post is funny, play along; do not
  describe why it works.

**Typography — people on X are sloppy, and it reads as real:**
- Drop the terminal period on a short reply.
- A lowercase opener is fine.
- Contractions always. Fragments welcome.
- At most ONE of these per reply, and only when the room allows it: an opener like "idk", "ngl",
  "tbh", "lol", "yeah"; a trailing "…". Never stack them. Never in a serious or grieving thread.
- **Do not invent spelling mistakes.** Sloppiness lives in rhythm and punctuation, not in
  misspelled words.

**Match the room.** A football post, a funeral post and a chip-history post are three different
registers. Write the one the room is already speaking. The commonest failure is one flat
middlebrow voice under every kind of post.
```

The last typography bullet is a deliberate division of labour with `src/shared/humanize.ts`: **the LLM owns voice, rhythm and diction; the deterministic layer owns keystroke noise.** Models produce fake-looking typos; the humanizer's character-swap produces real-looking ones. Neither should do the other's job.

### The persona-scope rule — full text

Replaces the current "Who I am (the COMPLETE persona — infer nothing beyond these three facts)" heading and adds the paragraph after `{{REPLY_PERSONA}}`. The persona body itself is untouched (it is `{{REPLY_PERSONA}}`, substituted from the active niche — this plan does not edit the niche).

```markdown
## Who I am — background, not material

{{REPLY_PERSONA}}

**Most posts I reply to have nothing to do with any of that, and that is the point.** My reach
comes from replying under big, uncrowded posts about anything: football, relationships, animals,
a news wire, someone's grandmother's funeral. When the post is not about my lane, this section is
background only. Do not mention it, do not gesture at it, do not bend the post's topic toward it.

Turning someone else's subject into my subject is the worst failure available here. "Private
airport security means more code for booking flows that actually work" under a Reuters story is
not a reply, it is an advert, and it earned 2 views out of a post with 27,000. Reply to what the
post is actually about.

Use the persona only when the post is genuinely about building, code, AI, solo business or
marketing. There it is my edge and I should use it hard.
```

### Length, in the template

Replaces "Length: tight. This is a reply, not a thread. Usually under ~280 chars per variant unless the angle genuinely needs more."

> **Length: aim for 40–90 characters. 140 is the ceiling.** My best-performing replies run 34–110 characters. One sentence is usually the whole reply. Short is not lazy — it is what survives a reply stack.

The per-mode budget in the tail clause narrows this further and overrides it.

### The specificity gate is now actively harmful

`passesSpecificityGate` passes on a digit, a first-person pronoun, or a **hardcoded list of my lane's tools** (`claude code|grok|copilot|cursor|mcp|turbo pascal|foxpro|delphi|dos|bun|typescript|postgres|anaf|excel|git|github|linux|vim|sql`). Two consequences under broad targeting:

1. It is **a pressure toward contamination** — naming a dev tool is one of three cheap ways to pass, under any post.
2. When every variant fails, `routes/replies.ts:430` **fires a second paid LLM call** and then falls through to a failing variant anyway. A wholesome reply — "The little ear twitch at 0:04" — has no digit, no first person, no dev tool. Under the new modes this misfires systematically, which is exactly the reason ML.3 already skipped the gate for resolved non-English languages.

The same reasoning applies one level up: an English-tuned heuristic applied to a mode it was never validated against yields **unknown, not fail** (§7.11). Task 7 scopes the gate to `personaUse === 'full'` and skips it elsewhere.

### The humanizer suffix landmine (not live — disarm before enabling)

`DEFAULT_HUMANIZER.suffixes` is `['well said', 'love this', 'good stuff', 'solid point', 'nice one']`, appended with p=0.20 at the Radar pick moment (`Radar.tsx:898`, HM.3). **Every one of those five strings is on the reply prompt's forbidden-openers list.** One Cannon reply in five would get agreement-slop stapled to a reply written specifically to avoid it.

Live state checked 2026-08-08: `app_settings['humanizer'].enabled === false`. **Not a bug today.** It is a tripwire for the deterministic-humanizer overhaul the user has already scheduled for a later session; Task 10 records it, Task 1 does not touch it.

---

## Decisions taken

1. **Mode is per-post, language is per-call.** Not unified. ML.3's set semantics exist because the batch template has one language block; a heterogeneous queue is the Cannon's whole point, so the mode line rides in `{{POSTS}}` next to `relationship`. Do not "fix" this into symmetry.
2. **Task 1 is a real byte-sync template edit**, not a rendered value. The persona-scope rule and the humanization block are constant on every call, so they belong in the cacheable prefix. Three files in one commit: `reply prompt.md`, `REPLY_PROMPT_TEMPLATE`, `REPLY_BATCH_PROMPT_TEMPLATE` — plus the `src/test.test.ts` anti-drift assertion that locks the batch default's voice block to the single default's.
3. **`personaUse` has three levels, not two.** `stance` (opinion, no lane nouns, no biography) is what a news post needs; collapsing it into `off` loses every take, into `full` loses nothing at all.
4. **`story` is not added.** Fabricated autobiography is the persona block's hardest ban.
5. **The confounded length number does not go in the prompt.** 339-vs-99 is parent-size confounded; "my best replies run 34–110 characters" is not.
6. **Curate is flipped after the drafter is fixed, not before.** Its "any reply I write comes out generic" was an accurate description of the drafter. Flipping first would feed the drafter posts it still cannot answer.
7. **The gate is skipped, not rewritten, for non-`full` modes.** Inventing per-mode specificity heuristics with nothing to validate them against is how ML.3's §7.11 note says not to do this.

---

## Done when

- No generated variant contains an em dash. (Assert in the smoke; the model complies or the rule is restated.)
- Under `personaUse !== 'full'`, the lane-noun rate in generated variants is **< 2%**. Baseline 2026-08-07: **10.4%** (19 of 182), those 19 averaging **27** views.
- Median generated variant length is **40–90** characters. Baseline: prompt says 280, corpus median 51.
- No generated variant opens with "I"/"my", a subordinate clause, or determiner + abstraction. Baseline: 18 of 180 open with I/my, 13 with a determiner — **17% of the corpus**.
- A mode is resolved and rendered for every post in a batch, and shown in the panel so a wrong one is visible before the paste.
- `loadOwnReplyPerformance` reports **yield per mode** and **contamination rate**, gated at n≥20.
- `bun test` + `bun run typecheck` + `bun run lint` green; `cd extension && bun run build` green; `bun scripts/smoke-reply-craft.ts` green.

---

## Task 1 (ship first, alone): the template overhaul  [no new module, no migration]

The persona-scope rule, the humanization block, the length recalibration, the `debate`-mould ban, **the opening-move reframe + the four universal opening bans**. Three files edited together (§7.14): `reply prompt.md`, `REPLY_PROMPT_TEMPLATE` and `REPLY_BATCH_PROMPT_TEMPLATE` in `src/x/replies/prompt.ts`. Full prose in §Design above.

The dead multi-line machinery goes with it: "Add a second (own line, blank line between)" survives only inside the `expertise` case (0 of 180 harvested replies are multi-line). `blankLineBetweenPropositions` stays — the non-Cannon Replies tab still reaches it.

The batch template must keep the voice block **byte-identical** to the single one — `src/test.test.ts` asserts it, and that test is the anti-drift guarantee AI.5 traded the heading-slicing for.

**Verify:** byte-sync tests green; the `reply` and `reply-batch` registry entries still validate (`{{TWEET_CONTEXT}}`/`{{POSTS}}` + `{{IDEA}}` required, `{{REPLY_PERSONA}}` optional); one `--live` batch of 5 mixed-topic posts, eyeballed for em dashes, tricolons and lane nouns.

**Note for the operator:** any `prompt_overrides` row for `reply` or `reply-batch` shadows this. Storage is override-rows-only, so a default improved in a later deploy applies automatically *unless* overridden. Check `GET /x/prompts` for "customized" before concluding the edit did nothing.

## Task 2: `src/shared/replyMode.ts` — the pure taxonomy + heuristic  [parallel-ok]

The `ReplyMode` table above, plus `detectReplyMode(text): ReplyMode | null` — `detectScript`'s twin. Zero-dep, fixture-tested against ≥30 real parents pulled from `harvest_rows` (they are free and they are the actual distribution). `null` = unknown; the resolver, not this module, maps unknown to `general`.

Add the `tsconfig` shim entry. **Count the `include` array; do not trust a number in a header.**

## Task 3: `cannon_targets.topic` + `src/x/replies/mode.ts` — the resolver

Migration `0027` (nullable `topic text`); inspect the emitted SQL. `resolveReplyMode({ explicit?, targets })` with the precedence above, mirroring `resolveReplyLanguage` — same file shape, same `source` echo so the panel can say *why* it picked. One PK SELECT per distinct handle.

## Task 4: widen `ReplyAngle` to five

`observation` + `question` through the union, `variantItemSchema` enum, `reply_drafts.angle`, `radar_drafts.variants`, `variantChips.ts`, `Playbook.tsx`. Playbook angle cells get a **hard boundary marker at this commit's date** — pre/post rows are not comparable (ML.6's trap, second instance).

## Task 5: render the mode — per-post line + tail block + angle narrowing

`renderBatchTweet` gains a `MODE:` line (beside `RELATIONSHIP`); a `BATCH_MODE_NOTE` rides once at the tail explaining how to read it (`BATCH_RELATIONSHIP_NOTE`'s twin). Single path gets `renderModeClause`, `renderLanguageClause`'s twin. Both routes narrow the schema via the existing `angles` option and trim per tweet.

**Both clauses ride on rendered VALUES** — after Task 1, `reply prompt.md` and both literals do not move again in this plan.

Panel: show the resolved mode and its source as a chip on each queued row, before the paste.

## Task 6: `{{REPLY_WINNERS}}` — measured few-shot, selected by mode

The single highest-value humanization lever, and the counterweight to twenty negative rules: the post drafter already injects `{{MY_WINNERS}}`; the reply drafter has no equivalent. `latestOwnReplyRows` (OH.3) is the $0 reader that makes it possible — top 4–6 own replies **for the resolved mode**, with their yields, injected at the variable tail.

Ground truth in the user's own voice beats any list of rules. Today's pool already includes the 19,088 (`hot-take`), the 3,486 Japanese (`wholesome`), the 2,248 (`hot-take`).

## Task 7: scope the specificity gate to `personaUse === 'full'`

Skip elsewhere — no gate, no regeneration, no gate vote in the primary pick. Removes a systematic paid retry (§Design). Same shape and same reasoning as ML.3's non-English skip.

## Task 8: flip the curate rubric + carry `mode` back for free

Replace "sits in or near my lane" / "far outside my lane" with **is there a concrete hook a reply can grab** — a named thing, a number, a visible detail, a claim, a moment — scored regardless of topic. Keep the `lowValue` list; it is good. Add a negative that matters: *the post is unanswerable without fabrication* (a personal announcement where every reply is "congrats" or invented).

Add `mode` to `CURATE_SCHEMA`. The classification comes back on a call already paid for.

## Task 9: measure it

`loadOwnReplyPerformance` gains a **mode** cell set, a **contamination rate** (lane-noun regex over replies whose parent resolves to a non-`expertise` mode), and an **opening-class** cell set (stance marker / content word / I-my / determiner / subordinate clause) **crossed with mode**.

The opening-class dimension exists specifically to retire the guesses in §"The opening move": it is unanswerable at n=182 because parent size swamps it, and it becomes answerable once mode is stamped and the cells can be read within a band. **Report capture rate (`views/orig_views`) beside raw yield in every cell** — raw yield is what made the stance-marker group look 20× better than it is.

Baseline row to beat, written into the plan on the day: 182 replies, 183 views/reply, 10.4% contaminated.

## Task 10 (final): docs-sync + `scripts/smoke-reply-craft.ts`

Codemap §2/§3/§4/§5/§7/§9 + header re-stamp; `docs/radar-tab.md`; `docs/PHASE-HISTORY.md` entry. Smoke: $0 by default, `--live` flag for one real mixed-topic batch (only a live call proves the provider accepts the widened enum in strict mode). **Record the humanizer suffix landmine** in `VERIFY-DEBT.md` for the humanizer-overhaul session.

---

## Out of scope (do NOT build)

- Editing the niche or `replyPersona`. The persona is correct; its *scope* was wrong.
- The deterministic humanizer overhaul (user has scheduled it separately). Task 1 draws the line: LLM owns voice, humanizer owns keystrokes.
- Per-mode LLM model/provider routing.
- Auto-replying, auto-posting, or any relaxation of the manual-paste rule (invariant #2).
- Re-scoring `cannon_targets` — CQ's `scoreMin` replay stands.
- A `story` angle (Decision 4).

## Risks / watch items

| risk | signal | response |
|---|---|---|
| **Twenty negative rules flatten the output** into a different monotone | variants get shorter and blander, yield falls | Task 6 is the positive counterweight and matters more than it looks. If yield falls after Task 1 and before Task 6, ship Task 6 next, not more rules. |
| Banned-word lists go stale as models drift | a new tell appears across many replies | Recalibrate from harvested replies at ≥100, never by vibes (§7.19). |
| Mode misclassification on an ambiguous post | wrong register, visible in the panel chip | The chip is the mitigation — a wrong mode is visible before the paste, and the roster pin fixes it permanently for a camped handle. |
| Angle union widening poisons the Playbook crosstab | `observation` cells fill while `debate` stalls | Hard date boundary (Task 4). Never compare across it. |
| `prompt_overrides` shadows the new defaults | Task 1 appears to do nothing | Check `GET /x/prompts` for "customized"; restore-to-default is a DELETE. |
| **The per-mode opening moves are unvalidated** — argued from scanning mechanics, not measured | a mode's yield falls after Task 5 while others hold | They are the softest thing in this plan and the first to revert. Task 9's opening-class × mode crosstab is what retires the guess; until it has n≥20 per cell, treat the moves as prose guidance, never as a gate. |
| Prefix-cache bust on every reply call after Task 1 | one-off cost bump | Expected and one-off: `promptCacheKey` includes the prompt sha. Steady state is unchanged. |
