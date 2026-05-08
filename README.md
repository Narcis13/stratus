# stratus

A thin, typed wrapper over **X API v2** in Bun + TypeScript. Single package, no monorepo, no DB, no Redis, no job queue. The whole codebase is ~600 lines you can read in 15 minutes.

> Companion to [`X-API-IMPLEMENTATION-PLAN.md`](./X-API-IMPLEMENTATION-PLAN.md), which is the full spec (auth, costs, policy, phased build order). This repo deliberately implements only a small slice of that plan and grows one endpoint at a time.
>
> [`IPSE-Implementation-PRD.md`](./IPSE-Implementation-PRD.md) is the eventual full product (Identity Graph + agents) — explicitly **out of scope here**.
>
> [`CLAUDE.md`](./CLAUDE.md) is the session-orientation doc. Read it first if you're contributing.

---

## Quickstart

```bash
cp .env.example .env          # fill in X_CLIENT_ID / X_CLIENT_SECRET from console.x.com
bun install

# 1. start the OAuth callback server, open the URL it prints, click Authorize on x.com
bun run auth

# 2. .tokens.json now exists; run the example calls
bun run play

# tests / type-check / lint
bun test
bun run typecheck
bun run lint
```

Use **`127.0.0.1`** (not `localhost`) in the OAuth redirect URI — X's allowlist treats them as different hosts. Register your app in the **Production** environment in console.x.com, not Development (Development has a `client-forbidden` bug for some flows).

---

## Repo layout

```
src/
  auth.ts          OAuth 2.0 PKCE: pair gen, authorize URL, code exchange, refresh, revoke
  token-store.ts   .tokens.json read/write; getValidAccessToken refreshes with rotation
  client.ts        xFetch — the ONE place all X API calls go through
  fields.ts        field-selection defaults (defaultPostParams)
  errors.ts        XApiError + classify (RFC 7807 problem-details parsing)
  pagination.ts    paginate(next_token) async iterator
  endpoints.ts     getMe, getTweet, searchRecent, createPost, deletePost
  server.ts        Bun.serve OAuth callback — `bun run auth`
  playground.ts    `bun run play` — example calls against your stored token
  test.test.ts     unit tests for the pure-function bits

.env.example       X_CLIENT_ID, X_CLIENT_SECRET, X_OAUTH_REDIRECT_URI, X_BEARER_TOKEN, PORT
.tokens.json       single-user token cache (gitignored)
```

---

## Current capabilities

This is an honest state-of-the-project, mapped against the phased build order in [`X-API-IMPLEMENTATION-PLAN.md` §10](./X-API-IMPLEMENTATION-PLAN.md). Anything not listed here is **not built yet**.

### Authentication — done

- **OAuth 2.0 PKCE** end-to-end: `generatePkcePair` → `buildAuthorizeUrl` → `/auth/x/start` → user consent on x.com → `/auth/x/callback` → `exchangeCodeForTokens` → `.tokens.json`. (`src/auth.ts`, `src/server.ts`)
- **Refresh-with-rotation**: `getValidAccessToken` refreshes 60 s before expiry and persists the new refresh token to disk **before** returning the access token. Loss of an unpersisted refresh token would lock the user out permanently. (`src/token-store.ts`)
- **Revoke** endpoint: `POST /auth/x/disconnect` calls `POST /2/oauth2/revoke` and deletes the local store.
- **All scopes** requested up-front: `tweet.read tweet.write tweet.moderate.write users.read follows.read mute.read like.read like.write bookmark.read media.write offline.access`. `offline.access` is mandatory — without it there is no refresh token.
- Single-user, plain-text token storage in `.tokens.json`. Encryption + per-user storage are deferred until a second user appears.

### HTTP client (`xFetch`) — done

Every X API call goes through one function (`src/client.ts`). It owns:

