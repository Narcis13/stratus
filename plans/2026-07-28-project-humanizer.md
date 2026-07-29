# Project-level humanizer — jitter on Radar reply picks

- **Status:** planned 2026-07-28 · not started
- **Goal fit:** Goal 4 (Circles — relationship-aware drafting): the Radar's AI-drafted replies gain the same "doesn't read as a form letter" jitter the canned-reply lists already have.
- **Cost impact:** **$0.** No X calls, no LLM calls. One new always-mounted $0 route pair; the jitter runs client-side in the panel at pick time.
- **Invariants touched:**
  - §7.13 — the settings upsert is ONE sync txn (trivially, a single `.run()`).
  - §7.16 — `app_settings` is explorer/MCP-visible; the humanizer config holds no secrets, so a raw key there is fine (the AI-settings 'ai'-key precedent, D1: NOT a registry key, so the UI.1 store never touches it).
  - §7.19 — measurement metadata honesty: jitter is **pick-time, never stored** (RL.9's rule). `radar_drafts.variants` stay verbatim; the humanized text is recorded only as what actually went out, via the existing `replyTextEdited` PATCH.
  - §7.20 — the new router is static-paths-only (`GET/PATCH/DELETE /x/humanizer`); keep it that way.
  - §7.28 — posting stays a manual paste; nothing here auto-posts.
  - Shared-module rule (§7, replyBand/postCoach discipline): the promoted core is zero-dep + IIFE-safe, config arrives as an ARGUMENT, the module reads no store.
- **Codemap sections relevant:** §3.1 (`src/shared/`), §3.3 (`replyLists/engine.ts`, `settings/`, routes `replyLists.ts`/`radar.ts`/`replies.ts`, `index.ts` mounts), §5 (`Radar.tsx`, `Settings.tsx`, `ReplyLists.tsx`, `api.ts`, `shared/types.ts`, shims + `tsconfig.app.json`), §9 (smoke scripts).

## Why / what changes for the user

Today the humanizer (prefix/suffix/lowercase/drop-period/typo jitter) only fires on canned-reply-list picks. After this plan, the Radar tab carries a **"Humanize picks" checkbox**: when checked, clicking an angle on a drafted radar row copies a jittered version of the variant (e.g. `honestly, great breakdown` instead of `Great breakdown.`), and the hint line says exactly which jitters fired (`copied ✓ · jitter: prefix, lowercase` / `· no jitter this time`). The chances and prefix/suffix pools are a **project-level config** editable in Settings → General ("Reply humanizer"), stored server-side, shared by any future surface. The stored drafts and the per-list humanizers are untouched.

## Design

**Data:** no new table, no migration. One new `app_settings` row, key `'humanizer'`, value = `HumanizerSettings` JSON (`HumanizerConfig & {enabled: boolean}`). Missing row = defaults (`DEFAULT_HUMANIZER` + `enabled: false`). Rollback story: delete the row / leave the checkbox off — every other surface is byte-identical.

**Pure logic:** the humanize half of `src/x/replyLists/engine.ts` (RL.1) moves to a new zero-dep `src/shared/humanize.ts`: `HumanizerConfig`, `DEFAULT_HUMANIZER`, `parseHumanizerConfig`, `resolveHumanizer`, `humanize` (fixed `HUMANIZE_DRAWS`=10, protected spans, `applied: string[]`), `MAX_REPLY_LENGTH`, plus a pure `jitterOdds(cfg)` (lifted from `ReplyLists.tsx`). `engine.ts` re-exports all of it so every existing importer and all 39 RL.1 tests stay byte-compatible. New extension shim `extension/src/humanize.ts` (7th `tsconfig.app.json` include entry).

**Routes:** new `src/x/routes/humanizer.ts` (always mounted in `src/x/index.ts` next to `replyListsRouter`, $0), backed by `src/x/settings/humanizer.ts` (the `src/llm/settings.ts` shape: read-through, NO cache, field-by-field sanitize):

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/x/humanizer` | — | 200 full `HumanizerSettings` |
| PATCH | `/x/humanizer` | partial: `enabled?`, `prefixes?`, `suffixes?`, the 5 `*Chance?` | 200 full settings after write; 400 per field (`invalid_enabled`, `invalid_prefixes`, `invalid_suffixes`, `invalid_prefix_chance`, …), 400 `empty_patch`, 400 `invalid_body` |
| DELETE | `/x/humanizer` | — | 200 defaults (row deleted = reset) |

PATCH is strict per-field (the `parseAiPatch` idiom — a typo'd value 400s, never silently falls back; lenient parse is only for reading stored rows). Pools: arrays of strings, trimmed, empties dropped, ≤25 entries × ≤60 chars. Chances: finite numbers in [0,1].

**Extension:** `api.humanizer.{get,patch,reset}` in `api.ts`; `HumanizerSettings` in `shared/types.ts` extending the shim's `HumanizerConfig` (§7 rule 4c — never re-type). `Radar.tsx` loads the config once per mount (failure → feature silently off; decoration never breaks the queue), renders the checkbox, and `onPick` runs `humanize(picked.text, config, Math.random, [author, handle])` before the clipboard write and `confirmDraft(tweetId, text)` — the existing RD.2 background path then records the jittered text as `replyTextEdited` with **zero server change**, which is the whole measurement story. `Settings.tsx` General gains a `HumanizerCard` (Section "Reply humanizer") reusing the RL.9-hardened `HumanizerEditor` idioms.

**Measurement:** the humanized text lands in `reply_drafts.replyTextEdited` via the existing paste path, so RU.9's source-exact Playbook attribution is unaffected (source beats text-match — proven by `smoke-radar-reply-flow.ts`). No new Playbook cell now; a `humanized vs verbatim` outcome cell is a future, n≥20-gated follow-up (see Out of scope).

## Decisions taken

1. **Client-side jitter at pick time, not server-side at generate/confirm.** Storing jittered variants would violate RL.9's "jitter is pick-time, never stored"; humanizing at confirm would put the jitter after the clipboard write. The panel is online anyway (drafting requires the server), and the repo's habit for exactly this shape is a shared pure core + shim (replyBand, postCoach, postFormat, judge).
2. **Config home: server-owned `app_settings` key** (user choice via AskUserQuestion, 2026-07-28). The AI-settings precedent (`llm/settings.ts`, D1): a raw JSON key, NOT a registry entry — the registry has no string-array type and the UI.1 store must never touch non-registry keys.
3. **Scope: Radar panel only** (user choice). On-page RU.7 variant chips, Reply Master, Conversations and Launch Room pickers stay verbatim.
4. **`enabled` lives inside the server config**, not in `chrome.storage.local` — the checkbox is an optimistic PATCH. One flag any future surface reads; survives extension reinstall.
5. **The checkbox defaults OFF** — the user asked for opt-in ("optionally, if we check a checkbox").
6. **The engine keeps re-exporting** rather than callers migrating imports: `routes/replyLists.ts` and `engine.test.ts` stay untouched, and the untouched test suite IS the proof the move changed nothing.
7. **CoachChip keeps scoring the verbatim variant.** The jitter is decided at click time; re-scoring humanized text would be noise (the RU.7 "no score at paste time" call).
8. **Per-list humanizers are untouched.** The project config is a sibling, not a replacement; lists keep their own overrides.

## Done when

- [ ] With the checkbox ON, clicking an angle in the Radar tab copies a text that (over repeated picks, at default chances) sometimes differs from the stored variant, and the hint names the applied jitters or says `no jitter this time`. Browser-verified.
- [ ] With the checkbox OFF (or the config never touched), the pick path is byte-identical to today.
- [ ] The humanized text — not the verbatim variant — is what `reply_drafts.replyTextEdited` records (visible in the Replies tab history / explorer).
- [ ] `GET/PATCH/DELETE /x/humanizer` round-trips survive a server restart, and `scripts/smoke-humanizer.ts` passes $0 against the real DB.
- [ ] All 1855+ existing tests still pass — especially `engine.test.ts` unmodified.

---

## Task 1: Promote the humanize core to `src/shared/humanize.ts` + extension shim  [parallel-ok]
**Depends on:** none
**Session budget:** ~5 files, mostly moved lines (~250 moved + ~40 new)

**Read first:** codemap header + §3.1 + §3.3 (`replyLists/engine.ts` row); `src/x/replyLists/engine.ts` (whole file, 464 lines); `extension/src/postCoach.ts` (the 5-line shim exemplar); `extension/tsconfig.app.json`; `extension/src/sidepanel/ReplyLists.tsx:900-930` (`jitterOdds`).

**Edit:**
- `src/shared/humanize.ts` (new) — the humanize half of the engine, moved verbatim.
- `src/x/replyLists/engine.ts` — delete the moved code; re-export it; import what its remaining half needs.
- `extension/src/humanize.ts` (new) — `export * from '../../src/shared/humanize.ts';` shim.
- `extension/tsconfig.app.json` — add `"../src/shared/humanize.ts"` to `include`.
- `extension/src/sidepanel/ReplyLists.tsx` — delete the local `jitterOdds`, import it from `../humanize.ts`.

**How:** Move these exports verbatim: `MAX_REPLY_LENGTH`, `HumanizerConfig`, `DEFAULT_HUMANIZER`, `HumanizeResult`, `parseHumanizerConfig`, `resolveHumanizer`, `HUMANIZE_DRAWS`, `humanize` — plus the private helpers only they use: `parsePool`, `parseChance`, `pickFrom`, `stripEdges`, `isProtectedWord`, `findFirstLetter`, `wordAt`, `lowercaseFirstLetter`, `TypoTarget`, `typoTargets`, `offset`, `neighborKey`, `mutate`, `QWERTY_ROWS`, `TYPO_KINDS`/`TypoKind`, and the regex constants they reference (`LETTER_RE`, `SPACE_RE`, `LETTERS_ONLY_RE`, `LEADING_NON_LETTERS_RE`, `TRAILING_NON_LETTERS_RE`, `URL_ISH_RE`). The render/pick half (`renderTemplate`, `pickItem`, `composeReply`, `stripEmoji`, `templateVars`, `availableVarsFor`, `TEMPLATE_VARS`, `ReplyVars`, `RenderResult`, `ComposeResult`, `PickableItem`, `EMOJI_RE`, `VAR_SLOT_RE`…) **stays in `engine.ts`**, which adds `export { … } from '../../shared/humanize.ts'` for everything moved and a plain import for any helper the remaining half shares (check whether `pickItem` uses `pickFrom` and whether `renderTemplate`/`composeReply` use `LETTER_RE` etc. — export shared privates from `humanize.ts` if so; a server module importing `src/shared/` is normal). Add `export function jitterOdds(cfg: HumanizerConfig): number` (the `1 − Π(1−pᵢ)` form from `ReplyLists.tsx:917`, with the empty-pool ⇒ that roll can't fire refinement it already carries). `humanize.ts` must have **zero imports** (IIFE-safe — the shim inlines it into the sidepanel build; the `serverSettings.ts` discipline). Do NOT change any behavior, constant, or draw order — `HUMANIZE_DRAWS` positional mapping is pinned by stubbed-rng tests.

**Tests:** none new; `src/x/replyLists/engine.test.ts` stays **byte-untouched** and green — that is the compatibility proof. `cd extension && bun run build` proves the shim + tsconfig entry.

**Done when:**
- [ ] `engine.test.ts` passes without modification; `git diff` shows it untouched.
- [ ] `src/shared/humanize.ts` has zero import statements.
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green; `cd extension && bun run build` green.
- [ ] Committed: `refactor(humanize): promote the humanizer core to src/shared with an extension shim`

**Cost note:** $0.

---

## Task 2: Server-owned humanizer settings — store + `GET/PATCH/DELETE /x/humanizer`  [parallel-ok]
**Depends on:** Task 1 (imports `parseHumanizerConfig`/`DEFAULT_HUMANIZER` from `src/shared/humanize.ts`; if run first, import from `engine.ts` and fix up after)
**Session budget:** ~4 files (3 new), ~300 lines incl. tests

**Read first:** codemap header + §3.2 (`llm/settings.ts` row) + §3.3 (`index.ts` mounts, `routes/replyLists.ts` row); `src/llm/settings.ts` (whole file — the shape to imitate); `src/llm/routes.ts` (PATCH per-field 400 idiom); `src/x/index.ts` (mount block); `src/x/routes/replyLists.test.ts:1-60` (bare-Hono test harness setup).

**Edit:**
- `src/x/settings/humanizer.ts` (new) — key + types + get/save/reset over `app_settings`.
- `src/x/routes/humanizer.ts` (new) — the three routes.
- `src/x/index.ts` — mount `humanizerRouter` (always, next to `replyListsRouter`).
- `src/x/routes/humanizer.test.ts` (new).

**How:** `src/x/settings/humanizer.ts` mirrors `llm/settings.ts` (D1): `HUMANIZER_SETTINGS_KEY = 'humanizer'`; `interface HumanizerSettings extends HumanizerConfig { enabled: boolean }`; `DEFAULT_HUMANIZER_SETTINGS = { ...DEFAULT_HUMANIZER, enabled: false }`; `getHumanizerSettings()` = read the row (read-through, **no cache** — the loadDoctrine discipline), sanitize: `parseHumanizerConfig(value) ?? DEFAULT_HUMANIZER` for the config part, `value?.enabled === true` for the flag (garbage/schema-drift row → defaults, never a throw); `saveHumanizerSettings(next: HumanizerSettings)` = one upsert (`onConflictDoUpdate` on `key`, the `setSettings` idiom, §7.13); `resetHumanizerSettings()` = delete the row. **Not a registry key** — never touch `settings/registry.ts` or the UI.1 store. Routes (`routes/humanizer.ts`, pillars.ts validation idiom): GET → `getHumanizerSettings()`. PATCH → parse body object (400 `invalid_body`), then per-field strict validation à la `parseAiPatch`: `enabled` boolean (`invalid_enabled`); `prefixes`/`suffixes` arrays of strings, trim, drop empties, refuse >25 entries or any entry >60 chars (`invalid_prefixes`/`invalid_suffixes` — refused, not clamped, the RL.4 `invalid_count` reasoning); each `*Chance` a finite number in [0,1] (`invalid_prefix_chance`, `invalid_suffix_chance`, `invalid_lowercase_chance`, `invalid_drop_period_chance`, `invalid_typo_chance`); no recognized field → 400 `empty_patch`; merge over current, save, return the full saved settings. DELETE → reset, return defaults. Static paths only (§7.20 — never add a `:param` here).

**Tests:** `routes/humanizer.test.ts`, bare-Hono `app.request` over the shared in-memory DB (replyLists.test.ts harness): GET returns defaults with `enabled:false`; PATCH `{enabled:true}` round-trips; PATCH each config field + GET shows the merge; the full 400 matrix (bad body, each `invalid_*`, chance 1.5 / −0.1 / `'0.5'`, 26-entry pool, 61-char entry, `empty_patch`); a hand-inserted garbage row (`value: '"nonsense"'`) degrades GET to defaults; DELETE resets after a PATCH. `afterAll` deletes the row (shared in-memory DB — don't leak into other suites' `app_settings` reads).

**Done when:**
- [ ] `curl`-level: PATCH then GET returns the patched config; DELETE returns defaults.
- [ ] All new tests green; no other suite's count changed.
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green.
- [ ] Committed: `feat(humanizer): project-level humanizer settings + $0 GET/PATCH/DELETE /x/humanizer`

**Cost note:** $0 — pure SQL over `app_settings`; nothing in the file can reach `xFetch` or `askLLM`.

---

## Task 3: Radar checkbox + humanize-at-pick
**Depends on:** Task 1, Task 2
**Session budget:** ~4 files, ~150 lines

**Read first:** codemap header + §5 (`Radar.tsx`, `api.ts`, `shared/types.ts` rows); `extension/src/sidepanel/Radar.tsx` (whole file, 526 lines — especially `RadarRow.onPick` at ~line 356); `extension/src/sidepanel/api.ts` (one existing namespace, e.g. `api.judge`, for the method shape); `extension/src/shared/types.ts` (where RL types sit); `extension/src/humanize.ts` (Task 1's shim).

**Edit:**
- `extension/src/shared/types.ts` — `HumanizerSettings` = `HumanizerConfig & {enabled: boolean}` importing `HumanizerConfig` from `../humanize.ts` (§7 rule 4c — extend the shim type, never re-type seven fields); `HumanizerPatchBody` (all fields optional).
- `extension/src/sidepanel/api.ts` — `api.humanizer.{get, patch, reset}` over `GET/PATCH/DELETE /x/humanizer` (all three now, so Task 4 doesn't touch this file's namespace twice).
- `extension/src/sidepanel/Radar.tsx` — config load, checkbox, jittered pick.
- `extension/src/sidepanel/styles.css` (or the styles file Radar's classes live in) — one small `.radar-humanize` rule.

**How:** In `RadarSection`: a `useState<HumanizerSettings | null>(null)` loaded once on mount via `api.humanizer.get(settings)` with a silent catch → stays `null` (decoration on the queue must never block it — the HV.3 status-line discipline). Render the checkbox as a `.radar-humanize` label row right under the `.radar-tabs` strip, only in the `queue` view: `☐ Humanize picks` with a `title` stating the jitter is applied at pick time and never stored, plus a muted `~N% of picks come out changed` from `jitterOdds(config)` (shim import). Checked = `config?.enabled ?? false`; disabled while `config === null`. onChange: optimistic local flip, then `api.humanizer.patch(settings, {enabled})`; on failure revert and surface via the existing `note` state. Thread the config + enabled flag into `RadarRow` as a prop (e.g. `humanizer: HumanizerSettings | null`). In `onPick`: when `humanizer?.enabled`, compute `const jittered = humanize(text, humanizer, Math.random, [s.author ?? '', s.handle].filter((v) => v !== ''))` and use `jittered.text` for BOTH `navigator.clipboard.writeText` AND `confirmDraft(s.tweetId, …)` — the background's existing RD.2 path records it as `replyTextEdited` (do NOT touch `background.ts` or `messages.ts`; zero wire change). Replace the boolean `copied` state with `pickNote: string | null`: `copied ✓ · jitter: prefix, typo:swap` from `jittered.applied.join(', ')`, or `copied ✓ · no jitter this time` when the array is empty, or plain `copied ✓` when the feature is off (RL.9's honesty pattern — the answer to "the humanizer does nothing"). `CoachChip` inputs stay the verbatim variant texts (decision 7). Do not humanize in the `clicked` view re-render — the jitter happened at pick time and is not re-derivable; the row keeps showing the stored variant.

**Tests:** none — panel components are untested by repo convention; the jitter engine itself is pinned by `engine.test.ts`. Gates: `bun test`, both typechecks, `cd extension && bun run build` (grep the emitted `dist/sidepanel.js` for `radar-humanize` as the build sanity check). Browser verification is Task 5's checklist.

**Done when:**
- [ ] Checkbox renders, persists across a panel close/reopen (server round-trip), and stays off/disabled when the server is unreachable.
- [ ] With it on, picks copy jittered text and the hint names the applied steps.
- [ ] `bun test` + `bun run typecheck` + `bun run lint` + extension build green.
- [ ] Committed: `feat(radar): optional humanize-at-pick with server-owned toggle`

**Cost note:** $0 — one $0 GET per panel mount + one $0 PATCH per checkbox toggle.

---

## Task 4: Settings → General "Reply humanizer" editor card
**Depends on:** Task 2, Task 3 (api namespace + types)
**Session budget:** ~3 files, ~200 lines

**Read first:** codemap header + §5 (`Settings.tsx`, tab-components row — the RL.9 paragraph); `extension/src/sidepanel/ReplyLists.tsx` — the `HumanizerEditor` + `TestRender` components (~lines 700–930) as the form exemplar; `extension/src/sidepanel/Settings.tsx` (General view structure: the four `Section`-wrapped panels).

**Edit:**
- `extension/src/sidepanel/HumanizerCard.tsx` (new) — the editor.
- `extension/src/sidepanel/Settings.tsx` — mount `<HumanizerCard settings={settings} />` in the General view, after "Behavior & privacy".
- `extension/src/sidepanel/styles.css` — reuse `.rl-*` classes where possible; add at most a couple of rules.

**How:** The card is a `Section title="Reply humanizer"` explaining scope in one line ("Applies to Radar picks when the Radar checkbox is on; each canned list still has its own override."). Form state mirrors `HumanizerEditor`'s RL.9-hardened contract exactly: load via `api.humanizer.get`; **dirty-track against the stored value with the same field order so a JSON compare is a value compare**; gate Save on `dirty`; print `Saved ✓`; re-sync the form keyed on `JSON.stringify(stored)` — not object identity — so an unrelated reload can't wipe half-typed pools. Pools are **one-per-line textareas, never comma-split** (`DEFAULT_HUMANIZER.prefixes` contains `'honestly,'`). Five chance inputs (number, step 0.05, client-side [0,1] guard mirroring the route's `invalid_*` codes so a bad value gets a message, not a bare 400). `enabled` checkbox included (same flag the Radar checkbox flips — say so in the copy). A `jitterOdds` line (`~N% of picks come out changed`, shim import). "Reset to defaults" → `confirm()` → `api.humanizer.reset` → reload. Surface PATCH 400 codes inline per field (the TuningPanel refusal pattern: show the code, re-read GET rather than leaving a rejected value on screen).

**Tests:** none (panel convention). Gates + extension build; manual check over the loaded extension.

**Done when:**
- [ ] Editing a chance or pool in Settings changes the next Radar pick's behavior (verifiable with typoChance=1 or an all-zero config).
- [ ] Dirty-gating: an untouched form's Save is disabled; a reload mid-edit does not wipe typed text.
- [ ] `bun test` + `bun run typecheck` + `bun run lint` + extension build green.
- [ ] Committed: `feat(settings): project humanizer editor card in Settings → General`

**Cost note:** $0.

---

## Task 5 (final): docs-sync + smoke
**Depends on:** all prior.

- [ ] `scripts/smoke-humanizer.ts` — rerunnable, **$0, no `--live` flag** (nothing in this feature can spend): snapshot + restore the `app_settings` `'humanizer'` row (the `smoke-ai-layer.ts` snapshot/restore precedent — never wipe a real customization), then: mount `humanizerRouter` in-process over the REAL DB → GET (assert shape) → PATCH `{enabled:true, typoChance:1}` → GET round-trip → the 400 matrix spot-checks (`invalid_typo_chance`, `empty_patch`) → DELETE → assert defaults → restore the original row on exit AND on entry (idempotent cleanup, the `smoke-glance.ts` discipline). Plus pure-engine sanity: a seeded `mulberry32` loop over `humanize('Great breakdown of the tradeoffs @somebody', cfg, rng, ['somebody'])` asserting the protected handle is never mutated and `applied` only ever names known steps.
- [ ] Browser verification pass (the convention debt from Tasks 3–4): checkbox round-trip, one jittered pick with the hint line, Replies-tab history showing the jittered text as the posted/edited text.
- [ ] `docs/PHASE-HISTORY.md`: one phase entry (what shipped, date, $0, the pick-time-never-stored contract, the `replyTextEdited` measurement story). **Not CLAUDE.md** — no guardrail changed.
- [ ] `docs/radar-tab.md`: the checkbox + hint line + "jitter is pick-time, never stored; the stored variants stay verbatim".
- [ ] `docs/settings-tab.md`: the General card.
- [ ] `docs/replies-tab.md`: one line in the Lists section noting the project-level sibling config and that per-list overrides are unaffected.
- [ ] `.claude/skills/plan-feature/references/codemap.md`: §3.1 add the `src/shared/humanize.ts` row; §3.3 update the `replyLists/engine.ts` row (now re-exports the shared core) + add `settings/humanizer.ts` + the `routes/humanizer.ts` row + the `index.ts` mount; §5 update `Radar.tsx` / `Settings.tsx` / `api.ts` / `shared/types.ts` / shim + `tsconfig.app.json` rows; §9 add the smoke script; re-stamp the header. Also fold in the currently-undocumented `17672d1` (`fix(playbook): tolerate a server older than the extension build`) if the stamp walk still shows it missing.

## Out of scope (do NOT build)

- Humanizing the on-page RU.7 variant chips, Reply Master single-generate, Conversations, or Launch Room pickers (user-scoped to the Radar panel; revisit only on request).
- A Playbook `humanized vs verbatim` outcome cell — needs an explicit humanized marker on `reply_drafts` (today it's folded into `replyTextEdited`) and n≥20; a separate plan if the toggle sees real use.
- Server-side humanize in `generate-batch` or the confirm endpoint (would store jitter — forbidden by RL.9's contract).
- A registry group `x.humanizer.*` or mirroring the config into the UI.6 settings wire (the config is fetched by the one surface that needs it).
- Migrating `routes/replyLists.ts` / `engine.test.ts` imports to the new module path (the re-export IS the design).
- Any `Test render` / sample-×5 affordance in the Radar tab (exists in the Lists subtab; duplicate on demand only).

## Risks / watch items

- **Default pools were written for canned praise replies** (`'well said'`, `'love this'`): appended to a substantive AI-drafted reply a suffix can read as filler. The chances are opening guesses (recalibrate by taste in the Settings card, not by code); if suffixes grate in practice, the user empties that pool — an explicitly empty pool is honored by `parseHumanizerConfig`.
- **`humanize` is capped at `MAX_REPLY_LENGTH` 280**: a near-280 variant silently skips prefix/suffix (correct — skip, never truncate) so jitter fires less often on long replies; the hint's `no jitter this time` keeps that honest.
- The `clicked` view shows the stored verbatim variant, not the jittered text that was copied — acceptable (the jittered text lives in `reply_drafts.replyTextEdited`), but worth one line in `docs/radar-tab.md` so it doesn't get reported as a bug.
- Tasks 1 and 2 are parallel-ok only if Task 2 imports from `engine.ts` when it lands first; running them in order avoids the fix-up.
