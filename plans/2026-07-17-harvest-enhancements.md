# Harvest 2.0 — passive timeline harvest + Harvest tab options

- **Status:** planned 2026-07-17 · not started
- **Goal fit:** Goal 2 (metrics over time — band-calibration denominators + longitudinal view curves), goal 3 (swipe-file corpus grows ambiently), goal 4 (timeline-affinity roster candidates). All via $0 DOM capture — no new X API surface.
- **Cost impact:** **$0** recurring. No X reads, no Grok calls, no image calls. Only local SQLite volume (~0.3–1 MB/day at natural browsing pace), bounded by a 2,000-row/day cap and 60-day retention pruning.
- **Invariants touched:**
  - §7.12 no derived-state tables — band is NEVER stored for passive rows; recomputed at read time from stored views/comments/tweetTime/capturedAt/text via shared `replyBand.ts`.
  - §7.19 stats gates — funnel cells n≥20 per band; affinity has a ≥3-distinct-days noise floor.
  - §7.24–27 extension discipline — one transport (`ApiRequest`), content script stays IIFE-safe, no new session-storage writers, shared logic in bun-tested pure modules.
  - §7.20 route order — new harvest routes are all static paths under the existing `harvest` router; no `:param` collisions.
  - §7.8 best-effort side writes — a failed passive flush never disturbs browsing or an active harvest.
  - §8 — nothing here can reach `createPost`, `xFetch`, or `askGrok`.
- **Codemap sections relevant:** §3.4 (`harvest.ts`, `playbook.ts` routes), §3.3 (`playbook.ts` domain module), §4 (`harvestRuns`/`harvestRows`), §5 (content.ts, harvester.ts, Harvest/People/Playbook/Settings tabs), §7, §10.

## Why / what changes for the user

Scrolling the home timeline naturally now harvests every tweet whose metrics the band badge already reads — into the same `harvest_rows` longitudinal series the active harvester uses, at $0, on by default (opt-out in Settings, capped at 2,000 rows/day, pruned after 60 days). Two new read surfaces fall out of that corpus: a **Timeline affinity** section in the People tab ("the algorithm keeps showing you @x — start their file"), and an **Opportunity-capture funnel** in the Playbook ("of the hot-band tweets you saw, you replied to 12%"). The active Harvest tab gains the options the user asked for: an optional CSV download (DB-only harvests), a min-views filter, all form choices persisted across panel closes, and a "Passive: N rows today" status line.

## Design

**Data: zero schema change.** Passive rows fit `harvest_rows` exactly (tweetId, handle, text, 5 metrics, tweetTime, capturedAt, content-shape columns; `orig*`/`groupPosition`/`matchedDraftId` stay null). They hang off a **synthetic per-UTC-day run**: `harvest_runs {handle:'timeline', mode:'timeline', scope:'passive'}`, found-or-created by the server. `mode='timeline'` is the discriminator every consumer filters on; the existing `POST /harvest/runs` validation keeps rejecting it so clients can never create passive runs directly. Repeated sightings ≥30 min apart create new rows on purpose — that IS the longitudinal view curve `harvest_rows` was designed for.

**New endpoint** (in the existing `src/x/routes/harvest.ts` router):

```
POST /x/harvest/passive   { rows: HarvestIngestRow[] }        (≤100/batch)
  → 201 { runId, inserted, skippedRecent, skippedCap }
  → 400 invalid_body | rows_required | too_many_rows | invalid_row_* (reuses parseIngestRow)
Server gates, in order:
  1. lazy retention prune: mode='timeline' runs older than 60d deleted (rows first, then runs, one sync txn)
  2. find-or-create today's UTC passive run
  3. per-tweet recapture gate: skip rows whose tweetId has a mode='timeline' row with capturedAt within 30 min (uses harvest_rows_tweet_captured_idx)
  4. daily cap: run.rowCount + accepted ≤ 2000; overflow dropped, counted in skippedCap
GET /x/harvest/affinity   ?days=30&limit=20&minDays=3
  → 200 { days, minDays, authors: [{handle, distinctDays, sightings, lastSeenAt, avgViews, stage|null, inRoster}] }
```

