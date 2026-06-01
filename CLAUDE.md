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
    token-store.ts  .tokens.json read/write; getValidAccessToken refreshes with rotation
                    (Phase 1 will swap the body to a Postgres `tokens` row; same exports)
    client.ts       xFetch — the ONE place all X API calls go through; exposes onCost
    fields.ts       field-selection defaults (defaultPostParams)
    errors.ts       XApiError + classify (RFC 7807 problem-details parsing)
    pagination.ts   paginate(next_token) async iterator
    endpoints.ts    getMe, getTweet, searchRecent, createPost, deletePost
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
    workers/             publisher, ownReconcile, metricsPoll
    index.ts             exports mountX(app) and startXWorkers() — only outside caller is app.ts
extension/               sibling Chrome MV3 side-panel UI (own package.json, Vite + React)
```

When LinkedIn arrives later: create `src/linkedin/` with the same shape, register in `app.ts`, point `drizzle.config.ts` at its schema. **Nothing inside `src/x/` changes.**

### Phase status

- **Phase 1 — Plumbing + Calendar:** done. `app.ts` + Hono, bearer + CORS middleware, Drizzle/Neon, Postgres token store, `pricing.ts` + `costTracker` wired into `xFetch.onCost`, `calendar.ts` routes, `publisher.ts` worker.
- **Phase 2 — Metrics + own-reconcile:** done. `metricsPoll` and `ownReconcile` workers; `/x/metrics` and `/x/posts` routes mounted via `mountX`.
- **Phase 3 — Voice library:** done, then **pivoted (2026-06-01) to a pure DOM-scrape swipe file**. No X API, no metrics polling — the `voicePull`/`voiceMetricsPoll` workers and the `tracked_authors`/`voice_metrics_snapshots` tables were dropped. `voice_authors` (handle PK + profile fields) and `voice_tweets` (now stores `scraped_html`) hold tweets the user manually saves. `/x/voice` routes are all $0 (scrape, enrich-author, list, retire, delete). See `src/x/routes/voice.ts`.
- **Phase 4 — Extension MVP (calendar + drafts):** done. End-to-end smoke-tested 2026-05-10: side panel → background API client → bearer-guarded `/x/calendar` → DB → 60 s publisher tick → live tweet → row flips `PENDING → POSTED`.
- **Phase 5 — Extension scraping for voice library:** done (2026-06-01). Content script scrapes the tweet (text + `tweetText` innerHTML for emoji-faithful format templates) plus a best-effort author hover card on "Save to stratus", and the full profile header on a "Save author" button. All capture is DOM-only.

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
- Own posts: ~113 polls × $0.001 ≈ **$0.113/tweet** over 30 days, then retired.
- Voice library: **$0** — captured by DOM scrape in the extension, never read through the X API.

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
- **`non_public_metrics` and `organic_metrics` silently null after 30 days** on owned posts. The metrics worker stops requesting them past the 30-day boundary and retires the row.
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