- Bearer auth header injection
- Retry on `429` (honors `x-rate-limit-reset`), `5xx`, and network errors with exponential backoff + jitter (1 s → 2 s → 4 s → 8 s, max 4 attempts)
- RFC 7807 problem-details parsing into a typed `XApiError`
- Per-call `onCost` callback for downstream cost tracking (currently a no-op — there's no persistent ledger yet)
- Rate-limit headers (`x-rate-limit-remaining`, `x-rate-limit-reset`) extracted on every response

### Errors — done

- `XApiError` class with `status`, `type` (the X problem-details URI), `detail`, `requestId`, `rawBody` (`src/errors.ts`).
- `classify(err)` maps X errors into 8 product-meaningful classes: `auth_invalid`, `duplicate_content`, `reply_restriction` (Feb 2026 policy), `user_suspended`, `rate_limited`, `usage_capped`, `scope_or_permission`, `server_error`, `unknown`.

### Endpoints — implemented

| Function | X endpoint | Auth | Cost | Notes |
|---|---|---|---|---|
| `getMe(token)` | `GET /2/users/me` | user | $0.001 | Returns `id`, `username`, `public_metrics`, `verified_type`, `subscription_type`. |
| `getTweet(token, id, {ownedPrivate?})` | `GET /2/tweets/:id` | user/app | $0.001 owned / $0.005 other | `ownedPrivate: true` requests `non_public_metrics` + `organic_metrics` (silently null after 30 d). |
| `searchRecent(token, query, {maxResults?})` | `GET /2/tweets/search/recent` | user/app | $0.005/result | 7-day window. **Per-request `max_results` is clamped to caller's intent** to avoid overpaying — see "Cost gotchas" below. |
| `createPost(token, body, opts?)` | `POST /2/tweets` | user | $0.015 / $0.20 | Pre-flight guards: URL-surcharge block, reply-to-other gate, requires `selfXUserId` for any reply. |
| `deletePost(token, id)` | `DELETE /2/tweets/:id` | user | $0.010 | |

### Pre-flight write guards (`createPost`)

These are policy/cost guards that fire **before** hitting X:

1. **URL surcharge guard** — if `text` matches `/(^|\s)https?:\/\//i`, the call throws unless `allowUrlSurcharge: true` is passed. URL-bearing posts cost **$0.20 vs $0.015** (13×). The cheap pattern is to post the link in a self-reply.
2. **Reply-to-other gate** — replies to non-self tweets are blocked on self-serve tiers since Feb 2026 unless the original author @-mentioned the app or quoted the app's post. `createPost` requires `selfXUserId` so the caller can't accidentally reply to a non-self tweet without explicit `allowReplyToOthers: true`.
3. **Self-quote** — quote-tweet of others is also blocked on self-serve. Self-quotes probably allowed but unverified — exposed as the `quote_tweet_id` field but not yet wrapped with a guard.

### Field selection — done

`src/fields.ts` is the single source of truth for `tweet.fields`, `user.fields`, `media.fields`, and `expansions`. `defaultPostParams({ ownedPrivate? })` returns the full canonical query. Don't hand-roll field strings at call sites.

### Pagination — done

`paginate(fetchPage, opts)` is an async iterator over `next_token`. Supports `maxItems`, `maxPages`, and `perPageSleepMs` (set to `1100` for `/2/tweets/search/all`, which is server-rate-limited to 1 req/sec).

### Tests — done

`bun test` runs 11 unit tests covering: `containsUrl`, `defaultPostParams`, `XApiError.classify`, PKCE pair generation, authorize URL construction. No integration tests against live X (intentional — would burn credits on every run).

---

## Cost cheat sheet (April 2026 prices, USD)

| Surface | Cost | Notes |
|---|---|---|
| Own post / mention / like / followers / following / mute / block read | $0.001 | 24h UTC dedup |
| Bookmarks read | $0.005 (billing bug — should be $0.001) | Defer bookmark sync |
| Other-user post read, search results | $0.005 | |
| Third-party user lookup | $0.010 | |
| Post create (no URL) | $0.015 | |
| **Post create (URL in text)** | **$0.20** | guarded in `createPost` |
| Like / Repost / Bookmark write | $0.015 | |
| Delete | $0.010 | |

Full reference: [`X-API-PRICING-REFERENCE.md`](./X-API-PRICING-REFERENCE.md) and the X plan §14.

### Cost gotchas already paid for

- **`maxItems` does NOT cap cost — `max_results` does.** X bills for every result it returns in the response body, not what your JavaScript iterates. A `for await … break` after asking for `max_results: 100` still costs ~100 reads. Already burned $0.49 once on a 3-result `searchRecent` because of this. Any endpoint wrapping `paginate()` MUST clamp the URL's per-request page size to the caller's intent — see `searchRecent` for the pattern (`Math.min(100, Math.max(10, opts.maxResults ?? 100))`).
- **`non_public_metrics` and `organic_metrics` silently null after 30 days** on owned posts. Snapshot before they decay if you care.
- **Hard pagination caps** that kill iteration silently: `/users/:id/tweets` 3,200; `/users/:id/mentions` 800; `/tweets/:id/retweeted_by` and `/tweets/:id/liking_users` hard 100.

---

## What's NOT in the box yet

Mapped against the X plan's module list (§6) — these are the deliberate gaps:

| Plan §  | Module | Status |
|---|---|---|
| §4.4 | Encrypted multi-user token storage (DB + AES-GCM) | Not built — single-user JSON file is enough today |
| §6.1 | Read endpoints beyond `getTweet`: `getMyTweets`, `getMentions`, `getLikedTweets`, `getBookmarks`, `getReverseChronTimeline`, `getQuotesOf`, `getRetweetersOf`, `getLikersOf`, `getConversationReplies` | Not built |
| §6.2 | `searchAll`, `searchCounts`, query-builder helpers | Not built (only `searchRecent`) |
| §6.3 | `postThread` (self-reply chain with resume-on-failure), `hideReply`, engagement actions (`like`, `unlike`, `repost`, `unrepost`, `bookmark`, `unbookmark`) | Not built |
| §6.4 | `backfillUserHistory` two-phase pipeline | Not built |
| §6.5–§6.7 | User lookup / search / relationships / mute/block / scoring | Not built |
| §6.8 | Media upload (chunked INIT/APPEND/FINALIZE/STATUS, OAuth 1.0a signing, alt-text) | Not built. Still requires OAuth 1.0a as of May 2026 — a real cost to add. |
| §6.9 | Metrics poller cadence engine | Not built |
| §6.10 | Compliance batch for delete reconciliation | Not built |
| §6.11 | Mentions poller (first-30-min protocol) | Not built |
| §6.12 | Cost tracker with persistent ledger + tier-cap circuit breakers | Stub only — `xFetch` exposes `onCost`, but nothing aggregates the events |
| §7.1 | Persistent rate-limit window store (Redis) | Not built — we just react to headers per-request |
| §7.4 | Idempotency (draft-row + body-hash + post-confirm scan) | Not built |
| §7.5 | Structured observability sink (Axiom / Better Stack) | Not built |
| §11 | OpenAPI type generation, integration / contract / cost-regression tests | Not built |

App-only Bearer (`X_BEARER_TOKEN`) is wired in `.env.example` for future public reads but no endpoint uses it yet — every implemented endpoint runs in user context.

---

## What's next on radar

Pull each item in only when you actually need it. Order reflects diminishing-returns thinking, not a hard roadmap.

1. **Persistent cost log.** `xFetch` already emits `CostInfo`; nothing stores it. Smallest next step: SQLite via `bun:sqlite`, one row per call, daily rollups in a view. Unblocks tier-cap enforcement and cost regression tests.
2. **More read endpoints, demand-driven.** Likely first: `getMyTweets` (paginated owned timeline) and `getMentions` (owned read, $0.001) — both feed the eventual mentions poller. Add to `endpoints.ts`, reuse `paginate()`, remember to clamp page size.
3. **Idempotency for writes.** Draft row keyed by UUID + body hash, written before `POST /2/tweets`, reconciled by a `since={attemptedAt - 60s}` scan if the network call fails. From X plan §7.4. Required before anything that can retry mid-flight.
4. **`postThread`.** Self-replies always work. Persist segments before/after each call so a mid-thread failure can resume; 500 ms inter-segment delay to dodge X's duplicate-content window. From X plan §6.3.4.
5. **Background metrics polling.** Start with a `setInterval` in a script, not BullMQ. Cadence ladder from X plan §6.9 (5 min → 15 min → 1 h → 6 h → daily). Persist to SQLite. Total ≈ 113 polls/post at $0.001 = $0.113/post.
6. **Mentions poller / first-30-min protocol.** Once `getMentions` and metrics polling are in, this is a thin scheduler on top.
7. **Reply targeting product decision.** Largest open question (X plan §13.1): do we ship a "click-to-X-reply" handoff, defer to Enterprise tier, or skip entirely? Affects whether `replyToOther` ever lands.
8. **Multi-user.** Swap the JSON token store for SQLite, encrypt token columns with AES-256-GCM (per-row IV, master key from env/KMS), per-row `userId` keys (X plan §4.4). Only do this when a second user actually exists.
9. **Media upload.** Chunked pipeline + OAuth 1.0a (still required as of May 2026 — confirm against [docs.x.com/changelog](https://docs.x.com/changelog) before starting). From X plan §6.8.
10. **Promotion to monorepo.** Defer until you start work on the IPSE Identity Graph or agents. There is no second package yet.

---

## Adding an endpoint (the working pattern)

1. Add a typed wrapper in `src/endpoints.ts` that calls `xFetch`.
2. Note the cost in a `/** Cost: $X. */` JSDoc above it (X plan §14 has the table).
3. If it's a write, think about pre-flight guards: URL surcharge, reply restriction, length, scope, idempotency.
4. If it paginates, use `paginate()` from `src/pagination.ts` — and **clamp the URL's per-request `max_results` to the caller's intent** (see the cost gotcha above).
5. Add a unit test for any pure transformation (query building, response shaping). Don't add an integration test that hits live X — those burn credits on every run.

---

## Conventions for this repo

- **Add one endpoint at a time** when there's a concrete need. Don't pre-stub the API surface.
- **No new packages or directories** without a concrete reason. The plan's full layout (`packages/x-client`, `packages/db`, agents, etc.) is the *eventual* shape — not the starting shape.
- **No DB, no Redis, no BullMQ yet.** A single JSON file is fine for one developer.
- **Comments explain the non-obvious *why*** (cost trade-off, X policy quirk, race condition). Plan documents carry the long-form prose.
- **One file, one source of truth.** Update `CLAUDE.md` and this README in the same commit when behavior changes.
