# MASTERPLAN — unified execution order for the 19 feature plans

> **Created:** 2026-07-17. Combines every plan in `plans/` into one dependency-correct
> execution order with per-task reasoning levels and parallel lanes.
> **Extended 2026-07-25:** Wave 6 (SC / GT / JD — the x-builder-derived backlog plans).
> **Extended 2026-07-28:** Wave 7 (HM / RC — the two Radar follow-up plans).
> **Extended 2026-08-17:** Wave 8 (RA — Radar access from a Claude Code session). This
> RE-OPENS the masterplan, closed at RC.5 since 2026-07-28; STATE.md's ledger and its
> stale "current state" numbers are re-opened by RA.1 (see the Wave 8 rationale).
> **Extended 2026-08-24:** Wave 9 (OU — the Outliers advanced-search query builder). This
> re-opens the masterplan a second time, closed at RA.8 since 2026-08-18; the ledger and the
> now twice-stale "current state" numbers are re-opened by OU.1 (see the Wave 9 rationale).
> **Execution state lives in `.claude/skills/masterplan/STATE.md`** — this file is the
> static plan; never mark progress here.
> **Driven by the `/masterplan` skill** — one task per session, codemap-first, state
> updated after every task.

## Plan legend (short codes → source files)

| Code | Plan file | Tasks | One-liner |
|---|---|---|---|
| UI | `2026-07-17-ui-overhaul-settings-moat.md` | 17 | Design-system UI + server settings registry (the moat) |
| RU | `2026-07-16-radar-reply-unification.md` | 10 | 3-variant drafting, radar→reply_drafts confirm, on-page chips, manual add |
| N  | `2026-07-16-niche.md` | 9 | Niche entity: persona/beliefs/doctrine DB-backed, pillar/channel ownership, wizard |
| ME | `2026-07-16-me-profile.md` | 7 | Me layer: facts/events/emotions/goals injected at prompt tails |
| AI | `2026-07-17-ai-layer.md` | 13 | DB prompt overrides, OpenRouter second provider, thread/rewrite/ideas surfaces |
| RL | `2026-07-16-reply-lists.md` | 8 | Canned reply lists: templates, anti-repeat, humanizer, AI generator |
| AX | `2026-07-16-augmented-x-ui.md` | 7 | Timeline person chips + tweet-page context panel |
| NT | `2026-07-16-notifications.md` | 7 | Notifications-page augment + like/repost/follow engagement harvest |
| HV | `2026-07-17-harvest-enhancements.md` | 6 | Passive timeline harvest + affinity + funnel + Harvest tab options |
| GR | `2026-07-17-guardrails.md` | 10 | Following curation queue, activity monitor, goals/commitments/scorecard |
| A3 | `2026-07-17-authoring-3.md` | 15 | Audience-aware slots, manual publishing, DM drafts, the Writer |
| ST | `2026-07-16-studio-2.md` | 9 | Studio 2.0: mascot, 6 new templates, patterns, presets |
| SC | `2026-07-22-static-coach.md` | 9 | Deterministic pre-publish coach, format classifier, fitted reach band |
| GT | `2026-07-22-mika-growth-tactics.md` | 9 | Reciprocity lane, reply-bait formats, launch seeding, milestone nudge, cooldown |
| JD | `2026-07-22-llm-judge.md` | 8 | On-demand 13-dimension draft judge, anchored fixes, falsification cell |
| HM | `2026-07-28-project-humanizer.md` | 5 | Project-level humanizer: server-owned jitter config + Radar humanize-at-pick |
| RC | `2026-07-28-radar-curated-drafting.md` | 5 | Radar curation: score the queue, dismiss the noise, draft the top N |
| RA | `2026-08-17-radar-access.md` | 8 | Swept sightings mirrored to the server + MCP read/draft tools + the radar-analyst skill |
| OU | `2026-08-03-search-query-builder.md` | 8 | Outliers: X advanced-search compiler, clipboard hand-off, saved hunts (revised 2026-08-24) |

Task IDs are `<code>.<n>` matching "Task n" in the source plan. **The source plan's task
block is the implementation spec** — this file only fixes order, reasoning level, and
the cross-plan adaptations below.

## Reasoning-level rubric

- **high** — well-exemplared work: CRUD routes copying pillars.ts, panel tabs copying an
  existing tab, pure modules with a named exemplar, docs-sync tasks. The plan block +
  exemplar files carry the implementer.
- **xhigh** — cross-file integration with traps: migrations + reconcile state machines,
  fragile DOM injection, money-adjacent paths, background/session-writer machinery,
  big rewrites, anything where a subtle mistake passes tests but breaks an invariant.
- **max** — the five tasks where an error corrupts a shared substrate that everything
  downstream builds on: the prompt-template surgery chain (N.3, N.4, AI.3, AI.5) and
  the publisher-adjacent manual-publish core (A3.5). For these, re-derive the plan's
  task block against the *current* code before editing — the plans were written before
  any of them landed, and each earlier chain task changes the ground the next stands on.

## Global rules (read before every task)

1. **Migration numbers are assigned at implementation time.** Six plans each say
   "migration 0013". Ignore the number in the plan text; always `bun run db:generate`
   against the current journal and inspect the SQL (drizzle drops seed INSERTs — codemap §4).
   Migration-generating tasks are **never run in parallel lanes** (journal conflicts).
2. **The prompt-surgery chain is strictly serial:**
   `RU.1 → N.3 → N.4 → ME.3 → AI.3 → AI.5`. Each edits `post prompt.md` /
   `reply prompt.md` / their TS literals / `buildGrokInput`/`buildBatchGrokInput`.
   Each later task must read the templates *as they exist after the previous one*,
   not as its plan quotes them (RU.1 renames the `## The two variants` heading that
   N.4's voiceBlock slice bounds on; AI.5's batch-template parity fixture must be built
   from the post-N, post-RU output).
3. **Hot files serialize across plans** (see STATE.md hot-file locks): `extension/src/content.ts`,
   `extension/src/sidepanel/Settings.tsx`, `extension/src/harvester.ts`, `src/x/playbook.ts` +
   `src/x/routes/playbook.ts`, `extension/src/sidepanel/Composer.tsx`, `src/x/routes/replies.ts`,
   the migrations journal. Two lanes may run concurrently only when neither touches a
   file the other owns.
4. **Codemap discipline:** every task ends by updating the touched sections of
   `.claude/skills/plan-feature/references/codemap.md` and re-stamping its header —
   per task, not just at each plan's docs-sync task. The next session reads the codemap
   instead of the repo; a stale map poisons every task after it.
5. **State discipline:** every task ends by updating `.claude/skills/masterplan/STATE.md`
   (status, commit sha, deviations/gotchas). Both files ride the task's own commit.
6. **Each plan's final docs-sync task still runs** — it writes CLAUDE.md phase entries,
   docs/, PLAN/CIRCLES/SURFACES status, and the smoke script verification. The per-task
   codemap updates make it a verification pass, not a catch-up.

## Cross-plan adaptations (the deviations register seed — full log in STATE.md)

- **D1 — `app_settings` lands once.** UI.1 creates it (shared schema). AI.2 must REUSE it
  (skip its table migration; keep its `src/llm/settings.ts` reading key `'ai'` through the
  UI.1 store or its own thin reader — do not create a second table or a second migration).
