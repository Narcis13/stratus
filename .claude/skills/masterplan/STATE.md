# Masterplan execution state

> Dynamic memory for `/masterplan`. Updated after EVERY task, in the task's own commit.
> Plan: `plans/MASTERPLAN.md` (static — order, reasoning levels, waves, D1–D10).
> Codemap: `.claude/skills/plan-feature/references/codemap.md` (updated per task too).

- **last-commit:** f033142 (pre-masterplan baseline)
- **current wave:** 0
- **next-up:** Lane A → UI.1 · Lane B → UI.8 · Lane C → ST.1 or ST.2

## Ledger

Status: `[ ]` todo · `[~]` in progress (lane claimed) · `[x]` done (sha + date) · `[s]` skipped (reason in deviations).

### Wave 0 — Foundations
- [ ] UI.1 Settings platform (xhigh)
- [ ] UI.8 Design tokens dark refactor (high)
- [ ] UI.9 Light theme + Appearance (high)
- [ ] UI.10 UI primitives + grouped rail (xhigh)
- [ ] ST.1 Engine layers + PRNG (high)
- [ ] ST.2 Studio shell refactor (high)
- [ ] ST.3 Cloud mascot (high)
- [ ] ST.4 Patterns + presets (high)
- [ ] ST.5 Milestone + streak cards (high)
- [ ] ST.6 Code card + mono font (high)
- [ ] ST.7 Thread cover + list card (high)
- [ ] ST.8 Chart card (high)
- [ ] ST.9 Studio docs+smoke (high)

### Wave 1 — Prompt & identity core
- [ ] RU.1 Reply prompt → 3 variants (xhigh)
- [ ] RU.2 Migration: source/variants/model columns (high)
- [ ] RU.3 Batch → 3 variants (xhigh)
- [ ] N.1 Niche schema + defaults + store (xhigh)
- [ ] N.2 Niche CRUD + activation + MCP (high)
- [ ] N.3 Post prompt persona extraction (MAX)
- [ ] N.4 Reply prompt persona extraction (MAX)
- [ ] N.5 Doctrine knobs threaded (high)
- [ ] N.6 Pillar/channel niche ownership (xhigh)
- [ ] N.7 Settings Niche card (high)
- [ ] N.8 Niche wizard (high)
- [ ] N.9 Niche docs+smoke (high)
- [ ] ME.1 me_entries/me_goals + profile module (high)
- [ ] ME.2 /x/me routes + loader + smoke (high)
- [ ] ME.3 Inject me-context at prompt tails (xhigh)
- [ ] ME.4 Me tab (high)
- [ ] ME.5 Playbook lift + digest goals fact (high)
- [ ] ME.6 MCP x_me tools (high)
- [ ] ME.7 Me docs-sync (high)
- [ ] AI.1 OpenRouter client (xhigh)
- [ ] AI.2 askLLM + /llm routes — D1 (xhigh)
- [ ] AI.3 Prompt registry + overrides (MAX)
- [ ] AI.4 /x/prompts routes (high)
- [ ] AI.5 Batch/extract/pillar-draft via registry — D3 (MAX)
- [ ] AI.6 Digest/icebreaker via registry + LLM gate (xhigh)
- [ ] AI.7 Thread drafter (xhigh)
- [ ] AI.8 Rewrite assist (high)
- [ ] AI.9 Idea generator (high)
- [ ] AI.10 Settings AI subtab (high)
- [ ] AI.11 Prompts editor panel (high)
- [ ] AI.12 Model-effectiveness cell (high)
- [ ] AI.13 AI docs+smoke (high)

### Wave 2 — Reply machine & on-page surfaces
- [ ] RU.4 Buffer/panel variants (high)
- [ ] RU.5 Confirm endpoint (xhigh)
- [ ] RU.6 Panel confirm wiring (high)
- [ ] AX.1 Glance endpoint (high)
- [ ] AX.2 Glance chip view-model (high)
- [ ] AX.4 tweetContext view-model (high)
- [ ] AX.3 Timeline chips, pill removal (xhigh)
- [ ] AX.5 Status-page context panel (xhigh)
- [ ] AX.6 Dossier click-through (high)
- [ ] RU.7 On-page variant chips (xhigh)
- [ ] RU.8 Manual add ⊕ (xhigh)
- [ ] RU.9 Playbook source attribution (high)
- [ ] RU.10 RU docs+smoke (high)
- [ ] AX.7 AX docs+smoke (high)
- [ ] RL.1 Reply-list engine (xhigh)
- [ ] RL.2 Schema + CRUD (high)
- [ ] RL.3 /use route (high)
- [ ] RL.4 AI generator — D5 (high)
- [ ] RL.5 Lists subtab UI (high)
- [ ] RL.6 QuickReplyPicker (high)
- [ ] RL.7 Playbook canned bucket (high)
- [ ] RL.8 RL docs+smoke (high)
- [ ] NT.1 Notification parser (high)
- [ ] NT.2 Engagement events + ingest (xhigh)
- [ ] NT.3 Engagements route (high)
- [ ] NT.4 Background notif-context (high)
- [ ] NT.5 Notifications content script (xhigh)
- [ ] NT.6 Fans engagement count (high)
- [ ] NT.7 NT docs+smoke (high)

