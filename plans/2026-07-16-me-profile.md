# M1 — Me (My Profile): the personal-context layer

- **Status:** planned 2026-07-16 · not started
- **Goal fit:** Goal 1 (authoring quality — the drafters produce the content the calendar schedules) with goal-4 spirit (personal, emotional content earns engagement the same way relationship context does). Same category as §8.6 editable pillars: the persona already ships inside the prompts; this makes the *dynamic* personal layer — facts, events, emotions, notes, goals — DB-backed, editable, and injected.
- **Cost impact:** $0 X API. Grok: the injected block adds ~150–500 tokens at the variable tail ≈ +$0.0005–0.001 per existing draft call (no new calls). $0 recurring.
- **Invariants touched:** §7.8 (best-effort loader — a me-layer failure never fails the paying path), §7.13 (sync SQLite), §7.14 (prompt byte-sync — templates untouched, tail injection only), §7.15 (variable tail), §7.16 (server-stamped fields, persisted via contextSnapshot), §7.18 (no fabrication — the block is the ONLY extra biography Grok may use; instruction rides inside the block), §7.19 (lift cell gated n≥20/side), §7.29–30 (docs sync, $0 smoke).
- **Codemap sections relevant:** §3.3 (posts/prompt.ts, replies/prompt.ts, people/relationship.ts), §3.4 (pillars.ts as CRUD exemplar, drafter.ts, replies.ts, playbook.ts, digest.ts), §4 (ideas/streaks as schema exemplars), §5 (App.tsx tabs, api.ts, Pillars.tsx as tab exemplar), §7, §10.

## Why / what changes for the user

Today the AI knows the static biography baked into `post prompt.md` §1 and nothing that happened since. After this ships, a new **Me tab** in the extension holds a living profile — evergreen facts, dated events ("shipped the studio Friday"), current emotions ("frustrated with the ANAF portal"), free notes, and measurable goals (5K MRR, a follower target with auto-tracked progress from `account_snapshots`). Every post draft gets the fresh slice of this injected at the prompt tail; reply drafts get a compact ≤3-line brief. Drafts stop sounding like a frozen bio and start sounding like a person having this specific week. A "What the AI sees" preview shows the exact rendered block, the Sunday digest narrates goal progress, and the Playbook measures whether me-context replies outperform cold ones.

## Design

**Data** (migration `0013`): two tables in `src/x/db/schema.ts`, shaped like `ideas` (uuid PK via `$defaultFn(crypto.randomUUID)`, `timestamp_ms` columns):

```sql
me_entries: id text PK, kind text NOT NULL ('fact'|'event'|'emotion'|'note'),
  text text NOT NULL, happened_at integer NULL (null = undated → created_at drives windows),
  pinned integer bool NOT NULL DEFAULT 0, active integer bool NOT NULL DEFAULT 1,
  created_at, updated_at
me_goals: id text PK, label text NOT NULL, kind text NOT NULL ('followers'|'mrr'|'custom'),
  target real NOT NULL, unit text NULL, current_value real NULL,
  deadline integer NULL, status text NOT NULL DEFAULT 'active' ('active'|'achieved'|'dropped'),
  created_at, updated_at
```

No seed INSERT — an empty profile renders an empty block and the prompts are byte-identical to today (this is also the rollback story).

**Pure logic** — `src/x/me/profile.ts` (stage.ts/relationship.ts pattern: pure, no DB, callers pass `now`):
- Freshness windows: emotions 7d, events 30d (off `happenedAt ?? createdAt`), facts/notes evergreen; `pinned` overrides windows and caps. `selectEntriesForPrompt(entries, now)` applies windows + per-kind caps.
- `goalProgress(goal, latestFollowers, now)` — for `kind='followers'` current comes from the caller-supplied latest `account_snapshots.followersCount` (null until the first daily pass); `mrr`/`custom` use `current_value`. Returns `{current, pct, daysLeft} | null`.
- `renderMeContext(selection, goals, now)` — the post-drafter block, hard-capped (~14 lines / 1200 chars): goal lines with progress, dated event lines ("3d ago: …"), emotion lines ("today: …"), pinned+recent facts/notes. The drafting instruction lives INSIDE the block (RELATIONSHIP_INSTRUCTION pattern): use for specificity and emotional grounding, let real feelings and goals color the draft when they fit, never recite the list, never invent beyond it. `''` when empty.
- `renderMeBrief(selection, goals, now)` — reply form, ≤3 lines (~300 chars): 1 goal line + up to 2 fresh event/emotion lines, instruction "reach for this only when it genuinely fits the reply; most replies won't need it."

