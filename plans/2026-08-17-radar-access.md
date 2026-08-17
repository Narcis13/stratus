# Radar access — the swept queue, readable and draftable from a Claude Code session (RA)

- **Status:** planned 2026-08-17 · not started
- **Goal fit:** goals 2 + 4 — the $0 DOM corpus grows a second half (what my sweep *admitted*, not just what /home fed me), and the people layer gets a relationship-aware drafting hand that costs stratus nothing.
- **Cost impact:** **$0 recurring, $0 per call.** No `xFetch`, no `askLLM`, no image call anywhere in the lane. Reply drafting moves from Grok (~$0.002–0.01/batch) to the operator's own Claude Code session, so this lane can only *reduce* spend. Storage: ≤2,000 new rows/UTC-day × 60-day retention ≈ 120k rows worst case (~30 MB at the 500-char text clamp).
- **Invariants touched:** #2 (programmatic replies — every reply this lane produces ends in a manual paste; nothing here can call `createPost`), #4 (one place to call X — no file in this lane may import `xFetch`), #8 (the only billed X call is `createPost` — this lane adds no read), §7.8 (best-effort side writes — the background ship hook never fails the buffer write), §7.9 (fill-only vs overwrite upserts), §7.10 (status ratchets — `radar_drafts` ready→clicked→expired is not widened), §7.11 (null = unknown — `verified`, `posted_at`, `source_path`), §7.12 (no derived-state columns — `vpm`/`person_tier` are read-time), §7.16 (server-stamped fields — band/signals/postedAt on a composed draft come from OUR row, never the caller), §7.19 (stat gates — every comparative cell n≥20), §7.20 (static path before `:param`), §7.24 (background = single writer), §7.27 (shims, never a forked rule — `bandStickiness` moves to `src/shared/`), §7.407 (ambient ingest: free-text/server-owned parent, lazy prune, warn-and-drop client, throttle mirrors the server window, gate order is the perf contract), §7.415a (machine output must not re-enter "your voice" — watch item, see Risks).
- **Codemap sections relevant:** header stamp, §3.4 (routes), §4 (DB — table count 42 → **43**, migration head `0028` → **`0029`**), §5 (extension: `background.ts`, `Radar.tsx`, Storage keys), §6 (MCP — 25 → **28** tools), §7.8/7.9/7.10/7.11/7.12/7.16/7.19/7.20/7.24/7.27/7.407, §8, §9.

## Why / what changes for the user

Today a swept tweet exists **only in the browser** (`chrome.storage.local['radar:sightings']`, cap 500, 24h TTL) unless a Grok batch draft happens to persist it. A Claude Code session can read what was *drafted* and what /home fed you three weeks ago — never what your armed sweep actually admitted, and never a sweep on `/search`, a list, or a profile.

After this lane: every sighting the Radar queues is mirrored to the server at capture time, with the page it came from. From a terminal session, `x_radar` answers "what did my sweep admit in the last 3 days, which of it is unworked, and which of it still clears today's filters"; `x_radar_tweet` shows one tweet's whole history (sightings → drafts → posted reply). Then Claude picks the tweets worth answering, composes 2–3 angle variants per tweet with `x_radar_draft_reply`, and one **Fetch drafts** click in the Radar tab makes those rows reply-ready in the panel — the same card, the same angle tabs, the same copy-on-pick handoff as the "Draft replies" button, with the paste still manual. Grok is not involved and stratus pays nothing.

## Design

**Data.** One new table, `radar_sightings`, **keyed by `tweet_id` (PK) and upserted** — the metric curve for /home already lives in `harvest_rows`; this table answers "what did my sweep admit and what happened to it", so bounded growth beats a second series. Columns: `url?`, `handle`, `author?`, `text` (≤500), `band` (`manual|roster|cannon|sweep`), `views`, `replies`, `likes?`, `bait`, `verified?`, `posted_at?` (derived once from `seenAt − ageMin`), `source_path?`, `first_seen_at`, `last_seen_at`, `seen_count`. Indexes `(last_seen_at)` and `(handle, last_seen_at)`. No FK (a sighting is usually a stranger). Migration **`0029`**, DDL-only, no seed.

```sql
CREATE TABLE radar_sightings (
  tweet_id text PRIMARY KEY NOT NULL, url text, handle text NOT NULL, author text,
  text text NOT NULL, band text NOT NULL,
  views integer NOT NULL, replies integer NOT NULL, likes integer,
  bait integer NOT NULL, verified integer, posted_at integer, source_path text,
  first_seen_at integer NOT NULL, last_seen_at integer NOT NULL,
  seen_count integer DEFAULT 1 NOT NULL
);
CREATE INDEX radar_sightings_last_seen_idx ON radar_sightings (last_seen_at);
CREATE INDEX radar_sightings_handle_idx ON radar_sightings (handle, last_seen_at);
```

**Pure logic.** `src/x/radar/corpus.ts` (new): `parseSightingWireRow` (the `parseIngestRow` twin), `mergeSightingRow` (upsert rules), `derivePostedAt`, `sightingVpm`, `buildSightingViews`, `summarizeSightings`. `bandStickiness` + a `RadarBandName` union move from `extension/src/shared/radar.ts` into `src/shared/radarSweep.ts` so the page and the server ratchet a band with **one** copy of the rule (§7.27); the extension keeps `RadarBand` as an alias so no importer changes.

