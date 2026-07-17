# stratus code map

> **Stamped:** 2026-07-16 at commit `2a7693e`.
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
| `biome.json`, `tsconfig.json` | Lint/format; TS strict, `noEmit`, `allowImportingTsExtensions`; tsconfig `include` covers `scripts/**` + `drizzle.config.ts`. |
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
| `src/db/shared-schema.ts` | `cost_events` (platform `'x' \| 'grok' \| 'xai'`). |
| `src/db/migrations/` | `0000`–`0012` + meta. `0000` carries the `content_pillars` seed `INSERT OR IGNORE` — drizzle-kit generate drops seed INSERTs; re-check after every generate. |
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
| `metrics.ts` | `GET /metrics/replies`, `/metrics/posts`, `/metrics/account`, `/metrics/best-times` (`?tzOffsetMin=`, top gated n≥3), `/metrics/pillars`, `/metrics/:tweetId`. |
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

Shared/other: `GET /healthz` (public), `GET/cost/today`, `GET /cost/daily`, `POST /grok/ask`, `POST /mcp` (JSON-RPC; GET/DELETE→405).

## 4. Database — 27 tables

`src/db/shared-schema.ts`: **cost_events** (platform-tagged spend ledger).

`src/x/db/schema.ts` (schema line numbers as of stamp):

| Table | Purpose / notes |
|---|---|
| `tokens` (L14) | Single row `id='default'` OAuth tokens. Excluded from explorer/MCP entirely. |
| `contentPillars` (L33) | Editable pillars; seed INSERT lives in migration 0000. Never let the active set go empty (409 guards). |
| `channels` (L54) | C8 topic rooms: slug PK, keywords JSON, optional pillar link (not FK-validated). |
| `mediaAssets` (L77) | S4 Studio PNGs as BLOBs (kind, prompt, w/h, usedOnTweetId). |
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

Migrations `0000`–`0012` (latest: `0009` has_media, `0010` pinned_tweet_id, `0011` media_note, `0012` media_assets). Workflow: edit schema → `bun run db:generate` → **inspect the SQL** (drizzle drops seed INSERTs; keep them idempotent) → boot/`deploy.sh` migrates.

## 5. Extension — `extension/` (own package.json, Vite + React, MV3)

**Build:** two passes (`vite.config.ts`) — content script first as self-contained **IIFE** (`content.js`; classic script, no imports allowed), then side panel + background as ES modules. Shared modules used by content.ts get inlined. Out-of-tree server modules reach the extension via **re-export shims**: `extension/src/replyBand.ts` → `src/shared/replyBand.ts`, `extension/src/channelSuggest.ts` → `src/shared/channelSuggest.ts` (tsconfig lists them in `include`).

**Manifest:** side panel + background service worker + content script on x.com/twitter.com. Permissions: sidePanel, storage, clipboardWrite/Read, contextMenus, alarms, notifications.

| File | Purpose |
|---|---|
| `src/background.ts` | Service worker. **Single writer of all `chrome.storage.session` state** (radar ring buffer cap 100 + dismissed cap 500, launch room state), writes serialized via promise chain. One HTTP transport: `ApiRequest` message channel — the only Authorization-header owner (incl. `binary` for asset blobs). Rankmap cache (10min TTL, S0.3). C7 launch alarms (`chrome.alarms`, +90s grace, liveness verify, notification). Ideas context menu. |
| `src/content.ts` | On-page: reply-band badge (`readTweetSignals`), save-to-stratus + save-author scrape, radar sightings stream (2s flush/60s throttle), C6 passive hover capture, C7 early-replies stream + launch-get throttle, post-save channel chips, `metrics_unparsed` loud error. |
| `src/harvester.ts` | Timeline harvester (human-like scroll, aria metric parse, CSV + ingest rows, since-last cursors) — driven over a port from the Harvest tab; imported by content.ts. |
| `src/shared/` | `messages.ts` (all message types: `stratus/api`, radar-\*, launch-\*), `types.ts` (`PostContext`, `RadarSighting`…), `radar.ts` (merge/cap/rank + `stampTiers`), `sightings.ts`, `launch.ts`, `earlyReplies.ts` (happy-dom fixture-tested), `metricsAria.ts` (locale-hardened), `harvest.ts`, `bgClient.ts`. |
| `src/sidepanel/api.ts` | Typed client — every call routes through background ApiRequest. |
| `src/sidepanel/App.tsx` | Tabs: today, people, channels, calendar, composer, studio, harvest, voice, replies, ideas, playbook, settings. Cross-tab handoffs: `onOpenPerson`, `openStudio`, remix→composer. |
| Tab components | `Today.tsx` (hosts: Conversations, DoNext, Fans, LaunchRoom, Digest, PinnedWatchCard, quests/streak, Radar, Targets, TodayPlan), `People.tsx` (+dossier, Icebreakers), `Channels.tsx`+`ChannelTags.tsx` (shared chip picker, 60s cache), `Calendar.tsx`, `Composer.tsx`+`composerLogic.ts` (best-time suggest, thread mode, jittered minutes), `Studio.tsx`, `Harvest.tsx`+`harvestClient.ts`, `Voice.tsx`+`Pillars.tsx` subtab, `Replies.tsx`, `Ideas.tsx`, `Playbook.tsx`, `Settings.tsx` (passiveCapture, applyPillarsToReplies, harvest cursors). |
| `src/studio/` | S3: `compose.ts` (layer model → canvas → PNG; layoutText wrap/shrink/ellipsize), `templates.ts` (quote/stat/banner/pfp + S4 background+scrim under text), `brandKit.ts`, `fonts.ts` (bundled Inter WOFF2s). |
| Storage keys | `chrome.storage.local`: brand kit, settings toggles, harvest cursors, `replyMaster:idea(+Id)`. `chrome.storage.session`: `radar:sightings`, `radar:dismissed`, `launch:active`, `launch:replies`. |

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
- Extension tests: bun:test on shared modules + studio; DOM fixtures via happy-dom (earlyReplies).
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
