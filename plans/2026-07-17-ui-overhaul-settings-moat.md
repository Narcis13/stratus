# Cockpit overhaul — design-system UI + the configurability moat

- **Status:** planned 2026-07-17 · not started
- **Goal fit:** all four goals — this is the surface through which every goal is operated. No new capability outside the ceiling; the overhaul restyles what exists and makes its behavior tunable.
- **Cost impact:** $0 recurring. No new X reads, no new Grok calls. Settings can *raise* existing spend ceilings, bounded by registry hard ceilings (see Decisions).
- **Invariants touched:** §7.13 (sync SQLite — settings store is sync reads), §7.19 (stat gates become configurable with floors; BAND recalibration stays manual-advice-only), §7.20 (new `/x/settings` route — no `:param` collisions), §7.22 (always-mounted, $0), §7.24–27 (background stays the single fetcher/writer of the mirrored settings blob; content script stays IIFE; no logic forks between server and page), §7.28 (untouched — nothing here posts), §8 budgets (soft/hard budget amounts become settings with ceilings; the *checks* are never disableable).
- **Codemap sections relevant:** §2 (root — design system + plans folders are new since stamp), §3.1, §3.3, §3.4, §5, §7, §9, §10. Codemap is **current** for `src`/`extension` (commits `c1d7901..f033142` touched only `plans/` and `Stratus Design System/`); the docs-sync task adds those two folders to §2.

## Why / what changes for the user

The side panel becomes a polished, breathing instrument that feels native beside X: every surface reads from the Stratus Design System tokens (`Stratus Design System/tokens/*.css`), ships **dark (default) and light** themes, gets a grouped tab rail, consistent chips/badges/empty-states, and room to breathe via a density setting. And configurability becomes the product's moat: a server-side settings registry (~60 knobs in this plan, growing with every future feature) editable from a genuinely crowded, searchable Settings tab — doctrine numbers, quest targets, follow-up windows, stat gates, band thresholds, budgets, AI cost caps, radar/launch behavior, display limits — plus inline gear-affordances next to the features they tune. Planned-but-unbuilt features (the 11 docs in `plans/`) appear as inert "coming soon" groups so the roadmap is visible in-product.

## Design

**Two workstreams, one plan.**

### W1 — Settings platform (data → store → routes → mirror)

- **Table:** `app_settings` in `src/db/shared-schema.ts` (platform-agnostic, like `cost_events`): `key` text PK, `value` text `{mode:'json'}`, `updated_at` integer `{mode:'timestamp_ms'}`. Migration `0013`. Only overrides are stored — a missing row means "default". Note: `plans/2026-07-17-ai-layer.md` already expects an `app_settings` table with this exact shape; this plan lands it first and that plan reuses it (its migration number shifts).
- **Store:** `src/settings/store.ts` — sync (`bun:sqlite`) read-through: `getSetting<T>(key): T` (override row else registry default), `setSettings(patch)`, `resetSettings(keys)`, in-process `Map` cache invalidated on every write. §7.13: no `await` inside, `.get()/.run()` terminals.
- **Registry:** `src/x/settings/registry.ts` — the single typed catalog. Entry shape:
  ```ts
  interface SettingDef {
    key: string;              // dot-namespaced: 'x.doctrine.replyTargetMin'
    group: string;            // 'doctrine' | 'quests' | 'people' | 'followups' | 'band' | 'gates' | 'workers' | 'budgets' | 'ai' | 'radar' | 'launch' | 'mentions' | 'display'
    label: string; description: string;   // description carries the "why"/warning copy
    type: 'number' | 'boolean' | 'string' | 'enum' | 'numberArray';
    default: unknown; min?: number; max?: number; step?: number;
    options?: string[]; unit?: string;    // 'days' | 'min' | 'usd' | '×' | 'h UTC' …
    scope: 'server' | 'mirrored';         // mirrored = also shipped to the extension blob
    appliesOn?: 'immediate' | 'restart';  // worker-cadence knobs are 'restart'
  }
  ```
  Validation is registry-driven: unknown key → 400 `unknown_setting`; type/range violation → 400 `invalid_setting_value`. **Floors and ceilings in the registry are the money/policy guard** (see Decisions).
- **Routes:** `src/x/routes/settings.ts`, always mounted under `/x` (bearer-guarded, $0):
  - `GET /x/settings` → `{ groups: [{ id, label, settings: [{ …def, value, isDefault }] }] }` — the UI renders from this; the extension never imports the registry.
  - `GET /x/settings/values?scope=mirrored` → flat `{ key: value }` — the extension mirror payload.
  - `PATCH /x/settings` body `{ [key]: value }` → validated per-key, all-or-nothing txn, returns updated entries.
  - `POST /x/settings/reset` body `{ keys?: string[], group?: string }`.
- **Consumption pattern (core discipline):** pure modules stay pure — they gain optional parameter objects defaulted to today's constants (`computeQuests(rows, opts = QUEST_DEFAULTS)`); **only routes and workers consult the store** and pass values down. Tests keep testing pure functions with explicit params; route tests assert the store is honored.
- **Extension mirror:** background (single fetcher, §7.25) pulls `GET /x/settings/values?scope=mirrored` on service-worker start, on a `stratus/settings-sync` message (panel mount, Settings save), and at a 5-min TTL; writes the flat blob to `chrome.storage.local['settings:server']`. New `extension/src/shared/serverSettings.ts`: `readServerSetting(blob, key, fallback)` + a `useServerSettings()` panel hook + an IIFE-safe content-script reader (init read + `chrome.storage.onChanged`). Baked defaults stay in code as fallbacks — a dead server never breaks the badge.
- **MCP:** two curated tools in `src/x/mcp.ts` via in-process `app.request` — `x_settings` (GET) and `x_update_setting` (PATCH, same validation). Registry ceilings mean an agent can never raise a budget past the hard cap.

### W2 — Design-system adoption (tokens → theme → primitives → tabs → other surfaces)

