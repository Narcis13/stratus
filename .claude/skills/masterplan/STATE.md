# Masterplan execution state

> Dynamic memory for `/masterplan`. Updated after EVERY task, in the task's own commit.
> Plan: `plans/MASTERPLAN.md` (static — order, reasoning levels, waves, D1–D10).
> Codemap: `.claude/skills/plan-feature/references/codemap.md` (updated per task too).

- **last-commit:** 8c89950 (UI.9). **Sha reconciliation (see D14):** history was rewritten after UI.1's STATE write — the shas `7e07dd5`/`40c718e`/`95b9fff` no longer exist. Actual Wave-0 commits: **UI.1 = `226368c`, UI.8 = `1299e43`, ST.1 = `61a04e7`** (the D12 collision commit that also carries UI.8's styles.css + UI.1's settings code). Verified all three tasks' work is present in the tree; only the recorded shas were stale, no status drift.
- **current wave:** 0 → 1 (Wave 0: UI.1, UI.8, ST.1, UI.9 done; only UI.10 remains)
- **next-up:** Lane A → Wave 1 server (RU.1 / N.1 / AI.1) · Lane B → UI.10 (primitives + grouped rail) · Lane C → ST.2 (Studio shell)

## Ledger

Status: `[ ]` todo · `[~]` in progress (lane claimed) · `[x]` done (sha + date) · `[s]` skipped (reason in deviations).

### Wave 0 — Foundations
- [x] UI.1 Settings platform (xhigh) — 226368c (code+format+state+codemap; D12 absorbed into 61a04e7) 2026-07-18
- [x] UI.8 Design tokens dark refactor (high) — 1299e43 (styles.css in 61a04e7 per D12) 2026-07-18
- [x] UI.9 Light theme + Appearance (high) — 8c89950 2026-07-18
- [ ] UI.10 UI primitives + grouped rail (xhigh)
- [x] ST.1 Engine layers + PRNG (high) — 61a04e7 2026-07-18
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
- **D11** (UI.8, standing): `biome.json` `files.ignore` now includes `Stratus Design System` — the DS reference folder (Decision 9, plan out-of-scope) was ~112 of the baseline lint errors. Not in UI.8's plan edit-list but a correct, universal fix; whole-repo lint dropped 119→7. The remaining 7 are pre-existing and NOT in any changed file: 2 a11y in `extension/src/sidepanel/Replies.tsx` (UI.15 territory) + 5 biome-format on generated `src/db/migrations/meta/*.json` (a future infra task could ignore `src/db/migrations/meta`).
- **D12** (UI.8, historical): UI.8's `styles.css` and UI.1's whole settings platform were absorbed into ST.1's commit `61a04e7` (15 files, 3894 ins) by a concurrent lane's broad `git add` before either owner committed. Not reverted — `61a04e7` is shared HEAD and other lanes built on it; rewriting shared history mid-run is more dangerous than the mislabel. UI.8's `styles.css` content is correct there (0 literals outside `:root`, build green). **Process lesson: parallel masterplan lanes in ONE worktree must stage explicit paths (`git add <files>`), never `git add -A`/`commit -am`.**
- **D14** (UI.9): two things. **(a) Sha reconciliation** — the git history was rewritten (rebase/squash) after UI.1 wrote STATE, so `7e07dd5`/`40c718e`/`95b9fff` are gone; real Wave-0 shas corrected in the ledger (UI.1 `226368c`, UI.8 `1299e43`, ST.1 `61a04e7`). All ticked work verified present in the tree — status was accurate, only shas stale. **(b) Density plumbing divergence** — the plan assumed density = "override ~6 spacing vars", but UI.8 did NOT variableize spacing (`.panel` hardcoded `padding:14px;gap:12px`, `.row` `gap:8px`). UI.9 introduced three semantic vars `--ui-panel-pad`/`--ui-section-gap`/`--ui-row-gap` (cozy defaults in `:root`, compact overrides in `[data-density='compact']`) and wired `.panel`/`.row` to them; `--ui-root-size` (13px, overridden by `[data-scale='12'|'14']`) drives `body` font-size. **Binds UI.11–16 polish:** density currently only tightens `.panel`/`.row`; a polish task wanting finer compaction adds more consumers of the `--ui-*` vars (don't remap the generic `--strat-space-*` tokens — they're used everywhere).
- **D13** (UI.1, binds UI.2): the **doctrine group is seeded in full by UI.1** — the 6 keys `x.doctrine.{replyTargetMin,replyTargetMax,weekReplyTargetPct,anchors3,anchors4,ladderSwitchAt}`, with the anchors' sorted-unique+range numberArray validation already in place (Task 2's plan attributed that hook to itself; landed early because UI.1 seeds the anchors so it must validate them). **UI.2 must NOT re-declare these doctrine keys** — it only adds the `quests`+`display` groups and wires the consumers (brief quota/ratio/gaps, composer ladder). Store layering (also binds AI.2/D1): `src/settings/store.ts` is platform-agnostic and never imports `src/x/*`; the X registry `src/x/settings/registry.ts` implements the store's `SettingsRegistry` interface and exposes the bound `getSetting`/`resolveSetting`/`getAllValues`/`setSettings`/`resetSettings` — **UI.2+ consumers import those from `../settings/registry.ts`, never the store directly**. biome.json now also ignores `src/db/migrations` (fulfils D11's anticipated infra ignore; the 5 generated-JSON lint errors are gone → whole-repo lint = 2, both pre-existing `Replies.tsx` a11y).

## Gotchas log

Things the next implementer must know that aren't obvious from the code. Append-only,
one line each, newest last.