- **D2 — Doctrine has one owner: the niche.** N.5 makes the 5 doctrine knobs (reply target
  min/max, week reply %, band min/max ×) live on `niches.doctrine`. UI.2's doctrine group
  must NOT duplicate them in `app_settings` — its doctrine `SettingDef`s either read/write
  through the active niche's doctrine JSON, or those 5 keys are dropped from the registry
  and the Settings UI links to the Niche card. Decide at UI.2 time; record the choice.
- **D3 — Batch prompt lifecycle:** RU.1 renames `VOICE_BLOCK_END` to `'## The three variants'`;
  N.4 substitutes `{{REPLY_PERSONA}}` inside the sliced block; AI.5 then retires slicing
  entirely with a standalone `REPLY_BATCH_PROMPT_TEMPLATE` whose parity fixture is the
  *current* (post-RU, post-N) build output. AI.5's anti-drift test asserts against defaults
  containing the niche placeholder.
- **D4 — One goals system, not two.** ME.1 creates `me_goals` (followers/mrr/custom, prompt
  grounding). GR.7 plans a separate `goals` table (followers/posted_replies/originals,
  pacing/scorecard). **Merge:** GR.7 extends `me_goals` with `baseline_value`, `baseline_at`,
  the two new metric kinds, and the `missed` status instead of creating a new table; its
  pure `goalPacing` consumes the merged shape; the digest carries ONE goals fact. If the
  merge proves ugly in practice, record the fork decision in STATE.md before building two tables.
- **D5 — After AI lands, new Grok calls go through `askLLM`.** A3.9 (DM) and A3.12 (article
  assist) are written against `askGrok` + `XAI_API_KEY` checks; since AI.2/AI.6 land first,
  they must use `askLLM` + `llmConfigured()` 503s instead, and their prompts should register
  in the prompt registry (keys `dm`, `article`) so the Prompts editor covers them. Refusal-ladder
  order (404 → 422 → 503 → spend) is unchanged.
- **D6 — Settings.tsx churn is expected.** N.7 (Niche card), AI.10/11 (AI + Prompts subtabs),
  HV.2 / A3.3 (toggles), GR.8 (commitments) all add to Settings before UI.11 rebuilds the whole
  tab. Keep feature-level Settings UI minimal and idiomatic — UI.11 absorbs and restyles them all.
- **D7 — UI.10 primitives arrive in Wave 0** so every NEW tab/card built in Waves 1–4 (Me tab,
  Niche card, week board, Following subtab, Goals card, Prompts editor…) uses `Section`/
  `EmptyState`/`SubTabs`/`SettingRow` and the `--strat-*` tokens from day one. The Wave-5
  polish passes (UI.12–15) then only touch pre-masterplan tabs.
- **D8 — UI's "coming soon" manifest must be pruned at UI.11 time**: by Wave 5 most of the 11
  planned features are shipped; only still-unbuilt ones render as inert groups.
- **D9 — AX.3 removes the band stats pill before NT/RU on-page work** builds near it; content.ts
  tasks run in the fixed order AX.3 → AX.5 → RU.7 → RU.8 → NT.5 → HV.2 → A3.3 (single lane).
- **D10 — Knob registry groups (UI.3–5) run in Wave 5**, after RU/HV/GR/A3 exist, so the
  registry catalogs the FINAL constant set (radar caps, passive-harvest caps, unfollow cadence,
  monitor thresholds, manual-alarm windows) instead of being retrofitted.

**Wave-6 seeds** (numbered D141+ — UI.17 minted **D140** as the masterplan's closing
deviation, so the seeds start after it; STATE continues from D145):

- **D141 — Composer.tsx is Wave 6's choke point.** Four tasks add blocks to it, in one
  fixed serial lane: **SC.3 → SC.6 → SC.8 → JD.6**. Each later task reads the Composer
  *as the previous one left it* (the coach column, cooldown chip and reach line all sit
  under the textarea; the judge block lands below the AI.8 rewrite section). No GT task
  touches Composer (GT.5 is skipped per D142; GT.4's "draft it" button lives in Today.tsx).
- **D142 — GT.5 is superseded by SC.6, never build it.** Both plans document the collision
  (SC plan header: "SC.6 supersedes that task"). The format classifier reads the text, so
  SC.6's cooldown covers hand-written posts — the register/pillar-keyed GT.5 cannot. GT.5
  is `[s]` in the ledger from day one; GT.9's smoke drops its cooldown assertion (SC.9's
  smoke owns cooldown arithmetic); the `GET /x/posts/cooldowns` route is built once, by SC.6.
- **D143 — `src/x/replies/*` serializes.** GT.1 → JD.1 in that order: both edit
  `src/x/replies/prompt.ts`, and JD.1's requirement that the byte-synced templates stay
  *unchanged* must be checked against the post-GT.1 templates, not the pre-edit ones.
  Likewise GT.6 → GT.8 (both edit `routes/replies.ts`). GT.1/GT.2 are the wave's only
  byte-sync prompt edits — regenerate the TS literals with the .md in the same commit.
- **D144 — SC.10/SC.11 are referenced, not scheduled.** The JD plan assigns two follow-ups
  to the SC plan (`scoreDraft` as a drafter structural validator with one conditional
  retry; a `format` parameter on the drafter). No task blocks exist for them, so they are
  NOT in Wave 6 — write them into the SC plan first if wanted, then append to the wave.

**Wave-7 seeds** (numbered D172+ — JD.8 minted **D171** as Wave 6's closing deviation,
so the seeds take D172–D174; STATE continues from D175):

- **D172 — Radar.tsx (with `sidepanel/api.ts` + `shared/types.ts`) is Wave 7's choke
  point.** Both plans rework the same pick path: HM.3 replaces the `copied` boolean with
  `pickNote`, threads a `humanizer` prop into `RadarRow` and adds `api.humanizer.*`;
  RC.4 refactors `draftReplies` into `sendBatch(rows, scoreById?)` and adds the second
  header button + `api.replies.curate`. Fixed serial order **HM.3 → RC.4** — RC.4 reads
  Radar.tsx *as HM.3 left it*, not as its plan quotes it (the RC plan already flags its
  line offsets as planning-time reads). Interaction to preserve, not duplicate: curation
  only changes **which rows get drafted**; picks on curated drafts still flow through
  HM.3's `onPick`, so curated picks are humanized for free — do NOT add jitter inside
  `curateAndDraft`.
- **D173 — RC.2 is the wave's only migration and runs alone.** Rule 1 applies: the plan
  says `0025` and the journal is currently free from `0025` (STATE), but the number is
  assigned by `bun run db:generate` at implementation time — generate against the current
  journal and inspect the SQL for dropped seed INSERTs either way. HM needs **no**
  migration: one raw `app_settings` key `'humanizer'` (the D1 `'ai'` precedent — NOT a
  registry key; the UI.1 store and `settings/registry.ts` never touch it).
