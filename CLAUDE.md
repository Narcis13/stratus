# CLAUDE.md — Session orientation for `stratus`

> Read this first, every session. This file is the guardrails; everything else is a pointer.

## What this is

A single-user service (one human, one bearer token) that does four things on top of a thin typed wrapper over X API v2:

1. **Schedule posts a week ahead** (calendar + 60 s publisher worker).
2. **Track metrics over time** on every published post (daily 03:00 UTC once-only snapshot pass).
3. **Voice library** — stash other people's tweets via $0 DOM scrape for style analysis.
4. **Circles — the people layer**: CRM stages, conversations/open loops, relationship-aware drafting, the Playbook, warmth.

Hard scope ceiling: if a feature isn't in service of those four, it doesn't get built.

Runtime: Bun + Hono server on Hetzner (systemd `stratus.service`, deployed via `scripts/deploy.sh`) + a Chrome MV3 side-panel extension (`extension/`, Vite + React, loaded unpacked). AI drafting via xAI Grok and OpenRouter through the `askLLM` dispatcher. An MCP server (`POST /mcp`) and a read-only DB explorer (`/explorer`) ride on the same process.

## Where knowledge lives (read the map, not the repo)

- **`.claude/skills/plan-feature/references/codemap.md`** — the pre-computed current-state index: every file, route, table, worker, extension surface, pattern (§7–8 = invariants/traps), smoke script. **Read this instead of scanning the repo.** Any commit that changes structure updates the touched sections + header stamp in the same commit.
- **`plans/MASTERPLAN.md`** + **`.claude/skills/masterplan/STATE.md`** — the unified execution order for the 12 active feature plans (`plans/2026-*.md`) and its live state (ledger, deviations D1+, gotchas, hot-file locks). Driven by the `/masterplan` skill: one task per session.
- **`PLAN.md`** / **`CIRCLES-PLAN.md`** / **`SURFACES-PLAN.md`** — canonical build plans for goals 1–3, goal 4 (C0–C10), and the S-phases. All shipped phases are ✓ there.
- **`docs/PHASE-HISTORY.md`** — the full chronological ledger of every shipped phase ("what shipped and why"). **Docs-sync tasks append their phase entry there, not here.**
- **`X-API-IMPLEMENTATION-PLAN.md`** — reference-only X API spec (endpoint semantics, pricing, policy quirks). Never a build plan.
- **`docs/`** — one .md per extension tab / surface; update the matching file when a tab changes.
- **`IPSE-Implementation-PRD.md`** — the eventual big product. Out of scope; never pull patterns from it preemptively.

## Workflow