- **`bun run lint` was 114–119 pre-existing errors at baseline** — mostly the `Stratus Design System/` reference folder. **UI.8 (D11) added that folder to biome ignore → whole-repo now 7 errors**, all pre-existing and outside any changed file (2 a11y `Replies.tsx`, 5 format on generated `migrations/meta/*.json`). Per-task gate stays "the changed files lint clean" (`bunx biome check <files>`), not "whole-repo green"; don't chase the remaining 7 unless your task owns those files.
- **`bun test` has 2 pre-existing failures** in `src/x/routes/brief.test.ts` ("brief quests (C9)") — full suite 624 pass / 2 fail, identical before and after UI.8. Unrelated to CSS/settings; a Wave-1 or brief-owning task should investigate. Don't read "2 fail" as a regression.
- **UI.8 design-token conventions:** `styles.css` `:root` = `--strat-*` set + legacy short aliases (`--bg`,`--accent`,`--status-*`…, all mapping to `--strat-*`) — the 2.4k-line sheet still resolves through the aliases; don't rip them out until a full migration pass. Alpha fills use `color-mix(in srgb, var(--strat-*) N%, transparent)` (exact-equal to the old rgba, tracks the base for UI.9's light theme) — a pre-existing `color-mix` at ~line 2051 already used the pattern, so it's sanctioned. `#fff`→`white` keyword. Fonts load from absolute `/fonts/Inter-*.woff2` (public/ → dist root; same files Studio uses) — no `sidepanel.html` change needed. `color-scheme: dark` stays until UI.9 adds `:root[data-theme='light']`.
- **ST.1 / compose.ts pattern engine:** `patternCoords(pattern,w,h,spacing,seed)` returns box-local coords; `dots|grid|diagonal|plus` share one top-left-first lattice (marks at `spacing/2 + k·spacing`, `< w/h`), `blobs` returns seeded-random `{x,y,r}` (count = `floor(w/spacing)·floor(h/spacing)`, 3 PRNG draws/blob in x,y,r order). `mulberry32` is the only sanctioned RNG in the Studio — Math.random is banned (determinism = the preview-IS-artifact contract). `path` layers author SVG in a 100×100 viewbox scaled into `box`; strokes divide lineWidth by mean scale. Downstream S5 tasks (ST.3 mascot, ST.4 patterns) build on these.
- **UI.1 settings platform landed INERT.** The routes (`GET /x/settings`, `GET /x/settings/values?scope=`, `PATCH /x/settings`, `POST /x/settings/reset`) are always-mounted (`settingsRouter` next to `data`/`explorer` in `mountX`) and fully working, but **no consumer reads the store yet** — pure modules stay pure and take params (Decision 6); UI.2–UI.7 wire brief/quests/people/gates/band/budgets through `getSetting`. Only the `doctrine` group is seeded (D13). Store cache is a module-level `Map` invalidated on every write; PATCH validates ALL keys before a one-txn upsert (all-or-nothing). Value column is JSON (`text {mode:'json'}`) so numbers/booleans/strings/arrays round-trip uniformly. `app_settings` = DB table #28; migration `0013_silent_nova.sql` (no seed INSERT — defaults live in the registry).
- **Sha-stamp trap (learned at UI.9, applies to EVERY task):** the codemap header + STATE `last-commit` embed the task's commit sha, but a commit can't contain its own hash — if you `commit --amend` to inject the sha, the amend produces a *new* sha and orphans the one you just wrote (this is precisely why UI.1's recorded `7e07dd5` vanished and forced a sync). **Don't chase convergence.** Stamp the sha of the just-created commit, amend once, and STOP — accept a possible one-commit lag between the stamp and the true post-amend HEAD. The Step-0 staleness guard runs `sync` on any mismatch, so a one-off lag is harmless by design. Prefer: commit → read sha → stamp → amend → done (no re-verify loop).
- **UI.9 light theme is an OPENING-GUESS palette, unverified in a browser.** Automated gates pass (632 pass / 0 fail incl. 6 new storage tests, typecheck + build + changed-file lint green) but the 12-tabs × {dark,light} × {cozy,compact} visual QA matrix is explicitly manual and deferred to the Wave-5 polish passes (UI.12–16 done-whens). Known trap (plan risk note): AA contrast on warn/ok/band **text over tinted fills** in light — the fill tokens and semantic ink were re-authored dark-enough to double as text (`--strat-warn: #9a6a10`, band-hot `rgb(0,150,100)`, band-warm-text `#8a6100`), but spot-check before trusting. Adjust `:root[data-theme='light']` values, not the consuming rules.
- **UI.9 `uiScale` only affects inherited/`em` sizes, not px tokens.** The sheet is px-heavy (no rem), so scale is implemented as `body { font-size: var(--ui-root-size) }` — it shifts base body text and anything relative, but the many explicit-px component font-sizes don't scale. True global scaling would need a rem migration (out of scope; QA-adjust if the effect feels too weak). Theme resolution + normalizers are pure exports in `storage.ts` (`resolveTheme(pref, prefersLight)`, `normalizeTheme/Density/Scale`) — reuse them; `main.tsx` owns the `<html>` stamping (sync matchMedia best-guess to avoid flash, then storage-corrected, + storage.onChanged + matchMedia-change listeners).
- **`bun test` ran 626 pass / 0 fail at UI.1 finish** (HEAD `1299e43` + UI.1). The 2 `brief.test.ts` failures the UI.8 gotcha flags are shared-in-memory-DB **order-dependent flakiness** (§9), not a hard failure — they did not manifest here. Still worth a brief-owning task's attention, but "2 fail" ≠ regression.

## Planning-error log

Corrections to MASTERPLAN.md itself (wrong dep, wrong order discovered live). (empty)