Merge rules (§7.9): `first_seen_at`/`posted_at`/`source_path`/`verified` are **fill-only** (where it *first* entered the queue is the interesting fact, and null never overwrites a known value); `last_seen_at` is max and metrics only move when the incoming sighting is newer; `likes` fills rather than overwrites with null (a metric-less re-sighting keeps what was captured — the extension's own rule); `band` ratchets by `bandStickiness` (manual > sweep/cannon > roster, equal → incoming); `seen_count` increments.

**Routes** — all four in the already-mounted `src/x/routes/radar.ts` (no `mountX` change), `$0` by construction, and nothing in the file may import `xFetch`/`askLLM`:

| Route | Body / params | Response | Errors |
|---|---|---|---|
| `POST /x/radar/sightings` | `{ rows: [{ tweetId, url?, handle, author?, text, band, views, replies, likes?, bait, verified?, ageMin, seenAt?, sourcePath? }] }`, ≤100 | 201 `{ inserted, updated, skippedRecent, skippedCap }` | 400 `invalid_body` / `rows_required` / `too_many_rows` / `{field}_invalid` + `index` |
| `GET /x/radar/sightings` | `days` (7, 1–60), `band`, `handle`, `admitted`, `worked`, `order` (`vpm\|views\|lastSeen`), `limit` (50, ≤200) | `{ days, sweep, count, summary, sightings[] }` | 400 `invalid_days` / `invalid_limit` / `invalid_band` / `invalid_handle` / `invalid_order` |
| `GET /x/radar/sightings/:tweetId` | — | `{ sighting, drafts[], replies[] }` | 400 `invalid_tweet_id`, 404 `not_found` |
| `POST /x/radar/drafts/compose` | `{ tweetId, variants: [{ text, angle }] }` (1–3) | 201 the `radar_drafts` row | 400 `invalid_body` / `invalid_tweet_id` / `invalid_variants` / `invalid_angle` / `reply_too_long`; 404 `sighting_not_found` |

`admitted` is **recomputed** per row through `passesSweep` with `sweepConfigFromSettings()` — the funnel's exact precedent (`loadTimelineFunnel`), and now exact rather than approximate because `verified` is stored. The response echoes the `sweep` config it judged with, since a preset change re-reads history. `worked` joins `radar_drafts` (any status) and posted `reply_drafts` by tweet id. `stage`/`isTarget` are joined from `people` + the target roster at read time (§7.12/§7.16 — the server owns that answer; `person_tier` is deliberately not a column and is never accepted from the client).

`POST /radar/drafts/compose` is the load-bearing one: it **stamps `band` and `signals` from the stored sighting**, never from the caller. That is not politeness — `extension/src/shared/radar.ts::draftRowToSighting` returns `null` when either is missing, so a draft row without them is silently dropped on rehydrate and the panel shows nothing. `signals.ageMin` is recomputed as `now − posted_at` so `POST /radar/drafts/:tweetId/confirm`'s `sourcePostedAt = draftedAt − ageMin` still lands on the true post time. `model` is server-stamped `'claude-code-mcp'` (the cohort key that makes RA measurable), `status: 'ready'`, `curationScore: null`, and prior `ready` rows for that tweet are flipped to `expired` in the same sync txn so "newest ready row wins" stays deterministic with two writers.

**Extension** (no `content.ts` change, no new tab). The `isRadarReport` handler in `background.ts` already receives every sighting — sweep, cannon, roster **and** ⊕ manual pins — and has `sender`, so `source_path` comes from `sender.tab?.url`'s pathname with zero content-script churn. After `addSightings` resolves, a best-effort `shipSightings` batches ≤100, throttles per tweet at 60 s (mirroring the server's recapture window, §7.407), POSTs, and **warns and drops** — never retried, never blocking the buffer write (§7.8/§7.24). Gated by `chrome.storage.local['radarSightingSync']`, default ON / absent = enabled — the HV.2 `passiveHarvest` precedent, deliberately **not** a registry knob (no mirrored-list bookkeeping, and the human owns their browser). `Radar.tsx` grows one **Fetch drafts** action reusing the existing `stratus/radar-rehydrate` message (which already answers `{ok, added}`), because the rehydrate is currently mount-only and MCP-written drafts would otherwise need a tab dance.

**MCP** (25 → 28 tools). Curated reads `x_radar` / `x_radar_tweet` forward to the two GETs; write-tier `x_radar_draft_reply` forwards to compose. Descriptions carry what the model cannot infer: what each band means, that an unworked high-vpm admitted row is the finding, that tweet ids are **strings**, that a composed draft is copy-paste material and publishes nothing.

**Skill.** `.claude/skills/radar-analyst/` — the analysis + drafting protocol over those tools.

**Measurement.** No new column and no new gate needed: `radar_drafts.model` is copied onto `reply_drafts.model` by the existing confirm route, so "do Claude-drafted replies out-earn Grok batch ones" is read-time SQL over `reply_drafts` → outcomes, split on `model = 'claude-code-mcp'`, reportable once each side has n≥20 (§7.19). Adoption reads off `radar_sightings` directly: rows/day and the `source_path` breakdown answer "how much of my sweeping happens outside /home", which is the question the passive corpus structurally cannot answer.

## Decisions taken

1. **Upsert one row per tweet** (user-chosen) rather than an append-only series: `harvest_rows` already owns the longitudinal curve for /home, and the §7.34 "latest row wins" trap is avoided entirely by not having multiple rows.
2. **`person_tier` and `vpm` are NOT columns** — a deviation from the shape sketched during planning. Both are the server's own answers (`people` + target roster; views/age), so storing a client's copy would fork a rule the server owns (§7.16) and add derived state a join already gives (§7.12).
3. **`posted_at` is stored, `ageMin` is not.** Age is a moving number; the post time is a fact. Storing it once keeps the confirm route's `draftedAt − ageMin` derivation correct hours after capture, which is exactly the window Claude drafts in.
4. **The ingest hook lives in `background.ts::addSightings`, not `content.ts::flushRadar`.** It covers every entry path (sweep/cannon/roster/⊕), it is already the single writer with the auth transport, `sender.tab.url` gives `source_path` for free, and the content IIFE stays untouched.
5. **Opt-out is a `chrome.storage.local` toggle, not a registry knob** (HV.2 precedent). A mirrored knob is seven edits and two exact-list tests for a switch only the human at the browser needs.
6. **No `recapture` skip beyond 60 s**, mirroring the client's `RADAR_RESEND_MS`; an upsert is cheap and `seen_count` should mean "times the algorithm put this in front of me", so the two windows are stated as twins on both sides.
7. **Reply text ceiling is 500 chars**, the same clamp the sighting text uses — refusing a long reply the operator could legitimately paste (premium longform) is worse than storing one. Not a knob; revisit only with a real refusal.
8. **Claude's drafts are `band`/`signals`-stamped server-side or they don't exist.** See `draftRowToSighting`: the alternative is an invisible feature that tests pass on.
9. **Composing expires prior `ready` rows for that tweet.** Two writers of `radar_drafts` (Grok batch, MCP compose) otherwise race over "newest ready row wins" at rehydrate.
10. **No `people` / `person_events` writes from the ingest.** Exposure is not interaction — HV.1 decision 6, restated so nobody "improves" it later.
11. **The skill drafts, it never publishes.** Invariant #2: all reply output is manual paste; the MCP write ceiling stays a `radar_drafts` row (and, elsewhere, a `draft` calendar row).

## Done when