**Routes** — `src/x/routes/me.ts`, always mounted (pure SQL, $0), imitating `routes/pillars.ts` validation style:
- `GET /x/me?kind=&active=` → `{entries, goals}`; each entry carries `inWindow: boolean` (derived server-side from `selectEntriesForPrompt` — the UI must never fork the window logic); each goal carries computed `progress` (followers goals read the latest `account_snapshots` row).
- `POST /x/me/entries` `{kind, text ≤1000, happenedAt?, pinned?}` → 201 / 400 `invalid_kind`/`invalid_text`/`invalid_happened_at`.
- `PATCH /x/me/entries/:id` partial `{kind?, text?, happenedAt?, pinned?, active?}` → 200 / 404 / 400.
- `DELETE /x/me/entries/:id` → `{ok:true}` / 404.
- `POST /x/me/goals` `{label, kind, target>0, unit?, deadline?, currentValue?}` → 201 / 400.
- `PATCH /x/me/goals/:id` partial incl. `currentValue` and `status` (`active|achieved|dropped`) → 200 / 404 / 400.
- `DELETE /x/me/goals/:id` → `{ok:true}` / 404.
- `GET /x/me/context?mode=post|reply` → `{mode, block: string|null}` — the exact rendered block, §7.18 transparency (grounding travels back).
- Exported `loadMeContextSafe(mode: 'post'|'reply'): Promise<string|null>` — loads active entries + active goals + latest followers, renders, returns null on empty or ANY error (console.error, never throws) — `loadReplyGuidanceSafe` discipline.

**Prompt injection** (all at the variable tail; both `.md` files and both TS templates byte-untouched):
- Posts: `BuildPostDraftOptions.meContext?: string` appended in `buildPostDraftInput` (exactly like `guidance`, before it); `drafter.ts::generateAndInsert` loads it via `loadMeContextSafe('post')`.
- Replies single: `PostContext.me?: string`, server-stamped in `/replies/generate` alongside `relationship`/`guidance` (routes/replies.ts ~L193–203) and appended in `buildGrokInput` (order: relationship → me → guidance). `parseContext` is an allowlist that never copies unknown fields — `me` cannot arrive from a client. The full `ctx` already persists as `contextSnapshot`, so every draft records whether it saw the block.
- Replies batch: `buildBatchGrokInput` gains a `meBrief?: string` arg appended ONCE per batch (it describes me, not the targets).

**Extension** — new **Me tab** (`extension/src/sidepanel/Me.tsx`, wired in `App.tsx` after `people`): goals with progress bars + inline current-value editor, quick-log composer (kind chips fact/event/emotion/note, optional date, pinned), entries grouped by kind with pinned/active toggles, collapsible "What the AI sees" preview (post + reply modes via `GET /x/me/context`). API methods in `sidepanel/api.ts`. New `docs/me-tab.md`.

**Measurement**:
- Playbook: `buildMeEffectiveness` in `src/x/playbook.ts` — posted+measured replies split by `contextSnapshot.me` present/absent, medians + lift only when BOTH sides clear `DEFAULT_MIN_CELL_N` (clone of the relationship-lift cell). Wired into `GET /x/playbook` + a "Personal context" Playbook-tab section. (Posts have no control group — the drafter always injects — so replies are the measured surface.)
- Digest: `DigestFacts.goals` (label/unit/target/current/pct array, null when no active goals) assembled in the digest route via the same helpers; Grok may narrate it (facts-only rule). Absent on previously cached digests — same contract as `rosterCoverage` (S0.7).
- MCP: curated `x_me` read + write `x_add_me_entry` (both $0, in-process `app.request`), so any Claude session can journal into the profile.

## Decisions taken

