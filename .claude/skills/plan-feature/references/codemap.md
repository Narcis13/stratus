# stratus code map

> **Stamped:** 2026-07-18 at commit `b65266f` (ST.6). (Sha-stamp trap: ST.5's real commit is `1f6b20f` not `bc3f1e8`, ST.4's is `15f2563` not `c1b0314`, ST.3's is `b82058b` not `292603d`, UI.10's is `c37d504` not `50948c9`, ST.2's is `dffd60a` not `860725f` — all amend-orphans, corrected here + in STATE.)
> This file exists so `/plan-feature` never re-scans the repo. It is the single
> pre-computed answer to "where does X live and how is it wired".
> **Maintenance rule:** any commit that adds/moves/deletes a file, route, table,
> worker, extension surface, or pattern MUST update the touched section here (and
> re-stamp the header). Every plan produced by `/plan-feature` ends with a
> docs-sync task that includes this file.

## 1. Thirty-second orientation

Single-user service (one human, one bearer token) with four goals and a **hard
scope ceiling** (a feature not serving one of these does not get built):

1. Schedule X posts a week ahead (calendar + 60s publisher worker).
2. Track metrics over time on every published post (daily 03:00 UTC once-only snapshot pass).
3. Voice library — stash other people's tweets via $0 DOM scrape for style analysis.
4. Circles — the people layer: CRM stages, conversations/open loops, relationship-aware drafting, Playbook, warmth (quests/digest/icebreakers).

Runtime: **Bun ≥1.1 + Hono** server on Hetzner (`https://stratus-narcis.duckdns.org`, systemd `stratus.service`, deployed via `scripts/deploy.sh`) + **Chrome MV3 side-panel extension** (Vite + React, loaded unpacked). State: **local SQLite via `bun:sqlite`** + Drizzle (`sqlite-core`), auto-migrated at boot. AI: xAI Grok via `src/grok/` (text `askGrok`, images `generateImages`). No queue, no Redis — in-process `setInterval` workers.

## 2. Root directory

| Path | What it is |
|---|---|
| `CLAUDE.md` | Session guardrails + full phase history. Update in the same commit as behavior changes. |
| `PLAN.md` | **Canonical build plan, goals 1–3** (cadence ladders, phased build). |
| `CIRCLES-PLAN.md` | **Canonical build plan, goal 4** (phases C0–C9, all shipped). |
| `SURFACES-PLAN.md` | Canonical plan for the S-phases (S0.x patches, S1 explorer, S2 MCP, S3 studio, S4 images). |
| `X-API-IMPLEMENTATION-PLAN.md` | Reference-only X API spec: endpoint semantics, pricing, policy quirks. Never a build plan. |
| `X-API-PRICING-REFERENCE.md` | Raw pricing tables. |
| `REPLY GUIDE.md` | The growth doctrine (70/30 ratio, reply bands, target roster) that features measure against. |
| `post prompt.md` / `reply prompt.md` | Prompt sources embedded verbatim as `POST_PROMPT_TEMPLATE` / `REPLY_PROMPT_TEMPLATE` — **byte-sync asserted by bun:test**; edit .md and the TS literal together. |
| `OVERHAUL-PLAN.md`, `REPLY-MASTER-PLAN.md`, `RADAR-REVIEW.md`, `PEOPLE-GRAPH-PLAN.md`, `RELATIONSHIP-OS-PROPOSAL.md`, `MIGRATION-PLAN.md` | Historical/superseded planning docs — background only. |
| `MIGRATION-RUNBOOK.md` | Neon→SQLite one-shot recovery runbook (runtime never touches Postgres). |
| `IPSE-Implementation-PRD.md` | The eventual big product. **Out of scope — never pull patterns from it.** |
| `MANUAL.md`, `DEPLOY.html`, `README.md` | User manual, deploy notes, readme. |
| `docs/` | Per-surface UI docs: one .md per extension tab + `s1`–`s4` surface docs. Update the matching file when a tab changes. |
| `evals/` | Reply-quality eval scripts (`analyze-own-replies.ts` — the BAND crosstab) + CSV/md corpora. |
| `scripts/` | Deploy + one-shots + `smoke-*.ts` rerunnable checks (see §9). |
| `public/explorer.html` | S1 data-explorer UI shell (self-contained vanilla JS, served at `GET /explorer`, no build step). |
| `scrape.js`, `humantype.py`, `hammerspoon-init.lua` | Standalone helpers (console harvester origin; typing/paste automation). Not part of the server. |
| `engagement post prompt.md`, `engagement-calendar-14d.md`, `src/my_niche.md` | Content-strategy notes consumed by prompts/planning, not code. |
| `drizzle.config.ts` | Points drizzle-kit at `src/x/db/schema.ts` + `src/db/shared-schema.ts` → `src/db/migrations/`. |
| `biome.json`, `tsconfig.json` | Lint/format; TS strict, `noEmit`, `allowImportingTsExtensions`; tsconfig `include` covers `scripts/**` + `drizzle.config.ts`. **biome `files.ignore` skips `dist`, `node_modules`, `scrape.js`, `Stratus Design System` (UI.8 — the DS folder is reference-only, not built), and `src/db/migrations` (UI.1 — drizzle-generated SQL + snapshot JSON; never hand-linted).** |
| `Stratus Design System/` | Reference-only design-system spec (Decision 9 — never imported/shipped). `tokens/{colors,typography,spacing,radii}.css` are the **source of the `--strat-*` tokens** UI.8 lifted into `styles.css`; `.jsx` components are specs the extension re-implements in TS. biome-ignored. |
| `.env.example` | Every env key, documented. Notables: `API_TOKEN` (one bearer for API+extension+MCP), `SELF_X_USER_ID`, `XAI_API_KEY`, `SQLITE_PATH` (`:memory:` in tests), `X_DAILY_BUDGET_USD` (soft), `XAI_IMAGE_DAILY_BUDGET_USD` (hard 429), `DAILY_METRICS_ENABLED`, `WINNER_REREAD_MIN_VIEWS`, `STRATUS_DEPLOY_HOST`, `MENTION_API_REPLIES` (unread; verify-then-enable carve-out). |
| `.claude/` | `commands/ship.md`; skills: `stratus` (drive the HTTP API), `skill-explainer`, `plan-feature` (this skill), `masterplan` (executes `plans/MASTERPLAN.md` one task/session; state in its `STATE.md`; updates THIS codemap after every task). |
| `plans/` | 12 feature plans + `MASTERPLAN.md` (unified execution order, reasoning levels, waves, adaptations D1–D10). Execution state: `.claude/skills/masterplan/STATE.md`. |

## 3. Server — `src/`

### 3.1 Entry + shared (platform-agnostic) layer

| File | Purpose |
|---|---|
| `src/app.ts` | Hono app. Order: CORS → public `/healthz` → `bearerAuth()` on `/x/*`, `/cost/*`, `/grok/*`, `/mcp` → `cost` routes → `mountX(app)` → `mountGrok(app)` → `mountMcp(app)` (after mountX so curated tools find routes). `import.meta.main` gates `Bun.serve` + `startXWorkers()` + SIGTERM/SIGINT drain (30s force-exit). Importing from tests never binds a port. |
| `src/middleware/auth.ts` | Bearer guard (`API_TOKEN`). |
| `src/middleware/cors.ts` | `chrome-extension://*` always allowed + `ALLOWED_ORIGINS`. |
| `src/middleware/costTracker.ts` | `makeOnCost(platform, {dailyBudgetUsd})` → writes `cost_events`, platform-tagged; soft budget watchdog logs `BUDGET WATCHDOG`. Platform-agnostic — never hardcode X here. |
| `src/db/client.ts` | The one `bun:sqlite` Database (WAL, `foreign_keys=ON`, boot auto-migrate). **Synchronous driver** — see §7 constraints. |
| `src/db/shared-schema.ts` | `cost_events` (platform `'x' \| 'grok' \| 'xai'`) + `app_settings` (UI.1 — `key`/JSON `value`/`updatedAt` override rows; a missing row = the registry default). |
| `src/settings/store.ts` | UI.1 **platform-agnostic** settings store: sync read-through over `app_settings` (module-level `Map` cache + invalidate-on-write), `getSetting`/`resolveSetting`/`getAllValues(scope?)`/`setSettings`(validate-all → one-txn upsert)/`resetSettings`. Takes a `SettingsRegistry` (never imports `src/x/*`, like `costTracker` takes `platform`). |
| `src/db/migrations/` | `0000`–`0013` + meta (`0013` = `app_settings`, UI.1). `0000` carries the `content_pillars` seed `INSERT OR IGNORE` — drizzle-kit generate drops seed INSERTs; re-check after every generate. biome-ignored (UI.1). |
| `src/routes/cost.ts` | `GET /cost/today` (per-platform spend + budget flags), `GET /cost/daily?days=` (zero-filled UTC series). |
| `src/routes/healthz.ts` | Public. 503 with `staleWorkers` when a heartbeat goes stale; reports `gitSha` from `.git-sha`; DB errors masked as `db_unreachable`. |
| `src/heartbeats.ts` | Worker heartbeat registry (`beat()` per tick; publisher stale >5min, dailyMetrics >25h). |
| `src/shared/replyBand.ts` | Canonical band classifier (hot/warm/skip/null) + `textLooksLikeReplyBait` — shared server/extension (extension re-export shim). |
| `src/shared/channelSuggest.ts` | Keyword→channel suggestion (word-boundary matching), shared server/extension. |
| `src/mcp.ts` | S2 platform-agnostic MCP bridge: per-request stateless `McpServer` + `WebStandardStreamableHTTPServerTransport` at `POST /mcp`; calls `registerXTools`. |
| `src/test.test.ts` | Grab-bag pure-function suite (best-times, annotateGaps, pinnedSince/buildPinnedWatch, md_to_schedule ladders…). New tests should go in per-area files instead. |
| `src/app.test.ts` | Pre-DB route guards: bearer 401s, CORS preflight, calendar/thread/drafter validation. |

### 3.2 Grok layer — `src/grok/`

| File | Purpose |
|---|---|
| `client.ts` | `askGrok` — ALL xAI text calls. `/v1/responses`, structured outputs via `text.format` json_schema (NOT `response_format`), `prompt_cache_key`, retry/auth, token pricing → `cost_events` platform `'grok'`; warns on unknown model. |
| `images.ts` | `generateImages` — ALL xAI image calls. `grok-imagine-image` default ($0.02/img; `-quality` $0.05 opt-in), `response_format:b64_json` (never let a raw xAI URL reach the extension — canvas taint), prefers response `usage.cost_in_usd_ticks` over the price table; platform `'xai'`. |
| `pricing.ts` | Token + per-image price maps (`priceForImage`). |
| `routes/ask.ts` | `POST /grok/ask` passthrough. |
| `index.ts` | `mountGrok` (refuses to mount without `XAI_API_KEY`). |

### 3.3 X slice — `src/x/` (public surface = `index.ts` ONLY; nothing outside imports deeper)

**Primitives**

| File | Purpose |
|---|---|
| `index.ts` | `mountX(app)` + `startXWorkers()` + re-export `registerXTools`. **Read this first for any wiring change — mount order is load-bearing** (see §7 traps). Grok-gated mounts: `replies`, `drafter`, `voiceExtract` only when `XAI_API_KEY` set; `images`/`digest`/`playbook`/`pillars` mount always and check the key at runtime (503). |
| `client.ts` | `xFetch` — the ONE place all X API calls go (retries, RFC7807 parsing, rate-limit headers, `onCost`, `costHint`). Invariant #4. |
| `auth.ts` / `server.ts` / `token-store.ts` | OAuth2 PKCE; `bun run auth` callback server; single-row token store — refresh-token rotation persisted BEFORE return, serialized by in-process promise-chain mutex (invariant #3 — never reorder). |
| `endpoints.ts` | Typed wrappers: `getMe`, `getTweet`, `getTweetsByIds`, `searchRecent`, `getUserTweets`, `getUserMentions`, `createPost` (URL-surcharge + self-reply + self-quote gates), `deletePost`. Add one endpoint at a time, clamp `max_results` (invariant #5). |
| `fields.ts` / `errors.ts` / `pagination.ts` | Field defaults (`attachments` already included — rides free), `XApiError`+classify, `paginate` async iterator (`perPageSleepMs` for search/all). |
| `pricing.ts` | X price table keyed off endpoint substrings; call sites pass `costHint` when the path can't tell. |
| `db/schema.ts` | All 26 X tables (§5). |
| `settings/registry.ts` | UI.1 typed settings catalog: `SettingDef`, `SETTINGS_REGISTRY` (doctrine group seeded), `validateSettingValue` (number/bool/string/enum/numberArray + sorted-unique), `settingsByGroup`. Implements the store's `SettingsRegistry` adapter + exports the **bound** `getSetting`/`resolveSetting`/`getAllValues`/`setSettings`/`resetSettings` — consumers import these, never the store. |
| `playground.ts` | `bun run play` scratch calls. |

**Domain modules (pure logic, bun-tested)**

| File | Purpose |
|---|---|
| `conversations.ts` | C2 thread grouping/ranking (`buildThreads`/`rankThreads`/`isActionable`) — no conversation table, regrouped per read. |
| `mentions.ts` | `pullMentions` — since_id checkpoint = max stored tweet_id; answered backfill; C1 person hooks. |
| `playbook.ts` | C4/S0.x aggregations, all gated `DEFAULT_MIN_CELL_N` (n≥20): angles, pillar×register, structures, batch-vs-single, band calibration, relationship lift, media (S0.2), latency (S0.5), roster coverage (S0.7), idea payoff (S0.8). |
| `quests.ts` | C9 daily quests (vacuous-done contract — a quiet day never breaks the streak). |
| `digest.ts` | C9 Sunday digest facts assembly (pure; one Grok narration in the route, cached in `digests`). |
| `conversion.ts` | S0.1 profile-visit → follow conversion math. |
| `people/stage.ts` | Stage engine: stranger→noticed→engaged→responded→mutual (≥2 exchange days)→ally (≥4/60d); ratchets up only. |
| `people/store.ts` | All people writes: `upsertPerson` (fill-only default, overwrite for profile scrapes), `logPersonEvents`/`safeLogPersonEvents` (deterministic ids `type:ref_table:ref_id` + INSERT OR IGNORE), `loadRelationshipFacts(Safe)`. |
| `people/relationship.ts` | C3 relationship block render (server-stamped, variable-tail). |
| `people/angles.ts` | Per-person angle crosstab. |
| `people/followups.ts` | C5 classifier: chain_live > dm_ready > neglected_target > neglected_ally > momentum; S0.6 `pickReupCandidate`; snooze keys `kind:handle` / `reup:<tweetId>`. |
| `people/sightings.ts` | C6 hover-capture ingest (once/day/handle event + snapshot gates). |
| `people/icebreakers.ts` | C9 grounding renderer (refusal ladder BEFORE key check: 404 → 422 no_shared_context). |
| `posts/prompt.ts` | `POST_PROMPT_TEMPLATE` (byte-synced with `post prompt.md`) + drafter helpers, `buildPostDraftsSchema(slugs)`. |
| `posts/pillars.ts` | `DEFAULT_PILLARS`, `parsePillar`. |
| `posts/pillarDraft.ts` | AI pillar proposal (never persisted directly). |
| `replies/prompt.ts` | `REPLY_PROMPT_TEMPLATE` (byte-synced with `reply prompt.md`), `buildGrokInput`, `buildBatchGrokInput` (slices persona blocks so the two prompts can't drift), `parseContext`/`parseBatchTweets` (NEVER accept `relationship`/`guidance` from clients), `BATCH_REPLY_SCHEMA`. |
| `data/inspect.ts` | S1 read-only core: second `{readonly:true}` connection (`:memory:` falls back to primary), whitelist from Drizzle exports (**`tokens` excluded entirely**), `readTable` (validated identifiers, escaped LIKE), `runSelect` (single-statement SELECT/WITH, 500-row cap), `describeTable`. Reused by MCP schema tools. |
| `mcp.ts` | S2 `registerXTools` — 16 tools: 3 schema (inspect core), 10 curated (in-process `app.request` with forwarded bearer; `x_digest` forces `factsOnly`), 3 write ($0 only; `x_draft_post` hard-codes `status:'draft'`). |

**Workers — `src/x/workers/`**

| File | Purpose |
|---|---|
| `publisher.ts` | 60s tick. Claim txn (`pending→publishing` committed BEFORE `createPost`) → finalize; 4xx→`failed`, 5xx/network → stuck `publishing` (ambiguous, shouted every tick, reconcile resolves). Threads: self-replies ~500ms apart, one bad segment freezes the rest (`thread_frozen`); re-verifies self-quote ownership. |
| `dailyMetrics.ts` | 03:00 UTC: getMe → `account_snapshots` (1/UTC-day, + `pinned_tweet_id`); since_id discovery of own tweets (stamps `has_media`); snapshot every non-retired row — **retire batch BEFORE writing snapshots** (invariant #7); winner re-read (≤5/day, claim pollCount 1→2 before the billed call); `pullMentions`. |

### 3.4 HTTP routes — `src/x/routes/` (all under `/x`, bearer-guarded unless noted)

| Router file | Endpoints (method path — one-line semantics) |
|---|---|
| `brief.ts` | `GET /brief` — Today-tab payload: KPI+sparkline, yesterday, leaders, plan+annotated gaps (S0.4), reply quota, ratio, spend, quests+streak (C9), pinnedWatch (S0.9). `?tzOffsetMin=` local-day; spend stays UTC. Pure helpers `pinnedSince`/`buildPinnedWatch` live here. |
| `calendar.ts` | `POST /posts/scheduled` (URL guard on pending; optional validated `pillar`), `POST /posts/threads`, `GET /posts/scheduled` (+filters), `GET/PATCH/DELETE /posts/scheduled/:id` (worker-owned statuses 409; PATCH `media_note`; GET returns thread siblings + `seededBy`). |
| `metrics.ts` | `GET /metrics/replies`, `/metrics/posts`, `/metrics/account` (**S5.5** the Studio milestone card's client `api.metrics.account()` consumes this — `{count,latest,series}`, `AccountSeriesPoint`), `/metrics/best-times` (`?tzOffsetMin=`, top gated n≥3), `/metrics/pillars`, `/metrics/:tweetId`. |
| `posts.ts` | `POST /posts/reconcile` — triggers the daily pass manually. |
| `pillars.ts` | `GET/POST /pillars`, `PATCH/DELETE /pillars/:slug` (last-active 409), `POST /pillars/draft` (Grok proposal, runtime key check). |
| `drafter.ts` | `POST /posts/draft` (3 register-distinct drafts → `status='draft'` rows), `POST /posts/reup` (self-quote drafts; ownership via posts_published). Grok-gated mount. |
| `replies.ts` | `POST /replies/generate` (band gate 422 BEFORE spend → relationship+guidance stamp → 2 variants → specificity gate w/ one auto-regen), `POST /replies/generate-batch` (≤25, no DB rows, persists `radar_drafts`), `GET /replies`, `/replies/outcomes` (§6.2 join), `/replies/default-prompt`, `GET/PATCH/DELETE /replies/:id` (PATCH→posted = paste time, logs my_reply, backfills postedTweetId). Grok-gated mount. |
| `voice.ts` | `POST /voice/scrape`, `PUT /voice/authors/:handle` (enrich + snapshot append), `GET /voice/authors`, `PATCH/DELETE /voice/authors/:handle`, `GET /voice/targets` (2–10x band + momentum), `GET /voice/tweets` (filters), `PATCH /voice/tweets/:tweetId` (`tags`/`addTags`), `DELETE /voice/tweets/:tweetId`. Exports `loadTargetHandles`. All $0. |
| `voiceExtract.ts` | `POST /voice/tweets/:tweetId/extract`, `POST /voice/extract-batch` (≤50). Exports the §8.3 prompt/schema for playbook reuse. Grok-gated mount. |
| `harvest.ts` | `POST /harvest/runs`, `POST /harvest/rows` (≤500; replies-mode reconcile → backfills draft `postedTweetId`), `GET /harvest/runs`. |
| `mentions.ts` | `GET /mentions`, `POST /mentions/refresh` (6/day server cap), `PATCH /mentions/:tweetId`. |
| `conversations.ts` | `GET /conversations` (regrouped per read), `PATCH /conversations/:conversationId` (read/snooze/mute → `conversation_meta`). |
| `people.ts` | `GET /people`, `GET /people/rankmap` (**before `:handle`**), `GET /people/:handle` (dossier), `PATCH /people/:handle` (only demote path), `POST /people/sightings` (C6 batch ≤50), `POST /people/:handle/events`, `POST /people/:handle/icebreakers` (refuse-before-spend). |
| `followups.ts` | `GET /people/followups` (queue + momentum + S0.6 reup item), `PATCH /people/followups` (snooze; reup special-cases `tweetId`), `GET /people/fans`. **Mounted before peopleRouter.** |
| `launch.ts` | `POST /launch/replies` (C7 early-replier ingest, shared deterministic event id with mentions; never touches `mentions` table). |
| `radar.ts` | `GET /radar/drafts?status=` (lazy 48h expiry), `PATCH /radar/drafts` (status ratchet), `PATCH /radar/drafts/:tweetId/tags`. |
| `ideas.ts` | `GET/POST /ideas`, `PATCH /ideas/:id` (consume/reopen provenance rules), `DELETE /ideas/:id`. |
| `channels.ts` | `GET/POST /channels`, `GET /channels/:slug` (the aggregate room), `PATCH/DELETE /channels/:slug`. |
| `playbook.ts` | `GET /playbook?minN=`, `POST /playbook/extract-winners` (≤20 winners/call, runtime key check). Loaders + `loadReplyGuidanceSafe`/`loadPostGuidanceSafe` (always DEFAULT gate) + exported `loadFollowersByHandle`. |
| `digest.ts` | `GET /digest?week=&tzOffsetMin=&refresh=&factsOnly=` (cached per week; degrades to facts on Grok failure). |
| `brief`/`streaks` | streak upsert happens inside `GET /brief` (idempotent per local day). |
| `images.ts` | `POST /images/generate` (n≤2; HARD daily budget 429 before spend; returns data: URLs). |
| `assets.ts` | `POST /assets` (≤2MB), `GET /assets` (metadata only), `GET /assets/:id/png` (bytes), `DELETE /assets/:id`. |
| `data.ts` | `GET /data/tables`, `GET /data/:table`, `POST /data/query` — S1 read-only; plus `explorer` router: `GET /explorer` at root, **outside bearer** (data-free shell). |
| `settings.ts` | UI.1 (mounted next to `data`): `GET /settings` (groups + value + isDefault), `GET /settings/values?scope=mirrored` (flat mirror payload), `PATCH /settings` (per-key validated, all-or-nothing → 400 `unknown_setting`/`invalid_setting_value`), `POST /settings/reset` (`{keys?,group?}`). Always mounted, $0; **landed inert — no store consumer yet** (UI.2–7 wire them). |

Shared/other: `GET /healthz` (public), `GET/cost/today`, `GET /cost/daily`, `POST /grok/ask`, `POST /mcp` (JSON-RPC; GET/DELETE→405).

## 4. Database — 28 tables

`src/db/shared-schema.ts`: **cost_events** (platform-tagged spend ledger) · **app_settings** (UI.1 — settings overrides; key PK, JSON value, `updatedAt`; only overridden keys get a row).

`src/x/db/schema.ts` (schema line numbers as of stamp):

| Table | Purpose / notes |
|---|---|
| `tokens` (L14) | Single row `id='default'` OAuth tokens. Excluded from explorer/MCP entirely. |
| `contentPillars` (L33) | Editable pillars; seed INSERT lives in migration 0000. Never let the active set go empty (409 guards). |
| `channels` (L54) | C8 topic rooms: slug PK, keywords JSON, optional pillar link (not FK-validated). |
| `mediaAssets` (L77) | S4 Studio PNGs as BLOBs (kind, prompt, w/h, usedOnTweetId). `assets.ts` `ASSET_KINDS` whitelist widened (**S5.5**) to all S5 template ids — `quote/stat/banner/pfp/milestone/streak/code/thread/list/chart/background/other`; unknown → `'other'`. |
| `scheduledPosts` (L94) | Calendar. status `draft\|pending\|publishing\|posted\|failed\|cancelled\|segment`; `thread_id`, `position`, `quote_tweet_id`, `pillar`, `register`, `media_note`, `source`. `publishing`/`posted` worker-owned. |
| `postsPublished` (L139) | Everything actually posted (incl. app-made): `in_reply_to_tweet_id`, `conversation_id`, `has_media` (null=unknown, never "no"). |
| `metricsSnapshots` (L164) | Once-only snapshots; `age_at_snapshot_min`; joined newest-first-wins everywhere. |
| `postTemplates` (L189) | C4 extracted winner structures (hook/skeleton/device, lowercased keys). |
| `accountSnapshots` (L205) | Daily getMe KPI, 1/UTC-day, + `pinned_tweet_id` (S0.9). Latest row = "my size" for banding. |
| `voiceAuthors` (L225) / `voiceAuthorSnapshots` (L253) / `voiceTweets` (L268) | Swipe file (DOM-scraped, $0): profile + follower series (append per enrich) + tweets (`scraped_html`, template columns from §8.3, `tags`). |
| `replyDrafts` (L301) | Grok reply drafts: `variants` JSON, `contextSnapshot` (records exactly what the model saw — signals, relationship, guidance), `postedTweetId` (the outcome join key), `idea`, `pillar`. `updatedAt` of posted flip = paste time. |
| `radarDrafts` (L357) | C0 persisted batch replies; status `ready\|clicked\|expired` ratchet; 48h lazy expiry; `tags`. |
| `people` (L397) / `personEvents` (L428) / `personSnapshots` (L449) | C1 CRM: handle PK + stage + watermarks; append-only timeline (**deterministic ids** `type:ref_table:ref_id`, INSERT OR IGNORE); ambient follower series (C6 hover, once/day gates). |
| `ideas` (L470) | C6 Idea Inbox: status `open\|consumed\|discarded`, consume provenance (`consumed_by_table/-id` restricted to reply_drafts/scheduled_posts). |
| `followupSnoozes` (L496) | item_key `kind:handle` or `reup:<tweetId>`. |
| `streaks` (L509) | Local-day PK diary (C9); upserted by brief reads. |
| `digests` (L522) | Weekly digest cache (week_key PK). |
| `mentions` (L542) | Inbox; **max stored tweet_id IS the since_id checkpoint** — never insert non-API ids; status flow + `answered_draft_id`. |
| `conversationMeta` (L568) | C2 snooze/read/mute per conversation_id. |
| `harvestRuns` (L582) / `harvestRows` (L595) | DOM harvest; repeated captures on purpose (longitudinal series); content-shape columns. |

Migrations `0000`–`0013` (latest: `0009` has_media, `0010` pinned_tweet_id, `0011` media_note, `0012` media_assets, `0013` app_settings). Workflow: edit schema → `bun run db:generate` → **inspect the SQL** (drizzle drops seed INSERTs; keep them idempotent) → boot/`deploy.sh` migrates. (biome now ignores `src/db/migrations` — UI.1, D11/D13.)

## 5. Extension — `extension/` (own package.json, Vite + React, MV3)

**Build:** two passes (`vite.config.ts`) — content script first as self-contained **IIFE** (`content.js`; classic script, no imports allowed), then side panel + background as ES modules. Shared modules used by content.ts get inlined. Out-of-tree server modules reach the extension via **re-export shims**: `extension/src/replyBand.ts` → `src/shared/replyBand.ts`, `extension/src/channelSuggest.ts` → `src/shared/channelSuggest.ts` (tsconfig lists them in `include`).

**Manifest:** side panel + background service worker + content script on x.com/twitter.com. Permissions: sidePanel, storage, clipboardWrite/Read, contextMenus, alarms, notifications.

| File | Purpose |
|---|---|
| `src/background.ts` | Service worker. **Single writer of all `chrome.storage.session` state** (radar ring buffer cap 100 + dismissed cap 500, launch room state), writes serialized via promise chain. One HTTP transport: `ApiRequest` message channel — the only Authorization-header owner (incl. `binary` for asset blobs). Rankmap cache (10min TTL, S0.3). C7 launch alarms (`chrome.alarms`, +90s grace, liveness verify, notification). Ideas context menu. |
| `src/content.ts` | On-page: reply-band badge (`readTweetSignals`), save-to-stratus + save-author scrape, radar sightings stream (2s flush/60s throttle), C6 passive hover capture, C7 early-replies stream + launch-get throttle, post-save channel chips, `metrics_unparsed` loud error. |
| `src/harvester.ts` | Timeline harvester (human-like scroll, aria metric parse, CSV + ingest rows, since-last cursors) — driven over a port from the Harvest tab; imported by content.ts. |
| `src/shared/` | `messages.ts` (all message types: `stratus/api`, radar-\*, launch-\*), `types.ts` (`PostContext`, `RadarSighting`…), `radar.ts` (merge/cap/rank + `stampTiers`), `sightings.ts`, `launch.ts`, `earlyReplies.ts` (happy-dom fixture-tested), `metricsAria.ts` (locale-hardened), `harvest.ts`, `bgClient.ts`. |
| `src/sidepanel/api.ts` | Typed client — every call routes through background ApiRequest. **UI.10:** `api.settings.{get,patch,reset}` over `/x/settings`; the `SettingEntry`/`SettingsGroup`/`SettingsResponse` types live in `shared/types.ts` (the panel renders from the GET, never the server registry). |
| `src/sidepanel/App.tsx` | Tabs: today, people, channels, calendar, composer, studio, harvest, voice, replies, ideas, playbook, settings. **UI.10:** the 104px rail is grouped by eyebrow dividers (`TAB_GROUPS` — Operate/Author/Library/Learn/System) with an `icons/icon128.png` brandmark above the lowercase wordmark; not-configured branch renders `<EmptyState>`. Cross-tab handoffs: `onOpenPerson`, `openStudio`, remix→composer. |
| `src/sidepanel/ui/` | **UI.10** thin token-only primitives (className + tokens, no state libs): `Section` (eyebrow + body), `EmptyState` (coach line + hint + action), `SubTabs` (segmented pill — Voice migrates in UI.14), `SettingRow` (typed control per `SettingEntry`: number→`Slider` when bounded else number input, boolean/enum/string/numberArray + reset dot when `!isDefault`), `Slider` (bounded range + tabular readout), `GearPopover` (`⚙` → outside-click hairline card of SettingRows; `settings[]` + `onPatch`). **D7: every NEW Wave-1+ surface builds on these.** CSS: the `.ui-*` block at the tail of styles.css. |
| `src/sidepanel/settingsClient.ts` | **UI.10** thin wrapper over `api.settings` (`loadSettingGroups`/`flattenSettings`/`patchSetting`/`resetGroup`/`resetKeys`) — where a GearPopover's `onPatch` lands its PATCH. Inert until UI.11 + the Wave-5 inline gears wire it. |
| Tab components | `Today.tsx` (hosts: Conversations, DoNext, Fans, LaunchRoom, Digest, PinnedWatchCard, quests/streak, Radar, Targets, TodayPlan), `People.tsx` (+dossier, Icebreakers), `Channels.tsx`+`ChannelTags.tsx` (shared chip picker, 60s cache), `Calendar.tsx`, `Composer.tsx`+`composerLogic.ts` (best-time suggest, thread mode, jittered minutes), `Studio.tsx` (**S5.2:** a shell over `sidepanel/studio/` — see below; ~776 lines after S5.3–S5.5 added mascot/pattern/celebration wiring), `Harvest.tsx`+`harvestClient.ts`, `Voice.tsx`+`Pillars.tsx` subtab, `Replies.tsx`, `Ideas.tsx`, `Playbook.tsx`, `Settings.tsx` (passiveCapture, applyPillarsToReplies, harvest cursors, **UI.9 Appearance: theme/density/text-size selects, patch-on-change**). |
| `src/studio/` | S3: `compose.ts` (layer model → canvas → PNG; layoutText wrap/shrink/ellipsize; S5.1 added `path`/`panel`/`pattern` layer kinds + exported `mulberry32` seeded PRNG + pure `patternCoords` — never `Math.random`), `templates.ts` (quote/stat/banner/pfp + S4 background+scrim under text; **S5.3** appends `mascotLayers` to quote (happy, bottom-left)/stat (celebrating if `delta>0` else happy, under sparkline)/banner (thinking, only no-milestone) — all guarded `if (kit.mascot && !data.background …)` so `mascot:false` is byte-identical; **S5.4** `baseLayers` takes an optional `pattern` arg → a `[gradient fill, pattern]` base (ink `withAlpha(contrastOn(kit.bg),0.07)`, full-card box); an AI bitmap always wins over a pattern; `QuoteCardData`/`BannerData` carry `patternKind?`/`patternSeed?`; **S5.5** `milestoneCardSpec`/`streakCardSpec` (both 1200×675) — giant `fmtCount(milestone)`/`${days}` + fixed-seed `blobs` confetti (`withAlpha(kit.accent,0.25)`, seed 11) + celebrating mascot only when a value is present; graceful null-data placeholders; **S5.6** `codeCardSpec({code,title})` 1200×675 — terminal window: desktop `fill shade(kit.bg,-0.5)` + `panel` (radius 20, shadow) screen, 3 monochrome `ring` discs, centered filename, line numbers + tokens laid out by FIXED monospace advance (`STUDIO_MONO_STACK`, `CODE_CARD`) — no canvas measurement; token colors kit-derived (keyword=accent, string/number=shade(accent), comment=muted ink); caps 18 lines/62 cols, over-cap → `⌄ trimmed` footer), `codeTokens.ts` (**S5.6** pure `tokenizeLine(line)→Token[]` — deliberately-loose 5-kind classifier `plain|keyword|string|number|comment`, small cross-lang keyword set; exports `MONO_ADVANCE=0.6` = JetBrains Mono's exact 600/1000 em-advance), `milestones.ts` (**S5.5** `MILESTONES` ladder `[50…100000]` + pure `latestCrossed(series)→{milestone,crossedOn}|null` — peak-based, unordered-tolerant, `>=` boundary; client-side detection over the account series, §7.12), `mascot.ts` (**S5.3** pure `mascotLayers({pose,x,y,scale,kit,seed?})→Layer[]`; poses `happy|celebrating|thinking|sleeping`; one 100×100 viewbox of `path` layers + `text` "zzz"; colours all `shade(kit.accent,…)` — re-skins with the brand; confetti seeded), `brandKit.ts` (**S5.3** `mascot:boolean` field, default true, lenient-parse fallback true; **S5.4** multi-preset: `BrandKits{active,kits}` in `studio:brandKits`, `loadBrandKits` migrates legacy `studio:brandKit`→`kits.default` else seeds `STARTER_KITS` (Midnight/Paper/Neon), keeps writing the legacy key for rollback; pure `parseBrandKitsFile` (accepts both file shapes) + `activeKit`/`patchActiveKit`/`setActivePreset`/`savePresetAs`/`renamePreset`/`canDeletePreset`+`deletePreset` (last-preset delete refused)), `fonts.ts` (**S5.6** bundled Inter + JetBrains Mono WOFF2s — Inter→`StudioInter`, Mono→`StudioMono`, per-face family, non-fatal load). |
| `src/sidepanel/studio/` | **S5.2** the Studio registry split (behavior-neutral). `registry.ts` — `TemplateId` (**S5.5** +`milestone`/`streak`; **S5.6** +`code`), `TEMPLATES` metadata (`id`/`label`/`size {w,h}`/`supportsAiBackground`), `templateMeta`/`supportsAiBackground` helpers, `EMPTY_STAT`/**S5.5** `EMPTY_MILESTONE`/`EMPTY_STREAK`/**S5.6** `DEFAULT_CODE`, `TemplateState` (**S5.4** `patternKind: PatternKind|null`+`patternSeed`; **S5.5** `milestoneData`/`streakData` — shell resolves override-over-auto; **S5.6** `codeTitle`/`codeText`), and the pure `buildSpec(id, state, kit) → RenderSpec` dispatch (replaces the old render ternary + `BG_TEMPLATES` set). `fields.tsx` — dumb props-driven field sections (`QuoteFields`/`StatFields`/`BannerFields`/`PfpFields`; **S5.5** `MilestoneFields`/`StreakFields` — a status line + manual number override; **S5.6** `CodeFields` — filename input + code textarea) + the presentational `BackgroundFields`/`LibraryRail` (state+handlers stay in the shell). **S5.5** `Studio.tsx` loads `api.metrics.account()`→`latestCrossed` (milestone) and `brief.quests.streak` (streak), override beats auto, `milestoneData`/`streakData` memoized so identity doesn't churn the render effect. `KitEditor.tsx` — the brand-kit section (colors/handle/watermark/**S5.3 mascot toggle**/style-suffix) + **S5.4 preset dropdown / Save-as / Rename / Delete** over the `BrandKits` bundle; export/import round-trips both file shapes via `parseBrandKitsFile`. The **S5.4 background segmented control** (`gradient|dots|grid|diagonal|plus|blobs|AI image` + blobs reroll; picking a pattern clears the AI bitmap) lives inline in `Studio.tsx`, not fields.tsx. **Adding a template = 1 registry row + 1 field section**, not another shell branch. |
| `src/sidepanel/styles.css` | The panel stylesheet (~2.4k lines). **UI.8:** `:root` holds the full `--strat-*` design-token set (verbatim from `Stratus Design System/tokens/*.css`) + `--x-*` companion tokens + **legacy short aliases** (`--bg: var(--strat-bg)` …) the sheet still resolves through. **Zero color literals outside `:root`** — tinted fills use exact fill tokens (`--strat-{accent,danger,warn}-fill`, `--strat-pillar-bg`, `--strat-scrim`) or `color-mix(in srgb, var(--strat-*) N%, transparent)` (exact-equivalent, and tracks the base so Task-9 light theme flows through). Inter is `@font-face`d from `/fonts/` and set on `body` via `--strat-font-sans`; metric classes get `tabular-nums`. **UI.9:** `:root[data-theme='light']` re-tints by redefining only the base `--strat-*` tokens (aliases resolve lazily → whole sheet flows through; `color-scheme: light`; direct-use fill tokens + band ink re-authored for a light base, dark text companions kept); density via `[data-density='compact']` and scale via `[data-scale='12'|'14']` override the new `--ui-panel-pad`/`--ui-section-gap`/`--ui-row-gap`/`--ui-root-size` vars that `body`/`.panel`/`.row` now consume. **UI.10:** `.brand`/`.brand-mark`/`.brand-word` + `.tab-group`/`.tab-group-eyebrow` (grouped rail), and a tail `.ui-*` block for the primitives (Section/EmptyState/SubTabs/SettingRow/Slider/GearPopover) — `--strat-*` tokens only, no literals. |
| `public/fonts/` | Bundled Inter WOFF2s (Regular/Bold/ExtraBold) + **S5.6** JetBrains Mono WOFF2s (Regular/Bold, OFL-1.1, latin subset) — served at `/fonts/`, loaded by the Studio (`studio/fonts.ts`, FontFace: Inter→`StudioInter`, Mono→`StudioMono`) and the panel sheet (`@font-face`, UI.8). |
| Storage keys | `chrome.storage.local`: brand kit, settings toggles, harvest cursors, `replyMaster:idea(+Id)`, **UI.9 appearance `theme`/`density`/`uiScale`** (stamped on `<html>` by `main.tsx` as `data-theme`/`data-density`/`data-scale`; `system` resolved via `matchMedia`). `chrome.storage.session`: `radar:sightings`, `radar:dismissed`, `launch:active`, `launch:replies`. |

## 6. MCP + integrations

- `POST /mcp` — 16 X tools (see §3.3 `x/mcp.ts`). Client setup: `claude mcp add --transport http stratus https://<host>/mcp --header "Authorization: Bearer $STRATUS_TOKEN"`.
- `.claude/skills/stratus` — drives the HTTP API from Claude Code (scheduling scripts `md_to_schedule.ts` with the cadence ladders 3/day `[9,13,18]`, 4/day `[8,12,16,20]`; always jitter minutes).

## 7. Patterns & conventions (name these in plans; point implementers at the exemplar file)

**Money/API discipline**
1. **One place to call X / Grok / images**: `xFetch` / `askGrok` / `generateImages`. Never raw fetch.
2. **Retire-before-snapshot** (dailyMetrics): a billed read must be unrepeatable — take the row out of the candidate set in a committed txn BEFORE the read/write that follows. At-most-once, never double-charge.
3. **Claim-before-call** (publisher, winner re-read): commit the state flip before the irreversible external call.
4. **Refuse-before-spend**: validation → band gate → grounding checks → THEN the paid call (replies.ts, icebreakers.ts, images.ts hard budget).
5. **`max_results` clamps** on every paginate wrapper (endpoints.ts pattern).
6. **costHint** when the URL can't price itself; `console.warn` on $0-priced billed calls.

**Data discipline**
7. **Deterministic event ids** `type:ref_table:ref_id` + INSERT OR IGNORE — backfill, live hooks, and DOM ingest share one idempotent id space (people/store.ts, launch.ts).
8. **Best-effort side writes**: `safeLogPersonEvents`, `persistRadarDrafts`, `consumeIdeaSafe` — a hook failure never fails the paying path.
9. **Fill-only vs overwrite upserts**: hover/launch glimpses fill-only; profile scrapes overwrite (people/store.ts).
10. **Status ratchets**: stages only auto-promote; radar drafts ready→clicked→expired; mentions never regress implicitly.
11. **null = unknown, never "no"** (`has_media`, `pinned_tweet_id`); bucket null separately in aggregations.
12. **No derived-state tables** when a read-time regroup works (conversations C2, momentum C5).
13. **Sync SQLite**: txns take sync callbacks (`.all()/.get()/.run()`, no await inside); never bind a JS `Date` in raw `sql` (use `.getTime()`); token refresh critical section = in-process mutex.

**Prompt discipline**
14. **Byte-sync prompts**: `.md` ↔ TS literal asserted by test; regenerate the literal when editing the .md.
15. **Variable tail**: ALL per-call content ({{TWEET_CONTEXT}}, {{PILLARS}}, relationship, guidance, idea) after the stable cacheable instruction prefix; `prompt_cache_key` set.
16. **Server-stamped fields**: `relationship`/`guidance`/gate signals are stamped server-side, never parsed from clients; persist exactly what the model saw in `contextSnapshot`.
17. **Structured outputs** via `text.format` json_schema on `/v1/responses` (`response_format` 400s there).
18. **No fabrication**: Grok may narrate only supplied FACTS; grounding blocks travel back in responses.

**Stats discipline**
19. **Gates**: playbook cells + all lifts n≥20/side (`DEFAULT_MIN_CELL_N`); angle preference ≥3 measured; best-times top n≥3; BAND recalibration ≥100 and manual-only. Below gate → `sufficient:false`/null, never a confident number.

**Routing/wiring traps**
20. **Static path before `:param`** (followups+fans and rankmap before `/people/:handle`) — check on every new people-adjacent route.
21. **Public-by-design routes** (`/healthz`, `/explorer`) mount at root outside the `/x/*` guard.
22. **Grok-gated mount vs runtime 503**: user-facing-always routes mount always + check key at runtime; pure Grok routes refuse to mount.
23. **Worker-owned statuses**: PATCH/DELETE 409 on `publishing`/`posted`.

**Extension**
24. **Background = single session-storage writer**; content/panel talk via messages, never write directly.
25. **One transport**: all HTTP through `ApiRequest`; blobs via `ApiRequest.binary`.
26. **Content script is an IIFE**: no module imports at runtime; shared code gets inlined — heavy deps stay out.
27. **Shims for shared server modules** (replyBand, channelSuggest) — never fork logic between server and page.
28. **Posting is always manual paste** — OAuth 1.0a media wall + reply policy; nothing auto-posts to others, MCP can only create `draft` rows.
- **Design tokens (UI.8)**: the panel's `styles.css` `:root` carries the `--strat-*` token set (from `Stratus Design System/tokens/*.css`) + `--x-*` companion tokens + legacy short aliases. New UI references `--strat-*` directly; tinted fills use the exact fill tokens or `color-mix(in srgb, var(--strat-*) N%, transparent)`; **no color literal lives outside `:root`**. **UI.9** made it theme-aware: `:root[data-theme='light']` redefines only the base `--strat-*` tokens (the whole sheet re-tints via the aliases), `main.tsx` stamps `data-theme`/`data-density`/`data-scale` on `<html>` from the local `theme`/`density`/`uiScale` settings (`system` resolved via `matchMedia` + listener). Appearance is panel-local (chrome.storage), never server-synced; content-script overlays and the Studio canvas are exempt (they follow X / the brand kit). (Unnumbered — the numbered `§7.N` refs are load-bearing across CLAUDE.md/plans; don't renumber.)
- **Settings platform (UI.1)**: server-side tunable knobs live in `app_settings` (override rows) + the typed `src/x/settings/registry.ts` catalog. Discipline: **only routes/workers read the store** via the bound `getSetting`; **pure modules stay pure** and take an opts object defaulted to today's constant (`computeQuests(rows, opts = QUEST_DEFAULTS)`) — so every existing pure test stays valid and the store is mockable. Registry floors/ceilings are the money/policy guard (an MCP agent editing via `x_update_setting` hits the same wall). The shared store (`src/settings/store.ts`) never imports `src/x/*` — the registry is passed in. (Unnumbered — see the `don't renumber` note above.)
- **UI primitives (UI.10, D7 standing)**: every NEW panel surface from Wave 1 on composes `src/sidepanel/ui/` primitives (Section/EmptyState/SubTabs/SettingRow/Slider/GearPopover) + `--strat-*` tokens — no bespoke `<h3>`/muted-`<p>`/hand-rolled controls. Primitives are pure presentation (className + tokens, no state libs, no API calls); the settings PATCH lives in `settingsClient.ts`, and the panel renders knobs from `GET /x/settings` (extension never imports the server registry). Wave-5 polish (UI.12–16) migrates the pre-masterplan tabs onto them. (Unnumbered — see the `don't renumber` note above.)

**Process**
29. **Docs sync in the same commit**: CLAUDE.md phase entry, the relevant plan doc (PLAN/CIRCLES/SURFACES), the matching `docs/<tab>.md`, and THIS codemap.
30. **Smoke script per feature**: rerunnable, $0 default, `--live` for the one paid verification, cleans up after itself.
31. **No obvious comments; comments explain why** (cost trade-off, policy quirk, race). No emojis.

## 8. Cost & policy invariants (condensed — full text in CLAUDE.md)

- URL in post text = **$0.20 vs $0.015** (13x). `createPost` guard; links go in first reply ($0.030 total).
- **Feb 2026**: programmatic replies to non-self tweets blocked on self-serve (except when @-mentioned — unverified, `MENTION_API_REPLIES=false`). Quote-of-others blocked. Self-reply/self-quote OK (self-quote verified via `verifiedSelfQuote`).
- Token rotation: persist new refresh token BEFORE returning access token.
- Owned reads $0.001; other-user reads $0.005; third-party user lookup $0.010; post $0.015; delete $0.010.
- Media upload requires OAuth 1.0a — **not supported**; Studio images are manual paste.
- Budgets: X soft $0.15/day (log), xAI images hard $0.50/day (429).
- Out of scope v1: multi-tenant, follower sync, media upload, Chrome Web Store, idempotency drafts, per-tier caps.

## 9. Tests & verification map

- `bun test` runs with `SQLITE_PATH=:memory:` (one shared in-memory DB across route suites — seed carefully, clean up; some suites assert exact medians over shared data).
- Pure suites live next to their module (`*.test.ts`); route suites hit the Hono `app` via `app.request` over the in-memory DB; pre-DB guards in `src/app.test.ts`.
- Extension tests: bun:test on shared modules + studio (`templates.test.ts` (S5.6 code-card block: chrome/token colors/column x-math/truncation/determinism), `codeTokens.test.ts` (S5.6 tokenizer splits + `MONO_ADVANCE`), `milestones.test.ts` (S5.5 crossing logic), `brandKit.test.ts`, `mascot.test.ts`, `compose.test.ts`); DOM fixtures via happy-dom (earlyReplies); `sidepanel/storage.test.ts` mocks `chrome.storage.local` for the settings round-trip + `resolveTheme` (UI.9).
- Byte-sync prompt tests (post + reply) fail when .md and TS literal drift.
- Smoke scripts (`scripts/smoke-*.ts`): authoring, c6, c9, channels, conversations, explorer, followups, launch, mcp, mentions, people, pillars, pinned-watch, playbook, radar-drafts, studio, targets — rerunnable, $0 default.
- Gates before commit: `bun test` + `bun run typecheck` + `bun run lint`.
- Deploy: `./scripts/deploy.sh` (rsync, migrate — aborts restart on failure, `.git-sha` stamp, `curl -f /healthz`).

## 10. Recipes — where new things go

- **New API surface**: pure logic in `src/x/<domain>.ts` or `src/x/<domain>/` → router in `src/x/routes/<name>.ts` → mount in `src/x/index.ts` (mind order + Grok gating) → route test + pure test → smoke script → docs sync. If MCP-worthy, add a curated tool in `src/x/mcp.ts` (in-process `app.request`).
- **New table/column**: `src/x/db/schema.ts` → `bun run db:generate` → inspect SQL for dropped seeds → consumers. Column semantics: nullable + null=unknown when backfill is impossible.
- **New worker**: `src/x/workers/` → register heartbeat + stop() in `startXWorkers` → healthz staleness window. Prefer read-time computation over a new worker when $0-equivalent (§7.12).
- **New extension surface**: component in `src/sidepanel/` → wire in `App.tsx` → API via `api.ts` → shared pure logic in `src/shared/` or `extension/src/shared/` (bun-tested) → `docs/<tab>-tab.md`. Content-script additions must stay IIFE-safe.
- **New prompt-affecting feature**: NEVER edit the template mid-file — inject at the variable tail; keep byte-sync tests green; stamp what the model saw into the draft's snapshot.
- **New measurement**: pure `build*` in `src/x/playbook.ts` (gated) → loader in `routes/playbook.ts` → Playbook tab section → optionally digest facts.

## 11. Update log

- 2026-07-16 `2a7693e` — initial map (post-C9, post-S4, post grok-imagine migration).
- 2026-07-17 — §2: added `plans/` + masterplan skill rows (planning only; no src/extension changes — stamp sha unchanged).
- 2026-07-18 `95b9fff` — §5: `compose.ts` gained `path`/`panel`/`pattern` layer kinds + `mulberry32`/`patternCoords` pure exports (ST.1 / S5.1).
- 2026-07-18 `40c718e` (styles.css in `61a04e7`, D12) — **UI.8**: `styles.css` adopts the `--strat-*` design tokens (legacy aliases retained), bundles Inter for the panel, 44 color literals → tokens/`color-mix`; §2 DS-folder + biome-ignore rows, §5 `styles.css`/`public/fonts` rows, §7 design-token pattern.
- 2026-07-18 `7e07dd5` (code in `61a04e7`, D12/D13) — **UI.1**: `app_settings` (table #28, migration `0013`) + platform-agnostic `src/settings/store.ts` + typed `src/x/settings/registry.ts` (doctrine group) + `src/x/routes/settings.ts` (GET/values/PATCH/reset, mounted inert next to `data`); biome ignores `src/db/migrations`. §3.1 store, §3.3 registry, §3.4 settings routes, §4 count 27→28 + migrations →0013, §7 settings-platform pattern.
- 2026-07-18 `f9ff346` — **UI.9**: light theme (`:root[data-theme='light']` over base `--strat-*`) + Appearance (theme/density/text-size) stamped on `<html>` by `main.tsx` from local `theme`/`density`/`uiScale`; `body`/`.panel`/`.row` consume new `--ui-*` vars; `storage.ts` getters/patch + `resolveTheme`/normalizers + `storage.test.ts`; Settings.tsx Appearance selects. §5 styles.css/Settings/Storage-keys rows, §7 theme-aware note, §9 storage test. (Sha corrected from the orphaned `8c89950` amend — see STATE D14a / sha-stamp-trap gotcha.)
- 2026-07-18 `c37d504` — **UI.10**: `src/sidepanel/ui/` primitives (Section/EmptyState/SubTabs/SettingRow/Slider/GearPopover) + `settingsClient.ts` + `api.settings.{get,patch,reset}` + `SettingEntry`/`SettingsGroup`/`SettingsResponse` in `shared/types.ts`; grouped rail (`TAB_GROUPS` eyebrow dividers) + brandmark + `EmptyState` in App.tsx; `.brand*`/`.tab-group*` + tail `.ui-*` CSS block. §5 App.tsx/ui/settingsClient/api.ts/styles.css rows, §7 UI-primitives pattern note.
- 2026-07-18 `dffd60a` — **ST.2**: behavior-neutral Studio shell refactor — new `src/sidepanel/studio/{registry,fields,KitEditor}.tsx` (template registry + `buildSpec` dispatch, dumb field/kit components); `Studio.tsx` 771→554 lines. §5 Tab-components + new `sidepanel/studio/` row. (Stamped `860725f` at ship — that sha was an amend-orphan; real commit is `dffd60a`, corrected at ST.3.)
- 2026-07-18 `292603d`→**`b82058b`** — **ST.3**: deterministic cloud mascot — new `src/studio/mascot.ts` (pure `mascotLayers`, 4 poses, all-`path` viewbox, kit-derived colours, seeded confetti) + `mascot.test.ts`; `brandKit.ts` gains `mascot:boolean` (default true, parse fallback); `templates.ts` appends the mascot to quote/stat/banner guarded so `mascot:false` is byte-identical (stat pose flips on `delta>0`); `KitEditor.tsx` mascot checkbox. §5 `src/studio/` + `sidepanel/studio/` rows. Browser-verified: all 4 poses + card placements + stat pose-flip render correctly. (`292603d` was an amend-orphan; real commit `b82058b`, corrected at ST.4 — same sha-stamp trap.)
- 2026-07-18 `bc3f1e8`→**`1f6b20f`** — **ST.5**: milestone + streak celebration cards — new `src/studio/milestones.ts` (`MILESTONES` ladder + pure `latestCrossed`) + `milestones.test.ts`; `templates.ts` `milestoneCardSpec`/`streakCardSpec` (blobs confetti seed 11, celebrating mascot, null-graceful) + `templates.test.ts` blocks; `registry.ts` `TemplateId`+milestone/streak, `EMPTY_MILESTONE`/`EMPTY_STREAK`, `TemplateState.milestoneData/streakData`; `fields.tsx` `MilestoneFields`/`StreakFields`; `Studio.tsx` loads account-series/streak + override; `api.ts` `metrics.account()` + `MetricsAccountResponse`/`AccountSeriesPoint` types; `assets.ts` `ASSET_KINDS` widened to all S5 kinds + `assets.test.ts` case. §3.4 metrics client, §4 mediaAssets kinds, §5 studio rows, §9 tests. **Unverified in a browser** (live account-series/streak fill + Copy-PNG rides ST.9's Studio walk).
- 2026-07-18 `c1b0314`→**`15f2563`** — **ST.4**: background patterns + named theme presets — `templates.ts` `baseLayers` gains an optional pattern arg (`[fill, pattern]` base at 0.07-alpha ink, AI bitmap still wins); `QuoteCardData`/`BannerData` carry `patternKind?`/`patternSeed?`; `brandKit.ts` multi-preset (`BrandKits`, `studio:brandKits`, legacy migration, `STARTER_KITS` Midnight/Paper/Neon, pure `parseBrandKitsFile`+preset mutations, last-preset delete guard); `registry.ts` `TemplateState`+`patternKind/patternSeed`; `KitEditor.tsx` preset dropdown/Save-as/Rename/Delete + bundle import; `Studio.tsx` inline bg-mode segmented control + blobs reroll. §5 `src/studio/`+`sidepanel/studio/` rows. Tests: `brandKit.test.ts` multi-preset block, `templates.test.ts` patterns block. **Unverified in a browser** — rides ST.9's Studio walk.
- 2026-07-18 `b65266f` — **ST.6**: code/terminal card + bundled JetBrains Mono — new `extension/public/fonts/JetBrainsMono-{Regular,Bold}.woff2` (OFL-1.1, latin subset); `fonts.ts` loads them as `StudioMono` (per-face family, non-fatal); new `src/studio/codeTokens.ts` (pure `tokenizeLine` + `MONO_ADVANCE=0.6`) + `codeTokens.test.ts`; `templates.ts` `codeCardSpec`/`CODE_CARD`/`STUDIO_MONO_STACK` (terminal window, fixed-advance token layout, kit-derived colors, 18-line/62-col caps + trimmed footer) + `templates.test.ts` code block; `registry.ts` `TemplateId`+`code`, `DEFAULT_CODE`, `TemplateState.codeTitle/codeText`, `buildSpec` case; `fields.tsx` `CodeFields`; `Studio.tsx` wiring. `assets.ts` `ASSET_KINDS` already whitelisted `code` (ST.5) — no server edit. §5 studio rows + public/fonts, §9 tests. **Unverified in a browser** — rides ST.9's Studio walk (MONO_ADVANCE=0.6 is JetBrains Mono's exact 600/1000 em-advance, so the "verify visually" is a check, not a discovery).
