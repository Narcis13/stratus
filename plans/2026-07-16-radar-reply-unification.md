# Radar ↔ Reply Master unification: 3-variant drafting, on-page variant paste, confirmed-click measurement, manual add

- **Status:** planned 2026-07-16 · not started
- **Goal fit:** Goal 2 (metrics on every published post — radar-drafted replies become measured `reply_drafts` rows) + Goal 4 (relationship-aware drafting; the C3 briefs already ride into the batch prompt).
- **Cost impact:** $0 X API (postedTweetId backfill rides existing harvest/daily reads). Grok per-click only: single reply draft ~$0.003–0.006 (up ~50% for the 3rd variant), batch of 20 tweets × 3 variants ~$0.02–0.08/click (output ×3 vs today; user explicitly accepted). Confirm/paste/PATCH paths all $0. No recurring spend.
- **Invariants touched:** §7.4 refuse-before-spend (batch stays deliberately un-gated — Radar pre-filtered; manual adds are an explicit human override); §7.8 best-effort side writes (persistRadarDrafts, confirm side-effects never fail the paying path); §7.10 status ratchets (radar ready→clicked→expired; reply_drafts copied→posted); §7.14 byte-sync prompts (reply prompt.md edit in Task 1); §7.15 variable tail; §7.16 server-stamped fields (relationship/guidance stay server-only); §7.24 background = single session-storage writer; §7.26 content script IIFE; §7.28 posting stays manual — chips *type into* the reply box, the human still hits Reply.
- **Codemap sections relevant:** §3.3 (replies/prompt.ts, radar route), §3.4 (replies.ts, radar.ts, playbook.ts), §4 (replyDrafts, radarDrafts), §5 (background/content/Radar.tsx), §7.14–16, §7.24–28, §10.

## Why / what changes for the user

Radar's "Draft replies" and Reply Master become one system. Every draft — single or batch — is 3 genuinely different variants (extends / contrarian / debate). Clicking a Radar row still opens the tweet, but now the content script injects three variant chips next to the reply box; clicking one types that variant into the composer and marks the draft **posted** (paste-time semantics, same as Reply Master's Done). That click also *confirms* the radar draft into a real `reply_drafts` row, so every radar-originated reply gets the full measurement chain: outcomes join, angle crosstab, latency, quota, and an exact (no longer text-matched) batch-vs-single split in the Playbook. A new round ⊕ button on every timeline tweet lets the user push any tweet into the Radar queue regardless of band — "I want to reply to this one, period."

## Design

**Data (migration 0013, all nullable — null = pre-feature unknown, never backfilled):**
- `reply_drafts.source` text — `'reply_master' | 'radar'`; stamped on every new insert; null = legacy row.
- `radar_drafts.variants` JSON — `{text, angle}[]`; `reply_text` stays the primary (variants[0]) so rank/rehydrate/old rows keep working.
- `radar_drafts.reply_draft_id` text — set when a radar draft is confirmed into a `reply_drafts` row (soft link, no FK).
- `radar_drafts.model` text — stamped by persistRadarDrafts from the batch response so the confirmed reply_drafts row (whose `model` is NOT NULL) has a truthful value.
- `radar_drafts.band` (existing text column): now also stores `'manual'`.

**Prompts (byte-sync discipline §7.14):**
- `reply prompt.md` + `REPLY_PROMPT_TEMPLATE`: "The two variants" → "The three variants" — exactly one variant per angle. **Trap:** `VOICE_BLOCK_END = '## The two variants'` in `src/x/replies/prompt.ts` slices the shared voice block for the batch head; rename the constant with the heading or the batch prompt silently swallows the variants section.
- `batchReplyHead()`: job/output rewritten — exactly **three variants per post, one per angle**, anchored by id. `BATCH_REPLY_SCHEMA` becomes `{replies: [{id, variants: [{text, angle}]}]}`. Relationship briefs, pillars, guidance injection unchanged (all already at the variable tail).