- **Tokens:** `extension/src/sidepanel/styles.css` `:root` is replaced by the full `--strat-*` token set copied from `Stratus Design System/tokens/{colors,typography,spacing,radii}.css`, with the current short names kept as aliases (`--bg: var(--strat-bg)` …) so the 2,437-line sheet keeps working; the 44 hardcoded hex/rgba occurrences outside `:root` are replaced with the tinted-fill/band/status tokens. Inter (already bundled at `extension/public/fonts/`) is `@font-face`d and becomes the panel font; metric numbers get `font-variant-numeric: tabular-nums`.
- **Light theme:** a `:root[data-theme='light']` override block (opening palette in Task 9; AA contrast is the acceptance bar), `data-theme` stamped on `<html>` by `sidepanel/main.tsx` from a local `theme` setting (`system|dark|light`, default `system→dark`) + `matchMedia` listener. Content-script overlays are **exempt** — they follow X's page theme via theme-neutral rgba, not the panel theme.
- **Appearance knobs (local, chrome.storage):** `theme`, `density` (`cozy` default | `compact` — a `[data-density]` block overriding ~6 spacing vars), `uiScale` (12/13/14px root font).
- **Primitives:** `extension/src/sidepanel/ui/` — `Section` (uppercase tracked eyebrow + body), `EmptyState` (one-line coach copy + optional hint, replaces bare "muted" paragraphs), `SubTabs` (segmented pill control — the Voice `Tweets|Pillars` pattern formalized; future plans reuse it), `SettingRow` (label + description + typed control + reset-to-default dot), `Slider`, `ProgressBar` (QuotaBar), `GearPopover` (the inline-config affordance: a `⚙` text-glyph button opening a small hairline card of SettingRows that PATCH `/x/settings` directly). DS component `.jsx` files are reference specs, not imports — the extension keeps its own TS/CSS implementations.
- **Shell:** the 104px rail gets grouped sections (eyebrow dividers): OPERATE (Today, People, Channels) / AUTHOR (Composer, Calendar, Studio, Ideas) / LIBRARY (Voice, Replies, Harvest) / LEARN (Playbook) / SYSTEM (Settings), the `assets/logo.png` S-mark above the lowercase wordmark.
- **Tab passes:** four grouped polish passes (Tasks 12–15) apply the primitives, chip taxonomy, empty-state treatment, and each tab's inline config affordances.
- **Other surfaces:** content-script injected UI token-aligned (Task 16); `public/explorer.html` restyled with the same token block + light/dark (Task 16).

### Measurement

`scripts/smoke-settings.ts` ($0): defaults → PATCH → consumer honors it (set `x.doctrine.replyTargetMin=15`, assert `GET /x/brief` quota target moves) → out-of-range 400 → reset → cache invalidation. Visual QA checklist per theme in Tasks 9/12–16 done-whens. No statistical cell — nothing here is an experiment.

## Decisions taken