- Feature work flows through **`/masterplan`** (one task per session, codemap-first, STATE.md updated in the task's commit) and **`/plan-feature`** for new plans. Don't re-scan the repo for orientation — the codemap is the time-saving mechanism; a stale one poisons the next session.
- **Standing verification bar for every task:** `bun test` + `bun run typecheck` + `bun run lint` green; extension-touching tasks also `cd extension && bun run build`; run the task's smoke script (`scripts/smoke-*.ts`) when its plan says so. Never report a task done with red gates.
- **Prompt byte-sync:** `post prompt.md` / `reply prompt.md` / `thread prompt.md` are embedded verbatim as TS literals (`POST_PROMPT_TEMPLATE` etc.), asserted byte-identical by bun:test — edit the .md and the literal together. Server-stamped injections (relationship, guidance, me, pillars) are appended in code at the variable tail, never client-supplied.
- Update this file only when a **guardrail** changes; phase entries go to `docs/PHASE-HISTORY.md`, structural detail to the codemap.

## Stack

- Bun ≥ 1.1, TypeScript strict (`allowImportingTsExtensions`, `noEmit`), native `fetch`/`Bun.serve`/`bun:test`, Biome for lint/format.
- **State: local SQLite via `bun:sqlite`** + Drizzle ORM (`sqlite-core`), auto-migrated at boot. The driver is **synchronous**: DB transactions take sync callbacks (`.all()`/`.get()`/`.run()`, no `await` inside) and you can't bind a JS `Date` in a raw `` sql`` `` template (use `.getTime()`). `bun test` runs against `SQLITE_PATH=:memory:`.
- Migrations: `bun run db:generate` against the current journal, then **inspect the SQL** — drizzle-kit drops seed INSERTs (codemap §4). Migration-generating work never runs in parallel sessions (journal conflicts).
- In-process `setInterval` workers (no Redis/BullMQ); worker heartbeats surface in `/healthz`.

## Repo shape

Per-platform vertical slices — X code lives under `src/x/`; a future platform gets a sibling folder that never reaches into it; only the thin top layer (`src/app.ts`, `src/middleware/`, `src/db/`, `src/routes/`, `src/llm/`, `src/mcp.ts`) knows about more than one platform.

```
src/
  app.ts             Hono app — mounts platform routers + /mcp, shared middleware, workers, SIGTERM drain
  middleware/        bearer auth, CORS (chrome-extension://*), costTracker (platform-tagged cost_events)
  db/                bun:sqlite + Drizzle singletons, shared-schema.ts, migrations/
  llm/               askLLM dispatcher (grok vs openrouter), AI settings, /llm routes
  grok/  openrouter/ one client per provider (askGrok / generateImages / askOpenRouter)
  shared/            pure modules shared with the extension build (replyBand, channelSuggest, …)
  x/                 everything X: auth/token-store/client(xFetch)/endpoints/pricing,
                     db/schema.ts, routes/, workers/ (publisher, dailyMetrics),
                     people/, replies/, posts/, playbook.ts, mcp.ts
                     index.ts — mountX(app) + startXWorkers(); the only outside caller is app.ts
extension/           Chrome MV3 side panel (own package.json): sidepanel/ tabs, content.ts,
                     background.ts (single writer of session buffers), shared/ pure cores, studio/
```

Authoritative source for what's actually wired: `src/x/index.ts` (`mountX` + `startXWorkers`) and codemap §3–5.

## Non-negotiable invariants

These have already cost real money or locked users out. Memorize before changing code. (Extended set: codemap §7–8.)

### 1. URL surcharge: $0.20 vs $0.015 (13× cost)
A post whose `text` matches `/(^|\s)https?:\/\//i` bills at $0.20, not $0.015. `createPost` blocks unless `allowUrlSurcharge: true`. Don't disable the guard to make a test pass; move the URL to a reply (link-in-first-reply).

### 2. Programmatic-reply restriction (Feb 2026)
Self-replies (own threads) always work. Replying to others via `in_reply_to_tweet_id` is **blocked on self-serve tiers** unless the author @-mentioned or quoted the app. `createPost` requires `selfXUserId`; all reply drafting ends in a manual paste, never an API reply.

### 3. Token rotation atomicity
X rotates the **refresh token on every refresh**; losing the new one locks the account out permanently. `token-store.ts::getValidAccessToken` persists the rotated token *before* returning the access token, serialized by an in-process promise-chain mutex (sync SQLite can't hold a lock across the HTTP refresh). Never reorder this. Single-process only.

### 4. One place to call X
Every X call goes through `xFetch` (`src/x/client.ts`) — retries, error parsing, rate-limit headers, `onCost` live there. No direct `fetch('https://api.x.com/...')` anywhere else. Same discipline per LLM provider: `askGrok` / `askOpenRouter` / `generateImages`, dispatched via `askLLM`.

### 5. `maxItems` does NOT cap cost — `max_results` does
X bills every result in the response body, not what your JS iterates. Clamp the URL's per-request page size to the caller's intent (see `searchRecent` for the pattern). Already burned $0.49 on a "3-result" search.

### 6. Cost middleware dispatches by platform
`cost_events` rows carry a `platform` column (`'x'`, `'grok'`, `'xai'`, `'openrouter'`); the shared middleware selects the price table by platform. Never hardcode X assumptions into shared layers.

### 7. A billed read must be unrepeatable — retire before you snapshot
`xFetch.onCost` bills the moment a response returns, even if the DB write after it fails. Take rows out of the candidate set (retire/claim in a committed txn) *before* the billed call. Getting this backwards once cost **$3.71 reading one tweet 3,712 times**. Trade-off is at-most-once, never double-billed.

Related standing rules: **refuse before spend** (validation/404/422/gates fire before any paid call); **a side-hook failure never fails the paying path** (`safeLog…`/`persist…` are best-effort); **nothing DOM-scraped ever writes the `mentions` table** (its max tweet_id IS the since_id checkpoint).

## Cost cheat sheet (Apr 2026 prices, USD)

| Surface | Cost | Notes |
|---|---|---|
| Own post / mention / like / followers read | $0.001 | 24h UTC dedup |
| Other-user post read, search results | $0.005 | why the voice library is DOM-scrape, not API |
| Third-party user lookup | $0.010 | |
| Post create (no URL) | $0.015 | |
| **Post create (URL in text)** | **$0.20** | ⚠️ guard in createPost |
| Like / Repost / Bookmark write | $0.015 | Delete $0.010 |

Steady state: ~$0.001/day account KPI + $0.001/tweet once-only snapshots + ~$0.01–0.03/day mentions + ≤$0.005/day winner re-reads. LLM drafting is per-click (~$0.002–0.01/call), image generation ~$0.02/image behind a hard daily budget. `/cost/today` + `/cost/daily` are the dashboards; budget watchdogs via `X_DAILY_BUDGET_USD` etc.

## Common commands

```bash
bun install
bun run auth           # OAuth server on http://127.0.0.1:3000 (use 127.0.0.1, not localhost)
bun test               # unit tests (in-memory SQLite)
bun run typecheck      # tsc --noEmit
bun run lint           # biome check
bun run db:generate    # drizzle-kit — then inspect the emitted SQL
cd extension && bun run build
bun scripts/smoke-<area>.ts   # rerunnable $0 checks; --live flags add one paid call
./deploy.sh            # host from arg/STRATUS_DEPLOY_HOST; runs migrations before restart
```

## Working style

- **One task per session** via `/masterplan`; add one endpoint at a time when something actually needs it — don't pre-stub API surface.
- **Per-platform isolation is load-bearing.** New X code under `src/x/`; cross-platform infra in the top-level shared layer only.
- **In-process workers, not a queue.** Don't reach for Redis/BullMQ unless something actually breaks at one process.
- Comments only for non-obvious *why* (cost trade-off, X policy quirk, race). No emojis unless asked.
- Thresholds ship as opening guesses (stage ladder, BAND, humanizer odds…) — recalibrate only at the stated sample sizes (e.g. BAND at ≥100 measured), never by vibes.

## Gotchas

- console.x.com: use the **Production** app environment (Development has a `client-forbidden` bug).
- Hard pagination caps: user tweets 3,200; mentions 800; retweeted_by/liking_users 100. `search/all` is 1 req/s (`perPageSleepMs: 1100`).
- `non_public_metrics`/`organic_metrics` silently null after 30 days on owned posts — the daily pass snapshots well inside that window; don't extend cadences past it.
- Quote-of-others blocked on self-serve; self-quotes go through `verifiedSelfQuote`. Media upload still requires OAuth 1.0a — no API media; images are pasted manually.
- X DOM selectors in `content.ts` drift — pure parsing cores live in `extension/src/shared/` and are fixture-tested; `content.ts` itself is browser-verified by convention, not unit-tested.

## Explicitly out of scope (v1)

API replies to non-self tweets; cross-account quote tweets; API media upload; follower/mute/block sync; multi-tenant auth; Chrome Web Store publishing; per-tier budget caps. If one becomes necessary, lift the relevant section from `X-API-IMPLEMENTATION-PLAN.md` *then*.

---

*Guardrails only. Phase history → `docs/PHASE-HISTORY.md`. Current structure → the codemap. Update the right file in the same commit as the behavior change.*