1. **Static biography stays static.** `post prompt.md` §1 is stable, cacheable, and already excellent; no byte-sync surgery. The Me layer is the *dynamic* complement injected at the tail. A `fact` entry supplements §1 (e.g. a new fact worth using) without editing templates.
2. **Replies get the brief always-on, no Settings toggle.** Precedent: `relationship` and `guidance` are always-on server stamps; the pillars toggle exists because pillars steer content, whereas the me-brief is persona continuity. "Lesser extent" is enforced structurally: ≤3 lines + an "only when it genuinely fits" instruction, not a switch.
3. **Own Me tab**, not a Settings subtab — the user framed it as a first-class surface ("Me (My Profile)"), and it hosts goals + preview, too much for Settings.
4. **Goals auto-track only what we already collect**: `followers` goals compute progress from `account_snapshots` ($0, daily getMe); `mrr`/`custom` take manual `currentValue` updates — no new data source, no external integrations.
5. **Freshness windows are opening guesses** (emotions 7d, events 30d, evergreen facts/notes, pinned overrides) — constants in `profile.ts`, revisit after ~30 days like the C1 stage thresholds.
6. **Measurement is replies-only lift** (contextSnapshot gives a with/without split); post-side effect shows up indirectly via existing views/register/pillar cells and the digest goal narration.
7. **No AI "profile writer".** Entries are human-written; Grok never generates profile content (it already fabricates biography if allowed — §7.18). The only AI touching this data is the drafters reading the rendered block.

## Done when

- [ ] Adding an emotion in the Me tab ("frustrated with the ANAF portal today") makes it appear in `GET /x/me/context?mode=post` immediately and stop appearing 7 days later; the tab's preview shows the exact block.
- [ ] A `followers` goal shows auto-computed progress from the latest account snapshot; an `mrr` goal takes a manual current value; both render with progress bars in the Me tab.
- [ ] A reply drafted via `/x/replies/generate` persists the brief in `contextSnapshot.me`; the Playbook renders a "Personal context" section (silent-until-gated below n≥20/side).
- [ ] The Sunday digest facts carry `goals` and the narration can mention progress without inventing numbers.
- [ ] `scripts/smoke-me.ts` passes at $0 (CRUD walk, windowed render, goal progress, cleanup) against a real DB.
- [ ] Both prompt byte-sync tests are untouched and green; with an empty profile every prompt is byte-identical to before this feature.

---

## Task 1: Schema + pure profile module

**Depends on:** none
**Session budget:** ~350 lines, 4 files

**Read first:** codemap header + §4 + §7.13; `src/x/db/schema.ts:464-535` (ideas/streaks — the shape to copy); `src/x/people/relationship.ts` (whole file — the render-block exemplar: instruction inside the block, `''` on empty, `oneLine`/`ago` helpers); `src/x/db/migrations/` latest file for numbering.

**Edit:**
- `src/x/db/schema.ts` — add `meEntries` + `meGoals` tables (DDL sketch in Design; indexes: `me_entries_kind_active_idx` on (kind, active), `me_goals_status_idx` on (status)).
- `src/db/migrations/0013_*.sql` — via `bun run db:generate`; inspect output (no seed INSERTs needed here, but confirm generate didn't touch migration 0000's pillar seed).
- `src/x/me/profile.ts` — new pure module.
- `src/x/me/profile.test.ts` — new pure suite.

**How:** `profile.ts` is pure (no DB, no clock reads — callers pass `now`), exporting: `ME_KINDS = ['fact','event','emotion','note']`, `GOAL_KINDS = ['followers','mrr','custom']`, window constants (`EMOTION_WINDOW_DAYS = 7`, `EVENT_WINDOW_DAYS = 30`), cap constants (post block ≤14 lines/1200 chars; brief ≤3 lines/300 chars), `ME_INSTRUCTION` (post form) and `ME_BRIEF_INSTRUCTION` (reply form) strings; `selectEntriesForPrompt(entries, now)`; `goalProgress(goal, latestFollowers, now)`; `renderMeContext(selection, goals, now)`; `renderMeBrief(selection, goals, now)`. Render shapes: goals as `Goal: 5K MRR — at 800 (16%), 45d left`; events as `3d ago: shipped the studio`; emotions as `today: frustrated with the ANAF portal`. Reuse the `oneLine`/`ago` helper shapes from relationship.ts (copy locally — no cross-module coupling for two 10-line helpers). Kind types are string unions like `Stage` in `people/stage.ts`. Timestamps in schema use `integer(..., { mode: 'timestamp_ms' })` and `$defaultFn(() => crypto.randomUUID())` for PKs, exactly like `ideas` (L470).

