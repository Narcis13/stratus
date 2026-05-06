# CLAUDE.md — Session orientation for `stratus`

> Read this first, every session.

## What this is

A **thin, typed wrapper over X API v2**. Single Bun package, no monorepo, no DB. Goal: be small enough to read end-to-end in 15 minutes and grow one endpoint at a time.

`X-API-IMPLEMENTATION-PLAN.md` is the canonical spec for X behavior, costs, and policy. This codebase only implements a fraction of it on purpose. Resist scaffolding ahead of need.

`IPSE-Implementation-PRD.md` is the eventual full product (Identity Graph + agents). **Out of scope here.** When work shifts to that, we add structure then — not now.

## Stack

- Bun ≥ 1.1, TypeScript strict (`allowImportingTsExtensions`, `noEmit`)
- Native `fetch`, `Bun.serve`, `Bun.file`, `bun:test` — no Hono, no Express, no Vitest
- Biome for lint/format

## Repo map

```
src/
  auth.ts         OAuth 2.0 PKCE — pair gen, authorize URL, exchange, refresh, scopes
  token-store.ts  .tokens.json read/write; getValidAccessToken refreshes with rotation
  client.ts       xFetch — the ONE place all X API calls go through
  fields.ts       field-selection defaults (defaultPostParams)
  errors.ts       XApiError + classify (RFC 7807 problem-details parsing)
  pagination.ts   paginate(next_token) async iterator
  endpoints.ts    getMe, getTweet, searchRecent, createPost, deletePost
  server.ts       Bun.serve OAuth callback — `bun run auth`
  playground.ts   `bun run play` — example calls
  test.test.ts    unit tests for the pure-function bits
```

## Non-negotiable invariants

These are the rules that have already cost real money or locked users out. Memorize before changing the code.

### 1. URL surcharge: $0.20 vs $0.015 (13× cost)
A post whose `text` matches `/(^|\s)https?:\/\//i` is billed at $0.20, not $0.015. `createPost` blocks unless `allowUrlSurcharge: true`. Don't disable the guard to make a test pass; move the URL to a reply.

### 2. Programmatic-reply restriction (Feb 2026)
Self-replies (own threads) always work. Replying to others via `in_reply_to_tweet_id` is **blocked on self-serve tiers** unless the original author @-mentioned the app or quoted it. `createPost` requires `selfXUserId` so the caller can't accidentally reply to a non-self tweet. Largest open product question — see X plan §13.1.

### 3. Token rotation atomicity
X rotates the **refresh token on every refresh**. If we lose the new refresh token between issuance and persistence, the user is permanently locked out. `token-store.ts::getValidAccessToken` writes the new token to disk *before* returning the access token. If you change that order, you'll burn someone's account.

### 4. One place to call X
Every X call goes through `xFetch` in `client.ts`. That's where retries, error parsing, and rate-limit headers live. Don't sprinkle direct `fetch('https://api.x.com/...')` around the codebase.

### 5. `maxItems` does NOT cap cost — `max_results` does
X bills for every result it returns in the response body, not what your JS iterates. A `for await (...) { if (++n >= 3) break; }` after a request asking for `max_results: 100` still costs you ~100 reads. Already burned $0.49 once on a 3-result `searchRecent` because of this. Any endpoint wrapping `paginate()` MUST clamp the URL's per-request page size to the caller's intent — see `searchRecent` in `endpoints.ts` for the pattern (`Math.min(100, Math.max(10, opts.maxResults ?? 100))`). The `maxItems` arg in `paginate()` only stops *additional* page fetches; the page already in flight is already billed.

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

## Common commands

```bash
bun install
bun run auth           # OAuth server on http://127.0.0.1:3000
bun run play           # example calls using stored tokens
bun test               # unit tests
bun run typecheck      # tsc --noEmit
bun run lint           # biome check
```

Use **`127.0.0.1` not `localhost`** for the OAuth redirect URI.

## Working style for this repo

- **Add one endpoint at a time** in `endpoints.ts` when you actually need it. Don't pre-stub the whole API surface.
- **No new packages, no new directories** without a concrete reason. The PRD's full layout (`packages/x-client`, `packages/db`, agents, etc.) is the *eventual* shape — not the starting shape. We resisted that on purpose.
- **No DB, no Redis, no BullMQ yet.** A single JSON file is fine for one developer. Swap when the second user appears.
- **No comments stating the obvious.** Comments only for non-obvious *why* (cost trade-off, X policy quirk, race condition). Plan sections carry long-form prose.
- **Tests:** `bun:test` (the PRD says Vitest; we use Bun's native runner — same API).
- **No emojis** unless the user asks.

## Gotchas

- **Use Production app environment** in console.x.com, not Development — Development has a `client-forbidden` bug for some flows.
- **Hard pagination caps** that kill iteration silently: `/users/:id/tweets` 3,200; `/users/:id/mentions` 800; `/tweets/:id/retweeted_by` and `/liking_users` hard 100.
- **`search/all` is server-rate-limited to 1 req/sec** — pass `perPageSleepMs: 1100` to `paginate()`.
- **`non_public_metrics` and `organic_metrics` silently null after 30 days** on owned posts.
- **Quote-tweet of others is blocked on self-serve** (Feb 2026). Self-quotes probably allowed; verify before exposing.
- **OAuth 1.0a still required for `/2/media/upload`** as of May 2026 — we don't support media yet for that reason. Confirm before adding.

## When you grow

Pull the next thing in only when an endpoint needs it. Likely order:
1. Persistent cost log (currently `xFetch` only calls `onCost` — no DB) → SQLite via `bun:sqlite` is the smallest next step
2. Idempotency for writes (the draft-row + body-hash pattern from X plan §7.4)
3. Background metrics polling (X plan §6.9 cadence) → start with a `setInterval` in a script, not BullMQ
4. Multi-user → swap the JSON token store for SQLite and add encryption (X plan §4.4)

Promote to a monorepo with `packages/` only when you're starting on the IPSE Identity Graph or agents — i.e., when there's actually a *second* package to make.

---

*One file, one source of truth. Update this in the same commit when behavior changes.*
