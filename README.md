# stratus

Thin typed wrapper over X API v2. Bun + TypeScript, single package, no monorepo, no DB.

Reference docs in this folder:
- [`X-API-IMPLEMENTATION-PLAN.md`](./X-API-IMPLEMENTATION-PLAN.md) — endpoint costs, auth flow, gotchas
- [`IPSE-Implementation-PRD.md`](./IPSE-Implementation-PRD.md) — the eventual full product (out of scope here)
- [`CLAUDE.md`](./CLAUDE.md) — read first when working in this repo

## Quickstart

```bash
cp .env.example .env          # then fill in X_CLIENT_ID / X_CLIENT_SECRET from console.x.com
bun install

# 1. start the auth server, open the URL it prints, click Authorize
bun run auth

# 2. now .tokens.json exists; run example calls
bun run play
```

Use `127.0.0.1` (not `localhost`) for the OAuth redirect URI — X's allowlist treats them as different.

## Layout

```
src/
  auth.ts          PKCE pair, authorize URL, token exchange, refresh, scopes
  token-store.ts   read/write .tokens.json; refresh-with-rotation invariant
  client.ts        xFetch() — typed fetch with bearer auth + retry
  fields.ts        field selection defaults
  errors.ts        XApiError + classify
  pagination.ts    paginate(next_token)
  endpoints.ts     getMe, getTweet, searchRecent, createPost, deletePost
  server.ts        Bun.serve OAuth callback (single-user dev tool)
  playground.ts    `bun run play` — example calls
  test.test.ts     unit tests for the pure-function bits
```

## Adding an endpoint

1. Add a typed wrapper in `src/endpoints.ts` that calls `xFetch`.
2. Note the cost in a comment above it (X plan §14).
3. If it's a write, think about which pre-flight guards apply (URL surcharge, reply restriction, length).
4. If it paginates, use `paginate()` from `src/pagination.ts`.