**API contract changes:**
- `POST /x/replies/generate` — response unchanged in shape; `variants` now has 3 entries; insert stamps `source: 'reply_master'`. `MAX_OUTPUT_TOKENS` 350 → 520.
- `POST /x/replies/generate-batch` — `maxOutputTokens = Math.min(9000, 200 + tweets.length * 420)`. Response: `{replies: [{tweetId, text, angle, variants: {text, angle}[]}], …}` (`text`/`angle` = primary, back-compat). `parseBatchTweets` accepts `band: 'manual'`.
- `GET /x/radar/drafts?tweetId=` — new filter (validated `TWEET_ID_RE`), returns that tweet's non-expired rows newest-first; combinable with `status`.
- `POST /x/radar/drafts/:tweetId/confirm` — new, $0, always-mounted. Finds the newest non-expired radar draft for the tweet; **idempotent** (row already has `reply_draft_id` → 200 with the existing draft). Otherwise inserts a `reply_drafts` row: `source: 'radar'`, `status: 'copied'`, `variants` (fallback `[{text: replyText, angle}]`), `replyText` = primary, `model` = stored model or `'radar-batch'`, contextSnapshot built from the stored snippet/signals/band (metrics: views/replies from signals, reposts/likes 0; topComments `[]`; `postedAt` derived as `draftedAt − ageMin`), `sourceUrl` from the row or constructed. Flips radar status → `clicked` and sets `reply_draft_id` in the same txn. Errors: 400 `invalid_tweet_id`, 404 `not_found` (no draft for tweet). The posted flip and `my_reply` person event stay in the existing `PATCH /x/replies/:id` path — no duplicated hooks.

**Extension:**
- `RadarSighting` gains `variants?: {text, angle}[]` and `draftId?: string`; `manual?: true`; band type widens to `'hot' | 'warm' | 'manual'`. `mergeSightings`: `manual` and `draftId`/`variants` survive re-sightings (a re-sight from the content script reports hot/warm — prev manual flag wins); eviction prefers non-manual rows. `rankSightings`: manual first (the human pinned it), then tier, band, vpm, recency. `draftRowToSighting` rehydrates variants + manual band.
- Background stays the single writer (§7.24). New messages: `stratus/radar-confirm {tweetId}` (panel row click → POST confirm, stamp `draftId` into the sighting), `stratus/radar-variants-get {tweetId}` (content → returns `{variants, draftId}` from the buffer, server fallback `GET /x/radar/drafts?tweetId=`), `stratus/radar-variant-pasted {tweetId, text}` (content → confirm idempotently if needed, then `PATCH /x/replies/:id {status:'posted', replyTextEdited: text≠primary ? text : undefined}`).
- Content script (IIFE-safe, §7.26): on status pages where the focused tweet has radar variants, inject a chip strip (3 angle-labeled buttons + text preview) near the action row; click clears the reply editor (selectAll+delete) then reuses `typeTextInto(findReplyEditor(), text)` (clipboard fallback when no editor), then sends `radar-variant-pasted`. Manual add: a round ⊕ button on every tweet action row (WeakSet-deduped like `attachButton`); click builds a sighting (`readTweetSignals`, zeros synthesized if null), `band: 'manual'`, flows through the existing radar-report path.
- Radar panel row: shows primary reply + "3 angles" hint; open click sends `radar-confirm` alongside the existing `radar-click` + clipboard copy of the primary.

**Measurement:**
- `classifyReplyOrigin` (routes/playbook.ts): a posted draft matched by `postedTweetId` now reads `reply_drafts.source` — `'radar'` → radar bucket, `'reply_master'`/null → single. The old radar text-match stays as fallback for historical rows. Everything else (outcomes, angle crosstab, latency, quests, quota) flows automatically because confirmed radar replies ARE reply_drafts rows.

## Decisions taken

