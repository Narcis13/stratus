# CLAUDE.md — Session orientation for `stratus`

> Read this first, every session.

## What this is

A small **deployed-anywhere service** (one user: me) that does three things, all on top of a thin typed wrapper over X API v2:

1. **Schedule posts a week ahead** (calendar + 60 s publisher worker).
2. **Track metrics over time** on every post I publish — through the scheduler or manually from the X app — via a daily own-reconcile pass plus a polling cadence.
3. **Stash other people's tweets** ("voice library") for style/structure analysis later.

Hard scope ceiling: if a feature isn't in service of those three, it doesn't get built.

### Source-of-truth docs

- **`PLAN.md`** — canonical *build* plan. What we're building next, in what order, with what shape. Read this before planning any non-trivial change.
- **`X-API-IMPLEMENTATION-PLAN.md`** — reference-only spec for X API behavior, costs, and policy quirks. Look here for endpoint semantics, pricing tables, rate limits, policy edge cases. Do **not** treat it as a build plan.
- **`IPSE-Implementation-PRD.md`** — the eventual full product (Identity Graph + agents). **Out of scope here.** Do not pull patterns from it preemptively.

## Stack

- Bun ≥ 1.1, TypeScript strict (`allowImportingTsExtensions`, `noEmit`)
- Native `fetch`, `Bun.serve`, `Bun.file`, `bun:test`
- Biome for lint/format
- **Planned (not yet present):** Hono (HTTP), Neon Postgres + Drizzle ORM (state), in-process `setInterval` workers (no Redis/BullMQ), Chrome MV3 side-panel extension (Vite + React).

## Repo map

```
src/
  test.test.ts    unit tests for the pure-function bits (will move under per-area test files later)

  x/              all X-specific code (Phase 1 relocation done — pure move, no behavior change)
    auth.ts         OAuth 2.0 PKCE — pair gen, authorize URL, exchange, refresh, scopes
    token-store.ts  Postgres-backed single-row token store (tokens.id='default');
                    getValidAccessToken persists the rotated refresh token before
                    returning the access token (legacy .tokens.json deleted 2026-06-10)
    client.ts       xFetch — the ONE place all X API calls go through; exposes onCost
    fields.ts       field-selection defaults (defaultPostParams)
    errors.ts       XApiError + classify (RFC 7807 problem-details parsing)
    pagination.ts   paginate(next_token) async iterator
    endpoints.ts    getMe, getTweet, getTweetsByIds, searchRecent, getUserTweets, createPost, deletePost
    server.ts       Bun.serve OAuth callback — `bun run auth`
    playground.ts   `bun run play` — example calls
```

### Where the code is going (per `PLAN.md`)

The repo grows in **per-platform vertical slices**. X gets its own folder; future platforms (LinkedIn, Threads, …) get sibling folders that never reach into each other. Only a thin shared layer at the top knows about more than one platform.

```
src/
  app.ts                 Hono app — mounts platform routers, shared middleware, starts workers
  middleware/            auth (bearer), cors (chrome-extension://*), costTracker (platform-tagged)
  db/                    Neon + Drizzle singletons, shared-schema.ts (cost_events), migrations/
  routes/                cost.ts (cross-platform spend), healthz.ts
  x/
    …existing primitives…
    pricing.ts           X price table (the switch keyed off endpoint substrings)
    db/schema.ts         tokens, scheduled_posts, posts_published, metrics_snapshots,
                         voice_authors, voice_tweets, reply_drafts
    routes/              calendar.ts, metrics.ts, voice.ts, replies.ts (mounted under /x)
    workers/             publisher, dailyMetrics (daily 03:00 UTC discover+snapshot)
    index.ts             exports mountX(app) and startXWorkers() — only outside caller is app.ts
extension/               sibling Chrome MV3 side-panel UI (own package.json, Vite + React)
```