### Wave 3 — Ambient data & guardrails
- [ ] HV.1 Passive harvest endpoint (xhigh)
- [ ] HV.2 Passive capture + toggle (xhigh)
- [ ] HV.3 Harvest tab options (high)
- [ ] HV.4 Timeline affinity (high)
- [ ] HV.5 Funnel playbook cell (high)
- [ ] HV.6 HV docs+smoke (high)
- [ ] GR.1 Following ledger (xhigh)
- [ ] GR.2 Harvester following mode (xhigh)
- [ ] GR.3 Curation queue (xhigh)
- [ ] GR.4 Following subtab (high)
- [ ] GR.5 Monitor rules + route + MCP (xhigh)
- [ ] GR.6 Monitor surfacing (high)
- [ ] GR.7 Goals + commitments — D4 (xhigh)
- [ ] GR.8 Accountability surfacing (high)
- [ ] GR.9 Digest scorecard (high)
- [ ] GR.10 GR docs+smoke (high)

### Wave 4 — Authoring 3.0
- [ ] A3.1 Active-times parser (xhigh)
- [ ] A3.2 audience_activity + routes (high)
- [ ] A3.3 Analytics capture (xhigh)
- [ ] A3.4 Audience-blended slots (xhigh)
- [ ] A3.5 Manual publish core (MAX)
- [ ] A3.6 Manual reconcile (xhigh)
- [ ] A3.7 Composer toggle + chips (high)
- [ ] A3.8 Manual alarms + Today card (xhigh)
- [ ] A3.9 DM drafts — D5 (xhigh)
- [ ] A3.10 DM UI (high)
- [ ] A3.11 Articles CRUD (high)
- [ ] A3.12 Article prompt + assist — D5 (xhigh)
- [ ] A3.13 Writer page (xhigh)
- [ ] A3.14 Calendar week board (xhigh)
- [ ] A3.15 A3 docs+smoke (high)

### Wave 5 — Settings moat + polish
- [ ] UI.2 Doctrine/quests knobs — D2 (xhigh)
- [ ] UI.3 People/followups knobs (high)
- [ ] UI.4 Gates/workers knobs + MCP (high)
- [ ] UI.5 Money/AI knobs + ceilings (xhigh)
- [ ] UI.6 Extension mirror (xhigh)
- [ ] UI.7 Band thresholds e2e (xhigh)
- [ ] UI.11 Settings tab rebuild — D6, D8 (xhigh)
- [ ] UI.12 Today polish (high)
- [ ] UI.13 Composer/Calendar polish (high)
- [ ] UI.14 People/Channels/Voice/Ideas polish (high)
- [ ] UI.15 Replies/Playbook/Harvest/Studio polish (high)
- [ ] UI.16 Content-script + explorer tokens (high)
- [ ] UI.17 UI docs+smoke (high)

## Hot-file locks

A lane claims a file before starting, releases on commit. `owner: —` = free.

| File | Owner |
|---|---|
| `extension/src/content.ts` | — |
| `extension/src/harvester.ts` | — |
| `extension/src/sidepanel/Settings.tsx` | — |
| `extension/src/sidepanel/Composer.tsx` | — |
| `src/x/routes/replies.ts` + `src/x/replies/prompt.ts` | — |
| `post prompt.md` / `reply prompt.md` (+ TS literals) | — |
| `src/x/playbook.ts` + `src/x/routes/playbook.ts` | — |
| `src/db/migrations/` journal (any migration task) | — |
| `src/x/routes/brief.ts` | — |

## Deviations & decisions register

Pre-seeded from cross-plan analysis (see MASTERPLAN "Cross-plan adaptations" for full text).
Append D11+ as work reveals divergences from plan text.

- **D1** (binds AI.2): `app_settings` created once by UI.1; AI.2 reuses it — no second table/migration.
- **D2** (binds UI.2): the 5 doctrine knobs are owned by `niches.doctrine` after N.5; UI.2 must not duplicate them in `app_settings` — read/write through the active niche or drop the keys. **Decision pending at UI.2.**
- **D3** (binds N.4, AI.5): `VOICE_BLOCK_END` renamed by RU.1 to `'## The three variants'`; N.4 substitutes `{{REPLY_PERSONA}}` inside the slice; AI.5 retires slicing — its parity fixture is post-RU/post-N output, and its anti-drift test asserts against defaults containing the niche placeholder.
- **D4** (binds GR.7): no separate `goals` table — extend `me_goals` (baseline fields, `posted_replies`/`originals` metric kinds, `missed` status). One goals system, one digest fact. **Confirm merge shape at GR.7.**
- **D5** (binds RL.4, A3.9, A3.12): after AI.2/AI.6, new LLM calls use `askLLM` + `llmConfigured()`; new prompts register in the registry (`dm`, `article`) so the editor covers them. Refusal-ladder order unchanged.
- **D6** (binds all Settings.tsx tasks pre-UI.11): keep feature Settings UI minimal; UI.11 rebuilds and absorbs.
- **D7** (standing): all NEW UI from Wave 1 on uses UI.10 primitives + `--strat-*` tokens; Wave-5 polish passes touch only pre-masterplan tabs.
- **D8** (binds UI.11): prune the "coming soon" manifest to features still unbuilt at that time.
- **D9** (standing): content.ts task order is fixed: AX.3 → AX.5 → RU.7 → RU.8 → NT.5 → HV.2 → A3.3.
- **D10** (standing): registry knob groups (UI.2–5) run in Wave 5 so they catalog the final constant set, including RU/HV/GR/A3 constants.

## Gotchas log

Things the next implementer must know that aren't obvious from the code. Append-only,
one line each, newest last. (empty — nothing implemented yet)

## Planning-error log

Corrections to MASTERPLAN.md itself (wrong dep, wrong order discovered live). (empty)