1. **Reply Master unified at 3 variants** (user choice via AskUserQuestion): both paths produce one variant per angle; `reply prompt.md` edited; single-draft cost +~50%.
2. **Paste = posted** (user choice): clicking a variant chip marks the draft posted immediately — identical semantics to Reply Master's Done (a human claim at paste time). Required by the existing harvest reconcile, which only backfills `postedTweetId` for drafts already `status='posted'` (`src/x/routes/harvest.ts:123`). A pasted-but-never-sent row simply never gets a measured outcome.
3. **Relationship augmentation already exists** — C3's `renderRelationshipBrief` (stage, exchange counts, gated best-angle, last exchange, notes) already rides into the batch prompt per distinct handle. No new work; do not re-implement.
4. **Confirm at panel-click, posted at chip-click.** The reply_drafts row is created when the user clicks the Radar row (that's the "confirmed" moment per the user's spec), status `copied`; the posted flip happens on variant paste. A user who opens the tweet but never pastes leaves a `copied` row — accurate.
5. **Manual adds skip the band gate by design** — the whole point is human override; they carry `band: 'manual'` so the Playbook's band calibration never mixes them into hot/warm cells.
6. **No new gate on batch spend** — Radar pre-filters; manual rows are deliberate. Batch cap stays 25 server / 20 panel.
7. **`radar_drafts` keeps one row per (tweet, draft-run)** — variants live as JSON on the row, not 3 rows, so status ratchets/tags/rehydrate stay keyed by tweetId unchanged.

## Done when

1. Reply Master button on a tweet returns 3 variants (one per angle) and the Replies-tab picker shows all three; byte-sync test green.
2. Radar "Draft replies" produces 3 variants per queued tweet in one Grok call; cost line shows in the panel; drafts survive browser restart with variants intact.
3. Clicking a Radar row opens the tweet; the page shows 3 angle chips; clicking one types that variant into the reply box; the corresponding `reply_drafts` row exists with `source='radar'`, chosen text, `status='posted'`.
4. After the next harvest (or daily discovery) the posted radar reply gains `postedTweetId` and appears in `GET /x/replies/outcomes` and the Playbook's batch-vs-single radar bucket without text-matching.
5. The ⊕ button on an arbitrary cold tweet puts it in the Radar queue (top-ranked, `manual` chip) and the next "Draft replies" drafts it.
6. `scripts/smoke-radar-reply-flow.ts` passes $0: seeds a radar draft with variants, confirms it, PATCHes posted, asserts the source-attributed origin classification, cleans up.

---

## Task 1: Reply Master → 3 variants (prompt + template + gate plumbing)  [parallel-ok]
**Depends on:** none
**Session budget:** ~180 diff lines, 5 files

**Read first:** codemap header + §3.3/§7.14; `reply prompt.md` (whole); `src/x/replies/prompt.ts:56-260` (template, VOICE_BLOCK_END, schema, parseReplyVariants); `src/x/routes/replies.ts:53-70, 219-267` (MAX_OUTPUT_TOKENS, specificity gate, primary pick); the byte-sync test (grep `REPLY_PROMPT_TEMPLATE` in `src/*.test.ts` / `src/x/**/*.test.ts`).