**Extension capture:** in `content.ts`'s `applyBand` — the scan already computed `readTweetSignals` for every article — record a passive sighting for EVERY article with parseable signals (all bands, including skip; ads have no aria label so `sig === null` filters them free). Gated by: `location.pathname === '/home'` (user decision: home timeline only), the `passiveHarvest` Settings toggle (default ON, `initPassiveCaptureSetting` pattern), and `!isHarvestActive()` (new export of `harvester.ts`'s existing `running` flag — an active harvest must not double-capture). Row built by reusing `extractArticle` (exported from `harvester.ts`; both files share the content IIFE bundle so this inlines). Transport is the `flushSightings` pattern: per-tweet 30-min resend throttle, 5s flush window, ≤100/batch, `ApiRequest POST /x/harvest/passive`, warn-and-drop on failure. Pure gate/mapping helpers live in new `extension/src/shared/passiveHarvest.ts` (bun-tested).

**Read surfaces:**
- *Affinity* — read-time SQL over `harvest_rows mode='timeline'` grouped by handle: distinct UTC days seen + sightings + avgViews over trailing `days`, floor `minDays≥3`, joined to `people` (stage) and `voice_authors` for `inRoster`. Rendered as a People-tab section with "Start their file" click-through (`onOpenPerson`).
- *Funnel* — pure `buildTimelineFunnel` in `src/x/playbook.ts` (new section 11): first sighting per tweet (30d window), band recomputed via shared `classifyBand` (ageMin = capturedAt−tweetTime, vpm derived, bait = `textLooksLikeReplyBait(text)`), replied = posted `reply_drafts.sourceTweetId ∈ seen`. Per-band `{seen, replied, rate}` gated `DEFAULT_MIN_CELL_N`. Wired into `GET /x/playbook` as `timelineFunnel` + a Playbook tab section.

**Harvest tab options:** `HarvestOptions` gains `downloadCsv?: boolean` (default true) and `minViews?: number`; the harvester skips `download()` when `downloadCsv === false` and filters rows below `minViews` at store time. The form (mode/scope/pace/max/minViews/downloadCsv) persists in one `chrome.storage.local` key. Start is blocked with a hint when both CSV and send-to-stratus are off (a harvest that saves nothing). A status line shows today's passive run rowCount (from `GET /x/harvest/runs`) or "Passive capture off".

## Decisions taken

1. **Reuse `harvest_rows`, no new table, no migration.** Passive rows match the table's exact semantics ((tweet_id, captured_at) longitudinal DOM series); a new table would fork identical columns. Band/signals are NOT stored — recomputable from stored fields (§7.12), proven by the shared `replyBand.ts` module.
2. **Home timeline only** (user choice). The corpus means "what the algorithm fed me", which keeps affinity/funnel semantics honest. Everywhere-on-X capture is explicitly out of scope for v1.
3. **Default ON, capped + pruned** (user choice). Opt-out toggle `passiveHarvest` in Settings (C6 `passiveCapture` precedent). Daily cap 2,000 rows, recapture interval 30 min, retention 60 days — all in-file constants, all opening guesses to revisit after ~30 days of real data.
4. **Both analytics surfaces ship** (user choice): affinity roster + opportunity funnel.
5. **All four Harvest-tab options ship** (user choice): CSV toggle, min-views filter, persisted form, passive status line. Send-to-stratus was already default-on — no change there.
6. **Passive rows never touch the people layer at write time.** Timeline exposure is not an interest signal (unlike C6 hovers); auto-creating `people` rows for every timeline author would bloat the roster. Affinity is the deliberate, read-time bridge — the human clicks "Start their file".
7. **Passive run creation is server-only.** `POST /harvest/runs` keeps its `posts|replies` validation; the passive route finds-or-creates its own run. Clients cannot forge `mode='timeline'` runs.
8. **Reposts are captured** (the algorithm chose to show them; the row's handle is the original author's, from the permalink). Own tweets are captured too — filtering is an analysis-time concern.