When LinkedIn arrives later: create `src/linkedin/` with the same shape, register in `app.ts`, point `drizzle.config.ts` at its schema. **Nothing inside `src/x/` changes.**

### Phase status

- **Phase 1 — Plumbing + Calendar:** done. `app.ts` + Hono, bearer + CORS middleware, Drizzle/Neon, Postgres token store, `pricing.ts` + `costTracker` wired into `xFetch.onCost`, `calendar.ts` routes, `publisher.ts` worker.
- **Phase 2 — Metrics + own-reconcile:** done, then **consolidated (2026-06-05) into a single daily pass**. The old `metricsPoll` (60s) + `ownReconcile` (24h) workers were replaced by one `dailyMetrics` worker that runs at **03:00 UTC** (`src/x/workers/dailyMetrics.ts`): (A) discovers own tweets/replies via a `since_id` timeline pull, (B) snapshots **every non-retired row regardless of age** by batched id lookup (`getTweetsByIds` → `GET /2/tweets?ids=`, ≤100/call), retiring each batch *before* writing its snapshots so a tweet is read once and only once (invariant #7). `/x/metrics` and `/x/posts` routes still mounted via `mountX`; `POST /x/posts/reconcile` now triggers the daily pass. Disable the timer with `DAILY_METRICS_ENABLED=false` (manual reconcile still works). **Age-gate dropped 2026-06-06** (was ≥24h "day-after"): now whatever a tweet's metrics are at the 03:00 UTC pass is the single number kept. **Account KPI added 2026-06-10:** the same daily pass starts with one `getMe()` ($0.001) into `account_snapshots` (follower/following/tweet/listed counts, max one row per UTC day — guard keeps boot catch-up runs from double-writing); `GET /x/metrics/account` serves the series with daily deltas joined against that window's posts/replies counts.
- **Phase 3 — Voice library:** done, then **pivoted (2026-06-01) to a pure DOM-scrape swipe file**. No X API, no metrics polling — the `voicePull`/`voiceMetricsPoll` workers and the `tracked_authors`/`voice_metrics_snapshots` tables were dropped. `voice_authors` (handle PK + profile fields) and `voice_tweets` (now stores `scraped_html`) hold tweets the user manually saves. `/x/voice` routes are all $0 (scrape, enrich-author, list, retire, delete). See `src/x/routes/voice.ts`.
- **Phase 4 — Extension MVP (calendar + drafts):** done. End-to-end smoke-tested 2026-05-10: side panel → background API client → bearer-guarded `/x/calendar` → DB → 60 s publisher tick → live tweet → row flips `PENDING → POSTED`.
- **Phase 5 — Extension scraping for voice library:** done (2026-06-01). Content script scrapes the tweet (text + `tweetText` innerHTML for emoji-faithful format templates) plus a best-effort author hover card on "Save to stratus", and the full profile header on a "Save author" button. All capture is DOM-only.
- **Overhaul 6.2 — Reply outcomes (2026-06-10, $0):** `GET /x/replies/outcomes` joins posted `reply_drafts` → `posts_published` → latest `metrics_snapshots` on `postedTweetId`, surfacing views/likes/replies/`profileVisits` (`user_profile_clicks`) per reply. The content script now stamps `signals: {band, views, replies, ageMin, vpm, bait}` into `PostContext` at capture time (same `readTweetSignals` path as the badge), so every draft is a labeled training row in `contextSnapshot`. `evals/analyze-own-replies.ts` emits the santoshstack crosstab over own replies — recalibrate `BAND` only at ≥100 measured. **The join only works if `postedTweetId` gets set** (PATCH after pasting); 12 historical drafts were backfilled by matching `posts_published.inReplyToTweetId` = draft `sourceTweetId`, the rest predate reply discovery or were edited beyond text-match. OVERHAUL-PLAN §6.3's harvest reconcile is the planned systematic fix.
- **Overhaul 6.3 — Harvest ingestion (2026-06-10, $0 X API):** harvested rows now land in Postgres alongside the CSV download. New tables `harvest_runs` + `harvest_rows` (repeated harvests of the same tweet create new rows on purpose — the `(tweet_id, captured_at)` series is the longitudinal view/bookmark curve the once-only API snapshot can't give). Routes in `src/x/routes/harvest.ts`: `POST /x/harvest/runs`, `POST /x/harvest/rows` (batched ≤500/call), `GET /x/harvest/runs`. The extension Harvest tab gained a "Send to stratus" toggle (default on, persisted); the content script ships rows through the background `ApiRequest` path after the CSV download, so an upload failure never loses the harvest. Replies-mode batches reconcile against `reply_drafts`: exact match on `postedTweetId` stamps `matched_draft_id`; otherwise a text+time fallback (collapsed-whitespace equality on what was actually posted, reply time within −10 min/+7 d of draft creation, same-source-tweet candidates preferred) links the row **and backfills the draft's missing `postedTweetId`** — the systematic fix for drafts never PATCHed after pasting.
- **Overhaul 6.4 — Daily Brief (2026-06-10, $0):** `GET /x/brief` (`src/x/routes/brief.ts`) is the growth-coach payload behind the extension's new **Today** tab (now the default tab): follower count + 7-day delta + 14-day sparkline from `account_snapshots`, yesterday's posts/replies with their snapshot numbers, profile-click leaders over the trailing week, today's scheduled slots with cadence-gap detection (anchors from the `md_to_schedule.ts` ladders — 3/day `[9,13,18]`, 4/day `[8,12,16,20]`, picked by filled-slot count; nearest-anchor assignment, unclaimed anchors are the gaps), reply quota (posted `reply_drafts` today vs the 10–20 target — `updatedAt` of the `posted` flip is paste time), the week's replies/posts ratio vs the 70/30 doctrine, and today's spend by platform (X + Grok side by side). Day boundaries are the *viewer's local day* via `?tzOffsetMin=` (JS `getTimezoneOffset()` semantics) **except spend, which stays on the UTC billing day** to match `/cost/today`. Pure SQL over already-billed data — no X API reads.

- **Overhaul 6.5 — Protect the machine (2026-06-10, $0):** (a) **Worker heartbeats** — `src/heartbeats.ts` registry; workers `beat()` each tick, `startXWorkers` registers `x.publisher` (stale >5 min) and `x.dailyMetrics` (stale >25 h), `/healthz` returns 503 with `staleWorkers` when one stops beating, so the deploy `curl -f` pages. (b) **Publisher double-post hardening** — `processOne` split into claim txn (`pending → publishing`, committed BEFORE `createPost`) then finalize; a definite X 4xx flips to `failed`, but 5xx/network leaves the row in `publishing` forever (ambiguous — the tweet may exist; reconcile finds it if it shipped, and the publisher shouts about stuck rows every tick). `publishing`/`posted` are worker-owned: PATCH/DELETE 409, status not settable via PATCH. (c) **URL guard at schedule time** — `calendar.ts` rejects `pending` rows whose text matches the URL regex (`400 url_in_text`); drafts may hold URLs, promotion re-checks. (d) **SIGTERM/SIGINT handler** in `app.ts` — stops timers, drains in-flight ticks (worker `stop()` is now async), 30 s force-exit backstop. (e) **`GET /cost/daily?days=30`** (zero-filled UTC series) + budget watchdog: `makeOnCost('x', { dailyBudgetUsd })` (env `X_DAILY_BUDGET_USD`, default 0.15) logs a `BUDGET WATCHDOG` error on every billed call once today's spend crosses it and stamps `dailyBudgetUsd`/`overBudget` into `/cost/today`. (f) `.env.example` gained `SELF_X_USER_ID`, `XAI_API_KEY`, `DAILY_METRICS_ENABLED`, `X_DAILY_BUDGET_USD`; `deploy.sh` warns when server `.env` is missing keys vs `.env.example`; legacy `.tokens.json` deleted (Postgres token row confirmed live first).

- **Overhaul 7.1 — Reply prompt surgery (2026-06-10):** `POST /x/replies/generate` now makes one Grok **structured-outputs** call (`text.format` json_schema on `/v1/responses` — verified live; `response_format` is chat-completions-only and 400s there) returning `{replies: [{text, angle}]}` — **two variants** tagged `extends`/`contrarian`/`debate`, stored in new `reply_drafts.variants` (jsonb); `replyText` holds the first gate-passing variant and the panel's editor grew variant-picker chips. Optional `idea` body field (≤2000 chars, new `idea` column) substitutes into the prompt's `<idea>{{IDEA}}</idea>` tag — Romanian seed in, English reply out; the extension keeps it one-shot under `replyMaster:idea` (panel textbox → the next generate consumes and clears it). Prompt hardenings live in `reply prompt.md` **and** the embedded `REPLY_PROMPT_TEMPLATE` (a bun:test asserts they stay byte-identical — regenerate the literal when editing the .md): reply-specific forbidden agreement-openers, bias to ONE punchy line, never fabricate numbers/biography, earned-profile-visit rule (no "follow me"; CTA only when the steer asks). Server-side **specificity gate** (digit OR first-person OR named tool) burns exactly one automatic regenerate when no variant passes; `costUsd` sums both calls. `maxOutputTokens` 2000→350 (verified live: xAI doesn't count reasoning tokens against the cap) + `prompt_cache_key`, with all variable content ({{TWEET_CONTEXT}}, {{IDEA}}) moved to the very end so the instruction block is a stable cached prefix — draft cost ~$0.002–0.004. **Persona stripped 2026-06-10:** the full voice doc (ANAF, hospital, family, 386 arc — audience-irrelevant) was cut from the reply prompt; persona is now exactly three inferable facts (solopreneur; passionate about programming/AI/marketing; builds in public), inventing biography is forbidden (stance and observation only, unless the steer supplies a fact), and the angle prose leans punchy/dividing/lightly-controversial plus extend-the-post. Prompt shrank ~17.5KB→~5KB; angle tags, schema, and specificity gate unchanged.

Authoritative source for what's actually wired is `src/x/index.ts` (`mountX` + `startXWorkers`). See `PLAN.md` §"Phased build" for the full breakdown.

## Non-negotiable invariants

These are the rules that have already cost real money or locked users out. Memorize before changing the code.

### 1. URL surcharge: $0.20 vs $0.015 (13× cost)
A post whose `text` matches `/(^|\s)https?:\/\//i` is billed at $0.20, not $0.015. `createPost` blocks unless `allowUrlSurcharge: true`. Don't disable the guard to make a test pass; move the URL to a reply.

### 2. Programmatic-reply restriction (Feb 2026)
Self-replies (own threads) always work. Replying to others via `in_reply_to_tweet_id` is **blocked on self-serve tiers** unless the original author @-mentioned the app or quoted it. `createPost` requires `selfXUserId` so the caller can't accidentally reply to a non-self tweet. Largest open product question — see X plan §13.1. (PLAN.md v1 explicitly excludes replies to non-self tweets and cross-account quote tweets for this reason.)

### 3. Token rotation atomicity
X rotates the **refresh token on every refresh**. If we lose the new refresh token between issuance and persistence, the user is permanently locked out. `token-store.ts::getValidAccessToken` writes the new token to disk *before* returning the access token. If you change that order, you'll burn someone's account. The Phase 1 swap to a Postgres-backed token store must preserve this ordering (write new refresh token in the same transaction *before* returning the access token).

### 4. One place to call X
Every X call goes through `xFetch` in `src/x/client.ts`. That's where retries, error parsing, rate-limit headers, and `onCost` live. Don't sprinkle direct `fetch('https://api.x.com/...')` around the codebase — not in workers, not in routes, not in scripts.

### 5. `maxItems` does NOT cap cost — `max_results` does
X bills for every result it returns in the response body, not what your JS iterates. A `for await (...) { if (++n >= 3) break; }` after a request asking for `max_results: 100` still costs you ~100 reads. Already burned $0.49 once on a 3-result `searchRecent` because of this. Any endpoint wrapping `paginate()` MUST clamp the URL's per-request page size to the caller's intent — see `searchRecent` in `src/x/endpoints.ts` for the pattern (`Math.min(100, Math.max(10, opts.maxResults ?? 100))`). The `maxItems` arg in `paginate()` only stops *additional* page fetches; the page already in flight is already billed.

### 6. Cost middleware dispatches by platform
When `pricing.ts` and `costTracker.ts` land, `cost_events` rows must carry a `platform` column (`'x'`, later `'linkedin'`, …) and the dispatcher in `src/middleware/costTracker.ts` selects the price table by platform. Never hardcode X assumptions into the shared middleware — the whole point of the per-platform folder shape is that the shared layer stays platform-agnostic.

### 7. A billed read must be unrepeatable — retire before you snapshot
`xFetch.onCost` bills the moment an X response returns; the cost is banked even if a later DB write fails or the process crashes. So a read must never be repeatable without the row first being taken out of the candidate set. `dailyMetrics.snapshotDue` reads every non-retired tweet **regardless of age** (whatever the metrics are at the 03:00 UTC pass is the one number we keep), and to keep each read **once and only once** it retires the whole batch in one committed txn *before* inserting any snapshot. The deliberate trade-off is at-most-once snapshots, not exactly-once: a crash between the retire commit and the inserts loses that batch's snapshots (a metrics gap), **never a double charge** — the right priority for a cost-sensitive single-user wallet. The earlier per-tick `metricsPoll` got this backwards (snapshot inside a txn, then advance the cursor) and a post-read failure rolled the cursor back, re-reading the same tweet every 60s — **$3.71 on one tweet read 3,712 times**. Also: tweets past `PRIVATE_FIELDS_MAX_AGE_MS` (28d) read public-only — requesting `non_public_metrics` past X's 30-day window is the read most likely to come back unstorable. Same family as #5 — irreversible billed side-effects must never sit upstream of something that lets you repeat them.

## Cost cheat sheet (Apr 2026 prices, USD)

| Surface | Cost | Notes |
|---|---|---|
| Own post / mention / like / followers / following / mute / block read | $0.001 | 24h UTC dedup |
| Bookmarks read | $0.005 (billing bug — should be $0.001) | Defer bookmark sync |
| Other-user post read, search results | $0.005 | |
| Third-party user lookup | $0.010 | |
| Post create (no URL) | $0.015 | |
| **Post create (URL in text)** | **$0.20** | ⚠️ guard in createPost |
| Like / Repost / Bookmark write | $0.015 | |
| Delete | $0.010 | |

Cadence-derived budgets (from PLAN.md §"Cadence ladders"):
- Own posts (and my replies to others — a reply is my own tweet): **1 snapshot × $0.001 = $0.001/tweet**, then retired — read **once and only once** (simplified 2026-06-02; consolidated 2026-06-05 into one daily 03:00 UTC pass — see `dailyMetrics`; age-gate dropped 2026-06-06). The snapshot pass reads **every non-retired tweet regardless of age** by batched id lookup (≤100/call) and retires the batch before snapshotting it, so no tweet is ever read twice. `nextPollAt` is still seeded to `postedAt + 24h` but is informational only — it no longer gates selection. Profile visits (`user_profile_clicks`) come free in `non_public_metrics` on the same owned read. At 50+ replies/day that's ~$0.05/day of snapshots plus the daily discovery reads.
- Voice library: **$0** — captured by DOM scrape in the extension, never read through the X API.
- Account KPI (follower counts): **$0.001/day** — one `getMe()` at the start of the daily pass, written to `account_snapshots`, max one row per UTC day.

## Common commands

```bash
bun install
bun run auth           # OAuth server on http://127.0.0.1:3000  (src/x/server.ts)
bun run play           # example calls using stored tokens       (src/x/playground.ts)
bun test               # unit tests
bun run typecheck      # tsc --noEmit
bun run lint           # biome check
```

Use **`127.0.0.1` not `localhost`** for the OAuth redirect URI.

## Working style for this repo

- **Follow `PLAN.md`'s phased build.** Don't jump phases for convenience — each phase ends with something usable, and skipping ahead breaks the "smoke test at the end" discipline.
- **Add one endpoint at a time** in `src/x/endpoints.ts` when a route or worker actually needs it. Don't pre-stub the whole API surface.
- **Per-platform isolation is load-bearing.** New X-specific code goes under `src/x/`. New cross-platform infrastructure goes under `src/db/`, `src/middleware/`, `src/routes/`, or `src/app.ts`. `src/x/` must not depend on `src/linkedin/` (or vice versa) when that lands; they only share the top-level layer.
- **In-process workers, not a queue.** A few `setInterval` calls in the same Bun process (publisher, ownReconcile, metricsPoll), using `SELECT … FOR UPDATE SKIP LOCKED` for safety. Don't reach for Redis/BullMQ unless something *actually* breaks at one process.
- **No comments stating the obvious.** Comments only for non-obvious *why* (cost trade-off, X policy quirk, race condition). `PLAN.md` and `X-API-IMPLEMENTATION-PLAN.md` carry long-form prose.
- **Tests:** `bun:test` (native runner — same API as Vitest).
- **No emojis** unless the user asks.

## Gotchas

- **Use Production app environment** in console.x.com, not Development — Development has a `client-forbidden` bug for some flows.
- **Hard pagination caps** that kill iteration silently: `/users/:id/tweets` 3,200; `/users/:id/mentions` 800; `/tweets/:id/retweeted_by` and `/liking_users` hard 100. Own-reconcile caps at the last ~500 tweets per pass for this reason.
- **`search/all` is server-rate-limited to 1 req/sec** — pass `perPageSleepMs: 1100` to `paginate()`.
- **`non_public_metrics` and `organic_metrics` silently null after 30 days** on owned posts. The metrics worker now retires at 24h (well inside that window), so it always requests them — but don't extend the cadence past 30 days without making the worker stop requesting the private fields at the boundary.
- **Quote-tweet of others is blocked on self-serve** (Feb 2026). Self-quotes probably allowed; verify before exposing. v1 ships without quote/reply-to-others endpoints on purpose.
- **OAuth 1.0a still required for `/2/media/upload`** as of May 2026 — we don't support media yet for that reason. Confirm before adding.
- **Other-user reads are 5× owned reads** ($0.005 vs $0.001) — which is exactly why the voice library captures by DOM scrape in the extension instead of reading other users through the API. Don't reintroduce X-API reads for the voice library without a budget conversation.

## Explicitly out of scope (v1)

Lifted from `PLAN.md` §"Explicitly NOT doing" — don't accidentally implement these:

- Replies to non-self tweets, cross-account quote tweets (Feb 2026 policy)
- Media uploads (OAuth 1.0a complexity not worth it for solo use yet)
- Follower / mute / block sync (not in the three goals)
- Idempotency draft-row pattern (single-user, low write volume; reconcile catches drift)
- Multi-tenant auth (one user, one bearer token shared between API and extension)
- Publishing the extension to the Chrome Web Store (load unpacked from local clone)
- Per-tier budget caps (one wallet; the cost dashboard is the cap)

If any of these becomes necessary, lift the relevant section from `X-API-IMPLEMENTATION-PLAN.md` *then* — not now.

---

*One file, one source of truth. Update this in the same commit when behavior changes. `PLAN.md` is the build plan; this file is the guardrails around it.*