1. **Dark + light, dark default** (user, AskUserQuestion). Light is a token-block override, shipped after full token adoption.
2. **Server-side settings table + registry** (user). Knobs live in `app_settings`; the extension mirrors `scope:'mirrored'` values via the background. Local-only knobs (apiUrl, bearer, theme, density, uiScale) stay in chrome.storage.
3. **Inert "coming soon" groups** (user). A client-side manifest (`comingSoon.ts`) lists the 11 planned features with sample knob labels, rendered disabled in Settings. The server registry never carries dead keys.
4. **Explorer.html included** (user). Restyled with the same tokens; light/dark via `prefers-color-scheme` + a persisted toggle.
5. **Safety rails are registry ceilings, not honor system.** Hard bounds: `x.budgets.imageDailyUsd` ∈ [0, 2.00] and the 429 check itself is not a setting; `x.budgets.xSoftDailyUsd` ∈ [0.01, 1.00]; `x.mentions.serverRefreshCap` ∈ [0, 12]; `x.mentions.pullMax` ∈ [10, 100] (invariant #5 clamp); batch caps ≤ current API-safe bounds ×2. **Never settings:** URL-surcharge guard, retire-before-snapshot, claim-before-call, token rotation, band-gate override mechanics, manual-paste posting, the `tokens` table exclusion.
6. **Pure modules gain params, never store reads.** Routes/workers are the only store consumers. Keeps every existing pure test valid and the store mockable.
7. **Gates configurable with floors.** `x.gates.minCellN` ∈ [5, 100] default 20; description warns below 20 is exploration, not evidence. BAND threshold settings carry the "recalibrate only at ≥100 measured (see evals/analyze-own-replies.ts)" warning in their descriptions — the settings exist (moat), the doctrine lives in the copy.
8. **Cadence anchors become one source of truth.** `x.doctrine.anchors3` / `anchors4` (numberArray, 0–23, 1–8 entries) feed `brief.ts` directly, `composerLogic.ts` via the mirror, and `md_to_schedule.ts` via an API fetch with baked fallback — killing the three-way hand-sync.
9. **DS `.jsx` components are specs, not dependencies.** The extension implements its own typed primitives matching the DS classes; the DS folder stays the reference (its README already points back at the extension as ground truth).
10. **Worker-cadence knobs are `appliesOn:'restart'`** (publisher interval, dailyMetrics hour) — workers read settings once at `startXWorkers`; the Settings UI shows a "takes effect on restart" hint. No hot-reloading timers.

## Done when

- [ ] Side panel renders every tab from `--strat-*` tokens in dark AND light with zero hardcoded colors outside the two token blocks; theme/density/scale switch live from Settings → Appearance.
- [ ] `GET /x/settings` returns ≥55 knobs across ≥12 groups; `bun scripts/smoke-settings.ts` passes: PATCHing `x.doctrine.replyTargetMin` visibly moves the `/x/brief` reply quota, out-of-range writes 400, reset restores defaults.
- [ ] Changing `x.band.bigViews` in the Settings tab changes the on-page badge verdict (after mirror sync) AND the server band gate — same number, both sides, no rebuild.
- [ ] The Settings tab shows: Connection, Appearance, ≥12 server groups with search + per-group reset, harvest cursors, and 11 inert "coming soon" groups.
- [ ] At least 6 inline `⚙` affordances exist next to their features (Today quests, DoNext, Radar, Composer ladder, Targets band, Playbook gate) and PATCH the same keys Settings edits.
- [ ] Explorer at `/explorer` matches the token palette in both themes.
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green; extension builds both passes.

---

## Task 1: Settings platform — table, store, registry core, routes
**Depends on:** none
**Session budget:** ~380 lines, 8 files (4 new)

**Read first:** codemap header + §3.1/§3.4/§7.13/§7.20–22; `src/db/shared-schema.ts` (whole — cost_events shape); `src/db/migrations/meta/_journal.json`; `src/x/routes/radar.ts` (always-mounted route exemplar); `src/x/index.ts:1-120` (mount order); `src/x/routes/brief.ts:40-60` (the doctrine constants the seed registry describes).

**Edit:**
- `src/db/shared-schema.ts` — add `appSettings` table (key text PK, value text json, updatedAt integer timestamp_ms).
- `src/db/migrations/0013_*.sql` — via `bun run db:generate`; inspect (no seed INSERT needed — defaults live in code).
- `src/settings/store.ts` (new) — `getSetting`, `getAllValues(scope?)`, `setSettings`, `resetSettings`, cache + `invalidateSettingsCache()` (exported for tests).
- `src/x/settings/registry.ts` (new) — `SettingDef` type, `SETTINGS_REGISTRY: SettingDef[]`, `validateSettingValue(def, v)`, `settingsByGroup()`. Seed with the **doctrine group only** (Task 2's table) so routes are testable; later tasks append groups.
- `src/x/routes/settings.ts` (new) — GET / GET values / PATCH / POST reset per the Design contract.
- `src/x/index.ts` — mount `settingsRouter` (static paths only, no `:param` — §7.20 safe anywhere; put it next to `dataRouter`).
- `src/x/settings/registry.test.ts`, `src/x/routes/settings.test.ts` (new).

**How:** Store validates through the registry before writing (registry passed in, so `src/settings/` stays platform-agnostic — same layering as `costTracker`). PATCH is all-or-nothing inside one sync txn (§7.13: sync callback, `.run()` terminals, `Date.now()` not `new Date()` bindings). GET merges registry defaults with override rows and stamps `isDefault`. Do NOT read the store from any consumer yet — this task lands the platform inert.

**Tests:** registry: type/range/enum/numberArray validation matrix, unknown key. Routes (in-memory DB, `app.request`): GET shape + isDefault flip after PATCH, PATCH txn atomicity (one bad key in a 2-key patch writes nothing), reset by key and by group, 401 without bearer.

**Done when:**
- [ ] `GET /x/settings` returns the doctrine group with defaults; PATCH/reset round-trip works.
- [ ] Migration lands on a fresh `:memory:` boot; `bun test` green pre-existing suites untouched.
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(settings): app_settings table, typed registry, /x/settings routes`

**Cost note:** $0.

---

## Task 2: Doctrine + quests knobs consumed  [parallel-ok with 3–5 after Task 1]
**Depends on:** Task 1
**Session budget:** ~300 lines, 6 files

**Read first:** codemap §3.4 brief; `src/x/routes/brief.ts:40-120` (REPLY_TARGET L42, WEEK_REPLY_TARGET_PCT L43, ANCHORS_3 L46 / ANCHORS_4 L47, ladder switch ~L82, SPARKLINE_DAYS L49, LEADER_COUNT L50); `src/x/quests.ts:15-80` (LAUNCH_ATTEND_WINDOW_MS L18, NEGLECTED_TARGET_DAYS L21, NEGLECTED_TARGETS_QUEST_TARGET L22, originals target literal ~L73); `src/x/routes/brief.test.ts`; `src/x/quests.test.ts`.

**Edit:**
- `src/x/settings/registry.ts` — extend doctrine group + add quests group:

  | key | default | range | consumer |
  |---|---|---|---|
  | `x.doctrine.replyTargetMin` / `Max` | 10 / 20 | 1–100 | brief quota |
  | `x.doctrine.weekReplyTargetPct` | 70 | 40–95 | brief ratio |
  | `x.doctrine.anchors3` / `anchors4` | [9,13,18] / [8,12,16,20] | hours 0–23, 1–8 entries, `scope:'mirrored'` | brief gaps + composer (Task 6) |
  | `x.doctrine.ladderSwitchAt` | 4 | 2–8, mirrored | ladder pick |
  | `x.quests.replyQuestTarget` | =replyTargetMin (derived — omit; use doctrine key) | — | quests |
  | `x.quests.originalsTarget` | 1 | 0–10 | quests |
  | `x.quests.neglectedTargetsCount` | 2 | 0–10 | quests |
  | `x.quests.neglectedTargetDays` | 7 | 1–60 | quests |
  | `x.quests.launchAttendWindowMin` | 30 | 5–120 | quests |
  | `x.display.sparklineDays` | 14 | 7–60 | brief |
  | `x.display.leaderCount` | 3 | 1–10 | brief |

- `src/x/quests.ts` — `computeQuests(…, opts: QuestOpts = QUEST_DEFAULTS)`; hardcoded `1` originals literal becomes `opts.originalsTarget`.
- `src/x/routes/brief.ts` — read via `getSetting` at request time; pass QuestOpts through.
- `src/x/quests.test.ts`, `src/x/routes/brief.test.ts` — extend.

**How:** Decision 6 — brief route reads the store, `computeQuests`/`annotateGaps` take params. Vacuous-done contract (§ quests) must hold for any target value, including 0 (0 ⇒ quest omitted, not auto-done — cover in tests). Anchors validation: sorted-unique enforcement in a registry `validate` hook for numberArray.

**Tests:** quests with custom opts (targets 0/1/custom, window shift); brief honors a PATCHed replyTargetMin (route test writes the override row first); anchors array validation (unsorted/dup/OOB → 400).

**Done when:**
- [ ] PATCH `x.doctrine.replyTargetMin: 15` → `/x/brief` `replyQuota.target.min === 15` and the quest line follows.
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(settings): doctrine + quest knobs read from registry`

**Cost note:** $0.

---

## Task 3: People / followups / stage / targets / pinned-watch knobs  [parallel-ok]
**Depends on:** Task 1
**Session budget:** ~350 lines, 8 files

**Read first:** `src/x/people/followups.ts:30-50,350-360,415-425` (window consts, REUP_*, FAN_UNACKNOWLEDGED_DAYS); `src/x/people/stage.ts:25-40` (MUTUAL_EXCHANGE_DAYS L33, ALLY_EXCHANGE_DAYS L34, ALLY_WINDOW_DAYS L35 — note the "change with the test matrix" comment); `src/x/routes/voice.ts:560-575` (targetBand L565-566); `src/x/routes/brief.ts:230-245` (PIN_STALE_DAYS L235, PIN_OUTPERFORM_RATIO L236, PIN_CANDIDATE_DAYS L239); `src/x/routes/digest.ts:45-48`; `src/x/routes/followups.ts` (where classifier opts thread through).

**Edit:** registry groups `people` + `followups`; thread opts through `classifyFollowups`/`pickReupCandidate` (followups route), `computeStage` (store.ts callers), `targetBand` (voice route + followups + rankmap callers), pinned helpers (brief route), digest windows (digest route).

  | key | default | range |
  |---|---|---|
  | `x.people.mutualExchangeDays` | 2 | 1–10 |
  | `x.people.allyExchangeDays` | 4 | 2–20 |
  | `x.people.allyWindowDays` | 60 | 14–180 |
  | `x.followups.chainLiveMaxAgeH` | 24 | 1–72 |
  | `x.followups.dmReadyWindowDays` | 7 | 1–30 |
  | `x.followups.neglectedTargetDays` | 7 | 1–60 |
  | `x.followups.neglectedAllyDays` | 14 | 1–90 |
  | `x.followups.momentumWeeklyPct` | 5 | 1–50 |
  | `x.followups.reupMinAgeDays` / `MaxAgeDays` | 14 / 60 | 3–180 |
  | `x.followups.fanUnacknowledgedDays` | 7 | 1–30 |
  | `x.people.targetBandMinX` / `MaxX` | 2 / 10 | 1–100, mirrored |
  | `x.pinned.staleDays` | 21 | 7–90 |
  | `x.pinned.outperformRatio` | 3 | 1.5–10 |
  | `x.digest.neglectedCap` | 5 | 1–20 |

**How:** stage thresholds become a `StageThresholds` param with the current values as default export — update the test matrix comment and keep the existing matrix passing via explicit-param calls. Stage ratchet semantics are unchanged (thresholds only affect future recomputes — safe, note in registry descriptions). `targetBand` mirrored because `Targets.tsx` renders the band label and the S0.3 rankmap tiers depend on it server-side; the extension only displays, so the mirror is cosmetic here.

**Tests:** stage matrix with a custom thresholds object (mutual at 3, ally at 5); followups route honors PATCHed windows; targetBand with custom multipliers; pinned-watch boundary at a PATCHed staleDays.

**Done when:**
- [ ] PATCH `x.followups.neglectedAllyDays: 21` → a 15-day-quiet ally leaves the queue (route test).
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(settings): people/followups/stage/targets/pinned knobs`

**Cost note:** $0.

---

## Task 4: Gates, metrics-lifecycle, worker knobs + MCP settings tools  [parallel-ok]
**Depends on:** Task 1
**Session budget:** ~320 lines, 8 files

**Read first:** `src/x/playbook.ts:10-20` (DEFAULT_MIN_CELL_N L14 — every builder already takes `minN`); `src/x/routes/playbook.ts` (loaders pass DEFAULT gate); `src/x/routes/metrics.ts:215-230` (BEST_TIME_MIN_N L220); `src/x/routes/radar.ts:20-35` (RADAR_DRAFT_TTL_MS L25); `src/x/workers/dailyMetrics.ts:75-95` (DEFAULT_HOUR_UTC L81, WINNER_REREAD_MIN_VIEWS L85, WINNER_REREAD_CAP L86); `src/x/workers/publisher.ts:50-65`; `src/x/index.ts` `startXWorkers`; `src/x/mcp.ts` (curated-tool pattern, `x_draft_post` guard).

**Edit:** registry groups `gates` + `workers`; consumers: `routes/playbook.ts` (default minN from store — the `?minN=` query param still overrides per-read), `routes/metrics.ts`, `routes/radar.ts`, `startXWorkers` (reads worker knobs ONCE at start — `appliesOn:'restart'`), `src/x/mcp.ts` (+2 tools), `src/mcp.test.ts`.

  | key | default | range | note |
  |---|---|---|---|
  | `x.gates.minCellN` | 20 | 5–100 | description: "<20 is exploration, not evidence" |
  | `x.gates.bestTimeMinN` | 3 | 1–20 | mirrored (composer chips) |
  | `x.radar.draftTtlH` | 48 | 6–168 | |
  | `x.workers.dailyMetricsHourUtc` | 3 | 0–23 | restart |
  | `x.workers.publisherIntervalSec` | 60 | 30–600 | restart |
  | `x.workers.winnerRereadMinViews` | 500 (env fallback kept) | 100–100000 | |
  | `x.workers.winnerRereadCap` | 5 | 0–10 | 0 disables re-reads |

**How:** env vars stay as the *default source* where they exist today (`WINNER_REREAD_MIN_VIEWS`): precedence = override row > env > registry default — implement as the registry default being computed from env at module load. MCP: `x_settings` calls `GET /x/settings` in-process; `x_update_setting({key, value})` calls PATCH — same validation, so ceilings hold for agents (Decision 5). Winner re-read cap 0 must short-circuit BEFORE any claim write (§7.3 claim-before-call untouched).

**Tests:** playbook route honors a PATCHed default gate while `?minN=` still wins; radar expiry at a custom TTL; MCP round-trip: `tools/call x_update_setting` moves a knob, out-of-ceiling value refused with the 400 surfaced in the tool result.

**Done when:**
- [ ] PATCH `x.gates.minCellN: 10` → a 12-sample playbook cell flips `sufficient: true` without `?minN=`.
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(settings): gate/worker/radar knobs + x_settings MCP tools`

**Cost note:** $0. Worker knobs can change spend *timing*, never spend *per read*; winner cap ceiling 10 bounds re-read spend at ≤$0.01/day.

---

## Task 5: Money + AI knobs with hard ceilings  [parallel-ok]
**Depends on:** Task 1
**Session budget:** ~300 lines, 8 files

**Read first:** codemap §7.1–6, §8; `src/x/index.ts:115-125` (makeOnCost wiring L120); `src/middleware/costTracker.ts` (makeOnCost signature); `src/x/routes/images.ts:20-70` (hard budget L26-29, n clamp L61); `src/x/routes/mentions.ts:25-40` (MAX_REFRESHES_PER_DAY L37); `src/x/mentions.ts:20-30` (DEFAULT_PULL_MAX L25); `src/x/routes/replies.ts:50-70` (MAX_OUTPUT_TOKENS L57, temperature L58, reasoning L59, MAX_BATCH_TWEETS L66); `src/x/routes/drafter.ts:40-55`; `src/x/routes/digest.ts:45-55`.

**Edit:** registry groups `budgets` + `ai` + `mentions`; consumers: `costTracker.ts` (accept `dailyBudgetUsd: number | (() => number)` — index.ts passes a getter), `images.ts` (read hard budget per-call, before spend — §7.4), `mentions.ts`/`routes/mentions.ts`, `replies.ts`, `drafter.ts`, `digest.ts`.

  | key | default | range | note |
  |---|---|---|---|
  | `x.budgets.xSoftDailyUsd` | 0.15 (env fallback) | 0.01–1.00 | watchdog logs only, as today |
  | `x.budgets.imageDailyUsd` | 0.50 (env fallback) | 0–2.00 | the 429 check itself is NOT a setting |
  | `x.mentions.serverRefreshCap` | 6 | 0–12 | |
  | `x.mentions.panelRefreshCap` | 4 | 0–8 | mirrored (Conversations.tsx budget) |
  | `x.mentions.pullMax` | 50 | 10–100 | invariant #5: also clamped in `getUserMentions` |
  | `x.ai.replyMaxOutputTokens` | 350 | 100–2000 | |
  | `x.ai.replyTemperature` | 0.7 | 0–1.5 | body override still wins |
  | `x.ai.replyReasoningEffort` | 'low' | enum none/low/medium/high | |
  | `x.ai.drafterMaxOutputTokens` | 600 | 200–3000 | |
  | `x.ai.digestMaxOutputTokens` | 700 | 200–3000 | |
  | `x.ai.batchReplyCap` | 25 | 5–50 | mirrored (RADAR_DRAFT_CAP stays ≤ this) |

**How:** every read happens at request time inside the refuse-before-spend ladder (validation → gate → budget → paid call) — never cache a budget across a request. `prompt_cache_key` note in `x.ai.*` descriptions: raising token caps raises cost per draft (~linear); the stable-prefix discipline (§7.15) is untouched because these are request params, not prompt text.

**Tests:** images 429 fires at a PATCHed lower budget (pre-network, existing test pattern in `images.test.ts`); mentions refresh cap honors override incl. 0 = refuse; replies route passes PATCHed maxOutputTokens into the (mocked) Grok call; ceiling writes → 400.

**Done when:**
- [ ] PATCH `x.budgets.imageDailyUsd: 0` → `/x/images/generate` 429s before any network call.
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(settings): budget/AI/mention knobs with hard ceilings`

**Cost note:** $0 in itself; ceilings cap worst-case: images ≤$2/day (hard), X soft ≤$1/day (log-only, unchanged semantics).

---

## Task 6: Extension mirror — background sync, shared reader, first consumers
**Depends on:** Task 1 (+ Task 2 for anchors, Task 5 for panel caps — land those first)
**Session budget:** ~320 lines, 8 files

**Read first:** codemap §5 + §7.24–27; `extension/src/background.ts:200-230` (rankmap cache TTL pattern L213 — imitate it), message registry `extension/src/shared/messages.ts`; `extension/src/shared/bgClient.ts`; `extension/src/sidepanel/composerLogic.ts:10-130` (ANCHORS L14-15, ladder switch L19, gate n≥3 L74); `extension/src/sidepanel/Conversations.tsx:22-30` (panel refresh budget); `extension/src/sidepanel/DoNext.tsx:14-20`; `.claude/skills/stratus/scripts/md_to_schedule.ts:35-45,145-155`.

**Edit:**
- `extension/src/shared/serverSettings.ts` (new, bun-tested) — blob type, `readServerSetting`, `DEFAULTS` mirror of baked values.
- `extension/src/background.ts` — `syncServerSettings()` (fetch values?scope=mirrored via the existing authorized transport; TTL 5 min; on `stratus/settings-sync`; write `settings:server` blob — background is the only writer).
- `extension/src/shared/messages.ts` — `stratus/settings-sync` message type.
- `extension/src/sidepanel/serverSettingsHook.ts` (new) — `useServerSettings()` (storage read + onChanged).
- `extension/src/sidepanel/composerLogic.ts` — anchors/ladderSwitch/bestTimeMinN become params; `Composer.tsx` passes hook values.
- `extension/src/sidepanel/Conversations.tsx`, `DoNext.tsx` — panel refresh cap, strip cap, snooze hours from the hook.
- `.claude/skills/stratus/scripts/md_to_schedule.ts` — fetch `GET /x/settings/values?scope=mirrored` (STRATUS_BASE_URL + token env already available to the skill), fallback to baked ladders on any error.

**How:** pure functions keep param-with-default signatures (`suggestBestSlotDate(cells, taken, now, opts = LADDER_DEFAULTS)`) so `composerLogic.test.ts` stays valid. The hook returns `DEFAULTS` until the blob loads — no flash of wrong config. Never read chrome.storage inside the pure modules (§7.26/27 discipline).

**Tests:** `serverSettings.test.ts` (blob parse, fallback on missing/garbage keys); `composerLogic.test.ts` cases with custom anchors (ladder switch honors custom threshold); existing tests untouched.

**Done when:**
- [ ] With a PATCHed `anchors3: [8,14,19]`, the Composer "Best time" suggestions use the new anchors after one sync (manual browser check).
- [ ] `bun test` (root + extension modules) + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(extension): mirrored server settings blob + first consumers`

**Cost note:** $0 — one extra authorized GET per 5 min while the browser is open.

---

## Task 7: Reply-band thresholds configurable end-to-end
**Depends on:** Task 6
**Session budget:** ~280 lines, 6 files

**Read first:** `src/shared/replyBand.ts` (whole — BAND L38-45, inline cutoffs L53/L62, `textLooksLikeReplyBait`); `src/x/routes/replies.ts` `gateSignalsFor` + band-gate block; `extension/src/content.ts:1050-1150` (badge render + radar stream call sites — find where `classifyBand` is invoked); `extension/src/shared/radar.ts` (rank uses band).

**Edit:**
- `src/shared/replyBand.ts` — `classifyBand(signals, thresholds: BandThresholds = BAND)`; hoist the L53/L62 inline literals (`tooSmallAgeMin:20, tooSmallViews:300, tooSmallVpm:15, watchReplyCeiling:25`) into `BandThresholds`.
- `src/x/settings/registry.ts` — `band` group, all `scope:'mirrored'`: `x.band.bigViews` 300 (50–5000), `baitViews` 180, `earlyReplies` 40, `midReplies` 120, `freshMin` 15, `risingVPM` 20, `baitVPM` 12, `watchVPM` 8, `tooSmallViews` 300, `watchReplyCeiling` 25. Every description ends: "Recalibrate only with ≥100 measured replies — see the Playbook band table."
- `src/x/routes/replies.ts` — gate builds thresholds from the store per request.
- `extension/src/content.ts` — read thresholds from the `settings:server` blob at init + onChanged; pass into every `classifyBand` call (badge, radar stream, top-comment signals).
- Tests: `replyBand.test.ts` custom-threshold cases; `app.test.ts`/replies route gate with PATCHed `bigViews`.

**How:** the shared module stays dependency-free (it's Vite-inlined into the IIFE — §7.26): thresholds arrive as an argument on both sides; only the *callers* differ (server: store; page: blob). Bait phrase regex stays baked (regex-in-settings is a footgun — note in Out of scope).

**Tests:** same signals flip hot→skip under stricter thresholds; server gate 422 flips to pass after PATCH (route test); badge-side covered by the shared-module tests (content.ts itself is untestable — note the manual check).

**Done when:**
- [ ] PATCH `x.band.bigViews: 1000` → a 500-view tweet's badge shows the downgraded band after sync AND `/x/replies/generate` gates it 422 — one number, both sides.
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(band): configurable thresholds shared server + badge`

**Cost note:** $0 — a stricter band SAVES Grok spend; a looser band is bounded by the user's own click rate (gate still runs before spend).

---

## Task 8: Design tokens + dark refactor of styles.css  [parallel-ok — no settings deps]
**Depends on:** none
**Session budget:** ~400 diff lines (mostly CSS), 4 files

**Read first:** `Stratus Design System/readme.md` (visual foundations + iconography); `Stratus Design System/tokens/colors.css`, `typography.css`, `spacing.css`, `radii.css` (copy sources); `extension/src/sidepanel/styles.css:1-100` (current `:root`) + grep `#[0-9a-f]|rgba\(` for the 44 hardcoded occurrences (lines ~230, 238, 270-290, 424, 481-493, 766, 807-814, 850-857 and onward); `extension/src/studio/fonts.ts` (FontFace load pattern); `extension/sidepanel.html`.

**Edit:**
- `extension/src/sidepanel/styles.css` — replace `:root` with the full `--strat-*` set (verbatim from the DS token files) + legacy aliases (`--bg: var(--strat-bg)` etc. so existing rules keep resolving); replace all hardcoded hex/rgba outside `:root` with tokens (`--strat-accent-fill`, `--strat-band-hot`, `--strat-warm-fill`, status ramp…); add the three Inter `@font-face` rules (`/fonts/Inter-*.woff2` — already shipped for Studio) and set `body { font-family: var(--strat-font-sans) }`; `font-variant-numeric: tabular-nums` on metric classes (`.kpi`, `.spark-meta`, badge counts).
- `extension/sidepanel.html` — nothing unless a preload hint is needed; verify font paths resolve from the sidepanel origin.

**How:** this is a **zero-visual-change refactor** (dark values are identical — DS tokens were lifted from this very file) except the font swap to Inter and tabular numerals. Do not restructure selectors yet — Tasks 10+ do that. Keep `color-scheme: dark` on `:root` for now (Task 9 makes it theme-aware). Band colors: introduce `--strat-band-hot/-warm/-warm-text` and use them at lines ~807-857.

**Tests:** none automated (CSS); acceptance = `grep -cE '#[0-9a-f]{3,8}|rgba?\(' styles.css` outside the token block returns 0, extension builds, every tab visually unchanged in a manual pass (except Inter).

**Done when:**
- [ ] No color literals outside the token block; panel renders in Inter with tabular metrics.
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green; `cd extension && bun run build` clean.
- [ ] Committed: `refactor(ui): adopt stratus design tokens, bundle Inter for the panel`

**Cost note:** $0.

---

## Task 9: Light theme + Appearance settings (theme / density / scale)
**Depends on:** Task 8
**Session budget:** ~300 lines, 6 files

**Read first:** Task 8's final `styles.css` token block; `extension/src/sidepanel/main.tsx`; `extension/src/sidepanel/storage.ts` (Settings interface + patchSettings — extend it); DS readme "Visual foundations" (what light must preserve: flat, hairline, one accent, no gradients).

**Edit:**
- `styles.css` — `:root[data-theme='light']` block. Opening palette (adjust in QA to AA): bg `#f5f7fa`, elev `#ffffff`, hover `#eceff4`, border `#d9dfe9`, text `#18212f`, muted `#5f6b80`, accent `#2f6ce0`, accent-hover `#1f5ccc`, danger `#c23a54`, warn text `#9a6a10` / fill 12%, ok `#1f9d66`, status ramp darkened equivalents, scrim `rgba(15,23,42,.4)`, band-hot `rgb(0,150,100)`, band-warm-text `#8a6100`, tinted fills at 10–14% alpha. Also `[data-density='compact']` (override ~6 spacing vars: panel pad 14→10, section gap 12→8, row gap 8→6) and `[data-scale]` root font 12/13/14px.
- `extension/src/sidepanel/main.tsx` — stamp `data-theme` (resolve `system` via `matchMedia('(prefers-color-scheme: light)')` + listener), `data-density`, `data-scale` on `document.documentElement`; react to storage changes.
- `extension/src/sidepanel/storage.ts` — add `theme: 'system'|'dark'|'light'` (default system), `density`, `uiScale` to Settings + getters/patch.
- `extension/src/sidepanel/Settings.tsx` — minimal Appearance rows (three selects) — the full rebuild is Task 11.

**How:** `color-scheme` must follow the theme (`dark` block sets `color-scheme: dark`, light sets `light`) so native controls match. Every tinted fill in light needs a darker *text* companion (`--strat-band-warm-text` pattern) — never light-alpha text on white. Content script and Studio canvas are NOT themed by this (Studio kit colors are user brand data; overlays follow X).

**Tests:** storage round-trip for the three new keys (extend existing storage expectations if any); the rest is the manual QA matrix: 12 tabs × {dark, light} × {cozy, compact} — checklist in the commit message.

**Done when:**
- [ ] Theme toggle flips the whole panel live incl. modals, chips, badges, band colors; no unreadable pair in light (spot-check warn/ok/band text on their fills).
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(ui): light theme + appearance settings (theme/density/scale)`

**Cost note:** $0.

---

## Task 10: UI primitives + grouped tab rail + breathing shell
**Depends on:** Task 8 (Task 9 helpful, not required)
**Session budget:** ~380 lines, 8 files (6 new)

**Read first:** DS `components/layout/TabRail.jsx` + `Panel.jsx` (spec); `components/core/Chip.jsx`, `components/data/QuotaBar.jsx`, `KpiCard.jsx` (spec); `extension/src/sidepanel/App.tsx` (whole); `styles.css` rail/topbar section (~L44-100); `Voice.tsx:1-80` (the subtab pattern to formalize).

**Edit:**
- `extension/src/sidepanel/ui/` (new): `Section.tsx` (eyebrow h3 + children), `EmptyState.tsx` (coach line + hint), `SubTabs.tsx`, `SettingRow.tsx` (typed control per SettingDef meta: number/boolean/enum/numberArray/string + reset dot when `!isDefault`), `Slider.tsx`, `GearPopover.tsx` (⚙ text-glyph button → hairline popover card; closes on outside click; children are SettingRows).
- `App.tsx` — rail groups with eyebrow dividers (OPERATE / AUTHOR / LIBRARY / LEARN / SYSTEM per Design); logo img (copy `Stratus Design System/assets/logo.png` → `extension/public/icons/` reuse existing icon128) above the lowercase wordmark.
- `styles.css` — rail group styles, `.ui-section`, `.ui-empty`, `.ui-subtabs`, `.ui-gear`, popover card; section rhythm: panels gap `var(--strat-space-6)`, section eyebrows 11px/0.04em uppercase muted.

**How:** primitives are thin — className + tokens, no state libraries. GearPopover takes `settings: SettingEntry[]` + `onPatch(key, value)` — the actual PATCH call lives in a tiny `sidepanel/settingsClient.ts` wrapper over `api.ts` (add `api.settings.get/patch/reset` there). SubTabs replaces nothing yet (Voice migrates in Task 14). No entrance animations — hover/press per DS motion rules only.

**Tests:** none for pure-presentation components (repo precedent: tab components are untested); `settingsClient` request-shape covered implicitly by later route usage. Keep `bun run typecheck` covering the new files via the extension tsconfig.

**Done when:**
- [ ] Rail shows grouped tabs + brandmark; primitives exported and used by at least the shell.
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green; extension builds.
- [ ] Committed: `feat(ui): primitives (Section/EmptyState/SubTabs/SettingRow/GearPopover) + grouped rail`

**Cost note:** $0.

---

## Task 11: Settings tab rebuild — the crowded cockpit
**Depends on:** Tasks 1, 6, 9, 10
**Session budget:** ~400 lines, 5 files (2 new)

**Read first:** `extension/src/sidepanel/Settings.tsx` (whole — keep connection form, toggles, harvest cursors); `src/x/routes/settings.ts` GET shape; `ui/SettingRow.tsx` + `GearPopover` from Task 10; the "Configurable knobs" sections of all 11 files in `plans/` (skim headers only — the coming-soon manifest quotes 3–5 knob labels each).

**Edit:**
- `extension/src/sidepanel/Settings.tsx` — full rebuild: sticky search box filtering rows by label/description/key across ALL groups; sections in order: **Connection** (apiUrl/bearer, unchanged semantics), **Appearance** (Task 9 rows), **server registry groups** (auto-rendered from `GET /x/settings` — one `Section` per group, `SettingRow` per knob, per-group "Reset group" button, `restart` hint chip on `appliesOn:'restart'`, non-default rows marked with the accent dot), **Extension toggles** (applyPillarsToReplies, autoTypeReplyDraft, passiveCapture — existing), **Harvest cursors** (existing list), **Coming soon** (from the manifest, disabled rows + "ships with <plan name>" note).
- `extension/src/sidepanel/comingSoon.ts` (new) — manifest for the 11 plans: augmented-x-ui, me-profile, niche, notifications, radar-reply-unification, reply-lists, studio-2, ai-layer, authoring-3, guardrails, harvest-enhancements; each `{id, title, planFile, knobs: [{label, hint}]}` with 3–5 representative knobs quoted from the plan (e.g. niche → reply quota per niche; reply-lists → humanizer chances; guardrails → unfollow window caps; ai-layer → provider/model/prompt overrides).
- `extension/src/sidepanel/api.ts` — `api.settings` namespace if not landed in Task 10.
- `styles.css` — settings-specific rules (search box, group header with reset, disabled coming-soon treatment at 0.5 opacity + `not-allowed`).

**How:** a PATCH from any row fires `stratus/settings-sync` so the mirror refreshes immediately (Task 6). Numeric inputs commit on blur/Enter with min/max from meta; invalid → inline `Message` error with the server's 400 code. Search matches also group labels so "budget" finds the group. Never render the bearer in coming-soon or anywhere new.

**Tests:** `comingSoon.ts` shape test (all 11 ids present, no empty knob lists) — trivial bun test; the rendering itself follows repo precedent (untested presentation).

**Done when:**
- [ ] Settings shows ≥12 live server groups + 11 inert groups; search filters; group reset restores defaults and the dots disappear.
- [ ] Editing `x.band.bigViews` here changes the badge after sync (end-to-end check with Task 7).
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(settings): crowded registry-driven Settings tab + coming-soon roadmap`

**Cost note:** $0.

---

## Task 12: Today tab polish + inline config
**Depends on:** Tasks 10, 2 (and 6 for mirrored caps)
**Session budget:** ~350 lines, 6 files

**Read first:** `extension/src/sidepanel/Today.tsx` (whole), `DoNext.tsx` (STRIP_CAP L17, SNOOZE_HOURS L18), `Fans.tsx` (AMBER_TOP_N L10), `Radar.tsx:20-40` (RADAR_DRAFT_CAP L28), `Targets.tsx` (NEGLECT_DAYS L10), `Digest.tsx`, `LaunchRoom.tsx`; `docs/today-tab.md`.

**Edit:** `Today.tsx` + the section components + `styles.css`; registry additions (group `display`, mirrored): `x.display.doNextCap` 5 (1–15), `x.display.doNextSnoozeH` 24 (1–168), `x.display.fansAmberTopN` 10, `x.display.radarDraftCap` 20 (≤ `x.ai.batchReplyCap`), `x.display.targetsNeglectDays` 7 (mirror of followups value — reuse `x.followups.neglectedTargetDays`, do NOT mint a duplicate key).

**How:** apply `Section`/`EmptyState` to every block (KPI hero via DS KpiCard spec: 26px tabular number + delta + sparkline); section order unchanged (Conversations → DoNext → quests/streak → KPI → pinned → launch → radar → targets → fans → plan → digest). Inline gears: quests Section header gear → quest targets (PATCH `x.quests.*`); DoNext gear → cap + snooze; Radar header gear → draft cap + band link-out ("band thresholds live in Settings"); Targets gear → band multipliers (`x.people.targetBandMin/MaxX`). Every EmptyState gets one coach line in the product voice (readme "Content fundamentals": terse, reassuring, `·` separators, no emoji).

**Tests:** components stay presentation-untested (precedent); `useServerSettings` consumers get their fallback behavior covered in `serverSettings.test.ts` already. Manual QA both themes.

**Done when:**
- [ ] Today reads as sections with eyebrows, hero KPI, coach-voice empty states; 4 gear affordances live and persisting.
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(ui): Today tab polish + inline quest/donext/radar/targets config`

**Cost note:** $0.

---

## Task 13: Composer + Calendar polish + inline cadence config
**Depends on:** Tasks 10, 6
**Session budget:** ~320 lines, 5 files

**Read first:** `Composer.tsx` (whole — thread mode, best-time chips, cost line COST_URL/COST_STANDARD via `composerLogic.ts:143`), `composerLogic.ts` (post-Task 6 param shape), `Calendar.tsx`, `docs/composer-tab.md` + `docs/calendar-tab.md`.

**Edit:** `Composer.tsx`, `Calendar.tsx`, `styles.css`; small `composerLogic.ts` touches only if a display helper is missing.

**How:** Composer: `Section` structure (draft → steer/idea → pillar/register → schedule), char counter with the DS counter treatment (danger past 280), cost line as a `Message` variant ("$0.015 · $0.20 with a URL — move links to the first reply"), best-time chips show `(n)` and grey below the mirrored `x.gates.bestTimeMinN`; inline gear next to "Best time" → anchors3/anchors4/ladderSwitchAt editors (numberArray SettingRow) — this is the cadence-ladder inline moat piece. Calendar: status badges to the DS six-step ramp tokens, thread grouping indent, `media_note` amber "visual" chip kept, EmptyState for empty days. No week-board rebuild — that belongs to `plans/2026-07-17-authoring-3.md` (do not preempt it).

**Tests:** any `composerLogic` helper touched gets cases in `composerLogic.test.ts`; otherwise manual QA.

**Done when:**
- [ ] Cadence anchors editable inline from the Composer and reflected in brief gaps + suggestions after sync.
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(ui): Composer/Calendar polish + inline cadence ladder editor`

**Cost note:** $0.

---

## Task 14: People + Channels + Voice + Ideas polish + inline config  [parallel-ok with 13, 15]
**Depends on:** Tasks 10, 3
**Session budget:** ~380 lines, 7 files

**Read first:** `People.tsx` (dossier slices L372/397/413), `Channels.tsx` (posts slice L223), `Voice.tsx` (TWEET_LIMIT L16, subtab header), `Pillars.tsx` (managed-entity editor pattern), `Ideas.tsx`, `ChannelTags.tsx`; `docs/people-tab.md` etc.

**Edit:** the four tabs + `styles.css`; registry `display` additions (mirrored): `x.display.dossierListLen` 5 (3–25), `x.display.channelPostsShown` 8 (3–30), `x.display.voiceListLimit` 100 (20–500).

**How:** unify the stage-chip taxonomy into one `.chip-stage-*` family (tokens, both themes) — this is the chip set the 11 future plans keep reusing (notifications tier chips, augmented-UI person chips): define it once here, document in styles.css comment. Voice migrates its hand-rolled subtab header to `SubTabs`. People dossier: `Section` per block, timeline with type glyphs (text glyphs only), stage picker as chips. Ideas: lifecycle chips (open/consumed/discarded via status ramp). Inline gears: People roster header → dossier list length; Channels room → posts shown.

**Tests:** manual QA; any pure helper extracted (e.g. chip tone mapping) gets a trivial bun test only if it contains logic beyond a lookup.

**Done when:**
- [ ] One chip family serves stages/tiers/status across all four tabs in both themes.
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(ui): People/Channels/Voice/Ideas polish + unified chip taxonomy`

**Cost note:** $0.

---

## Task 15: Replies + Playbook + Harvest + Studio polish + inline config  [parallel-ok]
**Depends on:** Tasks 10, 4, 5
**Session budget:** ~380 lines, 7 files

**Read first:** `Replies.tsx` (LIST_LIMIT L26, variant picker, band chips), `Playbook.tsx` (gated-section wording L~321), `Harvest.tsx`, `Studio.tsx` (KitEditor block), `docs/replies-tab.md`, `docs/playbook-tab.md`.

**Edit:** the four tabs + `styles.css`; registry: `x.display.repliesListLimit` 100 (20–500, mirrored).

**How:** Playbook is the showcase of the gated-state treatment: every "insufficient data (n=…)" becomes the standard `EmptyState` with the n and the gate value shown ("needs n≥20 — currently 7 · lower the gate in Settings"); the header gains a minN stepper bound to `x.gates.minCellN` (persisting — unlike today's per-read `?minN=`). Replies: variant chips (extends/contrarian/debate) to the unified chip family; outcome rows tabular. Harvest: form into `Section`s, pace radio as SubTabs-style pills; do NOT add the passive-harvest features (that's `plans/2026-07-17-harvest-enhancements.md`). Studio: KitEditor into `Section`s; kit colors are user data — leave the swatch inputs.

**Tests:** manual QA; Playbook stepper path covered by Task 4's route test (default-gate honor).

**Done when:**
- [ ] Playbook gate stepper persists and every gated cell explains itself; four tabs match the system in both themes.
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(ui): Replies/Playbook/Harvest/Studio polish + persistent gate stepper`

**Cost note:** $0.

---

## Task 16: Content-script overlay token alignment + explorer restyle
**Depends on:** Task 8 (explorer part independent)
**Session budget:** ~300 lines, 3 files

**Read first:** `extension/src/content.ts` `injectStyles` section (badge/save-button/chip CSS strings); `public/explorer.html:1-120` (its inline palette block); DS readme "X-companion reference tokens" (`--x-*`).

**Edit:**
- `extension/src/content.ts` — consolidate overlay styling into one `OVERLAY_TOKENS` const (theme-neutral rgba values per DS: band hot `rgb(0,186,124)`, warm `rgb(255,179,0)`/text `rgb(214,150,0)`, muted `rgb(113,118,123)`, blue `#1d9bf0`) referenced by every injected style — this is the constant block the future chip families (augmented-x-ui, notifications) will extend; keep visuals essentially as-is, just de-duplicate and align values.
- `public/explorer.html` — replace its palette with the `--strat-*` block + light overrides under `@media (prefers-color-scheme: light)` and a manual toggle button persisting `explorer:theme` in localStorage (stamp `data-theme`).

**How:** overlays must remain X-theme-neutral (they sit on white/dim/black timelines) — never apply the panel theme here. Explorer stays a single self-contained file with no build step (§ codemap §2); keep the formula-escaped CSV and all behavior untouched.

**Tests:** `scripts/smoke-explorer.ts` still passes (it asserts the shell serves + API behavior, not styling); manual check of explorer in both schemes.

**Done when:**
- [ ] Explorer matches the token palette in dark and light; overlay CSS has a single token const.
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(ui): overlay token consolidation + explorer light/dark restyle`

**Cost note:** $0.

---

## Task 17 (final): docs-sync + smoke
**Depends on:** all prior.

- [ ] `scripts/smoke-settings.ts` — rerunnable, $0, in-process app over the real (or `:memory:`) DB: GET defaults → PATCH `x.doctrine.replyTargetMin` → `/x/brief` reflects → out-of-range 400 → unknown key 400 → PATCH `x.budgets.imageDailyUsd: 0` → images route 429 → reset all → defaults restored → cleans up every override it wrote.
- [ ] CLAUDE.md: one phase-style entry ("Cockpit overhaul — DS tokens + dark/light + settings registry (~60 knobs) + crowded Settings tab", date, $0, gotchas: registry ceilings are the money guard; pure-modules-take-params discipline; mirror TTL).
- [ ] SURFACES-PLAN.md status updated (this ships as a Surfaces-family phase).
- [ ] `docs/` — update every changed tab doc (today, composer, calendar, people, channels, voice, ideas, replies, playbook, harvest, studio, settings) — settings doc gets the registry table.
- [ ] `.claude/skills/plan-feature/references/codemap.md`: §2 add `Stratus Design System/` + `plans/` rows; §3.1 add `src/settings/store.ts`; §3.3 add `x/settings/registry.ts`; §3.4 add settings routes; §4 table count 27→28 (`app_settings`), migrations →0013; §5 add `ui/` primitives, `serverSettings`, mirror keys, appearance storage keys; §6 +2 MCP tools (16→18); §7 add "settings thread through routes/workers; pure modules take params" as a named pattern; §9 add smoke-settings; header re-stamped.
- [ ] `.env.example` — note that `X_DAILY_BUDGET_USD` / `XAI_IMAGE_DAILY_BUDGET_USD` / `WINNER_REREAD_MIN_VIEWS` are now *defaults* that `app_settings` overrides.

## Out of scope (do NOT build)

- Any feature from the 11 plan docs (chips/context panel, Me tab, niche entity, notification harvest, 3-variant unification, reply lists, studio templates, OpenRouter/prompt editor, manual publish/week board/writer, following curation/monitor/goals, passive harvest). This plan only reserves their Settings real estate as inert groups.
- Prompt-text editing as a setting (that's ai-layer's `prompt_overrides` design — different table, different plan).
- Bait phrase regex / specificity-gate regexes as settings (regex footguns; revisit with ai-layer).
- Making the image-budget *check*, URL-surcharge guard, band-gate override flow, or any §7 money invariant toggleable.
- React component library adoption or CSS framework — tokens + hand CSS only, per DS.
- Publishing the DS folder anywhere or importing its `.jsx` files into the build.
- Multi-profile / per-niche settings scoping (niche plan owns that).
- Hot-reloading worker timers on settings change (restart-applied is enough for one user).

## Risks / watch items

- **Migration-number race:** ai-layer's plan says "migration 0013" — this plan takes 0013; whichever lands second renumbers. Both plans reference the same `app_settings` shape on purpose.
- **Light theme is net-new design** (DS is dark-only): the Task 9 palette is an opening guess; budget a real QA pass and expect 2–3 value adjustments. AA contrast on warn/band text over tinted fills is the known trap.
- **Settings sprawl:** ~60 knobs invite config drift the user forgets. Mitigation shipped: non-default accent dots, per-group reset, search. Watch whether a "show changed only" filter is wanted after a week of use.
- **Mirror staleness:** badge/band edits take up to one 5-min TTL (or a panel open) to reach the page. Acceptable for one user; the `stratus/settings-sync` message covers the common "edited in Settings, testing immediately" path.
- **Baked-vs-mirrored drift:** any NEW extension constant must decide at birth: baked default + mirrored key, or truly fixed. Codemap §7 pattern note (Task 17) is the guard.
- **Stage-threshold edits** change future stage recomputes only (ratchet keeps past promotions) — someone lowering `mutualExchangeDays` won't see retroactive promotions until the next qualifying event. Registry description says so; still a likely "why didn't it change" question.
- **Tab-restyle regressions:** four tabs per task × dense components — the per-task manual QA matrix (both themes) is the only net. Keep diffs CSS/structure-only; never touch data flow in Tasks 12–15.
