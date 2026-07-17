# Guardrails — activity monitor, following curation, accountability

- **Status:** planned 2026-07-17 · not started
- **Goal fit:** Curation = goal 4 (the people layer — roster hygiene closes the reciprocity loop the Circles CRM opened). Monitor = protects all four goals (the "protect the machine" lineage of Overhaul 6.5 — an account suspension zeroes every goal at once). Accountability = goal 4's warmth layer (C9 quests/streaks/digest) extended with goals, commitments, and a scorecard.
- **Cost impact:** **$0 recurring.** Following list = DOM scrape (harvester pattern). Unfollows = manual in the X app (queue only nudges). Monitor + goals + commitments = read-time SQL over already-billed data. Scorecard rides the existing weekly digest Grok call (facts block grows a few hundred bytes; no new call). No new X API endpoint, no new scope, no Grok spend.
- **Invariants touched:** §7.10 (status ratchets — `following.status` and `goals.status` only advance on defined edges), §7.11 (null = unknown — real follow dates are unknowable; `firstSeenAt` is a proxy, never presented as follow date), §7.12 (no derived-state tables — whitelist, debt, pacing, monitor alerts all computed at read time), §7.13 (sync SQLite txns, `.getTime()` in raw sql), §7.19 (gates — scorecard null under 4 tracked days; monitor thresholds are alerts, not stats), §7.20 (static path before `:param` — `/following/queue` and `/following/runs` before `/following/:handle`), §7.24–27 (background single-writer untouched; harvester ships via the one `ApiRequest` transport; content script stays IIFE), §7.29–31 (docs sync, smoke script, why-comments only). §8: zero X spend by construction; manual unfollow keeps us clear of the platform-manipulation wall the same way manual paste clears the reply wall.
- **Codemap sections relevant:** §3.3 (routes list, quests.ts, digest.ts, followups.ts), §4 (schema, streaks, followupSnoozes), §5 (harvester, Harvest tab, People tab, Today tab), §7 (patterns above), §10 (recipes).

## Why / what changes for the user

After the last task: you scroll your own `/following` page for a minute every few days; stratus then knows exactly who you follow and who follows back. A **Following** subtab in People shows a capped unfollow batch (15–18 per 6-hour window, longest-standing non-followers first, never a mutual/ally/target/kept person) — you unfollow in the X app and tick rows off; the next scrape confirms them. The Today tab grows an **Account health** card that fires only when your own behavior looks like what X's spam heuristics punish (posting bursts, near-duplicate posts, unfollow churn above the safe ceiling), and the Composer warns at schedule time before you create the risk. You can set **goals with deadlines** ("1,000 followers by Sep 30") and see on-pace/behind with required-vs-actual daily rates, set your own **daily commitment** minimums that drive the C9 quests and accumulate visible debt when missed, and the Sunday digest grades the week 0–100.

## Design

Three vertical slices, all $0, in the repo's standard shape (data → pure logic → routes → extension → measurement).

### A. Following ledger + curation queue

**Insight that shapes everything:** X's `/following` page renders a `Follows you` indicator (`[data-testid="userFollowIndicator"]`, locale-independent) on every row. **One scrape of the following list yields both sides** — who I follow and whether each follows back. No followers-page scrape, no API read.

**Data** (`src/x/db/schema.ts`, one migration):

```
following_runs: id uuid PK, started_at, completed_at nullable, rows_seen int, complete bool (default false)
following:      handle text PK (lowercased), display_name, follows_back bool,
                list_position int nullable,          -- render order in the latest run (≈ follow recency, best-effort)
                first_seen_at, last_seen_at, last_run_id -> following_runs,
                status text: 'active' | 'queued' | 'done' | 'confirmed' | 'gone',
                keep bool default false,             -- manual "never suggest" pin
                unfollow_marked_at nullable          -- when the user ticked "unfollowed"
```

`followed_at` deliberately does not exist — X doesn't expose it; `first_seen_at` is the proxy (§7.11) and the 7-day grace runs from it. Status semantics: `active` = in my following per latest data; `queued` = released into an unfollow batch; `done` = user says they unfollowed (awaiting scrape confirmation); `confirmed` = a **complete** run no longer saw the handle after `done`; `gone` = a complete run no longer saw a non-done handle (account deleted/blocked me/I unfollowed outside the queue). Ratchet edges (§7.10): `active→queued` (queue release), `queued→done` (user tick), `done→confirmed` / `active|queued→gone` (complete-run reconcile only), and the one reverse edge `done→queued` when a complete run still sees a done handle (the unfollow didn't actually happen). Partial runs (cancelled / capped) update seen rows but **never** mark `gone`/`confirmed` — absence from an incomplete scrape proves nothing.

**Routes** (`src/x/routes/following.ts`, always mounted, all $0 — imitate `src/x/routes/harvest.ts` for ingest and `radar.ts` for the ratchet PATCH):

- `POST /x/following/runs` `{}` → 201 run row.
- `POST /x/following/rows` `{runId, rows: [{handle, displayName, followsBack, listPosition}], done?: bool}` (≤500/batch) — upsert `following` (fill `first_seen_at` once, always refresh `follows_back`/`last_seen_at`/`list_position`/`last_run_id`); `done: true` on the final batch stamps `completed_at` + `complete` and runs the reconcile (`gone`/`confirmed`/`done→queued`) in the same sync txn. Errors: 400 `invalid_run_id|rows_required|too_many_rows|invalid_handle`, 409 `run_already_complete`.
- `GET /x/following?status=&q=&limit=` — ledger view.
- `GET /x/following/queue` — see below. **Registered before `/:handle`** (§7.20).
- `PATCH /x/following/:handle` `{status: 'done'}` (only `queued→done`; stamps `unfollow_marked_at`) or `{keep: bool}`. 404 unknown, 409 `invalid_transition`.