## Done when

- [ ] Scrolling x.com/home with the extension loaded produces `harvest_rows` with `mode='timeline'` and a single `harvest_runs` row per UTC day whose rowCount grows — with zero X API spend (`/cost/today` unchanged).
- [ ] Re-scrolling past the same tweet within 30 min adds no row; after 30+ min it adds one (the longitudinal curve).
- [ ] The Settings toggle off stops capture within one storage-change event; an active Harvest-tab run suspends passive capture in that tab.
- [ ] `GET /x/harvest/affinity` ranks a seeded 4-days-seen author above a 1-day author, floors at minDays, and flags roster membership.
- [ ] `GET /x/playbook` carries `timelineFunnel` with per-band gates (null rate under n≥20 seen).
- [ ] Harvest tab: a run with CSV off + send-to-stratus on lands rows in the DB with no download; min-views filters; form choices survive a panel close; passive status line shows today's count.
- [ ] `scripts/smoke-passive-harvest.ts` passes end-to-end ($0) against a real server.

---

## Task 1: `POST /x/harvest/passive` — daily run, dedupe gate, cap, retention prune
**Depends on:** none
**Session budget:** ~250 diff lines, 3 files

**Read first:** codemap header + §3.4 + §4; `src/x/routes/harvest.ts` (whole file — you extend it; note `parseIngestRow`, `normalizeHandle`, the sync-txn insert pattern at L136–182); `src/x/db/schema.ts` L582–645 (`harvestRuns`/`harvestRows`); `src/x/routes/launch.test.ts` (route-suite shape over the in-memory DB).

**Edit:**
- `src/x/routes/harvest.ts` — add `POST /harvest/passive` + in-file constants `PASSIVE_MODE='timeline'`, `PASSIVE_DAILY_CAP=2000`, `PASSIVE_RECAPTURE_MS=30*60_000`, `PASSIVE_RETENTION_DAYS=60`, `MAX_PASSIVE_BATCH=100`; export a pure `utcDayStart(now: Date): Date` helper if not trivial inline.
- `src/x/routes/harvest.test.ts` — NEW route suite (none exists; `parseIngestRow` unit tests currently live in `src/test.test.ts` — leave them there).

**How:** Body shape `{rows: unknown[]}`; validate each row with the existing `parseIngestRow` (passive rows simply omit `orig`/`groupPosition`). Order of operations: (1) **prune** — select `harvestRuns.id` where `mode='timeline'` and `createdAt < now − 60d`, then in one sync `db.transaction` delete matching `harvestRows` by `inArray(runId, ids)` then the runs (never touch other modes); (2) **find-or-create today's run** — `mode='timeline'` and `createdAt >= utcDayStart(now)`; insert `{handle:'timeline', mode:'timeline', scope:'passive'}` when missing; (3) **recapture gate** — one query: `harvestRows` where `mode='timeline'`, `inArray(tweetId, batchIds)`, `capturedAt > new Date(now.getTime() − PASSIVE_RECAPTURE_MS)` (Drizzle column mode binds Dates fine; only raw `` sql`` `` needs `.getTime()` — §7.13); also dedupe by tweetId within the batch itself (first wins); (4) **cap** — accept at most `PASSIVE_DAILY_CAP − run.rowCount` rows, count the rest as `skippedCap`; (5) insert accepted rows + bump `rowCount` in one sync txn (mirror the existing `/harvest/rows` txn; `mode: 'timeline'`, orig fields null). **Do NOT log person events** (decision 6). Do NOT add `'timeline'` to the `MODES` const — `/harvest/runs` must keep rejecting it. Response `201 {runId, inserted, skippedRecent, skippedCap}`.

**Tests:** `src/x/routes/harvest.test.ts` via `app.request` over the in-memory DB: creates run on first batch, reuses it on second same-day batch; recapture skip (insert, immediate re-send → `skippedRecent`); batch-internal dupe; cap enforcement (pre-set `rowCount` near 2000 via direct db insert); prune deletes only old `mode='timeline'` runs+rows and leaves a seeded `posts`-mode run alone; 400s (`too_many_rows` at 101, `invalid_row_tweet_id`); `POST /harvest/runs` still 400s on `mode:'timeline'`. Clean up seeded rows (shared in-memory DB — §9).