**Tests:** `profile.test.ts` — window boundaries (emotion at 6d in / 8d out; event 29d in / 31d out; `happenedAt` null falls back to `createdAt`), pinned overrides window AND cap, inactive excluded, caps enforced (over-cap input → truncated, never overflow), empty everything → `''` from both renders, brief ≤3 lines always, `goalProgress` (followers with/without snapshot, mrr manual, pct clamp, `daysLeft` from deadline, achieved/dropped excluded upstream — assert active-only is caller's job documented).

**Done when:**
- [ ] Fresh `:memory:` boot applies 0013; both tables exist.
- [ ] `renderMeContext`/`renderMeBrief` behave per the test matrix; both return `''` on empty input.
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(me): me_entries + me_goals schema and pure profile renderer (M1.1)`

**Cost note:** $0.

---

## Task 2: Me routes + loader + smoke

**Depends on:** Task 1
**Session budget:** ~400 lines, 5 files

**Read first:** codemap header + §3.4 + §7.8/§7.20; `src/x/routes/pillars.ts` (whole — the CRUD validation exemplar); `src/x/routes/playbook.ts` — just `loadReplyGuidanceSafe` (the safe-loader shape); `src/x/index.ts` (mount block); `src/x/routes/ideas.test.ts` (route-suite shape over the in-memory DB); `scripts/smoke-pillars.ts` (smoke shape).

**Edit:**
- `src/x/routes/me.ts` — new router (API contract in Design) + exported `loadMeContextSafe`.
- `src/x/index.ts` — `app.route('/x', me)` in the always-mounted block (near pillars; `/x/me` is a static prefix, no `:param` collision — note §7.20 checked).
- `src/x/routes/me.test.ts` — route suite.
- `scripts/smoke-me.ts` — rerunnable $0 check.
- `src/x/mcp.ts` — NOT here (Task 6).

**How:** Copy pillars.ts validation style: parse body defensively, per-field 400 error codes, `patch` object with `updatedAt: new Date()`. `GET /x/me` computes each goal's `progress` by loading the latest `account_snapshots` row once (`orderBy desc capturedAt limit 1` — see how `voice.ts` targets read "my size") and calling `goalProgress`. `GET /x/me/context` and `loadMeContextSafe` share one internal `renderFor(mode)`: load `active=1` entries + `status='active'` goals + latest followers, run `selectEntriesForPrompt` → `renderMeContext`/`renderMeBrief`. `loadMeContextSafe` wraps in try/catch, returns null on `''` or error with `console.error('me: context load failed (draft proceeds without it):', …)` — never throws (§7.8). `happenedAt` accepted as ISO string, stored as Date (sync driver: never bind a raw Date in `sql` templates — use Drizzle column ops only, §7.13). Smoke script: against the real DB via `app.request` in-process (smoke-pillars.ts pattern) — create entries of each kind + one followers goal + one mrr goal, assert GET shapes + context renders + windows (insert an old event via PATCH happenedAt), then delete everything it created.

**Tests:** `me.test.ts` — entry CRUD happy path + every 400 code + 404s; goal CRUD incl. status flips and `currentValue` PATCH; followers-goal progress over a seeded far-future `account_snapshots` row (clean up after — shared in-memory DB, other suites assert exact numbers); `GET /me/context` both modes, null block on empty; `loadMeContextSafe` returns null on empty profile.

**Done when:**
- [ ] Full CRUD round-trips over `app.request`; context endpoint returns the rendered block.
- [ ] `bun scripts/smoke-me.ts` passes and leaves no rows behind.
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(me): /x/me routes, context preview, loadMeContextSafe + smoke (M1.2)`

**Cost note:** $0 — pure SQL, always-mounted, no Grok, no X.

---

## Task 3: Inject into the three draft pipelines

**Depends on:** Task 2
**Session budget:** ~250 lines, 6 files

**Read first:** codemap header + §7.14–16; `src/x/posts/prompt.ts:268-295` (`BuildPostDraftOptions`/`buildPostDraftInput` — the guidance tail pattern); `src/x/routes/drafter.ts:160-175` (where guidance loads); `src/x/replies/prompt.ts:29-50` (PostContext server-stamped fields), `:302-331` (batch tail), `:392-425` (single tail); `src/x/routes/replies.ts:190-205` (stamp block) and `:376-392` (batch guidance load); `src/x/people/relationship.test.ts` (tail-placement test shape).

**Edit:**
- `src/x/posts/prompt.ts` — `BuildPostDraftOptions.meContext?: string`; append in `buildPostDraftInput` before `guidance`.
- `src/x/routes/drafter.ts` — in `generateAndInsert`: `const meContext = await loadMeContextSafe('post')`, pass through (both `/posts/draft` and `/posts/reup` flow here — one edit covers both).
- `src/x/replies/prompt.ts` — `PostContext.me?: string` (JSDoc: server-stamped, C3 discipline); append in `buildGrokInput` between relationship and guidance; `buildBatchGrokInput(tweets, idea, systemOverride, pillarDefs, guidance, meBrief?)` appends `meBrief` once after guidance.
- `src/x/routes/replies.ts` — single path: stamp `ctx.me` right after the relationship stamp (~L197) via `loadMeContextSafe('reply')`; batch path: load once (~L390) and pass as the new arg. `contextSnapshot` already persists the whole ctx — verify no field-picking on insert strips `me`.
- Tests: `src/x/me/profile.test.ts` or a new `src/x/replies/prompt.test.ts` additions (see below).

**How:** Mirror C3 exactly. `parseContext` (replies.ts L924) builds the ctx object field-by-field — `me` is simply never read from the client; do NOT add it there. The template literals (`POST_PROMPT_TEMPLATE`, `REPLY_PROMPT_TEMPLATE`) and both `.md` files must not change — byte-sync tests are the tripwire. Empty/null meContext → zero change to the rendered prompt (assert byte-equality in tests). Batch brief rides once because it describes me, not the 25 targets.

**Tests:** tail placement in all three builders (block present at the END, after the idea/steer content); absent → prompt byte-identical to pre-feature output; `parseContext` given a client `me` field → parsed ctx has no `me`; batch: meBrief appears exactly once. Existing byte-sync tests stay green untouched.

**Done when:**
- [ ] All three pipelines inject when the profile has fresh content and are byte-identical to today when it doesn't.
- [ ] A generated reply draft's `contextSnapshot.me` records the brief (route test over in-memory DB can assert the stamp on ctx before insert).
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(me): inject personal context at the variable tail of post + reply prompts (M1.3)`

**Cost note:** +~150–500 tail tokens per EXISTING Grok call (~+$0.0005–0.001); no new calls. Prefix caching unaffected (tail injection).

---

## Task 4: Extension Me tab  [parallel-ok with Task 3 after Task 2]

**Depends on:** Task 2
**Session budget:** ~400 lines, 5 files

**Read first:** codemap header + §5; `extension/src/sidepanel/Pillars.tsx` (edit/save/toggle list exemplar); `extension/src/sidepanel/Ideas.tsx` (quick-add + lifecycle list exemplar); `extension/src/sidepanel/api.ts` (method shape — everything through background ApiRequest); `extension/src/sidepanel/App.tsx` (tab registry); `docs/voice-tab.md` (doc shape).

**Edit:**
- `extension/src/sidepanel/api.ts` — `me` methods: `get()`, `context(mode)`, `addEntry/patchEntry/deleteEntry`, `addGoal/patchGoal/deleteGoal`.
- `extension/src/sidepanel/Me.tsx` — new tab component.
- `extension/src/sidepanel/App.tsx` — register tab `me` (label "Me") after `people`.
- `extension/src/sidepanel/styles.css` (or the existing style location) — progress-bar styles if none reusable.
- `docs/me-tab.md` — new doc.

**How:** Three sections. (1) **Goals**: card per active goal — label, progress bar (`progress.pct`), current/target/unit, `daysLeft` when deadlined; followers goals show "auto · from daily snapshot" and no value editor; mrr/custom get an inline current-value input PATCHing on blur; buttons: achieved / dropped / delete; add-goal form (label, kind select, target, unit, deadline). (2) **Quick log**: one text input + kind chips (fact/event/emotion/note) + optional date + pinned checkbox → `addEntry`; emotions default to today. (3) **Entries** grouped by kind, newest first: pinned star toggle, active toggle (retire, not delete), inline edit, delete; stale-by-window entries rendered dimmed with a "not injected anymore" hint, driven by the server-computed `inWindow` flag from `GET /x/me` (Task 2) — never re-derive windows client-side (§7.27 spirit). (4) **"What the AI sees"**: collapsible, two sub-blocks fetching `GET /x/me/context?mode=post` and `mode=reply`, monospace render, refetch on any mutation.

**Tests:** none required in the extension beyond `bun test` staying green (no shared pure module added); the behavioral check is manual over the loaded-unpacked extension.

**Done when:**
- [ ] Me tab loads, all CRUD paths work against the live server, preview shows the block and updates after edits.
- [ ] A followers goal renders auto progress; an mrr goal takes a manual value.
- [ ] `docs/me-tab.md` written; `bun test` + `bun run typecheck` + `bun run lint` green (both roots — extension has its own tsconfig via the composite build).
- [ ] Committed: `feat(me): Me tab — goals, quick log, entries, AI-view preview (M1.4)`

**Cost note:** $0 — reads/writes the always-mounted $0 routes only.

---

## Task 5: Measurement — playbook lift cell + digest goals fact  [parallel-ok with Task 4]

**Depends on:** Task 3
**Session budget:** ~300 lines, 6 files

**Read first:** codemap header + §7.19 + §10 "New measurement"; `src/x/playbook.ts` — the relationship-lift builder (with/without split over `contextSnapshot.relationship`) and `buildIdeaEffectiveness` (S0.8, the latest lift exemplar); `src/x/routes/playbook.ts` — the corresponding loader + where sections wire into `GET /playbook`; `src/x/digest.ts:73-161` (`DigestFacts` + assembly — `rosterCoverage` is the add-a-fact precedent); `src/x/routes/digest.ts` (facts computed route-side); `extension/src/sidepanel/Playbook.tsx` (section render shape).

**Edit:**
- `src/x/playbook.ts` — `buildMeEffectiveness(rows)`: posted+measured replies bucketed by `contextSnapshot.me` present/absent → medians (views, profileVisits) per side + `viewsLift`/`profileVisitsLift` via the shared `ratio()` only when BOTH sides ≥ `DEFAULT_MIN_CELL_N`.
- `src/x/routes/playbook.ts` — feed it from the already-loaded reply rows (the relationship-lift loader reads the same rows — no new query, S0.5 `toLatencyRows` precedent); wire `meEffectiveness` into the `GET /playbook` payload (`minN` knob flows through).
- `src/x/digest.ts` — `DigestFacts.goals: Array<{label, unit, target, current, pct}> | null`.
- `src/x/routes/digest.ts` — assemble it from active `me_goals` + latest `account_snapshots` via `goalProgress`; the narration prompt already narrates only the FACTS block, so no prompt change.
- `extension/src/sidepanel/Playbook.tsx` — "Personal context" section (with/without table + gated lift line, silent-until-gated note).
- Tests: `src/x/playbook.test.ts`, `src/x/routes/playbook.test.ts`, `src/x/digest.test.ts`, `src/x/routes/digest.test.ts` additions.

**How:** Straight clone of the relationship-lift cell reading `me` instead of `relationship` from the same parsed snapshot JSON. Digest: goals fact is null (not `[]`) when no active goals — narration skips per the no-fabrication rule; cached pre-M1 digests simply lack the key (S0.7 contract). Do NOT backfill anything — with/without splits populate naturally as drafts accrue.

**Tests:** builder — bucketing, gate (19/20 boundary), lift only when both sides clear, partition invariant (`with.n + without.n === totalMeasured`); route — a seeded reply with `contextSnapshot.me` lands in the with-bucket (clean up — shared in-memory DB); digest — facts shape + null-when-no-goals + passthrough in the route (facts-only path, no Grok in tests).

**Done when:**
- [ ] `GET /x/playbook` carries `meEffectiveness`; Playbook tab renders the section gated.
- [ ] `GET /x/digest?factsOnly=true` carries `goals` with computed progress.
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(me): playbook personal-context lift + digest goals fact (M1.5)`

**Cost note:** $0 — read-time SQL over already-billed data; digest narration cost unchanged (~$0.01/week, cached).

---

## Task 6: MCP tools — x_me + x_add_me_entry  [parallel-ok with Tasks 4–5]

**Depends on:** Task 2
**Session budget:** ~150 lines, 3 files

**Read first:** codemap header + §3.3 `x/mcp.ts` row + §6; `src/x/mcp.ts` (a curated tool — e.g. `x_brief` — and a write tool — `x_add_idea` — as exemplars); `src/mcp.test.ts` (round-trip test shape incl. the tool-count assertion); `scripts/smoke-mcp.ts`.

**Edit:**
- `src/x/mcp.ts` — curated `x_me` (in-process `app.request('/x/me', …)` with forwarded bearer) + write `x_add_me_entry` (`{kind, text, happenedAt?, pinned?}` → POST `/x/me/entries`; zod schema restricts `kind` to the four values — a smuggled field is stripped by the schema, `x_draft_post` discipline).
- `src/mcp.test.ts` — update the tools/list count (16→18) + one round-trip per new tool.
- `scripts/smoke-mcp.ts` — extend the $0 walk with the two tools.

**How:** Both tools are $0 by construction (pure-SQL routes). No `x_add_me_goal` — goals are deliberate, low-frequency, human decisions made in the tab (and a wrong target would steer every draft). Journal-style entry capture from any Claude session is the use case.

**Tests:** list shows 18 tools; `x_add_me_entry` lands a row readable via `x_me`; invalid kind rejected at the schema layer.

**Done when:**
- [ ] Round-trip green over `app.request` JSON-RPC; smoke-mcp extended and passing.
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(me): x_me + x_add_me_entry MCP tools (M1.6)`

**Cost note:** $0 by construction — neither tool can reach a billed path.

---

## Task 7 (final): docs-sync

**Depends on:** all prior.

- [ ] `scripts/smoke-me.ts` exists (Task 2) — re-run once against the real DB as the final check.
- [ ] CLAUDE.md: one phase-style entry "**Me layer M1 (2026-07-XX, $0 recurring; ~+$0.001/draft)**" — what shipped, the always-on-replies decision, the freshness-window opening guesses, the "done when" tails still pending live observation.
- [ ] PLAN.md: one line in the phased-build section pointing at `plans/2026-07-16-me-profile.md` (this feature has no canonical plan doc of its own; this file is it — flip its Status header to shipped).
- [ ] `docs/me-tab.md` written (Task 4); `docs/playbook-tab.md` updated with the new section (Task 5).
- [ ] `.claude/skills/plan-feature/references/codemap.md`: §2 (plans row if listed), §3.3 (me/profile.ts), §3.4 (me.ts routes), §4 (2 new tables, migration 0013), §5 (Me tab), §6 (18 tools), §9 (smoke-me) — header re-stamped to the new commit.

## Out of scope (do NOT build)

- Any AI generation of profile content (no "draft my bio with Grok") — §7.18; entries are human-written only.
- External goal integrations (Stripe/MRR APIs, analytics) — manual `currentValue` only.
- A Today-tab goals card — the Me tab and the Sunday digest cover it; revisit only if the digest narration proves the demand.
- Per-entry channel tags / pillar links — keep the profile flat; channels organize content, not the self.
- Injecting the me-block into icebreakers, digest narration prompts, or pillar drafting — posts + replies only in M1.
- A Settings toggle for reply injection — decision 2; don't add plumbing "just in case".
- Editing `post prompt.md` §1 or any template literal — tail injection only.

## Risks / watch items

- **Freshness windows are guesses** (7d emotions / 30d events) — revisit after ~30 days of real entries, C1-threshold spirit.
- **Emotional bleed in replies**: if the brief makes replies weirdly confessional, the fix is the `ME_BRIEF_INSTRUCTION` wording (or dropping emotions from the brief), not a toggle — watch the first ~20 drafted replies.
- **Token creep**: the post block is hard-capped, but a hoarder profile (50 pinned entries) pins at the cap forever — the caps are the guard; the preview makes it visible.
- **"Done when" tails needing live observation**: the first post draft that visibly uses a same-week event; the first gated `meEffectiveness` cell (needs ≥20 measured replies per side — months away, like every lift).
- **Shared in-memory DB in tests**: both new route suites seed `account_snapshots` — clean up, other suites assert exact medians (§9 warning).
