# MASTERPLAN — unified execution order for the 12 feature plans

> **Created:** 2026-07-17. Combines every plan in `plans/` into one dependency-correct
> execution order with per-task reasoning levels and parallel lanes.
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

Rules: a lane claims its hot files in STATE.md before starting and releases on commit;
migration tasks always run alone; when in doubt, serialize — a merge conflict in
`content.ts` or the migrations journal costs more than the parallelism saves.

## Standing verification bar (every task)

`bun test` + `bun run typecheck` + `bun run lint` green; extension tasks also
`cd extension && bun run build`; each plan's smoke script at its docs-sync task;
commit message from the task block; codemap + STATE.md updated in the same commit.
