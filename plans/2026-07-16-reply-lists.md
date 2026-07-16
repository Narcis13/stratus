# Reply lists — premade, templated, humanized canned replies (S5)

- **Status:** planned 2026-07-16 · not started
- **Goal fit:** Goal 4 (Circles) + the reply doctrine. Fast, human-sounding acknowledgment replies for the exact moments the machinery already surfaces — Launch Room early commenters, open loops in Conversations — at $0 per use. Deterministic (no AI at use time), posting stays manual paste.
- **Cost impact:** $0 recurring. $0 X API (nothing reads or writes X). One optional Grok call per "Generate items" click, ~$0.003–0.01 (structured outputs, reasoning low). Smoke `--live` = one such call.
- **Invariants touched:** §7.13 (sync SQLite txns, no Date binding in raw sql); §7.15 (variable tail + `prompt_cache_key` on the generator prompt); §7.17 (structured outputs via `text.format` json_schema); §7.22 (CRUD always mounted, `/generate` runtime 503 — pillars.ts shape); §7.24–25 (background = one transport; panel calls via `api.ts`); §7.28 (posting is ALWAYS manual paste — this feature only composes clipboard text); §7.29–30 (docs sync + $0-default smoke); §7.19 (attribution counts follow the existing `batchVsSingle` shape — counts, not gated medians).
- **Codemap sections relevant:** §3.3 (routes table, `pillars.ts`, `playbook.ts`), §4 (`ideas` as uuid-PK exemplar, migration workflow), §5 (extension: `api.ts` one-transport, Voice subtab pattern, LaunchRoom/Conversations copy buttons), §7, §10 recipes.

## Why / what changes for the user

The user keeps lists of premade replies ("Thanks for the early read, {name}!", "this one's going in the swipe file") managed from a new **Lists subtab of the Replies tab**. Clicking "Use" anywhere a list is offered — a compact picker rides on every Launch Room early-commenter row and every Conversations open loop — picks an item the account hasn't used recently (anti-repeat shuffle), fills `{name}`/`{handle}`/`{first_name}` from the target tweet's author, applies light humanization (occasional neutral prefix/suffix, casing/punctuation jitter, a 5% deliberate typo), and copies the final text to the clipboard for manual paste. An AI generator (one Grok call, proposal-first) can fill a whole list from a category prompt ("short congratulation replies, some with {name}"). The Playbook's batch-vs-single section gains a `canned` bucket so canned replies get measured against Grok-drafted and hand-written ones.

## Design

**Data (migration `0013`)** — three tables in `src/x/db/schema.ts`, uuid-PK pattern copied from `ideas` (schema L470):

```
reply_lists:       id uuid PK, name NOT NULL, description, humanizer JSON (null = engine defaults),
                   active bool default true, sort_order int default 0, created_at, updated_at
reply_list_items:  id uuid PK, list_id NOT NULL REFERENCES reply_lists(id) ON DELETE CASCADE,
                   text NOT NULL (template, ≤280), enabled bool default true,
                   source 'manual'|'ai' default 'manual', last_used_at NULL, use_count int default 0,
                   created_at, updated_at   [index (list_id, last_used_at)]
reply_list_uses:   id uuid PK, list_id NOT NULL, item_id NOT NULL, rendered_text NOT NULL,
                   target_tweet_id NULL, target_handle NULL, used_at NOT NULL default now
                   [index (used_at)]
```

`reply_list_uses` is both the audit log and the measurement hook (read-time text match against `posts_published`, §7.12 — no derived state).

**Pure engine** — `src/x/replyLists/engine.ts`, all randomness via an injected `rng: () => number` (bun-testable with stub sequences):