**Pure logic** (`src/x/connections.ts`, bun-tested — the playbook.ts/followups.ts split):

- `eligibleForUnfollow(rows, whitelist, now)`: `status='active'`, `follows_back=false`, `keep=false`, `first_seen_at ≤ now − GRACE_DAYS(7)`, handle ∉ whitelist. Rank: oldest `first_seen_at` first (longest-standing non-followers), `list_position` desc as tie-break.
- `releaseBudget(recentMarks, now, rand)`: window = trailing `UNFOLLOW_WINDOW_MS` (6h); per-window cap drawn once per call from 15–18 via injected `rand` (jitter discipline — never a robotic constant); budget = cap − count of `unfollow_marked_at` inside the window, floored at 0. Also `DAILY_CEILING = 40`: marks in trailing 24h ≥ ceiling → budget 0 regardless (the monitor reads the same constant).
- Whitelist is computed read-time in the route (§7.12): people at stage `mutual`/`ally` (non-retired), the 2–10x targets roster via the exported `loadTargetHandles()` (`src/x/routes/voice.ts`), and people tagged `keep`.

`GET /x/following/queue` response: `{batch: [{handle, displayName, firstSeenAt, url}], eligibleTotal, releasedNow, windowUsed, windowCap, dailyUsed, dailyCeiling, lastCompleteRunAt}` — releasing flips the batch rows `active→queued` in the same read (idempotent: already-`queued` rows re-appear in `batch` until marked done, and count against nothing twice).

**Extension:**

- Harvester: new `HarvestMode` value `'following'` in `extension/src/shared/harvest.ts` (scope forced `'all'`, `harvestTargetUrl` → `https://x.com/<handle>/following`, new `isFollowingPath`). New extract path in `extension/src/harvester.ts` reading `[data-testid="UserCell"]` cells (handle from the first `a[href^="/"]` link, display name, follows-back from `[data-testid="userFollowIndicator"]` presence) reusing the existing scroll engine (`humanScroll`, pacing presets, stability stop) via the `runHarvest<R>` generic; ships batches to `POST /x/following/rows` through the existing `apiSend` helper; still downloads a small CSV (handle, name, followsYou) for consistency. Dedupe by handle within the run.
- Harvest tab (`Harvest.tsx`): third mode radio "following" — enabled only when the context probe says the current page is `/<handle>/following`.
- People tab (`People.tsx`): a **Roster | Following** subtab (imitate the Voice.tsx Tweets|Pillars subtab). Following view: freshness banner ("last complete sync N d ago" — amber >7d, with a "how to sync" hint), the released batch (profile link opens `https://x.com/<handle>`, per-row "unfollowed ✓" → PATCH done, per-row "keep" toggle), window/daily budget readout, eligible-total and ledger search underneath.

### B. Activity monitor

**Pure** (`src/x/monitor.ts`, bun-tested). `MonitorAlert = {rule, severity: 'info'|'warn'|'critical', message, evidence}`. Rules, each a pure function over rows the route loads (all trailing-window SQL over `posts_published`, `reply_drafts`, `following`, `scheduled_posts`):

1. `postBurst` — own originals: >4 in 24h → warn; any 2 within 20 min → warn (the publisher jitters; two inside 20 min means manual posting on top of scheduled).
2. `replyBurst` — pasted replies (`reply_drafts.updatedAt` on posted flip): >10 in any trailing 60 min → warn, >15 → critical (bulk-reply heuristic headroom).
3. `nearDuplicate` — word-shingle Jaccard ≥ 0.8 between any pair of own originals in trailing 14d → warn, listing both tweet ids (repetitive-content penalty). Pure `shingleJaccard(a, b)` with normalization (lowercase, strip URLs/handles/whitespace).
4. `unfollowChurn` — `unfollow_marked_at` count trailing 24h: ≥25 → warn, ≥`DAILY_CEILING`(40) → critical ("stop for today"). Reads the same constant the queue enforces, so the alert can only fire if the user out-runs the queue by hand.
5. `scheduleCluster` — pending `scheduled_posts` pairs <45 min apart → info (advice, not danger).

**Route** `GET /x/monitor` (`src/x/routes/following.ts` or its own `monitor.ts` — own file, always mounted): `{alerts, worst, checkedAt}`. Brief (`routes/brief.ts`) gains a `monitor: {alerts, worst}` block computed from the same loaders.

**Schedule-time advisory:** `POST /x/posts/scheduled` response gains `warnings: string[]` (non-blocking — the URL guard stays the only 400): cluster-with-existing-pending (<45 min) and near-duplicate-of-recent-post (14d, same Jaccard). Composer displays them amber under the scheduled confirmation.

**Extension:** Today tab **Account health** card (imitate `PinnedWatchCard` — renders only when `alerts` is non-empty; critical rows red, warn amber, info grey). Panel-only v1 — no chrome notifications (open question below).

**MCP:** curated tool `x_monitor` in `src/x/mcp.ts` (in-process `app.request('/x/monitor')`, forwarded bearer — same shape as `x_brief`).

### C. Accountability — goals, commitments, scorecard