**Done when:**
- [ ] Two same-day batches share one run; rowCount is exact after skips
- [ ] Prune/cap/recapture cases above pass; other harvest modes untouched by prune
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(harvest): passive timeline ingest endpoint with cap, dedupe and retention`

**Cost note:** $0 — pure SQL over DOM-shipped rows; nothing in this route can reach `xFetch`.

---

## Task 2: Content-script passive capture + Settings toggle
**Depends on:** Task 1
**Session budget:** ~300 diff lines, 6 files

**Read first:** codemap header + §5 + §7.24–27; `extension/src/content.ts` L1053–1250 (applyBand, radar record/flush, `initPassiveCaptureSetting`, `flushSightings` — your exemplars) and L1326–1360 (scan loop/start); `extension/src/harvester.ts` L120–201 (`Extracted`, `extractArticle`) and L750–800 (the `running` flag); `extension/src/shared/sightings.ts` + its test (pure-module shape); `extension/src/sidepanel/Settings.tsx` (toggle rows).

**Edit:**
- `extension/src/shared/passiveHarvest.ts` — NEW pure module: `PASSIVE_HARVEST_KEY='passiveHarvest'`, `PASSIVE_FLUSH_MS=5000`, `PASSIVE_RESEND_MS=30*60_000`, `PASSIVE_BATCH_MAX=100`, `isHomeTimelinePath(pathname): boolean` (exactly `/home`, trailing-slash tolerant), `shouldRecordPassive(lastSentAt: number|undefined, now: number): boolean`, `toPassiveIngestRow(x: Extracted): HarvestIngestRow|null` (null when `id`/`handle` missing; text truncated to 500 chars, `textLen` = pre-truncation length; content-shape fields carried over).
- `extension/src/shared/passiveHarvest.test.ts` — NEW.
- `extension/src/harvester.ts` — export `extractArticle` and add `export function isHarvestActive(): boolean` returning the existing module-level `running` flag (L752).
- `extension/src/content.ts` — passive-harvest section (init setting listener mirroring `initPassiveCaptureSetting`; `recordPassiveHarvest(article)` called from `applyBand` whenever `sig !== null`; pending map + sentAt map (clear at >5000) + flush timer; flush sends `ApiRequest {method:'POST', path:'/x/harvest/passive', body:{rows}}`, ignores `unconfigured`, warns otherwise). Gate inside record: enabled && `isHomeTimelinePath(location.pathname)` && `!isHarvestActive()`.
- `extension/src/sidepanel/Settings.tsx` — "Passive timeline harvest" toggle row (default ON, absent-key=enabled — copy the `passiveCapture` row).
- `docs/settings-tab.md` — deferred to Task 6 (note it).

**How:** Capture ALL bands including skip — the funnel needs denominators; `sig === null` (ads/promoted) filters itself. Build the row from `extractArticle(article)` (NOT a new parser — §7.27 spirit: one DOM reader). Keep content.ts IIFE-safe: `passiveHarvest.ts` and the `extractArticle` export are inlined by the content build pass (same as `replyBand`); no dynamic import. Do not touch the radar pipeline — passive capture is a sibling section, not a modification of `recordRadarSighting`.

**Tests:** pure suite: path matcher (`/home`, `/home/`, `/notifications` no, `/elonmusk` no), resend gate boundaries, `toPassiveIngestRow` (truncation + textLen, null-id → null, shape-field passthrough). Extension build (`cd extension && bun run build` or the repo's equivalent) must succeed — the IIFE pass catches import mistakes.

**Done when:**
- [ ] Manual check: scrolling x.com/home logs POSTs to `/x/harvest/passive` (network tab), rows land in DB; toggling the setting off stops them without reload; starting a Harvest-tab run suspends them
- [ ] Pure tests green; extension builds
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(extension): passive home-timeline harvest capture with settings opt-out`