- **D174 — the two closing docs-sync tasks collide, and the plans' repo counts are
  planning-time snapshots.** HM.5 and RC.5 both write `docs/radar-tab.md`,
  `docs/PHASE-HISTORY.md` and the codemap header: serial, **HM.5 → RC.5**, the second
  re-stamp wins. Every count the task blocks assert (prompt keys 15→16, radar knob group
  1→2 / registry 61→62 / mirrored 27→28, tsconfig shims 6→7, smoke scripts 31→33, suite
  1855+) is re-derived from the current code at implementation time, never copied from
  plan text. D171a binds both closers: pick-time jitter and the lowValue drop rule are
  SELECTION RULES — their user-facing paragraphs go in the tab docs of the surfaces that
  render them (`radar-tab`, `settings-tab`, `replies-tab`), not only in PHASE-HISTORY.

### Wave-8 seeds (RA — D185–D187)

- **D185 — `bandStickiness` gets one owner at RA.1.** The ratchet moves from
  `extension/src/shared/radar.ts` into `src/shared/radarSweep.ts` (§7.27: the page and the
  server must not hold two copies of a rule they both apply), and `RadarBand` stays in the
  extension module as a **type alias** of the shared union so no importer changes. Any later
  task needing a band comparison imports it; `evictionWeight` stays extension-side (it is a
  display rule about cap pressure, not a shared verdict). Verify with
  `grep -rn "function bandStickiness" src extension` → exactly one hit.
- **D186 — the composed-draft contract is `draftRowToSighting`, and no test in the repo
  guards it for you.** `extension/src/shared/radar.ts:548` returns `null` when a
  `radar_drafts` row has a null `band` or null `signals`, so RA.4's compose route MUST stamp
  both server-side from the stored sighting (§7.16) or the feature ships invisible — green
  tests, empty panel. Same task, same reason: compose flips that tweet's prior `ready` rows
  to `expired` inside its txn, because `radar_drafts` now has **two** writers (the Grok batch
  and the MCP compose) racing the panel's "newest ready row wins" rehydrate.
- **D187 — the sighting feed's kill switch is a browser toggle, NOT a registry knob.**
  `chrome.storage.local['radarSightingSync']`, default ON / absent = enabled — the HV.2
  `passiveHarvest` precedent. So RA.2 owes none of STATE.md's seven-edit mirrored-knob move,
  and `docs/settings-tab.md`'s three count strings stay unchanged (confirm, don't assume).
  The corollary for RA.8: the only doc counts this wave bumps are the MCP ones (25 → 28,
  `src/mcp.test.ts` + `docs/s2-mcp-server.md`, in the same commit as each tool), the table
  count (42 → 43) and the migration head (`0028` → `0029`).

### Wave-9 seeds (OU — D195–D197)

- **D195 — the plan's `[parallel-ok]` tag on OU.7 is WRONG; `Outliers.tsx` serializes
  OU.5 → OU.6 → OU.7.** The plan file marks Task 7 parallel with Task 6 because it reads as a
  server-and-content-script task, but its last bullet renders the capture-count footer *in the
  tab*, so all three tasks write the same component. Either serialize them (the default) or
  move the footer render into OU.6 and leave OU.7 purely server+content — decide once, in
  OU.6's commit, and say which in STATE.md. This is the RC/HM `Radar.tsx` situation (D172)
  repeating: a plan sizes tasks by concern, the masterplan sizes lanes by file.
- **D196 — OU.1 owes the re-opening, and STATE.md's `current state` line is stale in two
  places I can already name.** RA.1 is the worked example and the one thing worth copying is
  that it **recounted** instead of carrying the line forward. Two numbers have moved since
  RA.8 and neither is in STATE.md: the migration head is **`0030_famous_wrecker`** (RQ.1,
  2026-08-19 — `radar_sightings.dismissed_at`), so **the journal is free from `0031`, not
  `0030`**; and the registry is **63 knobs / 33 mirrored**, not 61/31 (SW.1 added
  `x.sweep.media` + `x.sweep.excludeAds`, both mirrored). The codemap is authoritative for
  both. Recount the rest (suite, tables, MCP, smoke scripts, shims) off the running code
  anyway — that is the whole point of the exercise.
- **D197 — the `/search` passive-harvest temptation is refused for the third time.** OU.7
  stamps `voice_tweets.source` from a client-reported path; the obvious "improvement" is to
  widen `isHomeTimelinePath` so `harvest_rows` also fills from a search-results page. HV.2
  decision 2 defines that corpus as *what the algorithm fed me* — `loadTimelineFunnel` and
  `GET /harvest/affinity` both read it that way — and RA.6 already declined to widen it after
  diagnosing the passive-capture stop. Widening owes a provenance column and a review of both
  readers, i.e. its own plan. Third refusal; record it, don't re-litigate it.

---

## Wave 0 — Foundations (3 parallel lanes, start immediately)

Rationale: the settings platform unblocks AI.2; tokens + primitives make every later UI
task land in the design system once instead of being repainted in Wave 5; the Studio is a
sealed lane (touches only `extension/src/studio/*`, `sidepanel/Studio.tsx`, one `assets.ts`
whitelist line) that can trail alongside any wave.

**Lane A — server**
| Order | ID | Task | Depends | Reasoning |
|---|---|---|---|---|
| 0.1 | UI.1 | Settings platform: `app_settings`, store, registry core, `/x/settings` routes | — | **xhigh** |

**Lane B — panel CSS/system**
| Order | ID | Task | Depends | Reasoning |
|---|---|---|---|---|
| 0.2 | UI.8 | Design tokens + dark refactor of styles.css | — | high |
| 0.3 | UI.9 | Light theme + Appearance settings (theme/density/scale) | UI.8 | high |
| 0.4 | UI.10 | UI primitives + grouped tab rail | UI.8 | **xhigh** |

**Lane C — studio (background lane; may trail into later waves)**
| Order | ID | Task | Depends | Reasoning |
|---|---|---|---|---|
| 0.5 | ST.1 | Engine: path/panel/pattern layers + seeded PRNG | — | high |
| 0.6 | ST.2 | Studio shell refactor (template registry) | — | high |
| 0.7 | ST.3 | Cloud mascot + kit toggle | ST.1, ST.2 | high |
| 0.8 | ST.4 | Background patterns + theme presets | ST.1, ST.2 | high |
| 0.9 | ST.5 | Milestone + streak cards (+ asset kinds, metrics.account client) | ST.3, ST.4 | high |
| 0.10 | ST.6 | Code/terminal card + mono font | ST.1, ST.2 | high |
| 0.11 | ST.7 | Thread cover + list card + Composer seed handoff | ST.2, ST.3 | high |
| 0.12 | ST.8 | Chart card (growth + heatmap) | ST.1, ST.2, ST.5 | high |
| 0.13 | ST.9 | Studio docs-sync + smoke + browser verification | all ST | high |

Note: ST.7 touches `Composer.tsx` — hold it until no Wave-1/4 task owns that file.

---

## Wave 1 — Prompt & identity core (the serial spine of the whole masterplan)

Rationale: everything the product generates flows through these templates and loaders.
Land the smallest prompt edit first (RU 3-variants), then the structural extraction
(niche), then the tail layer (me), then the registry that wraps it all (ai-layer).
Doing these later would mean rewriting them around each other twice.