1. From a Claude Code session, `x_radar` returns tweets swept minutes earlier on **any** x.com page, each carrying `sourcePath`, `admitted` (recomputed against live sweep settings), and whether it has been worked.
2. `x_radar_tweet <id>` returns that tweet's sighting, every draft written for it, and any posted reply.
3. **End-to-end browser check:** Claude composes 2–3 variants for a chosen tweet via `x_radar_draft_reply`; **Fetch drafts** in the Radar tab makes the row appear reply-ready with angle tabs; picking one copies it, opens the tweet, and leaves a `reply_drafts` row with `source='radar'` and `model='claude-code-mcp'`.
4. `scripts/smoke-radar-access.ts` passes $0 against the real DB and leaves nothing behind (888-prefixed ids, `ra_*` handles — the `smoke-passive-harvest.ts` safety pattern).
5. Setting `radarSightingSync` to `false` stops the feed, and nothing else about the Radar behaves differently.
6. `bun run test` + `bun run typecheck` + `bun run lint` + `cd extension && bun run build` green, and `grep -cE '^\s*import[ {]' extension/dist/content.js` == 0.
7. The dead passive `/home` feed is either fixed or explained in writing (RA.6), so the skill's "what the algorithm feeds me" half is not quietly built on a corpus that stopped on 2026-07-27.

## Rollback story (if the lane stalls mid-way)

Every intermediate state is coherent and every layer is independently reversible. **After RA.1** the table exists with no writer — inert. **After RA.2** the feed can be stopped from the panel toggle (`radarSightingSync: false`) with no deploy; the rows already written are inert data. **After RA.3/RA.4** removing the feature is deleting four route blocks and three tool registrations — the table then sits behind routes nobody calls, exactly the TH.1 rollback shape. The migration is additive (a new table, no FK into an existing one, no column added to a live table), so it never needs reverting; and `radar_drafts` gains no column, so a composed draft is indistinguishable in shape from a Grok batch draft except by its `model` string. RA.5's button is a no-op without RA.4. RA.6 is independent of all of it.

## How `/masterplan` runs this lane

This lane opens **Wave 8**. RA.1's commit also does the registration, or no later task is selectable:

