# Masterplan execution state

> Dynamic memory for `/masterplan`. Updated after EVERY task, in the task's own commit.
> Plan: `plans/MASTERPLAN.md` (static — order, reasoning levels, waves, D1–D10).
> Codemap: `.claude/skills/plan-feature/references/codemap.md` (updated per task too).

- **last-commit:** `d38bbc5` (ST.8). **Sha reconciliation (see D21):** at ST.8 start STATE said `2104f46` (ST.7) but HEAD was `acd95ec` — `2104f46` was another amend-orphan (sha-stamp trap), real ST.7 commit is **`acd95ec`**. Corrected in the ledger + codemap header + §11. Earlier same trap: ST.6 `b65266f`→**`00b9615`**, ST.5 `bc3f1e8`→**`1f6b20f`**, ST.4 `c1b0314`→**`15f2563`**, ST.3 `292603d`→**`b82058b`**, UI.10 `50948c9`→**`c37d504`**, ST.2 `860725f`→**`dffd60a`**, UI.9 `8c89950`→**`f9ff346`**; rewritten `7e07dd5`/`40c718e`/`95b9fff` → actual Wave-0 **UI.1 = `226368c`, UI.8 = `1299e43`, ST.1 = `61a04e7`** (D12). All ticked work verified present; only recorded shas were ever stale, no status drift.
- **current wave:** Wave 0 foundations COMPLETE. Lane C Studio: ST.1–**ST.8** all done → only **ST.9** (docs-sync + smoke + the whole-Studio browser walk, dep all ST) remains in the lane. Wave 1 (Lane A) still open.
- **next-up:** Lane C → **ST.9** (the docs-sync + `scripts/smoke-*`/browser walk that clears every "unverified in browser" flag ST.1–ST.8 accrued — all 9 templates render check, Copy-PNG, Composer/re-up seed handoffs, live chart/stat/milestone/streak data fills). All clean, no hot-file locks. Lane A → Wave 1 server (RU.1 / N.1 / AI.1 — all dep-free). **UI lane** still blocked until the Wave-1 settings-mirror chain (UI.6) lands.

## Ledger

Status: `[ ]` todo · `[~]` in progress (lane claimed) · `[x]` done (sha + date) · `[s]` skipped (reason in deviations).