**Data** (same migration or a second one):

```
goals:       id uuid PK, metric text ('followers'|'posted_replies'|'originals'),
             target real, deadline timestamp_ms, baseline_value real, baseline_at timestamp_ms,
             status text ('active'|'achieved'|'missed'|'abandoned'), note text nullable,
             created_at, updated_at
commitments: key text PK ('replies'|'originals'), daily_target int, active bool, updated_at
```

**Pure** (`src/x/goals.ts`, bun-tested):

- `goalPacing(goal, currentValue, trailing7dPerDay, now)` → `{requiredPerDay, actualPerDay, pctComplete, verdict: 'ahead'|'on_pace'|'behind'|'overdue'|'achieved', projectedAt}`. `requiredPerDay = (target − current) / daysLeft`; verdict from actual/required ratio (≥1.1 ahead, ≥0.8 on_pace, else behind); past deadline unachieved → overdue.
- `commitmentDebt(streakRows, key, activeSince, todayKey)` → `{missedLast7, missedLast30, tier: 0|1|2|3}` computed from the existing `streaks.completed` JSON diary (§7.12 — no new event log; a day with no streaks row counts as missed once the commitment was active). Tiers drive escalating copy in the panel (0 clean → 3 "you've missed N of the last 7 days").
- `computeScorecard(inputs)` → `{score: 0–100, components: {questAdherence, cadenceConsistency, replyQuota, goalPacing, ratioAdherence}, sufficient}` — weighted blend; `sufficient: false` (score null) under 4 tracked days in the week (§7.19 spirit: never a confident grade over two days of data).

**Routes** (`src/x/routes/goals.ts`, always mounted, $0): `GET /x/goals` (each goal + live pacing; lazily flips `active→achieved|missed` at read — the radar lazy-expiry pattern, never a worker), `POST /x/goals` (validates metric/target/deadline future; stamps baseline from current value — followers from latest `account_snapshots`, counts from their tables), `PATCH /x/goals/:id` (note, abandon), `DELETE /x/goals/:id`. `GET /x/commitments` / `PUT /x/commitments` `{key, dailyTarget, active}`.

**Brief integration** (`routes/brief.ts`): `repliesTarget` currently hardcoded `REPLY_TARGET.min` (brief.ts:42,665) — when an active `replies` commitment exists its `daily_target` wins; same for a new originals target. Brief gains `goals` (active goals with pacing) and `commitments` (targets + debt) blocks. Quests keep their vacuous-done contract — commitments only change targets and add the debt readout; they never break the streak logic.

**Digest/scorecard** (`src/x/digest.ts` + `routes/digest.ts`): `DigestFacts` gains nullable `scorecard` (null on cached pre-Guardrails digests and under the 4-day gate — the S0.7 `rosterCoverage` precedent, no-fabrication rule skips null). Digest route computes it from the week's streaks rows + goal pacing + activity facts already loaded. Digest card renders the grade; delta vs previous week only when the previous week's cached digest carries a scorecard.

**Extension:** Today tab **Goals** card (pacing bar + verdict chip per active goal, inline add form: metric/target/deadline; abandon button) placed after the quests block; quests block gains the debt line and escalating copy; Digest card gains the grade. Commitment editing lives in Settings (two numeric fields + active toggles — Settings.tsx already owns toggles).

## Decisions taken

