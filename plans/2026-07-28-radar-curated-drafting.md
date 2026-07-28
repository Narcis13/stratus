# Radar curated drafting — score the queue, draft only the top N

- **Status:** planned 2026-07-28 · not started
- **Goal fit:** Goal 4 (Circles — the reply machine). Replies are the growth lever; the Radar is the reply queue. This makes the queue's one paid drafting click spend on the 25 tweets most likely to earn impressions instead of the 25 newest.
- **Cost impact:** per-click only, no recurring. One NEW LLM scoring call per "Curate & draft" click: ≤100 tweets, text-only, ~6k input / ~3k output tokens ≈ **$0.005–0.015** (grok-4.3 at reply defaults). The existing batch-draft call is unchanged (~$0.01–0.02). Zero X API reads/writes. No new budget line needed (rides the existing per-click LLM pattern).
- **Invariants touched:**
  - §7.4 refuse-before-spend — every 400 (body/tweets validation) fires before `askLLM`; a parse failure after spend is a 502, never a retry.
  - §7.8 side-hook best-effort — `persistRadarDrafts` stays best-effort; the new score column rides that same insert.
  - §7.14 prompt registry — new key `reply-curate`; template is TS-only (the `reply-batch` precedent — **no .md twin, no byte-sync test**).
  - §7.19 band/signals never reach the LLM — the scoring prompt gets text only; `classifyBand` already owns the numbers. `curation_score` is measurement metadata, never a gate.
  - §7.20 route order — register `POST /replies/curate` above the `/replies/:id` param routes.
  - Migrations discipline — `0025` is next; DDL-only ALTER (the RU.2 `0014` precedent); inspect generated SQL for dropped seed INSERTs.
- **Codemap sections relevant:** §3.3 (replies/prompt.ts, prompts/registry.ts, settings/registry.ts), §3.4 (`replies.ts`, `radar.ts` routers), §4 (`radarDrafts` L357), §5 (Radar.tsx, serverSettings.ts, api.ts, shared/radar.ts), §7 (.4/.8/.14/.19/.20), §9 (smoke map).
- **Codemap staleness note:** stamp `fc44d1c`; commits `61f9601`/`17672d1` since then touched `src/x/routes/replies.ts` (+29, JD-related) and `Radar.tsx` (2 lines). This plan was anchored by reading the CURRENT files; docs-sync re-stamps.

## Why / what changes for the user

Today "Draft replies" batches the newest ≤20 fresh sightings blindly — after a long scroll session the queue holds 40+ tweets and the batch spends on whatever ranked first, including "drop a link, let's connect" filler. After this plan, when the fresh queue exceeds the curated size (configurable, default 25), a second button **"Curate & draft (25)"** appears: one cheap scoring call grades every fresh tweet for reply-payoff, low-value tweets (connection invites, follow-trains, giveaways, engagement bait, nothing-to-add announcements) are **dismissed from the queue**, and the top 25 survivors get the normal 3-variant batch draft. The note line reports `scored 42 · dropped 17 · drafted 25 · $0.0xx`. Manually ⊕-pinned tweets are never scored away — a human pin outranks the model.

## Design

**Data.** Migration `0025` (DDL-only ALTER): `radar_drafts` gains `curation_score integer` — nullable, **null = this draft was not produced through curation** (backfill impossible; §7.11 null=unknown). No other schema change. Measurement later needs no new link: RU.5's `reply_draft_id` already joins `radar_drafts → reply_drafts → outcomes`, so "do high-scored tweets produce better reply outcomes" is read-time SQL over already-paid data.