**Cost note:** $0 — DOM only; a failed flush warns and drops.

---

## Task 3: Harvest tab options — CSV toggle, min-views, persisted form, passive status  [parallel-ok with Task 2]
**Depends on:** Task 1 (only for the status line; the rest is independent)
**Session budget:** ~250 diff lines, 4 files

**Read first:** codemap header + §5; `extension/src/sidepanel/Harvest.tsx` (whole file); `extension/src/shared/harvest.ts` (`HarvestOptions`, `HarvestIngestRow`); `extension/src/harvester.ts` L343–420 (`harvestPosts`/`harvestReplies` store filters), L578–592 (`download`), L634–750 (`runHarvest` — where the CSV/ingest branch lives); `extension/src/sidepanel/harvestClient.ts`.

**Edit:**
- `extension/src/shared/harvest.ts` — `HarvestOptions` gains `downloadCsv?: boolean` (absent = true) and `minViews?: number`.
- `extension/src/harvester.ts` — skip `download()` when `downloadCsv === false` (the `done` event's `filename` becomes `''`; keep the field, UI branches on it); in `harvestPosts`/`harvestReplies` skip items whose own `metrics.views < minViews` before storing.
- `extension/src/sidepanel/Harvest.tsx` — "Download CSV" checkbox (default on) + "Min views" number input in the tuning row; persist the whole form (`mode`, `scope`, `pace`, `maxStr`, `minViews`, `downloadCsv`) under one `chrome.storage.local` key `harvestForm` loaded on mount (keep the separate legacy `harvestSendToStratus` key as-is); disable Start with a hint when `!downloadCsv && !sendToStratus`; result block words the no-CSV case ("saved to stratus only"); passive status line at the bottom: fetch `GET /x/harvest/runs?limit=20` via the existing api client path, find `mode==='timeline'` with `createdAt` in today (UTC), render "Passive: N rows today" — or "Passive capture off" when `chrome.storage.local` `passiveHarvest === false`.
- `extension/src/sidepanel/harvestClient.ts` — only if the runs fetch needs a helper; prefer the existing `api.ts` request path.

**How:** Persisted form: one JSON object, field-by-field lenient parse (bad/missing fields fall back to defaults — `brandKit.ts` parse pattern). Min-views applies to the harvested item's own views in both modes (not `orig`). Don't restructure the harvester's event protocol; `done.filename: ''` is the only wire change and old panels ignore it.

**Tests:** the form-persistence parse helper, if extracted, gets a pure test; otherwise this task is UI-only — the harvester filter gets covered by extending whatever pure store-level test exists, or by a minimal exported-predicate test (`passesMinViews(views, minViews?)` in `shared/harvest.ts`, tested).

**Done when:**
- [ ] Manual: DB-only harvest (CSV off) lands rows with no download; min-views 1000 drops low rows from both CSV and ingest; closing/reopening the panel restores the form; status line shows today's passive count
- [ ] Start blocked with hint when both outputs are off
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(extension): harvest tab options — csv toggle, min-views, persisted form, passive status`

**Cost note:** $0.

---

## Task 4: Timeline affinity — route + People tab section  [parallel-ok with Tasks 2/3/5]
**Depends on:** Task 1
**Session budget:** ~280 diff lines, 4 files

**Read first:** codemap header + §3.4 + §7.13/§7.20; `src/x/routes/harvest.ts` (the router you extend + Task 1's constants); `src/x/routes/voice.ts` `loadTargetHandles` + the targets SQL (banding exemplar); `src/x/routes/people.test.ts` (rankmap test shape); `extension/src/sidepanel/People.tsx` (roster section + `onOpenPerson` wiring).

**Edit:**
- `src/x/routes/harvest.ts` — `GET /harvest/affinity` (static path on the harvest router — no `:param` trap, but keep it defined before any future param routes; §7.20).
- `src/x/routes/harvest.test.ts` — extend Task 1's suite.
- `extension/src/sidepanel/api.ts` — `harvest.affinity(days?)` client method.
- `extension/src/sidepanel/People.tsx` — "Timeline affinity" section.

**How:** Query params: `days` (default 30, clamp 7–90), `limit` (default 20, clamp 1–50), `minDays` (default 3, clamp ≥1) — invalid → `400 invalid_*` (route-validation style of `metrics.ts` `tzOffsetMin`). SQL over `harvestRows` where `mode='timeline' AND capturedAt >= since`: group by `handle` → `count(*) sightings`, `count(DISTINCT strftime('%Y-%m-%d', captured_at/1000, 'unixepoch')) distinctDays`, `max(captured_at) lastSeenAt`, `avg(views) avgViews`. **Raw `` sql`` `` comparisons need `.getTime()`** (§7.13). Filter `distinctDays >= minDays`, order distinctDays desc then sightings desc, limit. Join in TS: `people` rows by `lower(handle)` (stage, skip `retired`), `voice_authors` existence → `inRoster = person || voiceAuthor`. People tab: collapsible section under the roster — handle, `{distinctDays}d · {sightings}×` line, stage chip when known, else a "Start their file" affordance that calls the existing unknown-handle dossier flow via `onOpenPerson(handle)`. No new message types, no storage.

**Tests:** route suite: seed one author across 4 distinct capturedAt days + one single-day author (below floor) + one roster member (seed a `people` row) → ordering, floor, `inRoster`/`stage` join, window exclusion (a 60-day-old row outside `days=30`), param validation 400s. Clean up seeds.

**Done when:**
- [ ] Seeded multi-day author outranks single-day; floor and window hold; roster flag correct
- [ ] People tab renders the section with click-through to the dossier
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(harvest): timeline affinity route + people tab section`

**Cost note:** $0 — read-time SQL over already-captured rows.

---

## Task 5: Opportunity-capture funnel — playbook cell  [parallel-ok with Tasks 2/3/4]
**Depends on:** Task 1
**Session budget:** ~300 diff lines, 5 files

**Read first:** codemap header + §3.3 playbook + §7.19 + §10 "New measurement"; `src/x/playbook.ts` (section 8 `buildLatencyEffectiveness` + `DEFAULT_MIN_CELL_N` — your exemplar), `src/x/routes/playbook.ts` (a loader like `loadMediaRows`, the `GET /playbook` assembly, `minN` knob); `src/shared/replyBand.ts` (`classifyBand` signature, `textLooksLikeReplyBait`); `extension/src/sidepanel/Playbook.tsx` (one gated section, e.g. "Reply latency").

**Edit:**
- `src/x/playbook.ts` — section 11: `TimelineSeenRow {tweetId, views, comments, text, tweetTimeMs|null, capturedAtMs}`, `deriveTimelineBand(row)` (ageMin = `(capturedAtMs − tweetTimeMs)/60000`, null tweetTime → null band = excluded; vpm = views/max(ageMin,1); bait = `textLooksLikeReplyBait`; feed `classifyBand`), `buildTimelineFunnel(seen, repliedTweetIds, minN)` → `{hot: {seen, replied, rate, sufficient}, warm: {...}}` — `rate` null under gate, per-band gate on `seen` count.
- `src/x/playbook.test.ts` — pure cases.
- `src/x/routes/playbook.ts` — `loadTimelineFunnel(minN)`: first sighting per tweet over trailing 30d (`SELECT tweet_id, min(captured_at) …` sub-select or group-by, mode='timeline'), replied set = posted `reply_drafts.sourceTweetId`; wire into `GET /playbook` response as `timelineFunnel` (minN flows through like every other cell).
- `src/x/routes/playbook.test.ts` — route case.
- `extension/src/sidepanel/Playbook.tsx` — "Timeline funnel" section: per-band seen/replied/rate table, silent-until-gated note (copy the latency section's wording).

**How:** First-sighting-per-tweet is the band that mattered — the moment the tweet was replyable; later re-sightings must not re-band it. Band is recomputed, never stored (§7.12, decision 1). Replied = **posted** drafts only (paste-time reading, consistent with quota/roster-coverage). Keep the load inside `loadTimelineFunnel` — playbook's existing reply-row loaders don't carry passive rows. Mind the shared in-memory DB (§9): seed passive rows in this suite's own run and delete them after — other playbook tests assert exact medians.

**Tests:** pure: band derivation (null tweetTime excluded, bait flips a would-be band per `classifyBand` rules), gate (19 seen → sufficient:false, rate null; 20 → number), replied intersection counts distinct tweetIds. Route: seeded 30d window + partition sanity (hot.seen counts distinct tweets, not rows).

**Done when:**
- [ ] `GET /x/playbook` carries `timelineFunnel`; gates hold at the boundary
- [ ] Playbook tab renders the section (silent note when under gate)
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(playbook): timeline opportunity-capture funnel over passive harvest rows`

**Cost note:** $0.

---

## Task 6 (final): docs-sync + smoke
**Depends on:** all prior.

- [ ] `scripts/smoke-passive-harvest.ts` — rerunnable, $0, no `--live` needed: in-process Hono + real DB (mirror `scripts/smoke-followups.ts`): POST a passive batch → run created + rows inserted; immediate re-POST → `skippedRecent`; oversized batch → 400; seed an old passive run → next POST prunes it; `GET /harvest/affinity` returns the seeded author; `GET /playbook` carries `timelineFunnel`; deletes every seeded run/row on exit.
- [ ] CLAUDE.md: one phase-style entry ("Harvest 2.0 — passive timeline harvest + options (2026-07-XX, $0)": mode='timeline' convention, cap/prune/recapture constants as opening guesses, decision 6, band-recomputed-not-stored).
- [ ] `PLAN.md` status updated (harvest lives under goals 1–3 tooling).
- [ ] `docs/harvest-tab.md`, `docs/people-tab.md`, `docs/playbook-tab.md`, `docs/settings-tab.md` updated (whichever exist for those tabs — check `docs/`).
- [ ] `.claude/skills/plan-feature/references/codemap.md`: §3.4 (harvest routes), §4 (harvest_runs mode='timeline' convention), §5 (content.ts passive section, Harvest/People/Playbook/Settings rows, new shared module), §9 (smoke list) + header re-stamped.

## Out of scope (do NOT build)

- Capture outside `/home` (profiles, search, detail pages) — explicit user decision; revisit only with a new plan.
- Storing band/signals columns on `harvest_rows` — band is derived at read time; adding columns re-litigates decision 1.
- Person/people-table writes from passive rows (decision 6) — affinity's "Start their file" is the only bridge.
- Any X API enrichment of passively-seen tweets or authors (other-user reads are 5×; the whole point is $0).
- A background worker or alarm for passive capture — it rides the existing scan loop; no new timers server-side either (prune is lazy, in-request).
- Auto-tagging passive rows into channels; the existing `radar_drafts`/`voice_tweets` tag surfaces are unaffected.
- Changing `POST /harvest/rows` or the replies-mode reconcile in any way.

## Risks / watch items

- **Volume constants are opening guesses** (2,000/day cap, 30-min recapture, 60-day retention, minDays 3) — revisit after ~30 days of real scrolling, same spirit as the BAND ≥100 rule.
- **`extractArticle` on the home timeline** was built for profile pages; social-context quirks (e.g. "reposted" labels, promoted layouts) may differ — the `sig === null` filter plus `idFrom` null-guard should absorb it, but watch `metrics_unparsed` console errors the first week.
- **Funnel denominator honesty:** tweets seen but never replyable (own tweets, followed-only replies) inflate `seen`; if the rate reads absurdly low once gated, refine the population in a follow-up — don't pre-filter now.
- **First live "done when" tails:** the first same-tweet re-sighting ≥30 min apart (longitudinal curve) and the first affinity author promoted to a dossier are the real proof — watch for both.
- Codemap was current at planning time (`2a7693e`, no drift); Task 6 re-stamps it.