**Edit:**
- `reply prompt.md` — "## The two variants" → "## The three variants"; "exactly two genuinely different variants… pick the two angles" → exactly three, **one per angle** (extends, contrarian, debate each appear once); Output section: "exactly three variants".
- `src/x/replies/prompt.ts` — regenerate `REPLY_PROMPT_TEMPLATE` byte-identical to the .md; `VOICE_BLOCK_END = '## The three variants'` (the slicing trap); no schema change needed (`REPLY_VARIANTS_SCHEMA` is already an array).
- `src/x/routes/replies.ts` — `MAX_OUTPUT_TOKENS` 350 → 520 (3 variants ≈ 225 output tokens + JSON; xAI doesn't count reasoning tokens, verified §7.1).

**How:** Edit the .md first, then copy verbatim into the TS literal (escape backticks/`${`). The batch head (`batchReplyHead`) must still slice the voice block correctly — assert `sharedVoiceBlock()` still contains "Forbidden openers" in a test. Do NOT touch `buildGrokInput` injection order or the variants parser (angle-count enforcement stays soft — parse accepts whatever came back; the schema enum + prompt do the steering). The primary-pick logic (`variants.find(passesSpecificityGate) ?? variants[0]`) is variant-count-agnostic — leave it.

**Tests:** byte-sync test stays green (regenerate literal); add to the prompt test file: `sharedVoiceBlock()`-derived batch head still contains the forbidden-openers block; `REPLY_PROMPT_TEMPLATE` contains "three variants" and all three angle names.

**Done when:**
- [ ] `.md` and TS literal byte-identical (test proves it); voice-block slice intact
- [ ] One live Reply Master call (manual, ~$0.005) returns 3 variants — or note deferred to Task 10 smoke `--live`
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(replies): reply master drafts three angle variants`

**Cost note:** $0 in CI; ~$0.005 optional manual verification.

---

## Task 2: Migration 0013 + source stamping
**Depends on:** none (Task 1 parallel)
**Session budget:** ~120 diff lines, 5 files

**Read first:** codemap §4 + §10 "New table/column"; `src/x/db/schema.ts:301-390` (replyDrafts + radarDrafts); `src/db/migrations/` latest file for style; `src/x/routes/replies.ts:269-297` (generate insert); `src/x/routes/radar.ts:48-104` (RadarDraftInsert/persistRadarDrafts).

**Edit:**
- `src/x/db/schema.ts` — `replyDrafts`: add `source: text('source')` (nullable). `radarDrafts`: add `variants: text('variants', {mode:'json'})`, `replyDraftId: text('reply_draft_id')`, `model: text('model')`.
- `bun run db:generate` → inspect `0013_*.sql` (DDL-only ALTERs expected; confirm no seed INSERT dropped — none exist for these tables).
- `src/x/routes/replies.ts` — generate insert adds `source: 'reply_master'`.
- `src/x/routes/radar.ts` — `RadarDraftInsert` gains `variants: {text, angle}[] | null` and `model: string | null`; `persistRadarDrafts(tweets, replies, model)` signature gains the model arg; `buildRadarDraftRows` passes variants/model through (variants null until Task 3 supplies them — call site passes `result.model` and `null` variants for now… no: Task 3 lands the 3-variant response; here keep `variants: null`, `model` wired from the route's `result.model`).

**How:** Nullable columns, null = pre-feature (invariant §7.11 discipline). Nothing reads the new columns yet except the insert paths — every intermediate state coherent. Keep `replyText` NOT NULL semantics untouched.

**Tests:** extend `src/x/routes/radar` tests (or the replies route suite) minimally: generated draft row carries `source='reply_master'`; `buildRadarDraftRows` passes model through.

**Done when:**
- [ ] Migration applies on a fresh `:memory:` boot (bun test does this implicitly)
- [ ] New single drafts carry `source='reply_master'`; radar_drafts rows carry `model`
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(db): reply source + radar draft variants/model/link columns (0013)`

**Cost note:** $0.

---

## Task 3: Batch endpoint → 3 variants per tweet (server)
**Depends on:** Task 2 (and Task 1 for the renamed voice-block heading)
**Session budget:** ~250 diff lines, 4 files

**Read first:** codemap §3.3; `src/x/replies/prompt.ts:219-390` (batch head, schema, parseBatchReplies, buildBatchGrokInput); `src/x/routes/replies.ts:300-529` (generate-batch route, parseBatchTweets); `src/x/routes/radar.ts:60-104`; existing batch tests (grep `parseBatchReplies` in tests).

**Edit:**
- `src/x/replies/prompt.ts` — `batchReplyHead()`: "## The three variants for each post" — exactly three variants per post, one per angle, id-anchored; Output: `{"replies": [{"id": "...", "variants": [{"text": "…", "angle": "…"}, ×3]}]}`. `BATCH_REPLY_SCHEMA` reshaped to match. `BatchReply` → `{tweetId, variants: ReplyVariant[]}`; `parseBatchReplies` validates ≥1 variant per entry, runs `blankLineBetweenPropositions` on each, defaults bad angles to `'extends'`.
- `src/x/routes/replies.ts` — generate-batch: `maxOutputTokens = Math.min(9000, 200 + tweets.length * 420)`; the anchor/dedupe loop maps to `{tweetId, text: variants[0].text, angle: variants[0].angle, variants}`; `persistRadarDrafts(tweets, out, result.model)`.
- `src/x/routes/radar.ts` — `buildRadarDraftRows` stores full `variants` JSON, `replyText`/`angle` = primary.

**How:** Response keeps `text`/`angle` top-level per reply (primary) so an un-updated panel build still works. Prompt-cache discipline: the head stays static, posts/idea/pillars/guidance at the tail — untouched. Do NOT add a band gate or DB reply_drafts writes here (deliberately lightweight, decision 6). Keep first-occurrence-wins id filtering.

**Tests:** update batch suites: `parseBatchReplies` happy path (3 variants), truncated JSON → null, missing variants array → null, bad angle → extends; route validation guards unchanged (`src/app.test.ts` pre-DB paths); `buildRadarDraftRows` persists variants + model; response carries both primary and variants.

**Done when:**
- [ ] `POST /x/replies/generate-batch` returns 3 variants/tweet and persists them to `radar_drafts.variants`
- [ ] Old-shape consumers (panel using `.text`) still typecheck
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(replies): batch drafting returns three angle variants per tweet`

**Cost note:** $0 in CI (no live Grok in tests). Live batch ~$0.02–0.08/click, user-accepted.

---

## Task 4: Extension buffer + panel carry variants
**Depends on:** Task 3
**Session budget:** ~200 diff lines, 5 files

**Read first:** codemap §5 + §7.24; `extension/src/shared/radar.ts` (whole); `extension/src/shared/messages.ts:39-108`; `extension/src/background.ts:250-352` (attachReplies, rehydrate); `extension/src/sidepanel/Radar.tsx:112-145, 257-344`; `extension/src/sidepanel/api.ts` batch types.

**Edit:**
- `extension/src/shared/radar.ts` — `RadarSighting.variants?: {text: string; angle: string}[]`; `RadarDraftRow.variants`; `mergeSightings` preserves `variants` like `reply`; `draftRowToSighting` maps variants.
- `extension/src/shared/messages.ts` — `RadarReplies.replies[]` gains `variants`.
- `extension/src/background.ts` — `attachReplies` stores variants on the sighting.
- `extension/src/sidepanel/api.ts` — `BatchReplyResponse` reply type gains `variants`.
- `extension/src/sidepanel/Radar.tsx` — `draftReplies` forwards variants in the `RadarReplies` message; ready rows render a small "3 angles" hint next to "reply ready" (full picker lives on the tweet page — keep the panel light).

**How:** Follow the exact `reply`/`clickedAt` survival pattern in `mergeSightings` (radar.ts:81-88). Background remains the single writer — panel never writes session storage. No confirm flow yet (Task 6).

**Tests:** `extension/src/shared/radar.test.ts`: variants survive re-sighting merge; rehydrate maps variants; eviction unaffected.

**Done when:**
- [ ] After a batch draft, sightings in the buffer carry `variants`; restart-rehydrate restores them
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green (extension suite included)
- [ ] Committed: `feat(extension): radar buffer carries reply variants`

**Cost note:** $0.

---

## Task 5: Confirm endpoint + tweetId filter (server)
**Depends on:** Task 2 (Task 3 helpful for variants, but confirm must fall back to `[{text: replyText, angle}]` for pre-variant rows)
**Session budget:** ~260 diff lines, 3 files

**Read first:** codemap §3.4 + §7.8/7.10; `src/x/routes/radar.ts` (whole); `src/x/routes/replies.ts:269-297` (insert shape) and `:779-866` (PATCH semantics — do NOT duplicate its person-event hook); `src/x/db/schema.ts:301-355` (replyDrafts NOT NULL columns); `src/x/routes/harvest.ts:96-175` (reconcile expectations).

**Edit:**
- `src/x/routes/radar.ts` — (a) `GET /radar/drafts` accepts `?tweetId=` (TWEET_ID_RE, 400 `invalid_tweet_id`), filter combinable with status, still runs lazy expiry first. (b) `POST /radar/drafts/:tweetId/confirm`: newest non-expired row for the tweet; idempotent via `replyDraftId` (return the linked reply_drafts row, 200); else build the reply_drafts insert per the Design contract (source `'radar'`, status `'copied'`, contextSnapshot from snippet/signals/band with `postedAt = draftedAt − ageMin·60000`, metrics `{views, replies}` from signals + reposts/likes 0, topComments [], model = row.model ?? `'radar-batch'`, `costUsd: null`) and, in one sync txn (§7.13 — `.run()` terminals, no await inside), insert + stamp `replyDraftId` + ratchet status→`clicked`. 404 `not_found` when no row.

**How:** Import `replyDrafts` schema; the sync-driver txn pattern lives in `src/x/people/store.ts` exemplars. contextSnapshot must parse-shape like `PostContext` enough for `buildReplyOutcomes` (reads `ctx.signals`, `ctx.metrics`) and the playbook's `resolveAgeMin` (prefers `signals.ageMin`). Do NOT log a `my_reply` person event here — that fires on the posted flip in `PATCH /x/replies/:id`. Signals may be null (CLI-originated rows): omit `signals` from the snapshot then, metrics zeros, `sourcePostedAt: null`.

**Tests:** `src/x/routes/radar` suite over the in-memory DB: confirm creates the reply_drafts row (source/status/variants/model asserted); second confirm returns the same draft id (idempotent); tweetId filter returns only that tweet's rows; 404 on unknown tweet; signals-null row confirms without a signals block; radar status ratcheted to clicked.

**Done when:**
- [ ] Confirm round-trips idempotently; the created row is visible via `GET /x/replies` and PATCHable to posted
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(radar): confirm endpoint promotes radar drafts to measured reply drafts`

**Cost note:** $0 — pure DB; no Grok, no X.

---

## Task 6: Panel click → confirm wiring (background + Radar.tsx)
**Depends on:** Tasks 4, 5
**Session budget:** ~180 diff lines, 4 files

**Read first:** codemap §5/§7.24; `extension/src/shared/messages.ts` (message + guard pattern); `extension/src/background.ts:525-565` (onMessage dispatch) and `:280-311` (markClicked, markDraftsOnServer); `extension/src/sidepanel/Radar.tsx:72-87, 275-285`.

**Edit:**
- `extension/src/shared/messages.ts` — `RadarConfirm {type:'stratus/radar-confirm', tweetId}` + guard.
- `extension/src/shared/radar.ts` — `RadarSighting.draftId?: string`; survives merges like `reply`.
- `extension/src/background.ts` — handler: POST `/x/radar/drafts/:tweetId/confirm` via `handleApiRequest`, then (enqueueRadar, single-writer) stamp `draftId` onto the sighting. Best-effort: a failed confirm logs a warn, the click UX proceeds (§7.8).
- `extension/src/sidepanel/Radar.tsx` — `onOpen` additionally fires `radar-confirm` (existing markClicked + clipboard copy of primary unchanged).

**How:** Mirror the `RadarClick` flow exactly (message → background → session write through `enqueueRadar`). `markDraftsOnServer([tweetId],'clicked')` becomes redundant for confirmed rows (confirm ratchets server-side) but stays — the PATCH is a no-op on already-clicked rows.

**Tests:** message guard unit test; `radar.test.ts`: draftId survives merge.

**Done when:**
- [ ] Clicking a ready Radar row creates the reply_drafts row (observable in Replies tab / `GET /x/replies?status=copied`) and stamps draftId in the buffer
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(extension): radar row click confirms draft server-side`

**Cost note:** $0.

---

## Task 7: On-page variant chips + paste→posted (content script)
**Depends on:** Tasks 5, 6
**Session budget:** ~350 diff lines, 4 files

**Read first:** codemap §5 (content.ts, IIFE constraint §7.26); `extension/src/content.ts:842-990` (Reply Master click flow, `focusedTweetIdFromUrl`), `:1362-1460` (`typeTextInto`, `insertChar`, `findReplyEditor` — read its definition below L1460), `:602-666` (attachButton injection pattern + WeakSet), style injection block; `extension/src/shared/messages.ts`; `extension/src/background.ts` onMessage.

**Edit:**
- `extension/src/shared/messages.ts` — `RadarVariantsGet {tweetId}` (response `{variants, draftId} | null`), `RadarVariantPasted {tweetId, text}` + guards.
- `extension/src/background.ts` — `variants-get`: read buffer sighting; fallback `GET /x/radar/drafts?tweetId=` (map row.variants ?? `[{text: replyText, angle}]`). `variant-pasted`: POST confirm (idempotent — covers deep links that skipped the panel), then `PATCH /x/replies/:draftId` `{status:'posted', ...(text !== primary ? {replyTextEdited: text} : {})}`; warn-only on failure.
- `extension/src/content.ts` — on status pages (reuse `focusedTweetIdFromUrl` + the scan pass that calls `attachReplyMasterButton`): ask background for variants (once per tweetId, cached in a Map); when present, inject a chip strip under the focused tweet's action row — 3 buttons labeled by angle, `title` = full text, ~60-char preview. Click: clear the reply editor (`selectAll` + `delete` via execCommand, only if non-empty), `typeTextInto(findReplyEditor(), text)`; no editor → clipboard fallback + hint label; then send `radar-variant-pasted`. Mark the chosen chip active; subsequent clicks allowed (background PATCHes replyTextEdited again — status stays posted).
- styles: chip strip CSS in `injectStyles`.

**How:** The chip strip is the same injection discipline as `attachReplyMasterButton` (anchor on `[data-testid="reply"]` → `closest('div[role="group"]')`, WeakSet-deduped, permalink must equal focusedTweetId). Type directly — do NOT gate on the `autoTypeReplyEnabled` setting; chips exist to inject (clipboard stays the fallback). Posting remains manual (§7.28): the user still presses Reply.

**Tests:** pure helpers only (chip preview truncation, variant-shape guard) — DOM behavior is manual-verified. Message guards unit-tested.

**Done when:**
- [ ] Manual browser check: radar-drafted tweet page shows 3 chips; click types the variant into the reply box; draft flips to posted with chosen text (verify via Replies tab)
- [ ] Deep-linked tweet (panel never clicked) also works via the idempotent confirm
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(extension): on-page variant chips paste chosen radar reply`

**Cost note:** $0.

---

## Task 8: Manual add-to-radar button
**Depends on:** Task 4 (buffer types); touches `parseBatchTweets` (server) — coordinate with Task 3's file but independent logic
**Session budget:** ~250 diff lines, 6 files

**Read first:** codemap §5; `extension/src/content.ts:602-666` (attachButton exemplar), `:1006-1127` (readTweetSignals, recordRadarSighting, flush); `extension/src/shared/radar.ts` (merge/rank/evict); `src/x/routes/replies.ts:458-510` (parseBatchTweets band validation); `src/x/routes/radar.ts` band column comment.

**Edit:**
- `extension/src/shared/radar.ts` — band type `'hot' | 'warm' | 'manual'`; `mergeSightings`: an existing `manual` band never downgraded by a hot/warm re-sight (manual wins); eviction sorts non-manual out first; `rankSightings`: manual block above tier weighting; `isRadarSightings` accepts 'manual'; `draftRowToSighting` accepts band 'manual'.
- `extension/src/content.ts` — round ⊕ button (`stratus-radar-add-btn`, WeakSet-deduped, injected next to the band badge in the action row on ALL tweets incl. band-null ones); click → build sighting via `recordRadarSighting`-style code with `band: 'manual'` (signals from `readTweetSignals`, synthesize zeros + timestamp-derived ageMin when null), immediate flush; button flips to ✓ briefly.
- `src/x/routes/replies.ts` — `parseBatchTweets` accepts `band: 'manual'`.
- `src/x/routes/radar.ts` — type widened on `RadarBatchTweet`/`RadarDraftInsert` band.
- `extension/src/sidepanel/Radar.tsx` — render `manual` band chip (distinct color), whyLine tolerates zero signals.

**How:** Do NOT let manual rows enter the Playbook's hot/warm band cells: `radar_drafts.band='manual'` simply isn't 'hot'/'warm', and reply_drafts contextSnapshot signals keep their real computed band only when present — when synthesizing signals for a manual add, stamp `band` in the snapshot as the *computed* classifyBand verdict (may be null/skip), never 'manual' (PostSignals.band is the classifier's type). The `manual` flag is queue/UX metadata, not a classifier verdict.

**Tests:** `radar.test.ts`: manual ranks first; manual survives hot re-sight; eviction prefers non-manual; server: parseBatchTweets accepts manual band, rejects other strings.

**Done when:**
- [ ] Manual browser check: ⊕ on a cold tweet lands it top of the Radar queue with a `manual` chip; "Draft replies" includes it
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(radar): manual add-to-queue button on any tweet`

**Cost note:** $0 (drafting it costs the normal batch click the user initiates).

---

## Task 9: Playbook source-exact attribution  [parallel-ok after Task 2]
**Depends on:** Task 2
**Session budget:** ~120 diff lines, 3 files

**Read first:** codemap §3.3 playbook + §7.19; `src/x/routes/playbook.ts:355-410` (loadOriginRows) and `classifyReplyOrigin` (find in `src/x/playbook.ts`); `src/x/playbook.test.ts` + `src/x/routes/playbook.test.ts` batch-vs-single blocks.

**Edit:**
- `src/x/playbook.ts` — `classifyReplyOrigin` gains a source map arg: posted-draft match with `source='radar'` → `'radar'`; `source='reply_master'` or null → `'single'`; unmatched published replies keep the legacy radar text-match fallback, else unattributed.
- `src/x/routes/playbook.ts` — `loadOriginRows` selects `replyDrafts.source` alongside postedTweetId and builds the map.
- `extension/src/sidepanel/Playbook.tsx` — batch-vs-single section label notes radar rows are now confirmed drafts (one-line copy tweak).

**How:** Source wins over text-match (exact beats heuristic); keep the fallback so pre-feature history doesn't degrade. Gates (n≥20, §7.19) untouched.

**Tests:** pure: source='radar' beats text-mismatch; null source + text match still → radar (legacy); route: seeded radar-sourced posted draft lands in the radar bucket.

**Done when:**
- [ ] A confirmed+posted radar draft classifies `radar` without text equality
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(playbook): exact radar attribution via reply source column`

**Cost note:** $0.

---

## Task 10 (final): docs-sync + smoke
**Depends on:** all prior.

- [ ] `scripts/smoke-radar-reply-flow.ts` — rerunnable, $0 default: seeds a `radar_drafts` row with 3 variants → `GET ?tweetId=` → confirm (assert reply_drafts row: source/status/variants/contextSnapshot shape) → confirm again (idempotent) → PATCH posted with replyTextEdited → assert origin classification radar → cleanup. `--live`: one 2-tweet `generate-batch` call (~$0.01) asserting 3 variants each + radar_drafts persistence.
- [ ] CLAUDE.md: one phase-style entry (Overhaul 7.7 — Radar/Reply unification: what shipped, date, costs, the VOICE_BLOCK_END trap, paste=posted semantics, manual band never a classifier verdict).
- [ ] PLAN.md phased-build status updated (this lives under goals 1–3 tooling; reference CIRCLES C3/C4 hooks).
- [ ] `docs/today-tab.md` (Radar section) + `docs/replies-tab.md` updated; new on-page chips documented.
- [ ] `.claude/skills/plan-feature/references/codemap.md`: §3.3 (prompt/batch shapes), §3.4 (radar routes), §4 (0013 columns), §5 (messages, chips, manual button), §9 (new smoke) + header re-stamp.

## Out of scope (do NOT build)

- Auto-sending replies or clicking X's Reply button programmatically (Feb 2026 policy + §7.28 — paste-assist only).
- A band gate on the batch endpoint, or gating manual adds — deliberate human override.
- Per-variant A/B measurement beyond the existing angle crosstab (variants[].text === replyText matching already covers it).
- Merging `radar_drafts` into `reply_drafts` (different lifecycles: 48h-expiring queue vs permanent measured history).
- Retro-backfilling `reply_drafts.source` for historical rows (null = unknown, §7.11).
- Radar panel variant picker (chips live on the tweet page; panel shows primary + hint).

## Risks / watch items

- **3-variant batch output size**: 25 tweets × 3 variants pushes ~10k output tokens — watch the first live batches for truncation (parse returns null → 502); the 9000 cap may need raising or the panel cap (20) lowering.
- **X DOM drift**: chip injection + editor clearing depend on `tweetTextarea_0`/Draft.js behavior — same fragility class as the existing auto-type path; clipboard fallback is the safety net.
- **Paste=posted overcount**: a pasted-never-sent reply inflates the daily quota by 1 until noticed; accepted trade-off (decision 2), reconcile never links it so outcomes stay clean.
- **Angle diversity**: with one variant per angle *forced*, some posts fit an angle badly — the prompt keeps "ship-ready" pressure but quality on the weakest angle is unverified until real use.
- **Byte-sync regeneration** (Task 1) is the highest-risk mechanical step — the test catches drift, but the VOICE_BLOCK_END rename must land in the same commit.