- `plans/MASTERPLAN.md`: add `RA | 2026-08-17-radar-access.md | 8 | Radar sightings mirrored to the server + MCP read/draft tools + radar-analyst skill` to the legend (and bump the title's "17 feature plans" to 18), plus a Wave 8 section with the order/deps/reasoning below.
- `.claude/skills/masterplan/STATE.md`: re-open the ledger with the eight RA rows, and **refresh the stale "current state" line** — it still says tables 41 / MCP 23 tools / migrations through `0025` / registry 62 knobs, while the codemap (authoritative) says **42 tables, 25 MCP tools, head `0028`, 61 knobs / 15 groups / 31 mirrored**. Fix that line in RA.1 or every later task inherits wrong counts.
- Hot-file locks to declare: `src/x/routes/radar.ts` (RA.1/RA.3/RA.4 — serial), `extension/src/background.ts` (RA.2), `extension/src/shared/radar.ts` (RA.1), the migrations journal (RA.1 only, never parallel).

| ID | Task | Depends | Reasoning |
|---|---|---|---|
| RA.1 | `radar_sightings` + ingest route + migration `0029` | — | **xhigh** (migration + a shared-rule move) |
| RA.2 | Extension ships sightings + opt-out toggle | RA.1 | **xhigh** (background single-writer machinery) |
| RA.3 | Reader route + `x_radar` / `x_radar_tweet` | RA.1 | high |
| RA.4 | `POST /radar/drafts/compose` + `x_radar_draft_reply` | RA.1, RA.3 | **xhigh** (the rehydrate contract; two writers of `radar_drafts`) |
| RA.5 | Radar tab **Fetch drafts** action | — (RA.4 to be useful) | high |
| RA.6 | Passive `/home` capture repair | — `[parallel-ok]` | high |
| RA.7 | `radar-analyst` skill | RA.3, RA.4 | high |
| RA.8 | docs-sync + `scripts/smoke-radar-access.ts` | all | high |

---

## Task 1: `radar_sightings` table + the $0 ingest route  (RA.1)
**Depends on:** none
**Session budget:** ~380 lines, 8 files (schema, migration + journal, 1 new pure module + its test, 2 shared-module edits, radar.ts, radar.test.ts) + the MASTERPLAN/STATE registration above.

**Read first**
- Codemap header + §4 (the `harvestRuns`/`harvestRows` row and the migration workflow paragraph) + §7.8/7.9/7.11/7.16/7.407.
- `src/x/routes/harvest.ts:47–98` (regexes, caps, the passive constants) and `:268–373` (`POST /harvest/passive` — the ingest exemplar: parse-all-then-write, batch dedup, recapture skip, volume cap, lazy prune, honest `skipped*` counts) and `:833–855` (`utcDayStart`, `prunePassiveRuns`).
- `src/x/db/schema.ts:397–459` (`radarDrafts` — column style, `timestamp_ms`, index naming) and `:675–723` (`harvestRows`).
- `extension/src/shared/radar.ts:1–135` — `RadarBand`, `bandStickiness`, `evictionWeight`, the `RadarSighting` interface (this is the wire's source shape; note `likes`/`verified` are optional and `signals.ageMin` is capture-time).
- `src/shared/radarSweep.ts:100–145` (`passesSweep`, `SweepConfig`) — where the moved rule lands.
- `src/x/routes/radar.ts:1–50, 165–216` (file header, `TWEET_ID_RE`, the route style).

**Edit**
- `src/shared/radarSweep.ts` — add `export type RadarBandName = 'manual' | 'roster' | 'cannon' | 'sweep'` and `export function bandStickiness(b: RadarBandName): number`, moved verbatim (comment included) from the extension module. One copy of the ratchet, page and server (§7.27).
- `extension/src/shared/radar.ts` — `export type RadarBand = RadarBandName` (alias, so every existing importer is untouched); delete the local `bandStickiness` and import it from `../radarSweep.ts` (the shim path `cannon.ts`/`replyBand.ts` already use). Leave `evictionWeight` where it is — it is a client display rule, not a shared one.
- `src/x/db/schema.ts` — `radarSightings` exactly as the DDL sketch in Design; header comment states the upsert contract, why it is not a second `harvest_rows` series, and that `vpm`/`person_tier` are read-time (§7.12).
- `bun run db:generate` → `src/db/migrations/0029_*.sql` + journal append. **Inspect the emitted SQL** and verify no seed INSERT was dropped: `git diff --stat src/db/migrations/` shows only the new file + journal, and a fresh `SQLITE_PATH=:memory:` boot still reports 3 `content_pillars` rows (never grep for `INSERT INTO` — `0000`'s `INSERT OR IGNORE` spelling makes that return 0).
- `src/x/radar/corpus.ts` (NEW, pure — no db import): `SightingWireRow`, `parseSightingWireRow(v): SightingWireRow | { error: string }`, `derivePostedAt(seenAtMs, ageMin)`, `mergeSightingRow(existing, incoming)` returning the column patch, `SIGHTING_TEXT_MAX = 500`.
- `src/x/routes/radar.ts` — `POST /radar/sightings`, plus `SIGHTING_RECAPTURE_MS = 60_000`, `SIGHTING_DAILY_NEW_CAP = 2000`, `SIGHTING_RETENTION_DAYS = 60`, `MAX_SIGHTING_BATCH = 100`.
- Tests: `src/x/radar/corpus.test.ts` (NEW) + a `POST /radar/sightings` describe block in `src/x/routes/radar.test.ts`.

**How**
- Mirror `POST /harvest/passive` structurally: validate body → parse every row (first bad row 400s with its `index`, nothing written) → batch-dedup by tweetId (last wins, count as `skippedRecent`) → skip tweets whose stored `last_seen_at` is within `SIGHTING_RECAPTURE_MS` **and** whose band is unchanged → cap new inserts at `SIGHTING_DAILY_NEW_CAP` counting rows with `first_seen_at ≥ utcDayStart(now)` (import `utcDayStart` from `./harvest.ts`; radar.ts already imports from sibling route files) → lazy-prune `last_seen_at < now − 60d` on the ingest path (no worker, §7.407).
- Writes go through **one sync `db.transaction`** (§7.13 — `.run()`/`.all()` terminals, no `await` inside): existing rows get `mergeSightingRow`'s patch, new ones a plain insert. Drizzle's `onConflictDoUpdate` is fine for the insert half, but the fill-only/newer-wins rules live in the pure module and are unit-tested there, not in SQL.
- `parseSightingWireRow`: `TWEET_ID_RE` + `USERNAME_RE` (lowercase the handle — every side lowercases), `band` ∈ the 4-union with legacy `'hot'|'warm'` folded onto `'sweep'` (the extension already coerces; be lenient here too so an old build's buffer still lands), `text` trimmed and clamped to 500, integer metrics ≥ 0, `likes`/`verified` optional and **absent ≠ 0/false** (§7.11), `bait` required boolean, `ageMin` integer 0…525600, `seenAt` optional ISO (default now, clamped to ≤ now), `sourcePath` optional string ≤200 chars kept verbatim (it is a path, not a URL — do not accept a full URL here; the client sends the pathname).
- **Do not** write `people` / `person_events` (decision 10) and **do not** touch `mentions` (invariant). No import of `xFetch`/`askLLM` in this file, ever.
- Registration: the MASTERPLAN legend + Wave 8 table + the STATE.md ledger/count refresh described in "How `/masterplan` runs this lane", in this same commit.

**Tests**
- `corpus.test.ts`: every parse rejection by name; the 500-clamp; legacy band folding; `derivePostedAt` (including `ageMin: 0`); `mergeSightingRow` — newer sighting moves metrics, **older sighting does not**, `first_seen_at`/`posted_at`/`source_path`/`verified` fill-only, `likes: undefined` keeps the stored value, band ratchets (`roster` → `sweep` upgrades, `sweep` → `roster` does not, `manual` survives everything, equal stickiness → incoming), `seen_count` increments.
- `radar.test.ts`: 201 insert then re-POST → `updated` + `skippedRecent` inside 60 s; a band change inside 60 s **is** accepted; oversized batch → 400 with nothing written; bad row → 400 carrying `index`; daily cap → `skippedCap`; a 61-day-old row is pruned by the next POST while a fresh one survives.

**Done when**
- [ ] `POST /x/radar/sightings` upserts, dedups, caps, prunes, and reports honest counts.
- [ ] One copy of `bandStickiness` exists in the tree (`grep -rn "function bandStickiness" src extension` returns exactly one hit).
- [ ] Migration `0029` is DDL-only, inspected, and a `:memory:` boot still shows 3 `content_pillars` rows.
- [ ] MASTERPLAN Wave 8 + STATE.md ledger opened, stale counts corrected.
- [ ] `bun run test` + `bun run typecheck` + `bun run lint` green (extension build too — `shared/radar.ts` changed).
- [ ] Committed: `feat(radar): RA.1 radar_sightings table + $0 sighting ingest`

**Cost note:** $0 — local SQLite only.

---

## Task 2: the extension ships every sighting (RA.2)
**Depends on:** Task 1
**Session budget:** ~220 lines, 5 files.

**Read first**
- Codemap §5 `background.ts` row + Storage-keys row + §7.24/§7.407.
- `extension/src/shared/passiveHarvest.ts` (whole file — the pure twin this imitates) and `extension/src/content.ts:3491–3548` (`recordPassiveHarvest`/`flushPassiveHarvest` — the transport shape, warn-and-drop, `unconfigured` silence).
- `extension/src/background.ts:319–400` (`readRadar`/`addSightings`, `enqueueRadar`), `:948–968` (the `onMessage` listener — `sender` is in scope), `:519–550` (`markDraftsOnServer` — the best-effort server-mirror idiom to copy).
- `extension/src/sidepanel/storage.ts` (the `Settings` shape + `useSettings` `onChanged` filter) and the `passiveHarvest` rows in `extension/src/sidepanel/Settings.tsx`.

**Edit**
- `extension/src/shared/radarIngest.ts` (NEW, pure): `RADAR_SYNC_KEY = 'radarSightingSync'`, `RADAR_INGEST_BATCH_MAX = 100`, `RADAR_INGEST_RESEND_MS = 60_000`, `shouldShipSighting(sent: {at,band} | undefined, band, nowMs, resendMs?)`, `toSightingWireRow(s: RadarSighting, sourcePath: string | null)`, `pathFromTabUrl(url: string | undefined): string | null`.
- `extension/src/background.ts`: module-level `radarSyncEnabled` + `initRadarSyncSetting()` (the `initPassiveHarvestSetting` shape: one `chrome.storage.local` read + an `onChanged` listener on area `local`, absent ⇒ enabled); a `shipSightings(sightings, sourcePath)` fn; the `isRadarReport` branch computes `pathFromTabUrl(sender.tab?.url)` and calls it **after** the buffer write resolves.
- `extension/src/sidepanel/storage.ts` + `Settings.tsx`: the toggle beside `passiveHarvest`, wired into `useSettings`'s `onChanged` key filter (HV.3's missed-key lesson — a toggle the panel never re-reads looks broken).
- Tests: `extension/src/shared/radarIngest.test.ts`.

**How**
- Ship the **incoming batch**, not the merged buffer: the buffer holds up to 500 rows and re-sending them all on every flush is bytes the server would only count as `skippedRecent`.
- Throttle map: `Map<tweetId, {at, band}>`, ship when never sent, when the window elapsed, **or when the band changed** — the same three-part rule `recordRadarSighting` uses on the page, stated as a twin comment on both sides (§7.4c discipline).
- Best-effort, warn-and-drop, never retried (§7.8/§7.407): `handleApiRequest` → on `!ok && code !== 'unconfigured'` a single `console.warn`. It must never throw into `enqueueRadar` — a failed mirror may not cost the user their queue.
- Chunk at `RADAR_INGEST_BATCH_MAX`; the remainder ships on the next report rather than in a loop (the passive flush's overflow rule).
- `toSightingWireRow` maps `signals.ageMin` → `ageMin`, `signals.views/replies/bait` → the flat fields, `lastSeenAt` → `seenAt`, and passes `likes`/`verified` through **only when present** (`exactOptionalPropertyTypes`: build the object without the key, never assign `undefined`).
- `pathFromTabUrl` must not throw on a missing/opaque URL (`new URL` in a try, `null` on failure) — a chrome:// or discarded tab is normal.

**Tests**
- `shouldShipSighting`: never-sent → true; inside the window, same band → false; inside the window, different band → true; window elapsed → true.
- `toSightingWireRow`: full sighting round-trips; a sighting without `likes`/`verified` produces an object where those keys are **absent**; `sourcePath` null passes through.
- `pathFromTabUrl`: `https://x.com/search?q=…` → `/search`; `undefined` → null; garbage → null.

**Done when**
- [ ] Scrolling with an armed sweep on `/home`, `/search` and a list page lands rows in `radar_sightings` with the matching `source_path`; a ⊕ pin lands one too.
- [ ] `radarSightingSync: false` stops the POSTs; the queue, drafting and dismissals behave exactly as before.
- [ ] With no server configured, nothing is logged beyond the existing silence for `unconfigured`.
- [ ] `bun run test` + typecheck + lint + `cd extension && bun run build` green; `grep -cE '^\s*import[ {]' extension/dist/content.js` == 0.
- [ ] Committed: `feat(extension): RA.2 mirror radar sightings to the server`

**Cost note:** $0 — one local POST per flush window, bounded by the 100-row batch and the 60 s per-tweet throttle.

---

## Task 3: the reader route + `x_radar` / `x_radar_tweet` (RA.3)
**Depends on:** Task 1
**Session budget:** ~400 lines, 7 files.

**Read first**
- Codemap §3.4, §6, §7.12/7.16/7.19/7.20.
- `src/x/routes/harvest.ts:757–831` (`GET /harvest/affinity` — the reader exemplar: `intParam` validation, one grouped SELECT, the `people`/roster join, the assembled view) and its `intParam` helper.
- `src/x/routes/playbook.ts:444–505` (`loadTimelineFunnel` — how `passesSweep` + `sweepConfigFromSettings()` are applied to stored DOM rows).
- `src/x/settings/sweepConfig.ts` and `src/shared/radarSweep.ts:100–142`.
- `src/x/mcp.ts:311–353` (`x_threads`/`x_thread` — the curated-tier tool pair to imitate, including the "ids are STRINGS" warning) + `:74–78` (`qp`).
- `src/mcp.test.ts:95–120` (the exact tool-count assertion), `scripts/smoke-mcp.ts:140–163` (the expected-names list), `docs/s2-mcp-server.md` (three count strings).
- `src/x/people/store.ts` for `normalizePersonHandle`, and whichever loader the codebase already uses for the target roster (`loadTargetHandles()`) — reuse it, never re-derive membership (§7.4c).

**Edit**
- `src/x/radar/corpus.ts`: `buildSightingViews(rows, cfg, { drafted, replied, people, targets })` (pure — computes `vpm`, `ageMinAtLastSeen`, `admitted` via `passesSweep`, `stage`, `isTarget`, `worked`) and `summarizeSightings(views)` (counts by band, by `sourcePath`, admitted, worked, top handles).
- `src/x/routes/radar.ts`: `GET /radar/sightings` and `GET /radar/sightings/:tweetId` — the bare list registered **before** the `:tweetId` form (§7.20).
- `src/x/mcp.ts`: `x_radar`, `x_radar_tweet` (curated tier, `route(...)` forwarding).
- `src/mcp.test.ts` 25 → 27 + `names.has` assertions; `scripts/smoke-mcp.ts` expected list; `docs/s2-mcp-server.md` counts.
- Tests: a `GET /radar/sightings` describe block in `src/x/routes/radar.test.ts`; summary/view cases in `corpus.test.ts`.

**How**
- Window on `last_seen_at ≥ now − days`, order by the requested key (`vpm` default, computed in the pure layer — so read the window, then sort in JS; the row volume is bounded by the ingest cap and a SQL `vpm` expression would duplicate the formula).
- `admitted` uses **today's** config and the response echoes it under `sweep` — a preset switch legitimately re-reads history, and the echo is what keeps that legible rather than mysterious.
- `worked` = a `radar_drafts` row of any status **or** a posted `reply_drafts` row for that tweet id; two `inArray` selects over the windowed ids (the affinity route's join shape), never a per-row query.
- Summary carries **counts only, no rates** — a reply-rate over this corpus is an inference and would need the §7.19 gate; `GET /playbook`'s `timelineFunnel` already owns the gated funnel.
- `GET /radar/sightings/:tweetId` returns the sighting plus every `radar_drafts` row for it (newest first, with `status`, `angle`, `variants`, `model`, `curationScore`) and any `reply_drafts` row linked by `sourceTweetId`, so one call answers "did I already answer this, and with what".
- Tool descriptions must state: the four band meanings; that `admitted:false` on an older row may just mean the filters changed; that `sourcePath` is where it first entered the queue; that ids are strings.

**Tests**
- Param validation for each 400 code; `days` clamp behaviour.
- `admitted` flips when a sweep setting is patched between two reads (drive it through `PATCH /x/settings` in the test, the way the registry-backed routes are already tested).
- `worked` true for a tweet with a `radar_drafts` row, true for a posted `reply_drafts` row, false otherwise; `band`/`handle` filters; `limit` clamp; ordering.
- `x_radar` returns the route's body through MCP and `tools/list` reports 27.

**Done when**
- [ ] `x_radar` from a Claude Code session returns swept tweets with `admitted`/`worked`/`sourcePath`/`stage`/`isTarget` and a counts-only summary.
- [ ] `x_radar_tweet` returns one tweet's sighting + drafts + replies.
- [ ] `src/mcp.test.ts` asserts 27; `docs/s2-mcp-server.md`'s three counts match.
- [ ] `bun run test` + typecheck + lint green.
- [ ] Committed: `feat(radar): RA.3 sighting read layer + x_radar/x_radar_tweet`

**Cost note:** $0 — local SELECTs. Nothing on this path may reach `xFetch`.

---

## Task 4: compose a reply into the Radar queue + `x_radar_draft_reply` (RA.4)
**Depends on:** Tasks 1, 3
**Session budget:** ~320 lines, 5 files.

**Read first**
- `src/x/routes/radar.ts:282–383` (`POST /radar/drafts/:tweetId/confirm` — how a radar draft becomes a measured `reply_drafts` row, and specifically the `sourcePostedAt = draftedAt − signals.ageMin` derivation this task must keep correct).
- `extension/src/shared/radar.ts:548–564` (`draftRowToSighting`) — **the contract: a draft row with a null `band` or null `signals` is silently dropped on rehydrate.** Read this before writing the insert.
- `src/x/db/schema.ts:397–459` (`radarDrafts` columns) and `src/x/routes/radar.ts:77–143` (`RadarDraftInsert`, `buildRadarDraftRows` — the field-by-field precedent, including `curationScore ?? null` and the `author === handle ? null` rule).
- `src/shared/replyMode.ts:83–103` (`REPLY_ANGLES`, `ReplyAngle`).
- `src/x/mcp.ts:417–521` (the write tier — how `x_draft_post` hard-codes the safe status and says so).

**Edit**
- `src/x/routes/radar.ts`: `POST /radar/drafts/compose`, registered with the other `/radar/drafts` routes and **above** the `:tweetId` forms (§7.20); constants `MAX_COMPOSE_VARIANTS = 3`, `MAX_COMPOSE_TEXT = 500`, `COMPOSE_MODEL = 'claude-code-mcp'`.
- `src/x/mcp.ts`: `x_radar_draft_reply` (write tier).
- `src/mcp.test.ts` 27 → 28; `scripts/smoke-mcp.ts` expected list; `docs/s2-mcp-server.md` counts.
- Tests: a `POST /radar/drafts/compose` describe block in `src/x/routes/radar.test.ts`.

**How**
- Refuse before write (§7.4 order, even though nothing here spends): body shape → `TWEET_ID_RE` → 1…3 variants, each `text` non-blank after trim and ≤500, each `angle` ∈ `REPLY_ANGLES` (400 `invalid_angle` naming the allowed set) → **then** load the sighting. Unknown tweet → 404 `sighting_not_found`; that guard is what keeps composed drafts anchored to real captures instead of arbitrary ids.
- Stamp server-side (§7.16), never from the caller: `band` = the sighting's band; `signals` = `{ views, replies, bait, ageMin, vpm }` where `ageMin = round((now − posted_at)/60000)` (fall back to the stored age relationship when `posted_at` is null) and `vpm = views / max(ageMin, 1)`; `url`/`handle`/`author`/`snippet` from the row (`author === handle ? null`); `model = COMPOSE_MODEL`; `status = 'ready'`; `curationScore = null` (**null, never 0** — 0 is a real curation verdict); `variants` = all supplied, `replyText`/`angle` = `variants[0]`.
- One sync txn: flip this tweet's existing `ready` rows to `expired`, then insert. Decision 9 — deterministic "newest ready row wins" with two writers.
- The MCP tool description must say plainly: it writes a **draft into the Radar queue**, the operator pastes it by hand, nothing is published, and the panel needs a **Fetch drafts** click (or a Radar remount) to show it.
- Do **not** call `askLLM` here. The text arrives already written; a "polish it with Grok" step would re-add the spend this lane removes.

**Tests**
- Happy path: 201, the row carries non-null `band` **and** `signals` (assert both explicitly — this is the rehydrate contract, decision 8), `model = 'claude-code-mcp'`, `status = 'ready'`, `variants` length preserved, `curationScore` null.
- `signals.ageMin` reflects time since `posted_at`, not the capture-time age: seed a sighting with `posted_at` two hours back, compose, assert `ageMin ≈ 120`, then run `POST /radar/drafts/:tweetId/confirm` and assert the resulting `sourcePostedAt` lands within a minute of the seeded post time.
- A second compose expires the first row and leaves exactly one `ready`.
- 404 for an unknown tweet; 400 for 0 variants, 4 variants, a blank text, a 501-char text, an unknown angle.

**Done when**
- [ ] A composed draft appears in `GET /x/radar/drafts?status=ready` with band + signals populated.
- [ ] Confirming it produces a `reply_drafts` row with `source='radar'`, `model='claude-code-mcp'` and a correct `sourcePostedAt`.
- [ ] `tools/list` reports 28; docs counts match.
- [ ] `bun run test` + typecheck + lint green.
- [ ] Committed: `feat(radar): RA.4 compose radar drafts + x_radar_draft_reply MCP tool`

**Cost note:** $0 to stratus — the drafting happens in the operator's Claude Code session. No X call, no LLM call, and the reply still reaches X by manual paste (invariant #2).

---

## Task 5: a **Fetch drafts** action on the Radar tab (RA.5)
**Depends on:** none (pointless before Task 4, harmless before it)
**Session budget:** ~70 lines, 1–2 files.

**Read first**
- `extension/src/sidepanel/Radar.tsx:500–535` (the mount-only rehydrate effect and the `setNote` idiom) and `:905–935` (the `Section` `actions` block — where the new button goes, beside Draft replies / Clear / the gear).
- `extension/src/background.ts:1020–1028` — the `stratus/radar-rehydrate` handler already answers `{ ok, added }`; no message-type or background change is needed.
- Codemap §5 `Radar.tsx` row (RD.1/RD.2 — the Section eyebrow *is* the tab header).

**Edit**
- `extension/src/sidepanel/Radar.tsx`: hoist the rehydrate into a `pullDrafts` callback used by both the mount effect and a new action button; note line `n new draft(s)` / `up to date` via the existing `setNote`; disable while in flight, and reuse the existing action-button class (no new CSS — §7.435/UI.16: no colour literal, no new geometry).

**How**
- Keep the mount effect's behaviour byte-identical for the no-click path — this task adds an entry point, it does not change the C0 rehydrate contract.
- The button is visible in every view (a draft can arrive for a tweet in any of them), unlike the spending buttons which hide in Clicked; say why in a comment.
- No polling, ever. The panel's standing discipline is that a $0 route is *safe* to poll and still isn't polled.

**Tests**
- Panel components aren't unit-tested in this repo; this task's verification is the browser check in Task 8's done-when. Do not invent a test harness for it.

**Done when**
- [ ] Clicking **Fetch drafts** pulls server drafts into the queue without a remount and reports how many arrived.
- [ ] typecheck + lint + `cd extension && bun run build` green.
- [ ] Committed: `feat(extension): RA.5 Fetch drafts action on the Radar tab`

**Cost note:** $0 — one `GET /x/radar/drafts` per click.

---

## Task 6: repair the passive `/home` capture  `[parallel-ok]`  (RA.6)
**Depends on:** none — touches no file another RA task owns.
**Session budget:** ~80 lines of diff at most, plus a written finding.

**Read first**
- `extension/src/content.ts:3470–3548` (`initPassiveHarvestSetting`, `recordPassiveHarvest`, `flushPassiveHarvest`) and `extension/src/shared/passiveHarvest.ts`.
- `src/x/routes/harvest.ts:268–373` + `833–855`.
- `scripts/smoke-passive-harvest.ts` (run it — $0).
- Codemap §5 Storage-keys row (`passiveHarvest` default-ON semantics) and the HV entries in `docs/harvest-tab.md`.

**The finding to explain:** `harvest_rows` holds 799 `mode='timeline'` rows, first 2026-07-24, **last 2026-07-27**, while `mode='posts'`/`'replies'` rows kept arriving through 2026-08-17. So the transport, the auth and the server route are demonstrably fine; the gap is on the capture side.

**How** — work the three candidates in this order, cheapest first, and stop at the one that explains it:
1. **Server/route:** run `bun run scripts/smoke-passive-harvest.ts`. Green ⇒ the route is not the problem (expected).
2. **The toggle:** read `chrome.storage.local['passiveHarvest']` in the extension's service-worker console. An explicit `false` explains everything — then the fix is turning it back on plus a note in `docs/harvest-tab.md` about how it got there (the panel toggle is the only writer).
3. **The path gate:** `recordPassiveHarvest` bails unless `isHomeTimelinePath(location.pathname)`. If browsing happens on `/search`, a list or profiles, the corpus is *structurally* empty and nothing is broken. **Do not widen the gate as a reflex** — HV.2 decision 2 defines this corpus as "what the algorithm fed me", and `loadTimelineFunnel` + `GET /harvest/affinity` both read it under that meaning. Widening is a separate decision that owes: a provenance field so the two populations stay separable, and a review of both readers. Write the recommendation; implement it only if the operator says so in this session.
- Also check the harvester lock (`isHarvestActive()`): a run that never cleared would suspend passive capture indefinitely. Cheap to rule out.

**Tests**
- No new unit test unless a real code change lands (then cover it in `passiveHarvest.test.ts`).

**Done when**
- [ ] The 2026-07-27 stop has a named cause, written into `docs/harvest-tab.md` (and `plans/2026-08-17-radar-access.md` Risks if it stays unresolved).
- [ ] If it was the toggle or the lock: passive rows are arriving again (verify with one `x_query` on `harvest_rows` filtered `mode='timeline'`).
- [ ] If it was the path gate: the widening recommendation is written down and explicitly NOT implemented without a decision.
- [ ] `bun run test` + typecheck + lint green (+ extension build if `content.ts` changed).
- [ ] Committed: `fix(harvest): RA.6 passive timeline capture — <cause>`

**Cost note:** $0.

---

## Task 7: the `radar-analyst` skill (RA.7)
**Depends on:** Tasks 3, 4
**Session budget:** ~250 lines across 2 new files. No source change.

**Read first**
- `.claude/skills/stratus/SKILL.md` (the house style for a skill that drives this service) and this plan's Design + Decisions.
- `src/x/mcp.ts` — the final descriptions of `x_radar`, `x_radar_tweet`, `x_radar_draft_reply`, `x_query`, `x_niche`, `x_playbook`, `x_person`, `x_me` (the skill must not restate a tool's semantics differently from its description).
- `src/shared/replyMode.ts:56–136` (`ReplyModeId`, `REPLY_ANGLES`, `ANGLE_VOCABULARY_WIDENED_AT`) — the angle vocabulary the drafts must use.
- `docs/radar-tab.md` (so the skill's hand-off instruction matches the actual UI).

**Edit**
- `.claude/skills/radar-analyst/SKILL.md` (NEW) — name/description frontmatter that triggers on "analyse my radar", "what's worth replying to", "draft replies for the radar", `/radar-analyst`.
- `.claude/skills/radar-analyst/references/queries.md` (NEW) — the `x_query` recipes for the long tail (per-handle sighting counts, admitted-but-never-worked over 30 days, `source_path` breakdown, the `model='claude-code-mcp'` vs Grok outcome split with its n≥20 gate).

**How** — the skill spells out four things:
1. **Read ladder:** `x_radar` first (that is the whole corpus in one call); `x_radar_tweet` before drafting for a tweet (never draft a second reply to a tweet already answered); `x_niche` + `x_me` for voice and current context; `x_playbook` for which angles/rooms measure well — quoting a cell only when it is above its gate; `x_query` only for what the tools don't cover.
2. **Selection rule:** rank by `admitted && !worked`, then `vpm`, then relationship (`stage`/`isTarget` beats a loud stranger — the S0.3 ordering the panel already uses). **Check age**: `posted_at` older than the sweep's `maxAgeMin` by hours means the reply is late; say so instead of drafting.
3. **Drafting rules:** at most ~5–10 tweets per pass; 2–3 variants per tweet, each a *different* angle from `REPLY_ANGLES`; ≤500 chars; no fabricated claims about the author or their numbers (§7.18 — the sighting text is all the context there is, and it is truncated at 500 chars); match the tweet's language; no "As an AI"-shaped openings; then one `x_radar_draft_reply` call per tweet, and finish by telling the operator to hit **Fetch drafts** in the Radar tab and paste from there.
4. **Honesty rules:** never invent a metric the tools didn't return; report the `sweep` config the reader echoed when explaining why something reads as `admitted:false`; state when the corpus is thin (a sweep the operator never armed produces an empty queue, which is not a bug).
- The skill must **not** offer to publish, schedule as `pending`, or spend — those are outside the MCP write ceiling by design.

**Tests**
- None (documentation). Verification is Task 8's end-to-end run.

**Done when**
- [ ] `/radar-analyst` produces a ranked reading of the live corpus and, on request, composed drafts that show up in the panel.
- [ ] The skill names no tool, route or setting that doesn't exist (check each against `src/x/mcp.ts`).
- [ ] Committed: `docs(radar): RA.7 radar-analyst skill`

**Cost note:** $0 to stratus. The reasoning is billed to the operator's Claude Code session; the skill says so, so nobody looks for it in `/cost/daily`.

---

## Task 8 (final): docs-sync + smoke (RA.8)
**Depends on:** all prior.

- [ ] `scripts/smoke-radar-access.ts` — rerunnable, **$0**, no `--live` flag needed (nothing in this lane can spend). Mount `radar` (and `settings` for the admitted-flip check) in-process against the real DB, following `scripts/smoke-passive-harvest.ts`'s real-DB safety pattern **exactly**: 888-prefixed 18-digit tweet ids and `ra_*` handles so `cleanup()` can never touch a real row; synchronous cleanup that also runs from `fail()`. Sequence: POST 3 sightings → re-POST (assert `skippedRecent`) → GET list (assert `admitted` recompute, `summary` counts, ordering) → GET one → compose 2 variants (assert band+signals present, status `ready`) → compose again (assert the first row is `expired` and exactly one `ready` survives) → confirm (assert the `reply_drafts` row's `model` and `sourcePostedAt`) → cleanup and assert zero survivors.
- [ ] `docs/PHASE-HISTORY.md`: the RA phase entry (what shipped, 2026-08-17, $0, and the two gotchas worth carrying — the `draftRowToSighting` band+signals contract, and `admitted` being recomputed against *today's* sweep config).
- [ ] `docs/radar-tab.md`: sightings now mirror to the server; the **Fetch drafts** action; that drafts can arrive from a Claude Code session.
- [ ] `docs/harvest-tab.md`: RA.6's finding (if not already committed there).
- [ ] `docs/s2-mcp-server.md`: 28 tools, the three count strings, and a paragraph on the three new tools (verify RA.3/RA.4 already moved them; fix if not).
- [ ] `docs/settings-tab.md`: **no change expected** — the opt-out is a browser toggle, not a registry knob (decision 5). Confirm the counts there are still right rather than assuming.
- [ ] `.claude/skills/plan-feature/references/codemap.md`: §4 (new table, **43 tables**, migration head `0029`), §3.4 (four new routes), §5 (`background.ts` ship hook + the `radarSightingSync` storage key + `Radar.tsx` action), §6 (**28 tools**), §7 (the `bandStickiness` move under §7.27; the compose route's band+signals contract under §7.16), §9 (the new smoke script) + header re-stamp to this commit.
- [ ] `.claude/skills/masterplan/STATE.md`: all eight RA rows ticked, hot-file locks released, current-state numbers refreshed (suite count, tables 43, MCP 28, migration head `0029`, smoke scripts +1).
- [ ] **Browser check (the end-to-end done-when):** arm a sweep, scroll a list page, confirm rows land with the right `source_path`; from a terminal session compose a draft; click **Fetch drafts**; pick a variant; confirm the clipboard, the tweet opening, and the `reply_drafts` row.
- [ ] Committed: `docs(radar): RA.8 radar-access docs-sync + $0 smoke-radar-access.ts`

## Out of scope (do NOT build)

- **Any API reply, or auto-posting.** Invariant #2 — the output is always a manual paste. No route in this lane may reach `createPost`.
- **Any Grok/LLM call.** Not in compose ("polish this draft"), not in the reader ("summarize the queue server-side"). The point of the lane is that Claude drafts for free; adding a model call re-adds the spend and the byte-sync prompt discipline that goes with it.
- **A second longitudinal series for sightings.** Decision 1; `harvest_rows` owns curves.
- **`person_tier` / `vpm` / `admitted` as columns.** Read-time, all three (§7.12).
- **Widening the passive `/home` gate** without the explicit decision RA.6 describes.
- **A registry knob (mirrored or not) for the sighting sync.** Decision 5.
- **Writing `people` / `person_events` / `mentions` rows from the ingest.** Decision 10 + the API-checkpoint invariant.
- **A new extension tab, a Radar redesign, or migrating the hand-rolled `.radar-tab` switch to `SubTabs`.** RA.5 is one button.
- **A worker.** Retention prunes lazily on the ingest path (§7.407).
- **Deleting or rewriting `radar_drafts`.** Compose writes the same table the Grok batch writes, with a distinct `model` so the two cohorts stay separable.

## Risks / watch items

- **Machine output re-entering "your voice" (§7.415a).** Claude-authored replies land in `reply_drafts` with `source='radar'`, the same marker Grok batch drafts carry, and the reply-side few-shot exposure (`topAngles` guidance) is *already* unfixed per the codemap. This lane adds volume to a known hole rather than opening a new one — but if `model='claude-code-mcp'` becomes the bulk of posted replies, the guidance loader needs the `MACHINE_WINNERS_MAX`-style dilution the post side has. Watch the split; don't pre-build it.
- **`admitted` is judged against today's config.** A preset switch makes last week's rows read as not-admitted. Mitigated by echoing `sweep` in the response and saying so in the tool description; the alternative (storing the verdict) would freeze a rule the operator retunes weekly.
- **Three opening guesses, all recalibratable without a deploy only if they become settings later — today they are constants:** `SIGHTING_DAILY_NEW_CAP` 2000, `SIGHTING_RETENTION_DAYS` 60, `SIGHTING_RECAPTURE_MS` 60 s. Revisit after ~30 days of real volume, together with the four HV.1 numbers they mirror (that plan's own note says the same).
- **The 24h queue TTL vs a terminal-session workflow.** A sighting ages out of `chrome.storage.local` after 24h, but a composed draft rehydrates a fresh row (`draftRowToSighting` stamps `firstSeenAt`/`lastSeenAt` from `draftedAt`). That is convenient and slightly dangerous: it can resurrect a card for a tweet that is now far too old to answer. The skill's age check (RA.7 rule 2) is the only guard; if it proves insufficient, compose should refuse a sighting older than some multiple of the sweep's `maxAgeMin` — deliberately not built now, because refusing a reply the operator asked for is worse than a stale card.
- **The passive corpus may be structurally empty rather than broken** (RA.6 candidate 3). If so, `source_path` on `radar_sightings` becomes the *only* honest answer to "where do my opportunities come from", and HV.5's funnel keeps measuring only the /home slice. Say that in the RA.6 finding rather than quietly letting two corpora look like one.
- **STATE.md's "current state" line is stale** (41 tables / 23 MCP tools / head `0025` vs the codemap's 42 / 25 / `0028`). RA.1 fixes it; until then, trust the codemap.