- `renderTemplate(template, vars)` → `{text, missingVars}`. Vars: `{name}` (display name, emoji-stripped), `{first_name}` (first token of name), `{handle}` (username, no `@`). A missing var is removed **along with one adjacent `", "` / `" "`** so "Thank you, {name}!" degrades to "Thank you!" not "Thank you, !"; whitespace collapsed; the var listed in `missingVars`.
- `pickItem(items, availableVars, rng)` — the anti-repeat shuffle: enabled items only; items whose template needs a var not in `availableVars` are deprioritized (used only if nothing else remains); exclude the `min(n-1, floor(n/2))` most-recently-used (by `lastUsedAt`, null = never used = most eligible); pick **uniformly at random** among the remainder (pure LRU cycling is itself a detectable pattern — randomness inside the eligible half is the point). n=1 → return it. n=0 → null.
- `humanize(text, config, rng, protectedValues)` → `{text, applied: string[]}`. Independent rolls: prefix from pool (p=0.25), suffix from pool (p=0.20), lowercase first char (p=0.15), drop trailing `.` (p=0.10), **typo (p=0.05)** — exactly one of: drop a char / swap adjacent chars / neighbor-key substitution / doubled space, applied to a random word of ≥4 letters that is NOT an `@`/`#` token, not URL-like, and not inside any `protectedValues` string (never typo the person's name or handle). Enforce ≤280 after every step: a prefix/suffix that would overflow is skipped, never truncated mid-word.
- `DEFAULT_HUMANIZER` — exported defaults incl. neutral prefix pool (`"honestly,"`, `"man,"`, `"ngl"`, `"tbh"`, `"yeah,"` …) and suffix pool (`"well said"`, `"love this"`, `"good stuff"` …); per-list `humanizer` JSON overrides field-by-field (lenient parse, `brandKit.ts` spirit).
- `composeReply(itemText, vars, config, rng)` — render → humanize, returns `{text, missingVars, applied}`.

**Grok generator** — `src/x/replyLists/generate.ts`, imitating `src/x/posts/pillarDraft.ts` end to end: `REPLY_LIST_GEN_SCHEMA` (`{items: [{text: string}]}`), `buildListGenInput({prompt, count, existingItems})` with the instruction block as a stable cacheable prefix and the user prompt + existing items at the **variable tail** (§7.15), `parseGeneratedItems(raw)` degrading bad output to null. Prompt rules: each item ≤200 chars, standalone, varied register/length, MAY use `{name}`/`{handle}`/`{first_name}` in a natural fraction of items, no hashtags, no numbered lists, no fabricated specifics, English unless the prompt says otherwise (Romanian steer welcome).

**Routes** — `src/x/routes/replyLists.ts`, always mounted in `mountX` next to `ideasRouter` (CRUD is $0; only `/generate` needs Grok and checks `XAI_API_KEY` at runtime → 503, exactly like `pillars.post('/pillars/draft')`). No static-vs-`:param` trap: the only static path is the collection root. API contract:

| Method + path | Body → response |
|---|---|
| `GET /x/reply-lists` | → `[{...list, itemCount, enabledCount}]` (sortOrder asc) |
| `POST /x/reply-lists` | `{name, description?, humanizer?}` → 201 list. 400 `invalid_name` |
| `GET /x/reply-lists/:id` | → `{list, items}` (items createdAt asc). 404 |
| `PATCH /x/reply-lists/:id` | partial `{name?, description?, humanizer?, active?, sortOrder?}` → list. 400/404 |
| `DELETE /x/reply-lists/:id` | → `{ok:true}` (items cascade). 404 |
| `POST /x/reply-lists/:id/items` | `{mode:'append'\|'replace', items:[{text}], source?}` ≤100 items, each 1..280 → `{items}`. `replace` deletes+inserts in one sync txn. 400 `invalid_items`, 404 |
| `PATCH /x/reply-lists/:id/items/:itemId` | `{text?, enabled?}` → item. 400/404 |
| `DELETE /x/reply-lists/:id/items/:itemId` | → `{ok:true}`. 404 |
| `POST /x/reply-lists/:id/use` | `{vars?:{name?,handle?}, targetTweetId?, targetHandle?, preview?}` → `{itemId, text, missingVars, applied}`. Unless `preview:true`: ONE sync txn stamps `lastUsedAt`/`useCount` and inserts `reply_list_uses`. 404, 409 `no_enabled_items` |
| `POST /x/reply-lists/:id/generate` | `{prompt (1..2000), count? (default 12, ≤30)}` → `{items:[{text}], model, costUsd, requestId}` — **proposal only, never persisted** (user applies via `/items` with `mode:'replace'` or `'append'`). 503 `grok_not_configured`, 400, 404, 429/502 GrokApiError mapping (pillars.ts:210–225) |

**Extension** —
- `api.ts`: `ReplyList`/`ReplyListItem`/`UseReplyResponse`/`GenerateItemsResponse` types + `api.replyLists.{list,create,get,patch,remove,setItems,patchItem,removeItem,use,generate}`; all through the background `ApiRequest` channel (§7.25).
- `Replies.tsx` gains a `'drafts' | 'lists'` subtab switch (copy `Voice.tsx:19` `useState<'tweets'|'pillars'>` + its subtab header markup); new `ReplyLists.tsx` hosts management: list rail + item editor (add/edit/enable/delete, per-item "last used / ×N" stats), humanizer editor (pools + chances, Reset to defaults), "Test render" preview (sample vars, `preview:true`), and the AI generate box (prompt + count → preview grid → "Overwrite list" / "Append").
- `QuickReplyPicker.tsx` — compact picker (button → list menu → one click = `use` + `navigator.clipboard.writeText` inside the click handler → "Copied ✓", `LaunchRoom.tsx:225` pattern). Wired into Launch Room early-replier rows (vars from `r.handle` / `r.author`) and Conversations open-loop actions (counterpart handle/displayName), next to the existing Grok-draft buttons.

**Measurement** — `ReplyOrigin` (`src/x/playbook.ts:221`) grows `'canned'`: `classifyReplyOrigin` checks, after `'single'` and `'radar'`, whether `normalizeReplyText(reply.text)` matches a `reply_list_uses.renderedText` (normalized). Loader in `routes/playbook.ts` (near the `radarDrafts` query at L385) adds one `reply_list_uses` select; `buildBatchVsSingle` gains a `canned` cell; Playbook tab's batch-vs-single table gains the row. The rendered text is stored typos-and-all, so the paste-exact match holds.

## Decisions taken

1. **Pick/shuffle state lives server-side** (in `reply_list_items.lastUsedAt` + the `/use` route), not in extension storage — survives browser restarts/reinstalls, one source of truth, testable over the in-memory DB. The panel never picks locally.
2. **UI home = Replies tab subtab "Lists"** (user delegated placement). Quick-use surfaces = Launch Room rows + Conversations open loops — the two places with author context where canned acks are actually used. Radar/Today integration deliberately deferred.
3. **AI generator is proposal-first** (pillar-draft pattern), not write-on-generate: the route returns items, the UI previews, the user clicks Overwrite/Append which goes through the plain `/items` CRUD. Keeps the Grok route side-effect-free and the "overwrite" destructive step an explicit human click.
4. **Humanizer config is per-list JSON** (null = `DEFAULT_HUMANIZER`), not global settings — a "thanks" list may want emojisless suffixes while a "banter" list wants heavier jitter. Defaults chosen: prefix 0.25, suffix 0.20, lowercase 0.15, drop-period 0.10, typo 0.05 (user's number).
5. **Typos never touch names/handles/URLs** (protected spans) — a typo'd `@handle` breaks the mention and a typo'd name reads as disrespect, both worse than robotic.
6. **Measurement = `canned` bucket in the existing batch-vs-single attribution** via normalized-text match on `reply_list_uses.renderedText`, not a new reply_drafts row — reply_drafts is Grok-draft-centric (variants/contextSnapshot) and polluting it would skew the angle crosstabs.
7. **Missing-var degradation**: unresolved vars are stripped with adjacent-punctuation cleanup and reported in `missingVars`; `pickItem` prefers items whose vars are all available. Never block the use.

## Done when

- [ ] A list created in the panel with 5+ templated items yields, on 10 consecutive `/use` calls, no immediate repeats (no item twice in a row; verified by the smoke script) and rendered text with `{name}`/`{handle}` filled from the supplied vars.
- [ ] In a real browser: Launch Room (or Conversations) row → Quick reply → one click → final humanized text on the clipboard → manually pasted into X. No API post happens.
- [ ] "Generate items" fills a preview from a category prompt for ~$0.003–0.01, and "Overwrite list" persists it; without `XAI_API_KEY` the button surfaces the 503 cleanly while all CRUD still works.
- [ ] Over ~5% of a large sample of `/use` outputs contain exactly one injected typo, never inside a name/handle/URL (pure-test assertion with seeded rng).
- [ ] `GET /x/playbook` batch-vs-single carries a `canned` bucket; a `posts_published` reply whose text matches a use's `renderedText` counts there.
- [ ] `scripts/smoke-reply-lists.ts` passes $0 by default and cleans up after itself.

---

## Task 1: Pure engine — render, pick, humanize  [parallel-ok]
**Depends on:** none
**Session budget:** ~380 diff lines, 2 files

**Read first:** codemap header + §3.3 + §7 (`.claude/skills/plan-feature/references/codemap.md`); `src/x/people/followups.ts` (pure-module + injected-inputs style); `extension/src/studio/brandKit.ts` (lenient field-by-field config parse to imitate for `parseHumanizerConfig`).

**Edit:**
- `src/x/replyLists/engine.ts` — new: types (`HumanizerConfig`, `ReplyVars`, `PickableItem`), `DEFAULT_HUMANIZER`, `parseHumanizerConfig` (lenient, field-by-field fallback to defaults), `renderTemplate`, `pickItem`, `humanize`, `composeReply`.
- `src/x/replyLists/engine.test.ts` — new.

**How:** Everything pure, no DB, no clock, no `Math.random` — callers inject `rng: () => number` and `now: Date` where needed. Implement exactly the Design-section contracts:
- `renderTemplate`: vars `{name}`/`{first_name}`/`{handle}`; strip emojis from name (unicode property escape `\p{Extended_Pictographic}`); missing var → remove token + one adjacent `", "` or `" "`, collapse whitespace, record in `missingVars`. Unknown `{foo}` placeholders are left verbatim (they may be intentional text).
- `pickItem(items, availableVars, rng)`: filter `enabled`; partition into all-vars-available vs missing-var items (prefer the first partition, fall back to the second); exclude the `min(n-1, floor(n/2))` most recently used by `lastUsedAt` (null sorts as oldest); uniform `rng` pick among the remainder. Deterministic given a stubbed rng.
- `humanize`: independent probability rolls in fixed order (prefix, suffix, lowercase, drop-period, typo) so stubbed rng sequences are predictable; typo picks a candidate word (≥4 letters, not `@…`/`#…`/`http…`, not a substring of any `protectedValues` entry) and one of the four mutations; skip humanization steps that would exceed 280 chars; return `applied: string[]` naming what fired (e.g. `['prefix','typo:swap']`).

**Tests:** render matrix (all vars, missing name with comma cleanup, unknown placeholder untouched, emoji-stripped name); pick matrix (never-used preferred, exclusion window at n=2/3/6, n=1 repeats, disabled skipped, missing-var deprioritized, empty → null); humanize with seeded rng sequences (each step fires at its threshold, typo lands only on eligible words, protected values untouched across 200 seeded runs, 280 cap skips suffix); `parseHumanizerConfig` bad-field fallback.

**Done when:**
- [ ] All engine behaviors above pass with stubbed rng (no flaky randomness in tests)
- [ ] A 200-iteration seeded sweep shows typo rate ≈ configured chance and zero protected-span mutations
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(x): reply-list engine — template render, anti-repeat pick, humanizer`

**Cost note:** $0.

---

## Task 2: Schema + CRUD routes + mount
**Depends on:** Task 1 (imports `parseHumanizerConfig` for validation)
**Session budget:** ~400 diff lines, 5 files

**Read first:** codemap §4 (migration workflow) + §3.3; `src/x/db/schema.ts:464–502` (`ideas` uuid-PK exemplar + index style); `src/x/routes/pillars.ts` (full — the CRUD validation/409/404 idiom to imitate); `src/x/index.ts:53–108` (mount order + comments).

**Edit:**
- `src/x/db/schema.ts` — add `replyLists`, `replyListItems`, `replyListUses` per the Design DDL (FK `onDelete: 'cascade'` on items; indexes `(list_id, last_used_at)` and `(used_at)`).
- `src/db/migrations/0013_*.sql` — via `bun run db:generate`; **inspect the SQL** (no seed INSERTs needed here, but confirm nothing else got dropped — codemap §4 warning).
- `src/x/routes/replyLists.ts` — new: `GET/POST /reply-lists`, `GET/PATCH/DELETE /reply-lists/:id`, `POST /reply-lists/:id/items` (mode append|replace, ≤100 items, each trimmed 1..280, optional `source:'manual'|'ai'`), `PATCH/DELETE /reply-lists/:id/items/:itemId`. `replace` = delete-all + insert in one **sync** txn (§7.13: `.run()`/`.all()` terminals, no await inside).
- `src/x/index.ts` — import + `app.route('/x', replyListsRouter)` next to `ideasRouter`, with a one-line comment (always mounted, $0; only `/generate` — Task 4 — needs Grok at runtime).
- `src/x/routes/replyLists.test.ts` — new.

**How:** Copy pillars.ts's body-validation idiom (`raw` guard → typed field checks → precise 400 error slugs). `humanizer` in POST/PATCH: accept object or null, run through `parseHumanizerConfig` and store the validated JSON (null clears to defaults). List response for the collection route joins item counts with one grouped select. IDs are uuids via `$defaultFn(crypto.randomUUID)` — never accept client ids.

**Tests:** route suite over the in-memory DB (`app.request` pattern, seed carefully + clean up — codemap §9 shared-DB warning): create/list/get/patch/delete round-trip; cascade delete removes items; replace mode swaps items atomically; item text >280 → 400; 100-item cap; unknown ids → 404; invalid humanizer → 400.

**Done when:**
- [ ] Full CRUD round-trips over the in-memory DB incl. cascade + replace semantics
- [ ] Migration lands on a fresh boot (auto-migrate) without touching existing tables
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(x): reply_lists tables + CRUD routes (migration 0013)`

**Cost note:** $0.

---

## Task 3: The /use route — pick, compose, stamp
**Depends on:** Tasks 1–2
**Session budget:** ~200 diff lines, 2 files

**Read first:** codemap §7.13; `src/x/replyLists/engine.ts` (Task 1 output); `src/x/routes/replyLists.ts` (Task 2 output); one sync-txn exemplar: `src/x/routes/channels.ts` tag-merge PATCH (read-modify-write inside `db.transaction` with sync callbacks).

**Edit:**
- `src/x/routes/replyLists.ts` — add `POST /reply-lists/:id/use`.
- `src/x/routes/replyLists.test.ts` — extend.

**How:** Load list + enabled items → `pickItem(items, availableVarKeys, Math.random)` → 409 `no_enabled_items` when null → `composeReply` with the list's parsed humanizer config and `protectedValues = [vars.name, vars.handle]` → unless `preview:true`, ONE sync transaction: `UPDATE reply_list_items SET last_used_at, use_count = use_count + 1` + `INSERT INTO reply_list_uses (…rendered_text, target_tweet_id, target_handle…)` (`.run()` terminals; `new Date()` bound via Drizzle timestamp columns, never raw sql — §7.13). Response `{itemId, text, missingVars, applied}`. Validate `vars` fields as optional strings ≤120 chars, `targetTweetId` numeric-string if present (`/^\d{1,32}$/`).

**Tests:** two-consecutive-uses-differ with n≥2 (loop 10 uses, assert no immediate repeat); `preview:true` writes nothing (lastUsedAt still null, zero uses rows); vars rendered into `text`; missing name degrades cleanly (`missingVars` reported); 409 on empty/all-disabled list; use row persisted with rendered text.

**Done when:**
- [ ] 10 sequential `/use` calls on a 5-item list produce no immediate repeats and stamp 10 `reply_list_uses` rows
- [ ] Preview mode is verifiably side-effect-free
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(x): POST /x/reply-lists/:id/use — anti-repeat pick + humanized render`

**Cost note:** $0.

---

## Task 4: AI list generator (Grok, proposal-only)
**Depends on:** Task 2
**Session budget:** ~300 diff lines, 4 files

**Read first:** codemap §7.15/17/22; `src/x/posts/pillarDraft.ts` (full — the exemplar to imitate for schema/build/parse); `src/x/routes/pillars.ts:154–236` (runtime key check + GrokApiError mapping); `src/grok/client.ts` `askGrok` signature only.

**Edit:**
- `src/x/replyLists/generate.ts` — new: `REPLY_LIST_GEN_SCHEMA` (`{items:[{text}]}`, `required`, `additionalProperties:false`), `buildListGenInput({prompt, count, existingItems})`, `parseGeneratedItems(raw)`.
- `src/x/routes/replyLists.ts` — add `POST /reply-lists/:id/generate` (runtime `XAI_API_KEY` check → 503 first; validate prompt 1..2000, count default 12 max 30; 404 unknown list; call `askGrok` with `reasoningEffort:'low'`, `temperature:0.9`, `maxOutputTokens:1500`, `jsonSchema:{name:'reply_list_items', schema:REPLY_LIST_GEN_SCHEMA}`, `promptCacheKey:'stratus-reply-list-gen'`; map errors exactly like pillars.ts:210–225). Proposal only — NO DB write.
- `src/x/replyLists/generate.test.ts` — new (build/parse pure tests).
- `src/x/routes/replyLists.test.ts` — extend (pre-network validation guards only).

**How:** Prompt structure per §7.15: stable instruction prefix (what a reply-list item is, the rules from the Design section: ≤200 chars, standalone, varied register, natural fraction with `{name}`/`{handle}`/`{first_name}`, no hashtags/numbered lists/fabricated specifics, Romanian steer OK) — then the **variable tail**: requested count, the user's category prompt, and current list items (so "more like these" works and duplicates are avoided). `parseGeneratedItems` trims, drops empties/>280s, dedupes exact texts, returns null on unparseable.

**Tests:** `buildListGenInput` puts prompt + existing items after the instruction block (tail-position assertion, same style as the C3/C4 tail tests); `parseGeneratedItems` happy path + dedupe + >280 drop + garbage → null; route: 400 on missing prompt / count 31, 404 unknown list — all pre-network (never call Grok in tests).

**Done when:**
- [ ] Generator returns a parsed proposal without touching the DB
- [ ] All validation guards fire before any network call (refuse-before-spend, §7 pattern 4)
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(x): reply-list AI item generator (proposal-only Grok call)`

**Cost note:** ~$0.003–0.01 per real click; $0 in tests (validation-only). Runtime 503 without the key.

---

## Task 5: Extension — api client + Lists subtab management UI
**Depends on:** Tasks 2–4
**Session budget:** ~400 diff lines, 4 files

**Read first:** codemap §5; `extension/src/sidepanel/api.ts:1–60` + one existing method group (e.g. the ideas or pillars methods) for the call idiom; `extension/src/sidepanel/Voice.tsx:15–60` (the `'tweets'|'pillars'` subtab switch to copy); `extension/src/sidepanel/Pillars.tsx` (edit/save/reset/AI-draft-review-then-save UI — the closest management-panel exemplar); `extension/src/sidepanel/Replies.tsx:1–60` (props + header structure).

**Edit:**
- `extension/src/sidepanel/api.ts` — types (`ReplyList`, `ReplyListItem`, `HumanizerConfig`, `UseReplyResponse`, `GenerateItemsResponse`) + `api.replyLists.{list,create,get,patch,remove,setItems,patchItem,removeItem,use,generate}` through the ApiRequest transport.
- `extension/src/sidepanel/Replies.tsx` — add `'drafts' | 'lists'` subtab state + header chips (Voice.tsx pattern); render `ReplyListsPanel` on `'lists'`.
- `extension/src/sidepanel/ReplyLists.tsx` — new: list rail (create/rename/delete/active), item editor (textarea add, inline edit, enabled toggle, delete, "last used · ×N" stat line), humanizer editor (prefix/suffix pools as comma-separated inputs + chance sliders, Reset to defaults), "Test render" (sample name/handle inputs → `use` with `preview:true`), AI generate box (prompt + count → preview grid → "Overwrite list" / "Append" via `setItems`).
- `docs/replies-tab.md` — defer to Task 8 (do not edit here).

**How:** Follow Pillars.tsx interaction shape exactly (busy/notice/error state trio, confirm-before-delete). The generate flow: proposal held in component state only; Overwrite calls `setItems({mode:'replace', items, source:'ai'})`. A 503 from generate renders "Grok not configured on the server" inline, everything else keeps working. No new message types, no session storage — pure panel + api.

**Tests:** none new in the extension (repo pattern: panel components untested; logic lives server-side). Manual check in the "Done when".

**Done when:**
- [ ] Lists subtab: create list → add items → edit → test-render shows humanized output with vars filled
- [ ] Generate → preview → Overwrite persists items with `source:'ai'`
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green (both roots — extension tsc runs via repo typecheck)
- [ ] Committed: `feat(extension): reply Lists subtab — manage, humanize, AI-generate`

**Cost note:** generate button = one Grok call per click (~$0.003–0.01); everything else $0.

---

## Task 6: Extension — QuickReplyPicker in Launch Room + Conversations
**Depends on:** Task 5
**Session budget:** ~250 diff lines, 3 files

**Read first:** codemap §5; `extension/src/sidepanel/LaunchRoom.tsx:190–260` (early-replier row: `r.handle`, `r.author`, the clipboard Copy at L225); `extension/src/sidepanel/Conversations.tsx:390–460` (open-loop action row, clipboard at L404).

**Edit:**
- `extension/src/sidepanel/QuickReplyPicker.tsx` — new compact component: props `{vars: {name?, handle?}, targetTweetId?, targetHandle?, onUsed?}`; collapsed button ("canned ▾") → menu of active lists (fetched once per mount via `api.replyLists.list`, module-level 60s cache like `ChannelTags.tsx`) → click = `api.replyLists.use(...)` then `navigator.clipboard.writeText(text)` **inside the same click handler** (user gesture) → "Copied ✓" flash; surfaces 409 `no_enabled_items` as a tooltip.
- `extension/src/sidepanel/LaunchRoom.tsx` — add the picker to each early-replier row next to the Grok draft button (`vars: {name: r.author, handle: r.handle}, targetTweetId: r.tweetId`).
- `extension/src/sidepanel/Conversations.tsx` — add the picker to open-loop items next to Copy/Draft (vars from the thread counterpart's handle/displayName, targetTweetId = the owed inbound's tweet id).

**How:** Keep the picker dumb: no local pick logic, no storage writes — the server owns shuffle state (Decision 1). Mark the mention answered / launch reply handled exactly as the existing manual flow does (don't add new status flips; the user still clicks Done after pasting). Match existing row styling; no new CSS files.

**Tests:** none (panel-only); behavior verified in "Done when" browser check.

**Done when:**
- [ ] In a live side panel, a Launch Room row's picker puts a humanized, name-filled reply on the clipboard in one click; same on a Conversations open loop
- [ ] Two rapid uses of the same list on different rows yield different items (server shuffle observable)
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(extension): quick canned-reply picker in Launch Room + Conversations`

**Cost note:** $0.

---

## Task 7: Playbook `canned` attribution  [parallel-ok after Task 3]
**Depends on:** Task 3
**Session budget:** ~180 diff lines, 4 files

**Read first:** codemap §3.3 playbook rows + §7.19; `src/x/playbook.ts:221–275` (`ReplyOrigin`, `normalizeReplyText`, `classifyReplyOrigin`, `buildBatchVsSingle`); `src/x/routes/playbook.ts:380–400` (the radarDrafts loader + L494 `batchVsSingle` wiring); `extension/src/sidepanel/Playbook.tsx` batch-vs-single section only.

**Edit:**
- `src/x/playbook.ts` — `ReplyOrigin` → `'single' | 'radar' | 'canned'`; `classifyReplyOrigin` gains a `cannedTexts: Set<string>` param checked AFTER single/radar (a draft match always wins — same precedence discipline as radar's "independently written reply never counts"); `BatchVsSingle` + `buildBatchVsSingle` gain the `canned` cell.
- `src/x/routes/playbook.ts` — load `reply_list_uses.renderedText` (one select, normalized into the Set), thread through to the classifier; response `batchVsSingle.canned`.
- `src/x/playbook.test.ts` + `src/x/routes/playbook.test.ts` — extend.
- `extension/src/sidepanel/Playbook.tsx` — add the `canned` row to the batch-vs-single table.

**How:** Match on `normalizeReplyText` equality exactly like the radar branch (playbook.ts:244). Do NOT gate the counts (attribution is counts; only medians inside cells keep the existing `OutcomeCell` behavior). Keep the loader window consistent with the existing batch-vs-single population.

**Tests:** pure: a reply matching a use's rendered text → `'canned'`; draft-posted id beats canned (precedence); non-matching → unattributed-null; route: seeded use row + posts_published reply → `canned.n === 1`, cleanup after (shared in-memory DB, codemap §9).

**Done when:**
- [ ] `GET /x/playbook` returns `batchVsSingle.canned` and the Playbook tab renders it
- [ ] Precedence: a reply that is BOTH a posted draft and a text-match counts `single`, never twice
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(x): playbook canned-reply attribution bucket`

**Cost note:** $0 — read-time SQL over already-stored rows.

---

## Task 8 (final): docs-sync + smoke
**Depends on:** all prior.

- [ ] `scripts/smoke-reply-lists.ts` — rerunnable, $0 default, cleans up: creates a throwaway list + 5 templated items → 10 `/use` calls asserting no immediate repeats, vars rendered, uses rows written → preview writes nothing → replace-mode swap → cascade delete. `--live` adds ONE `/generate` call (~$0.003–0.01) asserting a parsed proposal (never persisted).
- [ ] CLAUDE.md: phase entry "Surfaces S5 — Reply lists (2026-07-16, $0 recurring; ~$0.003–0.01/generate click)" — what shipped, the anti-repeat/humanizer contracts, the proposal-only generator, the canned playbook bucket, gotchas (server-owned shuffle state; typos stored in rendered_text on purpose so the outcome text-match holds).
- [ ] SURFACES-PLAN.md: S5 section appended with status.
- [ ] `docs/replies-tab.md`: Lists subtab documented; `docs/today-tab.md`: one line each for the Launch Room / Conversations picker.
- [ ] `.claude/skills/plan-feature/references/codemap.md`: §3.3 (routes table + domain module `replyLists/`), §4 (3 new tables, migration 0013), §5 (Replies subtab, QuickReplyPicker), §9 (smoke list) updated + header re-stamped to the new commit.

## Out of scope (do NOT build)

- **Any auto-posting or typing automation** — no `createPost` path, no integration with `humantype.py`/Hammerspoon. Clipboard + manual paste only (§7.28, Feb 2026 wall).
- Per-item weights/priorities, cooldown timers per item, or cross-list dedupe.
- Language auto-detection of the target tweet; the list's language is the user's choice.
- Radar/Do-next/Mentions-refresh picker placements (Launch Room + Conversations only in v1).
- MCP tools for reply lists; import/export of lists; global (non-per-list) humanizer settings.
- A gated medians cell for canned outcomes beyond the batch-vs-single counts — revisit when canned n≥20 measured.

## Risks / watch items

- **Exclusion window `floor(n/2)` and all humanizer chances are opening guesses** — revisit after real use, same spirit as the BAND ≥100 rule. Typo chance is the user's 5%.
- **X composer paste normalization**: if X trims/normalizes pasted whitespace, the doubled-space typo variant and the playbook text-match could drift. Watch the first live paste; `normalizeReplyText` (collapsed whitespace) already absorbs most of it — worst case drop the doubled-space mutation.
- **LaunchRoom `r.author` may be null** → `{name}` falls to `missingVars` degradation; verify the degraded text reads naturally in the first live launch.
- **Shared in-memory DB in route tests** (codemap §9): the playbook suites assert exact medians — Task 7's seeds must clean up completely or those assertions break.
- Clipboard write must stay inside the click handler (user-gesture requirement) — an `await api.use()` before `writeText` is fine (transient activation survives one await in Chrome), but don't add further async hops; if flaky, compose-then-copy with a preview fetch on menu open.