**Pure logic** — new `src/x/replies/curate.ts` (sibling of `replies/prompt.ts`, imitates its batch half):
- `CURATE_PROMPT_TEMPLATE` — job: grade each post 0–100 for "will a sharp reply here earn impressions/profile visits for *me*"; flag `lowValue: true` for connection invites, follow-for-follow, giveaways, engagement bait, pure announcements, and posts with nothing concrete to add to. Placeholders: required `{{POSTS}}`, optional `{{REPLY_PERSONA}}` (persona substitutes FIRST — the `substituteReplyPersona` injection discipline). Posts block headed by `UNTRUSTED_CONTEXT_MARKER`, rendered `POST n (id: …) / @handle (author): / text` like `renderBatchTweet` (export it from prompt.ts or duplicate the 8 lines — exporting preferred).
- `CURATE_SCHEMA` — structured outputs: `{scores: [{id, score int 0–100, lowValue bool, reason string ≤120}]}`.
- `parseCurateScores(raw): CurateScore[] | null` — `parseBatchReplies` discipline: strict shape, clamp score to 0–100 int, degrade to null never a malformed row.
- `selectCurated(scored, wanted, keep): {keep: string[], drop: string[], unscored: string[]}` — anchor to asked ids (first occurrence wins), `lowValue` always drops, remaining sorted score desc (**stable** — tie keeps input order, which is the panel's ranked order), top `keep` kept, rest dropped; ids the model never scored land in `unscored` (a truncated response must not silently delete queue rows).
- `MAX_CURATE_TWEETS = 100` (the radar ring-buffer cap — the panel can never hold more).

**Settings.** `x.radar.curatedCount` — group `radar`, number, default **25**, min 5, max 50, **scope `mirrored`** (the panel needs it for the button label and the local clamp). Description carries the clamp note: effective size is `min(curatedCount, x.ai.batchReplyCap)`.

**Route** — `POST /x/replies/curate` in `src/x/routes/replies.ts` (rides the replies router's existing LLM-gated mount, AI.6):
- Body `{tweets, model?, provider?, reasoningEffort?}`. Tweets via `parseBatchTweets(body.tweets, MAX_CURATE_TWEETS)` (reused as-is — band/signals may ride along, they are ignored here and never reach the prompt). Param validation identical to the batch route, all before spend (§7.4).
- `keepTarget = Math.min(getSetting('x.radar.curatedCount'), getSetting('x.ai.batchReplyCap'))`.
- `loadActiveNicheSafe()` → `replyPersona`; `loadPromptSafe('reply-curate')`; ONE `askLLM` call — `jsonSchema: {name:'curate_scores', schema: CURATE_SCHEMA}`, `promptCacheKey` \`${prompt.cacheKey}:${niche.slug}:${niche.updatedAt?.getTime() ?? 0}\`, defaults `{temperature: 0.2, reasoningEffort: 'low', maxOutputTokens: Math.min(4500, 300 + tweets.length * 35)}` (scoring is judgment, not prose — voice-extract's 0.2). Errors via `llmErrorPayload`, else 502 `curate_failed`.
- `parseCurateScores` null → 502 `grok_parse_error` (+requestId). Then `selectCurated`.
- Response 200: `{scored: [{tweetId, score, lowValue, reason}], keep, drop, unscored, keepTarget, costUsd, model, requestId}`. **No DB writes** — the score is persisted by the follow-up generate-batch call.

**Score threading.** `RadarBatchTweet` (routes/radar.ts) gains `curationScore?: number`; `parseBatchTweets` accepts optional `curationScore` (int 0–100 else `invalid_tweet_curation_score_${i}`); `buildRadarDraftRows` copies it into `RadarDraftInsert.curationScore` (else null). Nothing about it reaches `buildBatchGrokInput` — prompt input is built from the same fields as today.

**Extension** (panel orchestrates — only the extension owns the session buffer, so dropping = the existing `stratus/radar-dismiss` message; the server cannot remove queue rows):
- `shared/serverSettings.ts`: `ServerConfig.curatedCount` + default 25 + `readNumber` wire + `curatedBatchSize(cfg) = Math.max(1, Math.min(cfg.curatedCount, cfg.batchReplyCap))` beside `radarBatchSize`.
- `shared/radar.ts`: pure `partitionForCurate(fresh: RadarSighting[]): {pinned, scoreable}` — `band === 'manual'` rows are pinned (never scored, never dropped), everything else scoreable.
- `sidepanel/api.ts` + `shared/types.ts`: `api.replies.curate(s, body)` beside `generateBatch`; `BatchReplyTweet.curationScore?`.
- `sidepanel/Radar.tsx`: extract the existing `draftReplies` body into `sendBatch(rows, scoreById?)` (builds `BatchReplyTweet[]`, attaches `curationScore` when given, posts, forwards `stratus/radar-replies`, sets note). New `curateAndDraft`: `partitionForCurate(fresh)` → `api.replies.curate` with `scoreable.slice(0, 100)` → `dismiss(res.drop)` → draft set = `pinned` first + keep-order survivors, trimmed to `batchReplyCap` from the keep tail → `sendBatch(set, scores)` → note `scored S · dropped D · drafted K/N · $total` (sum of both calls' cost). `res.unscored` rows are left untouched in the queue. Button `Curate & draft (N)` renders beside `Draft replies` only when `fresh.length > curatedBatchSize(server)`; disabled while either flow runs. Add `x.radar.curatedCount` to `RADAR_KEYS` so the gear exposes it.

**Measurement.** (a) Smoke assertion end-to-end ($0 path). (b) The note line's scored/dropped/drafted/cost per click. (c) Deferred: a Playbook `curationEffectiveness` cell (curated vs uncurated radar-source reply outcomes over the `reply_draft_id` join) — **only once ≥20 measured curated replies exist** (§7.19 gate); explicitly out of scope now.

## Decisions taken

1. **Two endpoints, panel orchestrates** (score → dismiss → existing generate-batch), not one combined curate-and-draft route. The queue lives in `chrome.storage.session`; only the extension can "remove from the corpus", and generate-batch (RU.3–RU.10 machinery) stays byte-untouched on its happy path.
2. **Server selects keep/drop** (top-N among non-lowValue), N read server-side from `min(x.radar.curatedCount, x.ai.batchReplyCap)`. The panel never re-ranks; it maps ids back to sightings.
3. **Dropped tweets are dismissed outright** (user's own words: "remove from the corpus"). Dismissal already prevents re-queue on re-sight (`mergeSightings` honors the dismissed list, cap 500).
4. **Manual ⊕ pins are exempt** — never sent for scoring, always in the draft set, ahead of curated survivors. A deliberate human click outranks the model. `roster`/`hot`/`warm` all get scored (content quality is exactly what the band numbers can't see).
5. **Text-only scoring** — band/signals never reach the prompt (§7.19 discipline; the classifier already priced the numbers in by admitting the tweet).
6. **Unscored ids (truncated response) are neither drafted nor dismissed** — they stay queued; a degraded model response costs coverage, never queue rows.
7. **`curation_score` persisted on `radar_drafts`** (nullable, null = uncurated) so curation quality is measurable later via the existing `reply_draft_id` link — no second migration, no contextSnapshot change, no Playbook work now.
8. **Button visibility**: only when fresh count exceeds the effective curated size — below that, plain "Draft replies" already covers the queue; curating a small queue is a second LLM call for nothing. (Curation-below-N is listed out of scope.)
9. **New prompt is TS-only** (`reply-curate` registry key, editable in the Prompts tab like `reply-batch`); default 25 / lowValue category list are opening guesses per the CLAUDE.md threshold rule — recalibrate only at the measurement gate.

## Done when

- With 30+ synthetic fresh sightings and N=25, clicking **Curate & draft** produces: one `/x/replies/curate` call, dismissals for every `drop` id, one `/x/replies/generate-batch` call whose tweets are the pinned+keep set carrying `curationScore`, and `radar_drafts` rows with non-null `curation_score` (verified by the smoke script over the in-process routers, $0).
- A `manual`-band sighting in the fresh set is never in the curate request and always in the batch request.
- `POST /x/replies/curate` refuses every malformed body with a 400 **before** any LLM call, and 502s (never retries) on parse failure after spend.
- `x.radar.curatedCount` round-trips through Settings → gear → mirrored blob, and the button label follows it.
- Browser check on real x.com: 40+ tweet session → button appears → queue shrinks to the survivors + drafted replies land as angle tabs; dropped rows do not reappear on re-scroll.
- `bun test` + `bun run typecheck` + `bun run lint` + `cd extension && bun run build` green after every task.

---

## Task 1: Pure curation core + `reply-curate` prompt key
**Depends on:** none
**Session budget:** ~350 diff lines, 4 files (1 new source, 1 new test)

**Read first:** codemap header + §3.3 + §7.14; `src/x/replies/prompt.ts:266-495` (BatchTweet, renderBatchTweet, REPLY_BATCH_PROMPT_TEMPLATE, BATCH_REPLY_SCHEMA, parseBatchReplies, substituteReplyPersona); `src/x/prompts/registry.ts` (whole file); `src/x/prompts/registry.test.ts`.

**Edit:**
- `src/x/replies/prompt.ts` — export the currently-private `renderBatchTweet` (one-word change).
- `src/x/replies/curate.ts` (NEW) — template, schema, `parseCurateScores`, `selectCurated`, `MAX_CURATE_TWEETS = 100`, `CurateScore` type.
- `src/x/prompts/registry.ts` — add `'reply-curate'` to `PROMPT_KEYS` + `PROMPT_SPECS` entry (required `['{{POSTS}}']`, optional `['{{REPLY_PERSONA}}']`), import from `../replies/curate.ts` (pure module — no route import, no cycle).
- `src/x/replies/curate.test.ts` (NEW).

**How:** Template tone/structure mirrors `REPLY_BATCH_PROMPT_TEMPLATE`: stable instruction head (job, persona block, the lowValue category list — connection invites, follow-trains, giveaways, engagement bait, announcement-with-nothing-to-add), variable `{{POSTS}}` at the tail (cacheable-prefix layout). Output contract in prose AND schema. `buildCurateInput(tweets: BatchTweet[], opts?: {replyPersona?, template?})` follows `buildBatchGrokInput`: persona substitutes first, `UNTRUSTED_CONTEXT_MARKER` heads the posts block, `{{POSTS}}`-token-tolerant fallback append. No idea/steer, no pillars, no meBrief, no relationship lines. `selectCurated` must be a stable sort (`[...].map((s,i)=>[s,i])` tie-break or equivalent) and must compute `unscored = wanted − scored ids`. Do NOT import the settings store or db — this module stays pure (playbook.ts discipline).

**Tests:** template contains both placeholders + the marker; parse: happy path, clamping (score 140→100, -3→0, non-int→rounded or rejected — pick reject-row→null like parseBatchReplies), garbage→null, empty scores array valid; select: lowValue dropped even at score 100, top-N cut, stable tie order, unknown ids ignored (first occurrence wins), unscored computed, keep ≤ N; registry: key count 16, `validatePromptBody('reply-curate', body-without-POSTS)` fails, spec loads.

**Done when:**
- [ ] `loadPromptSafe('reply-curate')` returns the default with a cache key
- [ ] All new pure tests green; existing registry tests updated (key count)
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(replies): curation scoring core + reply-curate prompt key`

**Cost note:** $0 — pure module, no call sites yet.

---

## Task 2: Migration 0025 — `radar_drafts.curation_score` + batch threading  [parallel-ok with Task 1]
**Depends on:** none
**Session budget:** ~150 diff lines, 6 files

**Read first:** codemap header + §4 (radarDrafts) + §7 migration notes; `src/db/migrations/0014_swift_rhodey.sql` (the DDL-only ALTER exemplar); `src/x/db/schema.ts` (radarDrafts table, ~L357); `src/x/routes/radar.ts:40-140` (RadarBatchTweet import, RadarDraftInsert, buildRadarDraftRows, persistRadarDrafts); `src/x/routes/replies.ts:557-640` (parseBatchTweets).

**Edit:**
- `src/x/db/schema.ts` — `curationScore: integer('curation_score')` on `radarDrafts` (nullable, no default).
- `src/db/migrations/` — `bun run db:generate`, then **inspect the SQL**: must be exactly one ALTER TABLE ADD COLUMN; verify the `content_pillars` seed INSERT in `0000` untouched (drizzle-kit drops seed INSERTs — codemap §4 standing check).
- `src/x/routes/radar.ts` — `RadarBatchTweet.curationScore?: number` (the interface lives here per the RU.2 layout — confirm; if it lives in replies/prompt.ts adjust), `RadarDraftInsert.curationScore: number | null`, `buildRadarDraftRows` copies `t.curationScore ?? null`.
- `src/x/routes/replies.ts` — `parseBatchTweets`: optional `curationScore` field — integer 0–100 else `invalid_tweet_curation_score_${i}`; rides into the pushed tweet like `band`.
- `src/x/routes/radar.test.ts` + the parseBatchTweets suite (in `replies.test.ts` or wherever it lives — grep `parseBatchTweets(`) — new cases.

**How:** Null semantics: **null = not curated**, never 0. `curationScore` must NOT be added to `buildBatchGrokInput`'s BatchTweet rendering — it is storage metadata like `band`/`signals` ("they never reach the Grok prompt" comment applies verbatim; extend that comment to name the score). RU.5 confirm endpoint needs NO change (measurement joins radar_drafts directly via `reply_draft_id`).

**Tests:** parseBatchTweets accepts absent/valid score, rejects 101, -1, 3.5, `'25'`; buildRadarDraftRows stores it and nulls it when absent; existing radar route tests still green (column nullable → no fixture change).

**Done when:**
- [ ] Migration applies on a fresh `:memory:` boot (bun test does this implicitly)
- [ ] Generated SQL inspected: one ALTER, no dropped seeds
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(radar): nullable curation_score on radar_drafts (0025) + batch threading`

**Cost note:** $0. **Migration-generating task — do not run in parallel with another migration-generating session (journal conflict), but safe alongside Task 1.**

---

## Task 3: `POST /x/replies/curate` + `x.radar.curatedCount` knob
**Depends on:** Task 1 (curate module), Task 2 (parseBatchTweets signature — only if its error-code numbering shifted; otherwise logically independent)
**Session budget:** ~320 diff lines, 4 files

**Read first:** codemap header + §3.4 (`replies.ts` row) + §7.4/.20; `src/x/routes/replies.ts:383-560` (the generate-batch route — the exemplar to imitate line-for-line for validation/error mapping); `src/x/replies/curate.ts` (Task 1's exports); `src/x/settings/registry.ts:569-586` (RADAR group) + how `x.ai.batchReplyCap` is defined (~L759-775); the generate-batch route tests (grep `generate-batch` in test files) for the askLLM-mocking pattern.

**Edit:**
- `src/x/routes/replies.ts` — the new route, registered **above** the `/replies/:id` param routes (§7.20).
- `src/x/settings/registry.ts` — `x.radar.curatedCount` in the RADAR array (group `radar`, default 25, min 5, max 50, scope `mirrored`, description names the batchReplyCap clamp and warns recalibration waits for measured outcomes).
- `src/x/settings/registry.test.ts` (or wherever group counts are pinned — grep `radar` in settings tests).
- `src/x/routes/replies.test.ts` — route suite.

**How:** Follow the generate-batch route's exact order: body parse → `parseBatchTweets(body.tweets, MAX_CURATE_TWEETS)` → model/provider/reasoningEffort validation (copy the three blocks) → ALL 400s done → `keepTarget` from settings → niche + `loadPromptSafe('reply-curate')` → single `askLLM` (defaults `{temperature: 0.2, reasoningEffort: 'low', maxOutputTokens: Math.min(4500, 300 + tweets.length*35)}`, cache key niche-suffixed) → `llmErrorPayload` mapping → `parseCurateScores` null → 502 `grok_parse_error` → `selectCurated(scored, wantedIds, keepTarget)` → 200. No DB writes, no `persistRadarDrafts`, no relationship/guidance/me loading (scoring doesn't need them and every skipped lookup is latency). Do NOT add a band gate — the queue is already band-admitted.

**Tests:** 400s: invalid_body, empty_tweets, too_many_tweets at 101, invalid_provider before any LLM call (assert the mock was not invoked — the §7.4 proof); happy path with a mocked askLLM returning a scores payload → keep/drop/unscored partition correct, keepTarget honors a patched `x.radar.curatedCount` override row AND the batchReplyCap clamp; parse-garbage → 502; registry: radar group now 2 knobs, curatedCount mirrored + range.

**Done when:**
- [ ] Route answers per the contract; every 400 pre-spend (mock-not-called asserted)
- [ ] Knob visible in `GET /x/settings/values?scope=mirrored`
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(replies): POST /replies/curate scoring endpoint + x.radar.curatedCount`

**Cost note:** per-click ~$0.005–0.015, bounded by `MAX_CURATE_TWEETS` (100) and the computed `maxOutputTokens` (≤4500). All tests mock the LLM — $0 to land.

---

## Task 4: Extension — Curate & draft button + orchestration
**Depends on:** Tasks 2 + 3
**Session budget:** ~330 diff lines, 7 files

**Read first:** codemap header + §5 (Radar.tsx row, serverSettings, api.ts rows); `extension/src/sidepanel/Radar.tsx` (whole file — small); `extension/src/shared/serverSettings.ts:55-115,160-175` (radarBatchSize + readNumber pattern); `extension/src/shared/radar.ts` (RadarSighting, groupQueue); `extension/src/shared/types.ts:864-900` (BatchReplyTweet family); `extension/src/sidepanel/api.ts:1160-1200` (replies namespace).

**Edit:**
- `extension/src/shared/serverSettings.ts` — `curatedCount` in `ServerConfig` + `SERVER_DEFAULTS` (25) + `readServerConfig` wire + `curatedBatchSize(cfg)`.
- `extension/src/shared/serverSettings.test.ts` — new key defaulting/garbage cases.
- `extension/src/shared/radar.ts` — pure `partitionForCurate(rows)` → `{pinned, scoreable}` (`band === 'manual'` pinned).
- `extension/src/shared/radar.test.ts` — partition cases.
- `extension/src/shared/types.ts` — `BatchReplyTweet.curationScore?`, `CurateBody`, `CurateScoredItem`, `CurateResponse` (mirror the route contract field-for-field).
- `extension/src/sidepanel/api.ts` — `api.replies.curate(s, body)`.
- `extension/src/sidepanel/Radar.tsx` — refactor `draftReplies` → shared `sendBatch(rows, scoreById?)`; new `curateAndDraft`; second header button; `RADAR_KEYS` += `'x.radar.curatedCount'`; gear note sentence about curation.

**How:** `curateAndDraft`: guard `fresh.length > curatedBatchSize(server)` (same condition as button render); `const {pinned, scoreable} = partitionForCurate(fresh)`; curate with `scoreable.slice(0, 100).map(minimal tweet fields)` (tweetId/handle/author/text/url — band/signals may ride, server ignores); on response: `dismiss(res.drop)` (existing helper — fire-and-forget is fine, the buffer write is ordered by the background's promise chain); build the draft set = `pinned` then keep-order sightings (map id→sighting; skip ids no longer in the buffer), trim from the tail to `min(pinned.length + keep.length, batchReplyCap)`; `sendBatch(set, new Map(res.scored.map(s => [s.tweetId, s.score])))` — pinned rows get no score (undefined → field omitted). Note format: `scored ${scoreable} · dropped ${drop} · drafted ${count}/${requested} · $${(curateCost+draftCost).toFixed(4)}`. One `busy` state disables both buttons (a curate mid-flight must not race a plain draft over the same rows). Errors: curate failure → note, NOTHING dismissed (refuse-before-drop on the client too); draft failure after dismissal is acceptable — dropped rows were dropped on their own merit, say so in the note (`dropped D · draft failed: …`).

**Tests:** serverSettings + radar partition suites (pure). Radar.tsx itself stays untested by convention (§9) — the logic worth testing was deliberately pushed into the pure modules.

**Done when:**
- [ ] `cd extension && bun run build` green (+ root gates)
- [ ] Button appears only when fresh > effective N; label carries the number
- [ ] Manual pin present → excluded from curate call, included in batch call (verifiable in the Task 5 smoke via the route layer; here by code review)
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(radar): Curate & draft — score the queue, dismiss the noise, draft the top N`

**Cost note:** the two calls this button fires are both bounded server-side (Task 3 caps + batchReplyCap). Panel clamps before asking (radarBatchSize discipline — never send what will be refused).

---

## Task 5 (final): docs-sync + smoke
**Depends on:** all prior.

- [ ] `scripts/smoke-radar-curate.ts` — $0 default, follows `scripts/smoke-radar-reply-flow.ts` (mounts the replies router in-process over the real in-memory DB): asserts the 400 ladder pre-spend (mock/absent LLM), the prompt key loads, the knob round-trips via the settings routes, `selectCurated` end-to-end with a canned scores payload, and `generate-batch`→`radar_drafts.curation_score` persistence with a mocked askLLM. `--live` adds exactly ONE real curate call on 3 synthetic tweets (~$0.003) and prints the scores.
- [ ] `docs/PHASE-HISTORY.md`: phase entry (what shipped, date, per-click cost, the manual-pin exemption gotcha, the unscored-degradation contract).
- [ ] `docs/radar-tab.md`: the new button, the note line, the dropped-rows-are-dismissed behavior, the knob.
- [ ] CLAUDE.md: **only if a guardrail changed** (none expected — do not add a phase entry there).
- [ ] `.claude/skills/plan-feature/references/codemap.md`: §2 (migrations line → 0025), §3.3 (curate.ts, registry 16 keys, radar group 2 knobs / 62 total / 28 mirrored), §3.4 (replies.ts + radar.ts rows), §4 (radarDrafts + migration list), §5 (Radar.tsx, serverSettings, types/api, shared/radar), §9 (smoke 31→32) + header re-stamp.

## Out of scope (do NOT build)

- A Playbook `curationEffectiveness` cell — wait for ≥20 measured curated replies (the §7.19 gate), then plan it as read-time SQL over `radar_drafts.curation_score → reply_draft_id → reply outcomes`.
- Curating when the queue is at or under N (quality-filter-only mode), a score floor knob, or auto-curation without a click.
- Showing per-tweet scores/reasons in the Radar cards (the response carries them; the UI ignores them in v1).
- Scoring `ready` (already-drafted) rows — money already spent on those drafts.
- Combining curate+draft into one server endpoint, or any server-side queue mutation.
- An .md prompt twin / byte-sync test for the curate template (TS-only like `reply-batch`).

## Risks / watch items

- **LowValue category list and default N=25 are opening guesses** — recalibrate only at the measurement gate, never by vibes.
- **Scoring quality unverified until `--live`** — the "done when" browser check and one `--live` smoke run are pending tails after Task 5.
- **Dismiss-then-draft-fails** leaves dropped rows gone with nothing drafted; accepted (drops were on merit), surfaced in the note. If it stings in practice, a later change can defer `dismiss(drop)` until after a successful batch.
- **`RadarBatchTweet` interface location** — Task 2 assumes routes/radar.ts per RU.2; if it moved, follow the import in replies.ts:61.
- Codemap was stale for `replies.ts`/`Radar.tsx` at planning time (2 post-stamp commits); tasks were anchored to current file reads, but re-verify line offsets when editing.