| Order | ID | Task | Depends | Reasoning |
|---|---|---|---|---|
| 1.1 | RU.1 | Reply Master → 3 variants (prompt + VOICE_BLOCK_END rename) | — | **xhigh** |
| 1.2 | RU.2 | Migration: reply source + radar draft variants/model/link columns | — | high |
| 1.3 | RU.3 | Batch endpoint → 3 variants per tweet | RU.1, RU.2 | **xhigh** |
| 1.4 | N.1 | Niche schema, migration, defaults (verbatim persona lift), store | — | **xhigh** |
| 1.5 | N.2 | Niche CRUD + activation ratchet + `x_niche` MCP | N.1 | high |
| 1.6 | N.3 | Post prompt persona/beliefs extraction (equivalence test) | N.1, after RU.1 | **max** |
| 1.7 | N.4 | Reply prompt persona extraction + niche snapshot stamp | N.1, RU.1, RU.3 | **max** |
| 1.8 | N.5 | Doctrine knobs → brief, targets, consumers | N.1 | high |
| 1.9 | N.6 | Pillars + channels niche ownership + `no_pillars_for_niche` refusal | N.1, N.2 | **xhigh** |
| 1.10 | N.7 | Settings Niche card + api client | N.2 | high |
| 1.11 | N.8 | Niche wizard (Grok, proposal-only) | N.2, N.7 | high |
| 1.12 | N.9 | Niche docs-sync + smoke | all N | high |
| 1.13 | ME.1 | `me_entries` + `me_goals` schema + pure profile renderer | — | high |
| 1.14 | ME.2 | `/x/me` routes + `loadMeContextSafe` + smoke | ME.1 | high |
| 1.15 | ME.3 | Inject me-context at all three prompt tails | ME.2, after N.4 | **xhigh** |
| 1.16 | ME.4 | Me tab | ME.2 | high |
| 1.17 | ME.5 | Playbook me-lift cell + digest goals fact | ME.3 | high |
| 1.18 | ME.6 | MCP `x_me` + `x_add_me_entry` | ME.2 | high |
| 1.19 | ME.7 | Me docs-sync | all ME | high |
| 1.20 | AI.1 | OpenRouter client (parallel-ok from Wave 0) | — | **xhigh** |
| 1.21 | AI.2 | AI settings store + `askLLM` dispatcher + `/llm` routes (**D1**: reuse UI.1's table) | AI.1, UI.1 | **xhigh** |
| 1.22 | AI.3 | Prompt registry + overrides, wired into reply + post drafting | after ME.3 | **max** |
| 1.23 | AI.4 | `/x/prompts` routes (edit/reset/restore) | AI.3 | high |
| 1.24 | AI.5 | Batch/voice-extract/pillar-draft into registry; retire slicing (**D3**) | AI.2, AI.3 | **max** |
| 1.25 | AI.6 | Digest + icebreaker into registry; XAI gate → LLM gate | AI.2, AI.3 | **xhigh** |
| 1.26 | AI.7 | Thread drafter (prompt + route + Composer) | AI.2, AI.3, AI.5 | **xhigh** |
| 1.27 | AI.8 | Rewrite assist | AI.2, AI.3 | high |
| 1.28 | AI.9 | Idea generator | AI.2, AI.3 | high |
| 1.29 | AI.10 | Settings AI subtab + restore-defaults | AI.2, AI.4 | high |
| 1.30 | AI.11 | Prompts editor panel | AI.4, AI.10 | high |
| 1.31 | AI.12 | Playbook model-effectiveness cell | AI.6 | high |
| 1.32 | AI.13 | AI-layer docs-sync + smoke | all AI | high |

Parallelizable inside Wave 1: ME.1/ME.2 alongside N.* (different files) until ME.3, which
waits for N.4. AI.1 anytime. N.5/N.6/N.7/N.8 can interleave with the ME block. AI.7/8/9
are parallel-ok after AI.5 (7 owns Composer.tsx, 8 also — serialize those two; 9 is Ideas).

---

## Wave 2 — Reply machine & on-page surfaces

Rationale: with prompts settled, complete the radar→measured-reply loop, canned replies,
and the on-page context layer. content.ts is the choke point — order fixed by **D9**.

| Order | ID | Task | Depends | Reasoning |
|---|---|---|---|---|
| 2.1 | RU.4 | Buffer + panel carry variants | RU.3 | high |
| 2.2 | RU.5 | Confirm endpoint + tweetId filter | RU.2 | **xhigh** |
| 2.3 | RU.6 | Panel click → confirm wiring | RU.4, RU.5 | high |
| 2.4 | AX.1 | `GET /x/people/glance` endpoint | — | high |
| 2.5 | AX.2 | `shared/glance.ts` chip view-model | AX.1 | high |
| 2.6 | AX.4 | `shared/tweetContext.ts` view-model (parallel-ok) | — | high |
| 2.7 | AX.3 | Timeline: kill stats pill, inject person chips (content.ts) | AX.1, AX.2 | **xhigh** |
| 2.8 | AX.5 | Status-page context panel + legacy-button kill (content.ts) | AX.3, AX.4 | **xhigh** |
| 2.9 | AX.6 | Chip/panel click-through to dossier | AX.3, AX.5 | high |
| 2.10 | RU.7 | On-page variant chips + paste→posted (content.ts) | RU.5, RU.6, AX.5 | **xhigh** |
| 2.11 | RU.8 | Manual add-to-radar ⊕ button (content.ts) | RU.4, RU.7 | **xhigh** |
| 2.12 | RU.9 | Playbook source-exact attribution | RU.2 | high |
| 2.13 | RU.10 | RU docs-sync + smoke | all RU | high |
| 2.14 | AX.7 | AX docs-sync + smoke | all AX | high |
| 2.15 | RL.1 | Pure engine: render/pick/humanize | — | **xhigh** |
| 2.16 | RL.2 | Schema + CRUD routes | RL.1 | high |
| 2.17 | RL.3 | `/use` route: pick, compose, stamp | RL.1, RL.2 | high |
| 2.18 | RL.4 | AI list generator (via `askLLM` per **D5**) | RL.2 | high |
| 2.19 | RL.5 | Lists subtab management UI | RL.2–4 | high |
| 2.20 | RL.6 | QuickReplyPicker in Launch Room + Conversations | RL.5 | high |
| 2.21 | RL.7 | Playbook `canned` attribution | RL.3, RU.9 | high |
| 2.22 | RL.8 | RL docs-sync + smoke | all RL | high |
| 2.23 | NT.1 | Notification cell parser (parallel-ok) | — | high |
| 2.24 | NT.2 | Engagement event types + ingest module | — | **xhigh** |
| 2.25 | NT.3 | `POST /x/people/engagements` route | NT.2 | high |
| 2.26 | NT.4 | Background notif-context cache | — | high |
| 2.27 | NT.5 | Notifications content script: augment + capture + sync chip | NT.1, NT.3, NT.4, RU.8 | **xhigh** |
| 2.28 | NT.6 | Fans engagement count (display-only) | NT.2 | high |
| 2.29 | NT.7 | NT docs-sync + smoke | all NT | high |

Parallel lanes in Wave 2: RL server work (2.15–2.18) alongside the AX/RU content-script
chain; NT server work (2.23–2.26) alongside both. Playbook tasks RU.9 → RL.7 serialize
(same files).

---

## Wave 3 — Ambient data & guardrails

Rationale: passive harvest and the following ledger both extend the harvester; the monitor
and goals build on data those produce. HV.2 before GR.2 (both rewrite harvester internals).

| Order | ID | Task | Depends | Reasoning |
|---|---|---|---|---|
| 3.1 | HV.1 | `POST /x/harvest/passive`: daily run, dedupe, cap, prune | — | **xhigh** |
| 3.2 | HV.2 | Content-script passive capture + Settings toggle | HV.1 | **xhigh** |
| 3.3 | HV.3 | Harvest tab options (CSV toggle, min-views, persisted form, status) | HV.1 | high |
| 3.4 | HV.4 | Timeline affinity route + People section | HV.1 | high |
| 3.5 | HV.5 | Opportunity-capture funnel playbook cell | HV.1 | high |
| 3.6 | HV.6 | HV docs-sync + smoke | all HV | high |
| 3.7 | GR.1 | Following ledger: schema + ingest/ratchet routes | — | **xhigh** |
| 3.8 | GR.2 | Harvester following mode | GR.1, HV.2 | **xhigh** |
| 3.9 | GR.3 | Curation queue: eligibility/budget + route | GR.1 | **xhigh** |
| 3.10 | GR.4 | People tab Following subtab | GR.2, GR.3 | high |
| 3.11 | GR.5 | Monitor: pure rules + route + MCP | GR.1 | **xhigh** |
| 3.12 | GR.6 | Monitor surfacing: brief, Today card, schedule advisory | GR.5 | high |
| 3.13 | GR.7 | Goals + commitments (**D4**: extend `me_goals`, don't fork) | ME.1 | **xhigh** |
| 3.14 | GR.8 | Accountability surfacing: brief, quests, Today, Settings | GR.7 | high |
| 3.15 | GR.9 | Weekly scorecard in digest | GR.7, GR.8 | high |
| 3.16 | GR.10 | GR docs-sync + smoke | all GR | high |

Parallel: HV.3/4/5 alongside GR.1/GR.3/GR.5 (disjoint files); GR.7–9 alongside the
HV chain. HV.5 holds the playbook lock while it runs.

---

## Wave 4 — Authoring 3.0

Rationale: manual publishing touches the most dangerous ground in the repo (publisher
claim predicate, discovery checkpoint, URL-surcharge exemption) — it deserves a settled
codebase. Audience slots feed the week board; DM drafting needs the mature people layer;
the Writer needs the prompt registry (**D5**).

| Order | ID | Task | Depends | Reasoning |
|---|---|---|---|---|
| 4.1 | A3.1 | Active-times parser (shared, fixture-tested) | — | **xhigh** |
| 4.2 | A3.2 | `audience_activity` table + `/x/analytics` routes | — | high |
| 4.3 | A3.3 | Content-script capture on X Analytics | A3.1, A3.2 | **xhigh** |
| 4.4 | A3.4 | Audience-blended slot suggestions (Composer + brief gaps) | A3.1, A3.2 | **xhigh** |
| 4.5 | A3.5 | Manual publish server core: status, guards, mark-posted | — | **max** |
| 4.6 | A3.6 | Manual reconcile in the daily pass | A3.5 | **xhigh** |
| 4.7 | A3.7 | Composer publish-mode toggle + Calendar/Today chips | A3.5 | high |
| 4.8 | A3.8 | Manual-post alarms, notification, Today card | A3.5 | **xhigh** |
| 4.9 | A3.9 | DM drafts: table, grounding reuse, routes (**D5**: `askLLM` + registry key) | — | **xhigh** |
| 4.10 | A3.10 | DM drafting UI: dossier + Do-next | A3.9 | high |
| 4.11 | A3.11 | Articles table + CRUD routes | — | high |
| 4.12 | A3.12 | Article prompt (byte-synced) + assist route (**D5**) | A3.11 | **xhigh** |
| 4.13 | A3.13 | The Writer page (`/writer`) | A3.11, A3.12 | **xhigh** |
| 4.14 | A3.14 | Calendar week board | A3.4, A3.5, A3.7 | **xhigh** |
| 4.15 | A3.15 | A3 docs-sync + smoke | all A3 | high |

Three sub-lanes: analytics (4.1–4.4), manual publish (4.5–4.8), DM/articles (4.9–4.13).
Migrations in A3.2 / A3.9 / A3.11 serialize (journal). A3.14 last — it needs both the
analytics and manual lanes.

---

## Wave 5 — Settings moat completion + polish sweep

Rationale (**D10**): the registry catalogs constants that now exist across ALL shipped
features; the Settings rebuild absorbs every card the waves added; polish passes only
touch pre-masterplan tabs (**D7**).

| Order | ID | Task | Depends | Reasoning |
|---|---|---|---|---|
| 5.1 | UI.2 | Doctrine + quests knobs (**D2**: niche doctrine is the owner) | UI.1, N.5 | **xhigh** |
| 5.2 | UI.3 | People/followups/stage/targets/pinned-watch knobs | UI.1 | high |
| 5.3 | UI.4 | Gates, metrics-lifecycle, worker knobs + MCP settings tools | UI.1 | high |
| 5.4 | UI.5 | Money + AI knobs with hard ceilings | UI.1 | **xhigh** |
| 5.5 | UI.6 | Extension mirror: background sync, shared reader, first consumers | UI.1, UI.2, UI.5 | **xhigh** |
| 5.6 | UI.7 | Reply-band thresholds configurable end-to-end | UI.6 | **xhigh** |
| 5.7 | UI.11 | Settings tab rebuild — the crowded cockpit (**D6**, **D8**) | UI.1, UI.6, UI.9, UI.10 | **xhigh** |
| 5.8 | UI.12 | Today tab polish + inline config | UI.10, UI.2, UI.6 | high |
| 5.9 | UI.13 | Composer + Calendar polish + inline cadence config | UI.10, UI.6 | high |
| 5.10 | UI.14 | People + Channels + Voice + Ideas polish (parallel-ok with 13/15) | UI.10, UI.3 | high |
| 5.11 | UI.15 | Replies + Playbook + Harvest + Studio polish (parallel-ok) | UI.10, UI.4, UI.5 | high |
| 5.12 | UI.16 | Content-script overlay token alignment + explorer restyle | UI.8 | high |
| 5.13 | UI.17 | UI docs-sync + smoke-settings | all UI | high |

---

## Wave 6 — Coach, judge & growth tactics (the x-builder harvest)

Rationale: three backlog plans distilled from the x-builder/i_mika_el code studies, all
$0 recurring (JD adds ~$0.003–0.007 per human click). Order: the two shared pure modules
first (SC.1/SC.2 — everything else in the wave reads them), the byte-sync prompt edits
early and serial (D143 — one prefix-cache bust each, and JD.1's "templates unchanged"
check needs the post-GT.1 ground), then the SC surfaces, the GT reciprocity lane, and
the JD chain last — it holds the wave's only migration (JD.4; plan text says "0018",
rule 1 applies — the journal assigns the real number) and its Composer/playbook surfaces
need the SC tasks to have released those files (D141). GT.5 is never built (D142).

| Order | ID | Task | Depends | Reasoning |
|---|---|---|---|---|
| 6.1 | SC.1 | `src/shared/postCoach.ts` — deterministic check engine (~29 rules + score) | — | high |
| 6.2 | SC.2 | `src/shared/postFormat.ts` — format classifier + real-corpus fixtures | — | high |
| 6.3 | GT.1 | Echo-anchor rule in reply prompt (byte-sync + batch anti-drift) | — | **xhigh** |
| 6.4 | GT.2 | Reply-bait skeletons in post prompt (byte-sync, §9 stable prefix) | — | high |
| 6.5 | JD.1 | Few-shot machine-draft dilution + trust markers (**D143**: after GT.1) | GT.1 | **xhigh** |
| 6.6 | GT.3 | Launch Room seed-first-comment checklist + one-click draft | — | high |
| 6.7 | GT.4 | Milestone nudge: brief `milestoneWatch` + Today card | — | high |
| 6.8 | SC.3 | Composer live coach column (client-side, no fetch) | SC.1 | high |
| 6.9 | SC.4 | Coach score chips on reply variants + Radar rows | SC.1, SC.3 | high |
| 6.10 | SC.5 | Playbook `formatEffectiveness` + `coachScoreEffectiveness` cells | SC.1, SC.2 | high |
| 6.11 | SC.6 | Format cooldown route + Composer chip (**D142**: supersedes GT.5) | SC.2, SC.3 | high |
| 6.12 | SC.7 | Niche-scoped coach lexicon (`GET /x/coach/lexicon`) | SC.1, SC.3 | high |
| 6.13 | GT.6 | Band-gate roster exemption + `reciprocityTargetMin` doctrine knob | — | **xhigh** |
| 6.14 | GT.7 | Daily reciprocity quest (6th quest) | GT.6 | high |
| 6.15 | GT.8 | Roster sightings into Radar (content.ts + `'roster'` band; **D143**: after GT.6) | GT.6 | **xhigh** |
| 6.16 | GT.9 | GT docs-sync + `smoke-growth-tactics.ts` (**D142**: no cooldown assertion) | all GT | high |
| 6.17 | SC.8 | Fitted reach band — architecture only, no invented numbers | SC.2, SC.5 | **xhigh** |
| 6.18 | SC.9 | SC docs-sync + `smoke-coach.ts` | SC.1–SC.8 | high |
| 6.19 | JD.2 | `src/shared/judge.ts` — verdict types + annotation locator | — | high |
| 6.20 | JD.3 | `src/x/judge/prompt.ts` — rubric, schema, parser, registry key | JD.2 | high |
| 6.21 | JD.4 | `draft_judgments` migration + `POST /x/judge` (migration — runs alone) | JD.3 | **xhigh** |
| 6.22 | JD.5 | `POST /x/judge/apply` — never-worse guard, 404/409 before spend | JD.4 | **xhigh** |
| 6.23 | JD.6 | Composer judge panel + anchored-fix selection (**D141**: after SC.3/6/8) | JD.4, JD.5 | high |
| 6.24 | JD.7 | Playbook `judgeEffectiveness` falsification cell (after SC.5 — playbook lock) | JD.4 | high |
| 6.25 | JD.8 | JD docs-sync + `smoke-judge.ts` | all JD | high |

Parallelizable inside Wave 6: SC.1/SC.2 alongside GT.1–GT.4 (disjoint files); JD.2/JD.3
(pure modules) alongside anything; the GT.6→GT.7→GT.8 reciprocity chain alongside the SC
surface chain. Serial constraints: Composer.tsx SC.3 → SC.6 → SC.8 → JD.6 (**D141**);
playbook.ts + routes/playbook.ts SC.5 → JD.7; `src/x/replies/*` GT.1 → JD.1 and
GT.6 → GT.8 (**D143**); JD.4 is the wave's only migration and never runs in a parallel
lane. Reasoning-level notes: no task here is **max** — the two prompt edits are additive
bullets guarded by byte-sync/equivalence tests, not the structural surgery the Wave-1
chain was; the **xhigh** set is where a subtle mistake passes tests but breaks an
invariant (GT.1's embedded-batch parity, JD.1's markers beside byte-synced literals,
GT.6's money-gate carve-out, GT.8's content.ts + band coercion, SC.8's fit arithmetic,
JD.4/JD.5's refuse-before-spend ladders and the never-worse guard).

---

## Wave 7 — Radar follow-ups: curated drafting & humanize-at-pick

Rationale: two small plans written 2026-07-28 after Wave 6 closed, both landing on the
Radar reply queue. HM is $0 end-to-end (a pure-core promotion out of `replyLists/engine.ts`,
one `app_settings` key, pick-time jitter that is never stored); RC adds one per-click
scoring call (~$0.005–0.015) in front of the existing batch draft and the wave's only
migration (D173). Order: the four foundation tasks first — two pure modules and the
migration are pairwise parallel; HM.2 follows HM.1 in-order to skip its plan's
import-fix-up caveat — then the money-adjacent curate route, then the serialized
Radar.tsx lane (**D172**: HM.3 before RC.4 — the humanizer's `onPick` rewrite is the
ground RC.4's `sendBatch` refactor stands on, and curated picks inherit the jitter for
free). The Settings card runs beside RC.4 (disjoint files); the two docs-sync closers
are serial (**D174**).

| Order | ID | Task | Depends | Reasoning |
|---|---|---|---|---|
| 7.1 | HM.1 | Promote humanize core to `src/shared/humanize.ts` + extension shim (`engine.test.ts` byte-untouched) | — | high |
| 7.2 | RC.1 | Pure curation core (`replies/curate.ts`) + `reply-curate` prompt key | — | high |
| 7.3 | RC.2 | Migration: `radar_drafts.curation_score` + batch threading (**D173**: migration — runs alone) | — | high |
| 7.4 | HM.2 | Humanizer settings store + `GET/PATCH/DELETE /x/humanizer` | HM.1 | high |
| 7.5 | RC.3 | `POST /x/replies/curate` + `x.radar.curatedCount` knob | RC.1, RC.2 | **xhigh** |
| 7.6 | HM.3 | Radar checkbox + humanize-at-pick (**D172**: before RC.4) | HM.1, HM.2 | **xhigh** |
| 7.7 | RC.4 | Extension Curate & draft orchestration (**D172**: after HM.3) | RC.2, RC.3, HM.3 | **xhigh** |
| 7.8 | HM.4 | Settings → General "Reply humanizer" editor card | HM.2, HM.3 | high |
| 7.9 | HM.5 | HM docs-sync + $0 `smoke-humanizer.ts` (**D174**: before RC.5) | all HM | high |
| 7.10 | RC.5 | RC docs-sync + `smoke-radar-curate.ts` (`--live` = one ~$0.003 call) | all RC, HM.5 | high |

Parallelizable inside Wave 7: HM.1→HM.2 alongside RC.1/RC.2/RC.3 (disjoint files —
HM touches `replyLists/engine.ts`/`src/shared/`/`settings/humanizer.ts`, RC touches
`replies/curate.ts`/schema/`routes/replies.ts`); HM.4 alongside RC.4 (Settings.tsx +
HumanizerCard vs Radar.tsx + shared modules). Serial constraints: Radar.tsx/api.ts/
types.ts HM.3 → RC.4 (**D172**); RC.2 never in a parallel lane (**D173**); docs-sync
HM.5 → RC.5 (**D174**). Reasoning-level notes: no task is **max** — nothing touches the
prompt-surgery chain or the publisher; the moved humanizer core is pinned by a
byte-untouched `engine.test.ts` and the curate route imitates generate-batch
line-for-line. The **xhigh** set is where a subtle mistake passes tests but breaks an
invariant: RC.3 (a paid `askLLM` call behind the §7.4 refuse-before-spend ladder —
every 400 fires pre-spend, a post-spend parse failure is a 502 and never a retry),
HM.3 (untested panel code carrying the §7.19 pick-time-never-stored contract — the
jittered text must reach BOTH the clipboard and `confirmDraft`, with `background.ts`/
`messages.ts` byte-untouched), and RC.4 (client-side dismissal ordering — dismiss only
after a successful curate response, `unscored` ids neither drafted nor dismissed; a
mistake here silently deletes queue rows and no test catches panel code).

---

## Wave 8 — Radar access from a Claude Code session (RA)

Rationale: one plan written 2026-08-17, and the wave that **re-opens** a masterplan closed
at RC.5. The problem it solves is an absence, not a feature gap: a swept sighting exists only
in `chrome.storage.local` (cap 500, 24h TTL) unless a Grok batch draft happens to persist it,
so an agent session can read what was *drafted* and what /home fed us, never what the armed
sweep actually **admitted** — and never a sweep on `/search`, a list or a profile, which the
HV.2 passive corpus excludes by design. RA mirrors every sighting to the server at capture
time (with the page it came from), exposes it as `x_radar`/`x_radar_tweet`, and closes the
loop the other way: Claude composes angle variants into the same `radar_drafts` table the
"Draft replies" button fills, so one **Fetch drafts** click makes them reply-ready in the
panel with the paste still manual (invariant #2).

**The whole wave is $0** — no `xFetch`, no `askLLM`, no image call in any task; drafting moves
off Grok onto the operator's own session, so RA can only reduce spend. Order: the migration
task alone first (it also owns the wave's one shared-rule move, D185), then the extension
transport and the read layer in parallel (disjoint files), then the compose route that depends
on both, then the three independent closers. RA.6 (the passive-capture repair) touches nothing
another RA task owns and may run at any point.

**RA.1 owes the re-opening**, in its own commit: this file's legend + this section are already
here, so what remains is STATE.md — the eight ledger rows, the Wave 8 hot-file locks, and a
**correction of the stale "current state" line** (it still reads 41 tables / 23 MCP tools /
head `0025` / registry 62 knobs, while the codemap — authoritative — says 42 tables, 25 tools,
head `0028`, 61 knobs / 15 groups / 31 mirrored). Skip that correction and every later RA task
inherits wrong counts and asserts against them.

| Order | ID | Task | Depends | Reasoning |
|---|---|---|---|---|
| 8.1 | RA.1 | `radar_sightings` table + `POST /x/radar/sightings` + migration `0029` (**D185**: the `bandStickiness` move; migration — runs alone) | — | **xhigh** |
| 8.2 | RA.2 | Background ships every sighting + the `radarSightingSync` toggle (**D187**: no registry knob) | RA.1 | **xhigh** |
| 8.3 | RA.3 | `GET /x/radar/sightings(/:tweetId)` + `x_radar` / `x_radar_tweet` (MCP 25 → 27) | RA.1 | high |
| 8.4 | RA.4 | `POST /x/radar/drafts/compose` + `x_radar_draft_reply` (**D186**; MCP 27 → 28) | RA.1, RA.3 | **xhigh** |
| 8.5 | RA.5 | Radar tab **Fetch drafts** action (one button; no CSS, no new message type) | — (pointless before RA.4) | high |
| 8.6 | RA.6 | Passive `/home` capture repair — diagnose the 2026-07-27 stop | — | high |
| 8.7 | RA.7 | The `radar-analyst` skill (`.claude/skills/radar-analyst/`) | RA.3, RA.4 | high |
| 8.8 | RA.8 | RA docs-sync + `$0 scripts/smoke-radar-access.ts` + the browser end-to-end check | all | high |

Parallelizable inside Wave 8: RA.2 (extension: `background.ts`, `shared/radarIngest.ts`,
`storage.ts`, `Settings.tsx`) alongside RA.3 (server: `radar/corpus.ts`, `routes/radar.ts`,
`mcp.ts`) — fully disjoint; RA.5 and RA.6 alongside anything (RA.5 owns only `Radar.tsx`,
RA.6 only `content.ts`/docs). Serial constraints: **`src/x/routes/radar.ts` is the wave's hot
file — RA.1 → RA.3 → RA.4 never overlap**; RA.1 runs alone as the migration task (global rule
1); `src/mcp.test.ts`'s exact tool count is edited by RA.3 (→27) and RA.4 (→28), which is a
second reason those two serialize; RA.8 closes after everything. Reasoning-level notes: no
task is **max** — nothing touches the prompt-surgery chain, the publisher, or any billed path.
The **xhigh** set is where a mistake passes tests and breaks something invisible: RA.1 (a
migration plus a rule moved out from under the content IIFE), RA.2 (background single-writer
machinery, §7.24/§7.8 — the mirror must never fail the buffer write, and the throttle must
mirror the server's window or the wire carries rows the server only counts as `skippedRecent`),
and RA.4 (**D186** — the null-`band`/null-`signals` drop, plus the two-writer race on
`radar_drafts`, and an `ageMin` recomputed from `posted_at` so the confirm route's
`sourcePostedAt` derivation still lands on the true post time hours after capture).

---

## Wave 9 — Outliers: the X advanced-search query builder (OU)

Rationale: one plan written 2026-08-03 and **revised 2026-08-24**, and the wave that re-opens a
masterplan closed at RA.8. It closes the last gap in goal 3's intake: the swipe file grows only
from tweets that happen to cross the timeline, because finding *deliberately* — an outlier hunt
by keyword, engagement floor and date window — means typing raw operator syntax into x.com from
memory and re-typing it every session. OU compiles that syntax from a structured form, puts it on
the clipboard for a manual paste (Open in X is the secondary), and saves useful hunts by name.
The results page needs **no capture code at all**: `content.ts`'s save-button attach anchors on
the reply button plus a permalink with no path gate, so every result already carries **Save to
stratus** — verified by reading `content.ts:1325–1351`, not assumed.

**The whole wave is $0** — no `xFetch`, no `askLLM`, no image call on any path, and that is the
design rather than a happy accident: X API v2 has **no** `min_faves`/`min_retweets`/`min_replies`
operator at any tier, so the API version of this feature would pay ~$0.005 per returned result to
discard most of them. Invariant #8 says adding a billed read back is a decision made out loud;
this wave makes the opposite one, on the record, and `searchRecent` stays deleted.

Order: the migration task alone first (global rule 1), then the pure compiler and the settings
group in parallel (fully disjoint trees), then the routes that depend on all three, then the tab,
then its prefills and the provenance stamp, then docs-sync. **`extension/src/sidepanel/Outliers.tsx`
is the wave's hot file** and the plan's own parallel tag on OU.7 is wrong about it — D195.

**OU.1 owes the re-opening**, in its own commit: this file's legend, seeds and this section are
already here, so what remains is STATE.md — the eight ledger rows, the Wave 9 hot-file locks, and
a **recount** of the `current state` line, which is now stale in at least two named places (D196).
Skip that recount and every later OU task inherits wrong counts and asserts against them.

| Order | ID | Task | Depends | Reasoning |
|---|---|---|---|---|
| 9.1 | OU.2 | `saved_searches` table + migration (**plan says `0031`; verify — global rule 1**; runs alone) | — | **xhigh** |
| 9.2 | OU.1 | Pure compiler `src/shared/searchQuery.ts` + `FAVES_LADDER` (**owes the re-opening, D196**) | — | **xhigh** |
| 9.3 | OU.3 | `outliers` settings group — 6 server-scope knobs (default floors, window, sort) | — | high |
| 9.4 | OU.4 | `/x/searches` CRUD + `compile` / `run` / `defaults` routes + mount | OU.1, OU.2, OU.3 | high |
| 9.5 | OU.5 | Outliers tab — form, live preview, Copy + Open in X, saved list, the 12th shim | OU.1, OU.4 | high |
| 9.6 | OU.6 | Prefills — channel keywords, target roster, faves ladder, `SettingsGear` | OU.5 | high |
| 9.7 | OU.7 | `voice_tweets.source = 'outlier_search'` provenance + the footer count (**D195, D197**) | OU.4, OU.5, OU.6 | **xhigh** |
| 9.8 | OU.8 | OU docs-sync + `$0 scripts/smoke-outliers.ts` + the browser pass | all | high |

Parallelizable inside Wave 9: **OU.1 (`src/shared/`) alongside OU.3 (`src/x/settings/`)** — fully
disjoint, and neither can start the other's file. Nothing else parallelizes: OU.4 needs all three
of its predecessors, and OU.5 → OU.6 → OU.7 all write `Outliers.tsx` (D195). Serial constraints:
**OU.2 runs alone** as the migration task (global rule 1) and must re-derive its number rather than
trust the plan's `0031`; **`src/x/routes/searches.ts` is written once**, by OU.4, so no hot-file
race exists on the server side; OU.8 closes after everything. This wave bumps **no MCP count** —
there is no tool in it by decision, so `src/mcp.test.ts`'s exact **28** and the six
`docs/s2-mcp-server.md` strings are untouched (confirm, don't assume). The doc counts it *does*
bump are the table count, the migration head, the registry counts (`docs/settings-tab.md`'s
count strings **plus** its group table row — none of them asserted by anything, and RA.8 found
four of them already rotted), the smoke-script count, and the extension `include` shim count
(11 → 12).

**Reasoning-level notes.** No task is **max** — nothing here touches the prompt-template surgery
chain, the publisher, or any billed path, so the substrate the rest of the repo stands on is never
under the knife. Most of the wave is **high** by the rubric's first clause: OU.3 copies the
`RADAR` block in `registry.ts`, OU.4 copies `replyLists.ts`'s CRUD ladder, OU.5/OU.6 copy an
existing tab and the Voice/Radar gear pattern, and OU.8 is a docs-sync. The three **xhigh** tasks
are each the rubric's second clause — a subtle mistake passes every test:

- **OU.1** is single-file and pure, which normally reads *high*, and it is not, for one reason:
  **X's parser is the oracle and it is off-machine.** A byte-exact golden test written by the same
  session that wrote the compiler proves self-consistency, not correctness — get the OR-group
  parenthesisation or an operator's spelling wrong and the query does not error, it returns the
  *unfiltered firehose*, which looks exactly like a working feature with a generous niche. The
  task carries a manual x.com spot check and a dated verification comment for precisely this
  reason; treat that step as part of the implementation, not a formality.
- **OU.2** is a migration (rubric: xhigh by category), plus the standing drizzle-kit dropped-seed
  trap. DDL-only and small, but global rule 1 and the fresh-`:memory:` `content_pillars` count
  both apply, and a number quoted from plan text is the exact failure this wave already found in
  its own source plan (`0026`, written when the head was `0025`).
- **OU.7** edits `content.ts` — the wave's only content-script touch, under the IIFE constraint —
  and its failure mode is silent provenance corruption: extend the existing `onConflictDoUpdate`
  set-clause to include `source` and every test still passes while a re-save from the timeline
  quietly erases the hunt that found the tweet. First-save-wins is the rule; the re-save test in
  the plan block is the only thing that catches breaking it.

---

## Parallelism model (how many sessions at once)

Practical ceiling: **2–3 concurrent sessions**, each owning a lane, coordinated through
STATE.md's hot-file locks:

- **Wave 0:** 3 lanes (server platform / panel CSS / studio) — fully disjoint.
- **Wave 1:** the prompt spine (RU.1→N.3→N.4→ME.3→AI.3→AI.5) is one serial lane; a second
  lane runs the non-prompt tasks of the same plans (N.2/N.7, ME.1/ME.2/ME.4, AI.1, AI.4);
  Studio lane C keeps trailing.
- **Wave 2:** content-script chain (one lane) ∥ RL server+UI (second lane) ∥ NT server (third).
- **Wave 3:** HV chain ∥ GR server chain ∥ GR goals chain.
- **Wave 4:** analytics ∥ manual-publish ∥ DM/articles (migrations serialize).
- **Wave 5:** knob groups UI.3/UI.4 parallel; polish passes UI.13/14/15 parallel.
- **Wave 6:** SC pure/surface chain ∥ GT reciprocity chain ∥ JD pure modules (JD.2/JD.3);
  Composer.tsx, playbook.ts and `src/x/replies/*` serialize per D141/D143; JD.4
  (migration) runs alone.
- **Wave 7:** HM server lane (HM.1→HM.2) ∥ RC server lane (RC.1 ∥ RC.2 → RC.3); the
  Radar.tsx/api.ts/types.ts trio serializes HM.3 → RC.4 (D172); HM.4 ∥ RC.4 (disjoint
  files); RC.2 (migration) runs alone (D173); docs-sync closes HM.5 → RC.5 (D174).
- **Wave 8:** RA.1 alone (migration + the D185 rule move), then 2 lanes — extension
  (RA.2, later RA.5) ∥ server/MCP (RA.3 → RA.4); `src/x/routes/radar.ts` and
  `src/mcp.test.ts`'s exact tool count serialize RA.1 → RA.3 → RA.4. RA.6 floats (it owns
  only `content.ts` + harvest docs) and RA.7 is docs-only; RA.8 closes alone.
- **Wave 9:** OU.2 alone (migration), then 2 lanes — OU.1 (`src/shared/`) ∥ OU.3
  (`src/x/settings/`) — and a single lane from OU.4 on, because OU.5 → OU.6 → OU.7 all write
  `Outliers.tsx` (D195). OU.8 closes alone. Effective ceiling for this wave is **2**.

Rules: a lane claims its hot files in STATE.md before starting and releases on commit;
migration tasks always run alone; when in doubt, serialize — a merge conflict in
`content.ts` or the migrations journal costs more than the parallelism saves.

## Standing verification bar (every task)

`bun test` + `bun run typecheck` + `bun run lint` green; extension tasks also
`cd extension && bun run build`; each plan's smoke script at its docs-sync task;
commit message from the task block; codemap + STATE.md updated in the same commit.