1. **Following data source: DOM scrape, $0** (user choice via AskUserQuestion). API sync at $0.001/account/pass (~$1.00 per 500+500 pass) rejected; also keeps us inside "no new recurring X spend".
2. **Unfollow execution: manual queue** (user choice). No `follows.write` scope (current token doesn't have it — `src/x/auth.ts` SCOPES), no $0.010/unfollow API writes, zero automated-churn policy exposure. Same nudge-not-action discipline as pinned-watch/posting.
3. **Accountability = goals+pacing, harder commitments, weekly scorecard; NO hard blocks** (user choice). Stratus never refuses an action for being behind.
4. **One-page scrape**: `/following` alone (the `userFollowIndicator` badge) — followers-page scrape rejected as redundant for curation.
5. **Whitelist is read-time** from Circles data (mutual/ally stages, targets roster, `keep` flag) — no whitelist table (§7.12).
6. **Grace = 7d from `first_seen_at`** — real follow dates unknowable; opening guess, revisit with thresholds.
7. **Cadence numbers**: 6h window, cap jittered 15–18 per window, 40/day hard ceiling shared with the monitor. Conservative end of the user's "15–20 per 6–8h".
8. **Alerts are panel-first**; no chrome notifications v1 (risk list).
9. **Partial scrape runs never mark `gone`/`confirmed`** — only complete runs reconcile; absence from an incomplete scroll proves nothing.
10. **Scorecard gated at ≥4 tracked days**; scorecard rides the existing digest call, never a new Grok call.
11. The v1 "no follower sync" exclusion is consciously amended by this plan for the DOM-scrape ledger only — API follower/following sync stays out of scope.

## Done when

- [ ] Scraping my own `/following` page (Harvest tab, following mode) lands rows in `following` with correct `follows_back` flags, and a second complete scrape after unfollowing someone flips their `done` row to `confirmed` — observed live in the browser.
- [ ] `GET /x/following/queue` never releases more than the window budget, never a handle at stage mutual/ally, on the targets roster, `keep`-flagged, or first-seen <7d ago — asserted in tests and the smoke script.
- [ ] Seeded burst/near-duplicate/churn data makes `GET /x/monitor` emit the expected alerts, the Today tab shows the Account health card only when alerts exist, and `POST /x/posts/scheduled` returns a cluster warning without blocking the insert.
- [ ] A goal "N followers by date" shows on-pace/behind with required-vs-actual daily rates in the brief; an active `replies` commitment changes the quest target; missed days surface as debt.
- [ ] The Sunday digest facts carry a 0–100 scorecard once ≥4 days are tracked (null before), and the Digest card renders it.
- [ ] `scripts/smoke-guardrails.ts` passes, $0, cleans up after itself.

---

## Task 1: Following ledger — schema + ingest/ratchet routes
**Depends on:** none
**Session budget:** ~400 lines, 5 files

**Read first:** codemap header + §3.3/§4/§7 (esp. 7.10, 7.11, 7.13, 7.20); `src/x/db/schema.ts` (streaks L509, followupSnoozes L496, harvestRuns/harvestRows L582+ as shape exemplars); `src/x/routes/harvest.ts` (full — the ingest exemplar); `src/x/routes/radar.ts` (status-ratchet PATCH exemplar); `src/x/index.ts` (mount list + order).

**Edit:**
- `src/x/db/schema.ts` — add `followingRuns` + `following` tables (DDL sketch in Design §A).
- `src/db/migrations/` — `bun run db:generate`, inspect SQL (no seeds needed here, but verify nothing else got dropped).
- `src/x/routes/following.ts` — new router: `POST /following/runs`, `POST /following/rows` (≤500, upsert + complete-run reconcile in one sync txn), `GET /following`, `PATCH /following/:handle`. Leave `GET /following/queue` for Task 3 but structure the file so static paths register before `/:handle` (§7.20).
- `src/x/index.ts` — mount `following` router (always mounted; no Grok involvement).
- `src/x/routes/following.test.ts` — route suite over the in-memory DB.

**How:** Handle normalization: reuse `normalizePersonHandle` from `src/x/people/store.ts` (harvest.ts imports it the same way). Upsert semantics: `first_seen_at` fill-only, everything else refreshed (§7.9 analog). The reconcile on `done: true`: inside one sync txn (`.run()` terminals, no await — §7.13) mark unseen `active|queued` → `gone`, unseen `done` → `confirmed`, seen `done` → `queued`, then stamp the run `complete`. "Unseen" = `last_run_id != thisRunId` — rows batches already refreshed carry the run id, so the reconcile needs no in-memory set. 409 `run_already_complete` on rows for a completed run. PATCH: only `queued→done` (+ stamp `unfollow_marked_at`) and `keep` toggle; anything else 409 `invalid_transition`, unknown handle 404.

**Tests:** run create; batch upsert (fill-only first_seen, follows_back refresh); complete-run reconcile matrix (gone/confirmed/done→queued, and **partial run touches nothing**); 400s (bad handle, empty rows, >500); 409 on completed run; PATCH ratchet (done from queued OK, done from active 409, keep toggle).

**Done when:**
- [ ] Two-run lifecycle works end-to-end in the test: run A seeds, handle disappears in complete run B → `gone`; `done` handle absent in B → `confirmed`.
- [ ] Partial run (no `done: true`) never flips statuses.
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(following): ledger schema + ingest/ratchet routes`

**Cost note:** $0 — pure ingest, no X API anywhere in the file (state it in the header comment like harvest.ts does).

---

## Task 2: Harvester following mode (extension)
**Depends on:** Task 1
**Session budget:** ~350 lines, 4 files

**Read first:** codemap §5; `extension/src/shared/harvest.ts` (full); `extension/src/harvester.ts` lines 1–140 (engine + pacing), 330–420 (`harvestPosts`/`harvestReplies` ctx pattern), 497–660 (ingest/ship/runHarvest); `extension/src/sidepanel/Harvest.tsx` (mode radio + context probe).

**Edit:**
- `extension/src/shared/harvest.ts` — `HarvestMode` gains `'following'`; `harvestTargetUrl`/`isAtTarget` handle `/<handle>/following`; new `isFollowingPath(url)`; `HarvestContextResult` gains `onFollowing: boolean`; new `FollowingIngestRow {handle, displayName, followsBack, listPosition}`.
- `extension/src/harvester.ts` — `extractUserCell(cell)` reading `[data-testid="UserCell"]`: handle from the first profile `a[href^="/"]` (strip leading `/`, validate `USERNAME` shape), display name from the cell's first text span, `followsBack` = presence of `[data-testid="userFollowIndicator"]`; `harvestFollowing(ctx)` collecting cells in DOM order (`listPosition` = running index, dedupe by handle); ship via existing `apiSend` to `POST /x/following/runs` then batched `/x/following/rows` (≤500, final batch `done: true` only when the scroll hit natural bottom, not on cancel/max — partial runs must stay incomplete, Task 1 semantics); small CSV (handle, name, followsYou) through the existing `download`/`esc` helpers.
- `extension/src/sidepanel/Harvest.tsx` — third mode option, enabled only when the context probe reports `onFollowing`; scope selector hidden for this mode (forced `'all'`); done-summary shows rows + follows-back count.
- `extension/src/shared/harvest.test.ts` (or the existing shared-module test file) — URL helpers.

**How:** Reuse the scroll engine untouched — following pages lazy-load like timelines; the `stableNeeded` bottom detection works as-is. Do NOT touch `metricsAria` (no metrics here). Locale safety: anchor exclusively on `data-testid` attributes, never on the "Follows you" text. The content script is an IIFE (§7.26) — everything imported must inline. Cursor storage (`harvestCursorKey`) does not apply to this mode; skip since-last logic entirely.

**Tests:** pure URL/type helpers in bun:test (`isFollowingPath`, `harvestTargetUrl('x','following')`, `isAtTarget` for `/x/following`); `extractUserCell` via a happy-dom fixture (the `earlyReplies.test.ts` pattern): normal cell, follows-back cell, malformed cell → null.

**Done when:**
- [ ] Live check: on your own `/following` page, a run streams progress, lands rows in the ledger (`GET /x/following` shows them with correct followsBack), downloads the CSV, and a cancelled run leaves the run incomplete.
- [ ] Fixture tests cover the three cell shapes.
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green (server AND `extension/` build passes: `cd extension && bun run build`)
- [ ] Committed: `feat(following): harvester following-mode scrape`

**Cost note:** $0 — DOM only.

---

## Task 3: Curation queue — pure eligibility/budget + queue route
**Depends on:** Task 1 (parallel-ok with Task 2)
**Session budget:** ~350 lines, 4 files

**Read first:** codemap §3.3/§7 (7.10, 7.12, 7.20); `src/x/people/followups.ts` (pure-classifier exemplar + snooze constants style); `src/x/routes/voice.ts` — `loadTargetHandles` export; `src/x/routes/following.ts` (from Task 1); `src/x/quests.ts` (constant-naming style).

**Edit:**
- `src/x/connections.ts` — new pure module: `GRACE_DAYS = 7`, `UNFOLLOW_WINDOW_MS = 6h`, `WINDOW_CAP_MIN = 15`, `WINDOW_CAP_MAX = 18`, `DAILY_CEILING = 40`; `eligibleForUnfollow(rows, whitelist, now)` (rank oldest `firstSeenAt` first, `listPosition` desc tie-break); `releaseBudget(markTimes, now, rand)` (jittered cap, window count, daily-ceiling zero).
- `src/x/routes/following.ts` — `GET /following/queue` (registered before `/:handle`): load ledger + whitelist (people stage mutual/ally non-retired + `loadTargetHandles()` + `keep` rows), compute eligibility + budget, flip released rows `active→queued` in the same read, return the Design §A payload.
- `src/x/connections.test.ts` — pure suite.
- `src/x/routes/following.test.ts` — queue cases appended.

**How:** Whitelist assembly lives in the route, not the pure module (the pure fn takes a `Set<string>`). Idempotence: already-`queued` rows come back in `batch` on every read until marked done — they consume no new budget (budget counts `unfollow_marked_at`, i.e. completed marks, not releases; a queued-but-never-done row therefore never eats the window). `rand` injected for testability (followups momentum style); route passes `Math.random`. `lastCompleteRunAt` from the newest complete run — the UI freshness banner needs it. Whitelisted handles that are already `queued` (stage changed after release) are dropped from `batch` and flipped back to `active` — a person becoming mutual mid-queue must never be shown for unfollow.

**Tests:** eligibility matrix (follows_back true excluded, grace boundary at exactly 7d, keep excluded, whitelist excluded, ordering); budget (empty window → cap within 15–18 for seeded rand; marks inside window reduce it; 40 in 24h → 0); route: queue flips to queued, re-read returns same batch without double-release, whitelisted-after-release row reverts, mutual-stage person never appears (seed a person row).

**Done when:**
- [ ] Queue read is idempotent and budget-correct in tests.
- [ ] A person at stage mutual with `follows_back=false` never surfaces.
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(following): curation queue with jittered cadence caps`

**Cost note:** $0.

---

## Task 4: People tab Following subtab
**Depends on:** Tasks 2, 3
**Session budget:** ~300 lines, 3 files

**Read first:** codemap §5; `extension/src/sidepanel/Voice.tsx` (the Tweets|Pillars subtab wiring — the exemplar); `extension/src/sidepanel/People.tsx` (roster + dossier structure); `extension/src/sidepanel/api.ts` (client method shape).

**Edit:**
- `extension/src/sidepanel/api.ts` — `following.queue()`, `following.list(params)`, `following.patch(handle, body)`.
- `extension/src/sidepanel/People.tsx` — **Roster | Following** subtab. Following view per Design §A: freshness banner (amber when `lastCompleteRunAt` >7d or null, with "open your /following page and run a following harvest" hint), budget readout (`windowUsed/windowCap · dailyUsed/40`), batch rows (avatar-less: handle link → `https://x.com/<handle>`, displayName, "first seen Nd ago", "unfollowed ✓" button → PATCH done + reload, "keep" toggle), eligible-total line, collapsed ledger search below.
- `docs/people-tab.md` — deferred to Task 10 (do not edit here).

**How:** All HTTP through `api.ts` → background `ApiRequest` (§7.25). Handle click-throughs to the dossier stay for handles that have a people row (`App.onOpenPerson` — the Targets/Radar pattern); the profile link is a plain anchor. No optimistic UI beyond the button flip — reload the queue after each PATCH (single-user, cheap).

**Tests:** none new beyond compile (UI-only task; repo precedent: tab components are untested, logic lives server-side).

**Done when:**
- [ ] Live: batch renders, "unfollowed ✓" moves a row out, keep-toggle removes a row from future queues, freshness banner reflects the last complete run.
- [ ] `bun test` + `bun run typecheck` + `bun run lint` + `cd extension && bun run build` green
- [ ] Committed: `feat(following): People tab Following subtab`

**Cost note:** $0.

---

## Task 5: Monitor — pure rules + route + MCP tool  [parallel-ok]
**Depends on:** Task 1 (only for the `unfollowChurn` table; rule can be written against the schema)
**Session budget:** ~400 lines, 5 files

**Read first:** codemap §3.3/§7 (7.12, 7.19); `src/x/playbook.ts` (pure build-fn + loader split exemplar — skim one section, e.g. `buildLatencyEffectiveness`); `src/x/quests.ts` (inputs-object style); `src/x/mcp.ts` (curated-tool shape, e.g. `x_brief`); `src/x/db/schema.ts` postsPublished L139 (text, postedAt, isReply), replyDrafts L301 (updatedAt semantics).

**Edit:**
- `src/x/monitor.ts` — new pure module: `MonitorAlert`, thresholds as named exported constants, the five rules from Design §B (`postBurst`, `replyBurst`, `nearDuplicate` + `shingleJaccard`, `unfollowChurn`, `scheduleCluster`), `runMonitor(inputs)` composing them, `worstOf(alerts)`.
- `src/x/routes/monitor.ts` — `GET /monitor`: loaders (trailing 24h originals, trailing 3h posted reply times, trailing 14d original texts, trailing 24h `unfollow_marked_at`, pending scheduled slots) + `runMonitor`. Always mounted.
- `src/x/index.ts` — mount.
- `src/x/mcp.ts` — curated `x_monitor` tool (in-process `app.request('/x/monitor')`, forwarded bearer); bump the tool-count assertion in `src/mcp.test.ts`.
- `src/x/monitor.test.ts` + `src/x/routes/monitor.test.ts`.

**How:** `nearDuplicate` normalization: lowercase, strip URLs/@handles, collapse whitespace, 3-word shingles, Jaccard over shingle sets; pairs only among ≤ the trailing-14d originals (small n, O(n²) fine at single-user scale). `replyBurst` uses posted `reply_drafts.updatedAt` (paste time — same reading as the brief quota; say so in a comment). `unfollowChurn` imports `DAILY_CEILING` from `src/x/connections.ts` — one constant, two consumers. Thresholds are opening guesses — name them as exported constants so recalibration is a one-line diff. Sync-driver rules apply to any raw sql (§7.13).

**Tests:** each rule's boundary (4 vs 5 posts/24h; 10 vs 11 replies/hr; Jaccard 0.79 vs 0.81; 24 vs 25 and 39 vs 40 marks; 46 vs 44 min gap); `shingleJaccard` normalization (URL/handle stripped, case-insensitive); `worstOf`; route returns empty alerts on empty DB; seeded route case per rule.

**Done when:**
- [ ] All five rules fire on seeded data and stay silent on clean data.
- [ ] `x_monitor` listed and callable in the MCP test round-trip.
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(monitor): activity-pattern rules + /x/monitor + MCP tool`

**Cost note:** $0 — read-time SQL only.

---

## Task 6: Monitor surfacing — brief block, Today card, schedule-time advisory
**Depends on:** Task 5
**Session budget:** ~300 lines, 5 files

**Read first:** codemap §3.3/§5; `src/x/routes/brief.ts` (structure around the quests block, lines ~590–740, + `pinnedWatch` wiring); `src/x/routes/calendar.ts` (POST /posts/scheduled validation section incl. the URL guard); `extension/src/sidepanel/Today.tsx` (PinnedWatchCard mount point); `extension/src/sidepanel/Composer.tsx` (schedule-response handling).

**Edit:**
- `src/x/routes/brief.ts` — `monitor: {alerts, worst}` block reusing the Task 5 loaders (import from `routes/monitor.ts` — export them there).
- `src/x/routes/calendar.ts` — POST response gains `warnings: string[]` (cluster <45 min vs existing pending; near-duplicate vs trailing-14d originals via `shingleJaccard`). **Never a new 4xx** — the URL guard remains the only content block.
- `extension/src/sidepanel/Today.tsx` — `AccountHealthCard` (renders only when alerts non-empty; severity colors; imitate `PinnedWatchCard` placement right after it).
- `extension/src/sidepanel/Composer.tsx` — display `warnings` amber after a successful schedule.
- `src/x/routes/brief.test.ts` + `src/x/routes/calendar.test.ts` — new assertions.

**How:** Export the Task 5 loader functions from `routes/monitor.ts` so brief doesn't duplicate SQL (the `loadBestTimeCells` precedent, brief.ts/metrics.ts). Calendar advisory computes only over cheap reads already at hand or one extra indexed query — keep it inside the existing handler, after the insert succeeds (a warning must never abort the write).

**Tests:** brief carries `monitor` and stays shaped on empty DB; calendar POST returns `warnings` on a seeded cluster and duplicate, empty otherwise, and still inserts the row in both cases.

**Done when:**
- [ ] Live: scheduling two posts 30 min apart returns (and Composer shows) the cluster warning; Today shows Account health only when alerts exist.
- [ ] `bun test` + `bun run typecheck` + `bun run lint` + extension build green
- [ ] Committed: `feat(monitor): brief block, Today card, schedule-time warnings`

**Cost note:** $0.

---

## Task 7: Goals + commitments — schema, pure pacing/debt, routes, MCP  [parallel-ok]
**Depends on:** none
**Session budget:** ~400 lines, 6 files

**Read first:** codemap §3.3/§4/§7 (7.10–7.13, 7.19); `src/x/quests.ts` (full — streak diary semantics the debt calc reads); `src/x/routes/radar.ts` (lazy status-flip-on-read pattern); `src/x/db/schema.ts` (streaks L509, ideas L470 as uuid-PK exemplar); `src/x/routes/ideas.ts` (CRUD route exemplar); `src/x/mcp.ts` (curated tool shape).

**Edit:**
- `src/x/db/schema.ts` + migration — `goals` + `commitments` tables (DDL sketch in Design §C).
- `src/x/goals.ts` — pure: `goalPacing`, `commitmentDebt`, `computeScorecard` (all per Design §C; scorecard used in Task 9 but defined here with its own tests).
- `src/x/routes/goals.ts` — `GET/POST /goals`, `PATCH/DELETE /goals/:id`, `GET/PUT /commitments`. Always mounted, $0.
- `src/x/index.ts` — mount.
- `src/x/mcp.ts` — curated `x_goals` tool (`app.request('/x/goals')`); bump tool count in `src/mcp.test.ts`.
- `src/x/goals.test.ts` + `src/x/routes/goals.test.ts`.

**How:** Current values at read: `followers` from latest `account_snapshots` (null → pacing degrades to nulls, never a fake 0 — §7.11); `posted_replies` count from posted `reply_drafts` since `baseline_at` (updatedAt = paste time); `originals` from non-reply `posts_published` since `baseline_at`. Trailing-7d actual rate from the same tables. Lazy flips at read (`active→achieved` when current ≥ target; `active→missed` past deadline) — radar-expiry pattern, status ratchet §7.10, PATCH may only set `abandoned`/note. POST validates: metric enum, target > baseline, deadline in the future (400s otherwise). Commitments PUT upserts by key; `daily_target` 1–100.

**Tests:** `goalPacing` matrix (ahead/on_pace/behind boundaries, overdue, achieved, null current); `commitmentDebt` (missing streak rows count as missed only after activeSince; tier boundaries); `computeScorecard` (component weights sum, gate at <4 days → sufficient:false); routes: CRUD lifecycle, lazy achieved/missed flip on GET, validation 400s, commitments upsert.

**Done when:**
- [ ] A goal created with a live baseline flips to achieved on GET once the metric passes target (seeded).
- [ ] `x_goals` in the MCP round-trip.
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(goals): goals + commitments schema, pacing/debt/scorecard core, routes`

**Cost note:** $0.

---

## Task 8: Accountability surfacing — brief + quests integration + Today Goals card + Settings
**Depends on:** Task 7
**Session budget:** ~350 lines, 5 files

**Read first:** codemap §3.3/§5; `src/x/routes/brief.ts` lines 590–745 (quest inputs assembly, `REPLY_TARGET` at L42/L665); `src/x/quests.ts` (QuestInputs — do NOT change its contract); `extension/src/sidepanel/Today.tsx` (quests block render); `extension/src/sidepanel/Settings.tsx` (toggle/persist pattern).

**Edit:**
- `src/x/routes/brief.ts` — read active commitments once: `replies` commitment overrides `repliesTarget` (currently `REPLY_TARGET.min`); add `goals` (with pacing via `goalPacing`) and `commitments` (targets + `commitmentDebt` over the already-loaded streak rows) blocks to the response.
- `extension/src/sidepanel/Today.tsx` — Goals card (pacing bar `pctComplete`, verdict chip, required-vs-actual line, inline add form, abandon button) after the quests block; quests block renders the debt line with tiered copy (tier 0 nothing → tier 3 explicit miss count).
- `extension/src/sidepanel/api.ts` — `goals.*`, `commitments.*` methods.
- `extension/src/sidepanel/Settings.tsx` — commitments editor (two numeric inputs + active toggles, PUT on save).
- `src/x/routes/brief.test.ts` — commitment-override + goals-block assertions.

**How:** The originals commitment maps to the existing `original` quest's target (currently hardcoded 1 in `computeQuests`) — pass it through `QuestInputs`… `QuestInputs` has no originals target field; extend `computeQuests` minimally by adding an optional `originalsTarget` input defaulting to 1 (keep every existing test passing — additive only). Debt copy tiers live in the component, not the server (presentation). An empty goals list renders nothing (the PinnedWatchCard only-when-nudge discipline).

**Tests:** brief: active replies commitment changes `quests.items` target; inactive commitment doesn't; goals block shaped with pacing; quests unchanged when no commitments exist (regression).

**Done when:**
- [ ] Live: setting a replies commitment of 15 changes the quest label/target in Today; a followers goal renders its pacing bar.
- [ ] All pre-existing quest/streak tests untouched and green.
- [ ] `bun test` + `bun run typecheck` + `bun run lint` + extension build green
- [ ] Committed: `feat(goals): brief pacing + commitment-driven quests + Today Goals card`

**Cost note:** $0.

---

## Task 9: Weekly scorecard in the digest
**Depends on:** Tasks 7, 8
**Session budget:** ~250 lines, 4 files

**Read first:** codemap §3.3; `src/x/digest.ts` (full — `DigestFactInputs`/`DigestFacts`/instructions); `src/x/routes/digest.ts` (facts assembly + cache path); `extension/src/sidepanel/Today.tsx` Digest card region; `src/x/goals.ts` `computeScorecard` (from Task 7).

**Edit:**
- `src/x/digest.ts` — `DigestFactInputs`/`DigestFacts` gain nullable `scorecard` (the `rosterCoverage` S0.7 precedent: absent on old cached digests, null under gate, skipped by narration per the no-fabrication rule — no instruction-prefix change needed).
- `src/x/routes/digest.ts` — compute scorecard inputs over the Monday-week (streak rows already loaded for `quests` facts; goal pacing from active goals; activity from the week's tweets); previous-week delta only when the prior cached digest's facts carry a scorecard (read the `digests` row; null otherwise).
- `extension/src/sidepanel/Today.tsx` (Digest card) — grade badge + delta when present.
- `src/x/digest.test.ts` + `src/x/routes/digest.test.ts` — shape + gate + passthrough.

**How:** Scorecard components from facts already assembled: questAdherence (`daysAllDone/daysTracked`), cadenceConsistency (days with ≥1 original / 7), replyQuota (replies vs commitment×7 or `REPLY_TARGET.min`×7), goalPacing (mean verdict score over active goals; skip when none), ratioAdherence (replyPct vs 70). Weighted blend; components with no data drop out and reweight (never fault a quiet component — the quests vacuous-done spirit). Gate: `daysTracked < 4` → `sufficient:false`, score null. Do not touch `DIGEST_INSTRUCTIONS` — the facts block is already the variable tail (§7.15) and the no-fabrication rule handles the new field.

**Tests:** `buildDigestFacts` passes scorecard through; gate at 3 vs 4 days; route: facts carry scorecard, cached digest without one → delta null; factsOnly path unaffected.

**Done when:**
- [ ] `GET /x/digest?factsOnly=true` carries a numeric scorecard over a seeded 5-day week and null over a 2-day week.
- [ ] `bun test` + `bun run typecheck` + `bun run lint` + extension build green
- [ ] Committed: `feat(goals): weekly scorecard in digest facts + card`

**Cost note:** $0 — rides the existing weekly Grok call; `factsOnly`/no-key degradation paths unchanged.

---

## Task 10 (final): docs-sync + smoke
**Depends on:** all prior.

- [ ] `scripts/smoke-guardrails.ts` — rerunnable, $0, cleans up after itself (imitate `scripts/smoke-followups.ts`): seeds a following run → batch rows → complete-run reconcile (gone/confirmed) → queue release respecting a seeded mutual-stage person + keep flag + grace boundary → PATCH done → budget decrement; seeds burst/duplicate/churn → asserts monitor alerts + calendar `warnings`; goal lifecycle (create → pacing → seeded achieve) + commitment override visible in brief; digest factsOnly scorecard. No `--live` flag — nothing paid exists to verify.
- [ ] CLAUDE.md: one phase-style entry ("Guardrails — monitor, following curation, accountability (2026-07-XX, $0)": what shipped, the manual-queue + DOM-scrape decisions, cadence constants, the "done when" tails still pending live verification).
- [ ] PLAN.md status updated (this is goals-1/4-adjacent infrastructure; note the conscious carve-out of the v1 "no follower sync" exclusion for the DOM ledger).
- [ ] `docs/people-tab.md` (Following subtab), `docs/today-tab.md` (Account health + Goals cards, debt line, digest grade), `docs/harvest-tab.md` (following mode), settings doc if present.
- [ ] `.claude/skills/plan-feature/references/codemap.md`: §3.3 (new modules connections.ts/monitor.ts/goals.ts + routers), §4 (4 new tables, migration numbers), §5 (harvester mode, People subtab, Today cards, Settings), §7 (nothing new — existing patterns reused), §9 (new smoke) — header re-stamped to the new commit.

## Out of scope (do NOT build)

- **API following/followers sync** (`GET /2/users/:id/following` at $0.001/result) — rejected by user choice; do not add "just for freshness".
- **`follows.write` scope, API unfollow, or any auto-unfollow worker** — the queue is manual by decision #2; no button may call an X write.
- **Extension-automated unfollow clicking** (content script driving X's unfollow buttons) — site automation, policy exposure; never.
- **Followers-page scrape** — redundant (decision #4).
- **Chrome notifications for monitor alerts** — panel-only v1 (risk list).
- **Hard blocks on scheduling/drafting when behind on commitments** — explicitly declined by user.
- **A whitelist table or UI** beyond the `keep` flag — whitelist is computed read-time from Circles data.
- **Follow-recommendation / who-to-follow features** — curation only prunes, never suggests follows.
- **New goal metric kinds** beyond the three enums — add later with data.

## Risks / watch items

- **X DOM drift**: `UserCell` / `userFollowIndicator` testids can change silently — the scrape then yields zero rows (loud in the panel via rows=0, never corrupt data). Same exposure class as the existing harvester; acceptable.
- **`list_position` ≈ follow recency** is a best-effort assumption about X's following-list ordering — used only as a ranking tie-break, never shown as fact.
- **Grace 7d, window 6h, cap 15–18, ceiling 40, burst/duplicate/churn thresholds, scorecard weights** — all opening guesses (same spirit as the C1 stage thresholds); revisit after ~30 days of real use, constants are named exports for one-line recalibration.
- **Large following lists** need one long or several partial scroll sessions; partial runs never reconcile, so `gone`/`confirmed` detection waits for the first truly complete run — the freshness banner is the mitigation.
- **"Done when" live tails**: the first real complete scrape → queue → unfollow → confirm cycle, and the first Sunday scorecard, both need live use to observe.
- **Feb 2026-style policy shifts**: if X tightens unfollow limits further, only the constants in `src/x/connections.ts` change.