### Wave 0 — Foundations
- [x] UI.1 Settings platform (xhigh) — 226368c (code+format+state+codemap; D12 absorbed into 61a04e7) 2026-07-18
- [x] UI.8 Design tokens dark refactor (high) — 1299e43 (styles.css in 61a04e7 per D12) 2026-07-18
- [x] UI.9 Light theme + Appearance (high) — f9ff346 2026-07-18 (sha corrected from orphaned 8c89950)
- [x] UI.10 UI primitives + grouped rail (xhigh) — c37d504 2026-07-18 (sha corrected from orphaned 50948c9 — see D17)
- [x] ST.1 Engine layers + PRNG (high) — 61a04e7 2026-07-18
- [x] ST.2 Studio shell refactor (high) — dffd60a 2026-07-18 (sha corrected from orphaned 860725f — see D16)
- [x] ST.3 Cloud mascot (high) — b82058b 2026-07-18 (sha corrected from orphaned 292603d — see D17)
- [x] ST.4 Patterns + presets (high) — 15f2563 2026-07-18 (sha corrected from orphaned c1b0314 — see D18)
- [x] ST.5 Milestone + streak cards (high) — 1f6b20f 2026-07-18 (sha corrected from orphaned bc3f1e8 — see D19)
- [x] ST.6 Code card + mono font (high) — 00b9615 2026-07-18 (sha corrected from orphaned b65266f — see D19/D20)
- [x] ST.7 Thread cover + list card (high) — acd95ec 2026-07-18 (sha corrected from orphaned 2104f46 — see D21)
- [x] ST.8 Chart card (high) — d38bbc5 2026-07-18
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
- **D15** (ST.2, binds ST.3–ST.8): the Studio shell landed at **554 lines, not the plan's "< ~300"**. The plan's explicit split (registry.ts + fields.tsx + KitEditor.tsx) was done in full AND the AI-background section + library rail were also extracted into `fields.tsx` as `BackgroundFields`/`LibraryRail` (beyond the 4 named field components) — but the shell's irreducible logic (all state, 6 effects incl. the debounced render loop, and the async handlers generateBackground/saveToLibrary/reopenAsset/loadStatData/loadBannerData/stampVisualMade) can't be moved without a `useStudio` hook the plan didn't ask for. The **actual goal is met**: a new template = 1 `registry.ts` row + 1 field section + 1 `buildSpec` case, zero shell edits beyond those. ST.3/ST.5/ST.7/ST.8 register new templates through `TEMPLATES`/`buildSpec`; ST.3 also appends mascot layers in `templates.ts` (not the shell). **Do NOT add per-template render branches back into `Studio.tsx`** — go through the registry.
- **D16** (ST.3): two things. **(a) Sha reconciliation** — ST.2's recorded `860725f` was an amend-orphan (`git merge-base --is-ancestor 860725f HEAD` → false); real ST.2 commit is `dffd60a` (= HEAD at ST.3 start). Corrected in the ledger, `last-commit`, codemap header + §11. Same sha-stamp trap as UI.9/UI.10 — status was accurate, only the sha was stale. **(b) Mascot placement diverges from the plan's loose anchors** (all QA-adjustable at ST.9, browser-verified here so they're de-risked): quote card = happy mascot at **x:96, y:598, scale:0.55** — the plan said "bottom-left" but the handle occupies the natural bottom-left slot, so the mascot sits *below* the handle (y:598, card h:675). Stat = celebrating/happy at **x:1020, y:334, scale:0.6** (plan's ≈1020/330). Banner = thinking at **x:1190, y:140, scale:1.5**, guarded `kit.mascot && !data.background && data.followers === null`. When no milestone the headline box still spans w:1340, so a very long headline *could* run under the banner mascot — didn't in the test render, flagged for ST.9. Confetti seed default 7; body strokeWidth `max(1.5, 3*scale)`, face `max(1.2, 2.4*scale)` (scale-proportional, since `drawPath` normalizes strokeWidth to output px).
- **D17** (ST.4): three things. **(a) Sha reconciliation** — ST.3's recorded `292603d` and UI.10's `50948c9` were both amend-orphans (`git merge-base --is-ancestor` → false); real commits `b82058b` (ST.3) and `c37d504` (UI.10), corrected in the ledger + codemap header + §11. Status was accurate, only shas stale — same trap as D16/D14a. **(b) `patternSeed?` added beyond the plan** — the plan said thread only `patternKind?` onto the card-data interfaces, but reroll determinism needs the seed too, so `QuoteCardData`/`BannerData`/`TemplateState` carry `patternKind?`+`patternSeed?` (seed default 7, only `blobs` reads it). **(c) KitEditor prop shape changed** — the S5.2 `kit`/`onReplace` props became `bundle` (a `BrandKits`) + preset callbacks (`onSelectPreset`/`onSaveAs`/`onRename`/`onDelete`/`onImport`/`onResetActive`); the shell's single-kit `replaceKit` is gone. **Binds ST.7** (touches `Studio.tsx`/`StudioSeed`): the shell now holds `bundle` (not `kit`) — read the active kit via `activeKit(bundle)`; `StudioSeed` still lives in `Studio.tsx` (add `template?` there per plan).
- **D18** (ST.5): three things. **(a) Sha reconciliation** — ST.4's recorded `c1b0314` was an amend-orphan (`git merge-base --is-ancestor c1b0314 HEAD` → false); real ST.4 commit is `15f2563` (= HEAD at ST.5 start). Corrected in the ledger + `last-commit` + codemap header + §11. Same sha-stamp trap as D16/D17. **(b) Confetti is a fixed-seed built-in, NOT the S5.4 pattern picker** — milestone/streak cards are `supportsAiBackground:false`, so they don't get the background segmented control; their `blobs` confetti is authored directly in the spec via `confettiLayer(kit,w,h)` at `withAlpha(kit.accent,0.25)`, seed **11** (module const `CONFETTI_SEED`). Deterministic (a fixed seed satisfies the "confetti deterministic" test); no reroll UI. **Binds ST.8** if the chart card wants confetti — reuse `confettiLayer`, don't thread patternSeed. **(c) `metrics.account()` client + types shipped** — `api.metrics.account()` over `GET /x/metrics/account` returning `MetricsAccountResponse{count,latest,series}` with `AccountSeriesPoint` (both new in `shared/types.ts`, `snapshotAt` is the ISO string of the server's Date). **ST.8 reuses this exact client** (MASTERPLAN dep ST.5) — don't re-add it. The milestone auto-detect maps `series → {date: snapshotAt, followers: followersCount}` into `latestCrossed`.
- **D19** (ST.6): three things. **(a) Sha reconciliation** — ST.5's recorded `bc3f1e8` was an amend-orphan (`git merge-base --is-ancestor bc3f1e8 HEAD` → false); real ST.5 commit is `1f6b20f` (= HEAD at ST.6 start). Corrected in the ledger + `last-commit` + codemap header + §11. Same sha-stamp trap as D16/D17/D18. **(b) `STUDIO_MONO_STACK` lives in `templates.ts`, not `brandKit.ts`** — the plan named `brandKit.ts:32`'s `STUDIO_FONT_STACK` only as a *precedent to follow*, not a location mandate; the mono stack is code-card-only and belongs with its consumer. The code card font is independent of `kit.fontFamily` (code is always mono) via a local `monoFont(weight,sizePx)` helper. **(c) `assets.ts` needed no edit** — ST.5 pre-whitelisted `code` (and `thread`/`list`/`chart`) in `ASSET_KINDS`, so the plan's "kind:'code' degrades to 'other'" fallback never had to fire. No server change in ST.6 at all (Studio-sealed lane, as designed).
- **D20** (ST.7): four things. **(a) Sha reconciliation** — ST.6's recorded `b65266f` was an amend-orphan (`git merge-base --is-ancestor b65266f HEAD` → false); real ST.6 commit is `00b9615` (= HEAD at ST.7 start). Corrected in the ledger + `last-commit` + codemap header + §11. Same sha-stamp trap as D16/D17/D18/D19. **(b) `App.tsx` needed NO edit** — the plan's edit-list included `App.tsx` ("prop type only"), but `StudioSeed` is imported by App and `openStudio` is generic over it, so widening `StudioSeed` in `Studio.tsx` (adding `template?: 'quote'|'thread'`) is structurally sufficient; typecheck green with App untouched. `Composer.tsx`'s inline `onMakeVisual` prop type was widened to `{text; postId?; template?: 'quote'|'thread'}` and `onMakeVisual={openStudio}` still typechecks (same shape). **(c) Thread cover + list card are BOTH `supportsAiBackground:true`** — the plan said "both honor kit.mascot/patterns via the Task 4 `baseLayers` signature", and patterns only reach templates whose TEMPLATES row is bg-capable (ST.4 gotcha), so both carry `background?`/`patternKind?`/`patternSeed?` and get the full gradient/pattern/AI segmented control for free. **(d) The list card has NO mascot** (the plan describes the thinking mascot only on the thread cover; the list's ≤6 rows fill the card). The thread cover's thinking mascot is bottom-right, suppressed under an AI background like the quote card. **Binds ST.9:** the thread mascot coords (x:1030,y:548,scale:0.55) and both cards' layouts are QA-adjustable in the browser walk (same de-risking spirit as D16's mascot placements).
- **D21** (ST.8): three things. **(a) Sha reconciliation** — ST.7's recorded `2104f46` was an amend-orphan (`git merge-base --is-ancestor 2104f46 HEAD` → false); real ST.7 commit is `acd95ec` (= HEAD at ST.8 start). Corrected in the ledger + `last-commit` + codemap header + §11 (the §11 ST.7 line had a literal `→**ST.7 sha**` placeholder — now `acd95ec`). Same sha-stamp trap as D16–D20. **(b) `heatmapCells(cells, minN=3)` takes minN** — the plan wrote `heatmapCells(cells)`, but `BestTimeCell` carries no `sufficient` field; the S0.4 gate is `BestTimesResponse.minN`, so the signature needs it. Default `HEATMAP_MIN_N=3` (the server also gates its `top` at 3). The shell passes `best.minN`. `heatmapCells` emits the FULL 7×24 grid (168 cells) so the template just places each — a cell below `minN` OR with no `avgViewsPerDay ?? avgViews` value is `sufficient:false`/`intensity:null` (renders the muted ink wash). Intensity = min→max over the sufficient set; a flat set → uniform 0.5 (guarded span, never all-invisible). **(c) Chart card is NOT bg-capable** (`supportsAiBackground:false`, like the stat card) — the plan was silent; an AI image behind a data chart would fight it, so no `patternKind`/`patternSeed` threading and no bg segmented control. `growthSeries` returns RAW follower points (the `sparkline` layer does its own min/max fit via `sparklineCoords`) — no normalization in chartData for growth. **Binds ST.9:** the chart card's two live-data fills (account series → growth, best-times → heatmap) + below-gate muting are the browser-walk items; both are $0 reads.
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
- **UI.10 rail is now GROUPED.** App.tsx uses `TAB_GROUPS` (Operate/Author/Library/Learn/System eyebrow clusters), not the old flat `TABS` — a later task adding a tab adds it to a group. The vertical 104px rail's layout rules live at styles.css `.app`/`.topbar`/`.brand`/`.tab-group` **~L265+** (the plan's "rail/topbar ~L44-100" pointer is STALE — L44-100 is the UI.8 token block). `.topbar` is still the class name despite being a sidebar.
- **UI.10 primitives are INERT except `EmptyState`** (wired into App.tsx's not-configured branch — the "used by the shell" done-when). `Section`/`SubTabs`/`SettingRow`/`Slider`/`GearPopover` + `settingsClient.{loadSettingGroups,flattenSettings,patchSetting,resetGroup,resetKeys}` + `api.settings.{get,patch,reset}` are exported but UNWIRED — first real consumers are UI.11 (Settings rebuild) + the Wave-5 inline gears (UI.12–15). Per D7 this is foundational, not dead code; don't delete on an "unused" pass.
- **UI.10 brandmark reuses `/icons/icon128.png`** (byte-identical to DS `assets/logo.png`, md5 `d06f9c20…`) — no separate logo asset added; the plan's "copy logo.png → public/icons" was a no-op since icon128 already sits there and serves from dist root.
- **Settings types are extension-local mirrors** — `SettingEntry`/`SettingsGroup`/`SettingsResponse`/`SettingsPatchResult`/`SettingsResetResult` in `extension/src/shared/types.ts` (re-exported via api.ts), mirroring the `GET /x/settings` JSON. The extension MUST NOT import `src/x/settings/registry.ts` (§5 build-isolation). **Binds UI.2/UI.11:** if the server `SettingDef` shape gains a field the editor needs, hand-sync it into `SettingEntry`.
- **`exactOptionalPropertyTypes` pass-through pattern (UI.10):** primitives forwarding a maybe-undefined optional (`Slider.unit`, `SettingRow.onReset`, `GearPopover.onReset`/`label`) type the prop as `T | undefined` explicitly — else TS rejects `prop={maybeUndefined}`. Reuse this for new primitives that relay optionals.
- **UI.10 rail regrouping is UNVERIFIED IN A BROWSER** (like UI.9's palette). Extension typecheck + Vite build + changed-file lint are green and the CSS compiles, but the visual QA (grouped rail spacing, brandmark, EmptyState, popover) rides the Wave-5 polish passes (UI.12–16 done-whens), per D7/D14.
- **ST.2 registry contract (the S5 template-authoring API):** `extension/src/sidepanel/studio/registry.ts` owns `TemplateId` (union), `TEMPLATES` (metadata rows), `templateMeta(id)`/`supportsAiBackground(id)` helpers, `EMPTY_STAT`, the `TemplateState` interface (every per-template input the shell holds), and `buildSpec(id, state, kit) → RenderSpec` (a switch, exhaustive on the union). To add a template downstream: (1) extend the `TemplateId` union + add a `TEMPLATES` row (set `supportsAiBackground`), (2) add the template's inputs to `TemplateState` + a `case` in `buildSpec`, (3) add a field component to `fields.tsx` + one `{template === 'x' && <XFields .../>}` line in the shell's JSX. `supportsAiBackground(id)` **replaced the old `BG_TEMPLATES` set** — use it, it reads the metadata row. Card size is now `{w,h}` (object), not the `"1200×675"` string — display is `${size.w}×${size.h}`; save/download read `.w`/`.h` directly (always finite, so the old `Number.isFinite` guards are gone). **ST.2 is behavior-neutral & UNVERIFIED IN A BROWSER** — extension build+typecheck+lint green, `templates.test.ts`/`brandKit.test.ts` untouched (142 ext tests pass); pixel-identical rendering is asserted by construction, not yet eyeballed (rides ST.9's browser walk).
- **`StudioSeed` stays exported from `Studio.tsx`** (the shell) post-ST.2 — App.tsx's `import { StudioPanel, type StudioSeed } from './Studio.tsx'` is unchanged. ST.7 adds `template?: 'quote' | 'thread'` to `StudioSeed` there (still in the shell), not in registry.ts.
- **ST.3 mascot is BROWSER-VERIFIED** (unlike ST.1/ST.2 which deferred to ST.9): rendered the real `mascotLayers` output onto a canvas via a throwaway HTTP harness — all 4 poses draw a clean lobed cloud, the stat pose-flip is visible (celebrating has confetti+arm-puffs, idle is a plain happy cloud), quote/stat/banner placements are collision-free. The hand-authored `CLOUD_PATH` + face arcs are validated. ST.9's full-Studio browser walk still owns the in-panel toggle/preset re-skin check, but the geometry is no longer a risk.
- **ST.3 pattern — mascot is `path`-only + one shared box (S5.3):** every mascot feature (body, eyes, mouth, arms, confetti, thought-trail) is a `path` layer sharing the SAME `box: {x, y, w:100*scale, h:80*scale}` 100×100 viewbox — `circlePath(cx,cy,r)` builds filled dots as SVG arcs, so there's no per-feature canvas math and the whole thing is one coordinate system. Sleeping adds one `text` "zzz" (plain text — repo no-emoji rule §7.31). Colours are ALL `shade(kit.accent, …)` (body fill 0.85, face ink −0.55), so the mascot re-skins for free when ST.4's presets change the accent — **do not hardcode a mascot hex.** Templates guard with `if (kit.mascot && !data.background …)` — the byte-identity regression tests (`mascot:false` === pre-task) lock this; keep it when ST.5/ST.7/ST.8 add cards that should carry the mascot.
- **`BrandKit.mascot` is a REQUIRED boolean field now (default true).** ST.4 rewrites `brandKit.ts` for multi-preset storage (`studio:brandKits`) + built-in starter presets (`Midnight`/`Paper`/`Neon`) — each preset constant and the lenient multi-parse MUST carry `mascot` (fallback true), or a preset load drops the field and typecheck breaks. The 3 full-kit test literals (`templates.test.ts` mascot:false, `brandKit.test.ts` mascot:false, `mascot.test.ts` mascot:true) are the only other places a kit is spelled out in full.
- **ST.4 landed: `loadBrandKit`/`saveBrandKit` (single-kit) are GONE.** Storage is now the bundle API: `loadBrandKits()`/`saveBrandKits(bundle)` + `activeKit(bundle)` for the current kit. `loadBrandKits` migrates a legacy `studio:brandKit` value into `kits.default` on first load, else seeds `STARTER_KITS`, and keeps writing the legacy key for the active kit (rollback safety). The pure preset mutations (`patchActiveKit`/`setActivePreset`/`savePresetAs`/`renamePreset`/`deletePreset`/`canDeletePreset`) never touch chrome.* — the shell wraps them in `applyBundle(fn)` which persists. `parseBrandKitsFile` (import) accepts BOTH the multi bundle AND a legacy single-kit JSON.
- **ST.5 celebration cards suppress the mascot on null data.** `milestoneCardSpec`/`streakCardSpec` render a graceful placeholder ("no milestone crossed yet" / "no streak yet — show up today") when the value is null AND drop the celebrating mascot (nothing to cheer). The `templates.test.ts` blocks lock this (null → no `path` layer). Both cards' data comes resolved from the shell: **override beats auto** (a typed number wins over the account/streak read), and the milestone's `dateLabel` ("reached YYYY-MM-DD") only shows when the auto value is in effect (an override has no crossing date). `milestoneData`/`streakData` are `useMemo`-stabilized in `Studio.tsx` so their fresh-object identity doesn't retrigger the debounced render effect every render.
- **ST.5 streak start-date is derived, not stored.** `brief.quests.streak` only carries `{current, todayComplete}` — no start date — so `Studio.tsx` computes "since" as `today − (current−1) days`. If a future task adds a real streak-start to the brief, prefer it over this derivation.
- **ST.6 code card is measure-free by design — `MONO_ADVANCE = 0.6` is exact, not a guess.** JetBrains Mono is 600 advance units on a 1000 em, so a token at column `c` sits at `codeLeft + c·fontSizePx·0.6` with zero canvas `measureText`. That's WHY the mono font is bundled (the ratio must be identical across machines). `codeCardSpec` caps at 18 lines / 62 cols (`CODE_FONT_PX=22`, panel `{72,44,1056,588}`); over-cap → `⌄ trimmed` footer (U+2304, a symbol not an emoji — the repo no-emoji rule is unaffected). Token boxes are given a generous width (`text.length·fontSizePx+8`, ≫ 0.6 advance) so a single-line left-aligned token can never wrap/ellipsize even if the real glyph advance drifts slightly from 0.6. **ST.6 is UNVERIFIED IN A BROWSER** (like ST.1/2/4/5) — the in-panel pixel/column check rides ST.9's Studio walk; the layout math itself is asserted in `templates.test.ts` (column x-diff === colDiff·size·MONO_ADVANCE).
- **ST.6 fonts came from fontsource (jsDelivr `jetbrains-mono@latest` latin-400/700 woff2, ~21KB each), not the official JetBrains release.** They are the same OFL-1.1 JetBrains Mono, latin-subset (smaller = fine for code cards). If ST.9/QA finds a needed glyph missing, swap for the full official woff2. The two files are `extension/public/fonts/JetBrainsMono-{Regular,Bold}.woff2`; Vite copies `public/` → dist root, so they serve at `/fonts/…` and `chrome.runtime.getURL('fonts/…')` resolves (same path as Inter — no manifest/`web_accessible_resources` change; the side panel is an extension page).
- **ST.7 thread cover + list card are the two NEW background-capable templates** (bringing the bg-capable set to quote/banner/thread/list). `parseListItems(raw)` lives in `templates.ts` (exported): trim → drop blanks → strip a leading `\d+[.)]` or `-*•` marker **followed by whitespace** (`/^\s*(?:\d+[.)]|[-*•])\s+/`, so "3 lessons" with no punctuation stays whole) → cap 6. The list card's accent number disc is a `ring` with `width = 2r` (r=11,width=22 → filled disc radius 22), the same trick the pfp monogram uses; the digit ink is `contrastOn(kit.accent)`. The thread cover badge is `['a thread', '1/N']` (plain text, §7.31; N = `max(1, round(count))`). Both cards call `baseLayers` so patterns/AI-bg compose; the thread's thinking mascot is guarded `kit.mascot && !data.background`. **ST.7 is UNVERIFIED IN A BROWSER** (like ST.1/2/4/5/6) — the Composer→thread-cover seed handoff, the list render, and both cards' pixels ride ST.9's Studio walk; the pure spec math + `parseListItems` are bun-tested (55 tests in templates.test.ts). Seed routing lives in `Studio.tsx`'s effect (`seed.template === 'thread' ? 'thread' : 'quote'`), not the registry — component-level, covered by ST.9's browser check per the plan.
- **ST.8 chart card is the 9th and last S5 template — Lane C is code-complete but UNVERIFIED IN A BROWSER** (like ST.1/2/4/5/6/7). Pure spec + `chartData` gate/normalization are bun-tested (148 studio tests, 239 ext total, typecheck+build+changed-file lint green); the live 30-day follower curve, the real best-times heatmap, and the below-gate muting all ride ST.9's Studio walk. `heatmapCells` intensity uses **min→max** normalization over the sufficient set (NOT absolute 0..max) — the least-active measured cell reads at the 0.15 alpha floor, the most-active at 0.9; a flat measured set is uniform 0.5. If ST.9's browser check finds the heatmap too washed-out on a thin single-user sample, that's the knob to revisit (raise the 0.15 floor or switch to absolute normalization), QA-adjustable like the other ST card placements.
- **ST.4 patterns only reach background-capable templates (quote, banner).** `baseLayers(kit,w,h,bg,scrimAlpha,pattern?)` is the only pattern injection point and only quote/banner use it (stat/pfp call `background(kit)` directly). A new bg-capable card (ST.5/ST.8) gets the background segmented control **for free** if its `TEMPLATES` row sets `supportsAiBackground:true` — BUT its data interface must carry `patternKind?`/`patternSeed?`, its `buildSpec` case must forward `state.patternKind`/`state.patternSeed` (conditional-spread — `exactOptionalPropertyTypes`), and its spec must call `baseLayers(..., patternArg(data.patternKind, data.patternSeed))`. The bg segmented control (`gradient|dots|grid|diagonal|plus|blobs|ai`) is inline in `Studio.tsx` and gates on `supportsAiBackground(template)`; `bgMode` is the single source of truth, `patternKind` derives from it (don't add a second patternKind state — biome exhaustive-deps flagged it).

## Planning-error log

Corrections to MASTERPLAN.md itself (wrong dep, wrong order discovered live). (empty)
