# MIGRATION-PLAN.md — stratus → Next.js on Vercel (Neon retained)

> Companion to `PLAN.md` (build plan) and `CLAUDE.md` (guardrails). This is the
> **one-time migration** plan: lift the Bun + Hono service off the self-managed
> Hetzner box onto **Next.js (App Router) on Vercel**, **keeping Neon Postgres**,
> **keeping the static-bearer auth**, and adding a **web UI**. The Chrome extension
> stays as-is.
>
> Optimised for Claude Code: each task is self-contained, names exact files, ends
> with a runnable **Verify** gate and a **Commit** point. Execute top-to-bottom;
> dependencies are explicit. Do not skip a Verify.

---

## 0. Decision record (locked)

| Question | Decision | Consequence |
|---|---|---|
| Database | **Keep Neon** (no Supabase) | One-line driver tweak; transactions preserved; no PgBouncer hazard |
| Auth | **Keep static bearer** (`API_TOKEN`) | Extension unchanged; web UI gets a separate minimal login cookie |
| Backend framework | **Keep the Hono app**, mount via `hono/vercel` | All 36 routes + middleware run unchanged under one catch-all handler |
| Frontend | **New Next.js App Router web UI** | The actual new value; mirrors the extension's tabs |
| Hosting | **Vercel** (box decommissioned) | Workers become **Vercel Cron**; needs **Pro plan** |
| Extension | **Unchanged** | Only the Settings base URL flips to `https://<app>/api` |

### Why this is a good idea now (given the locked decisions)
- The code is already serverless-shaped: no websockets/streaming, no `c.var` plumbing,
  pure functions extracted, `xFetch`/OAuth on plain `fetch`+Web Crypto, and the DB
  driver is *already* `@neondatabase/serverless`.
- `hono/vercel` means the backend is a **lift, not a rewrite** — middleware, CORS,
  cost tracking, and all routes come along for free.
- Keeping Neon sidesteps the only sharp DB risk (interactive `FOR UPDATE`
  transactions in the token store + publisher claim are incompatible with PgBouncer
  transaction-mode pooling; Neon's WebSocket Pool supports them).
- Next.js justifies itself via the **web UI** requirement.

### The one real cost / constraint
- **Vercel Pro (~$20/mo) is required.** The publisher needs ~per-minute cadence;
  Vercel Cron only does sub-daily frequencies on Pro. Hobby (daily-only cron) cannot
  ship scheduled posts on time. Budget this as a hard line item.
- Cron timing on Vercel is *approximate* (fires "around" the minute, can occasionally
  skip), vs. today's self-correcting in-process timer. Acceptable because scheduled
  posts are already minute-jittered, but note it.

---

## 1. Risk register (read before starting)

| # | Risk | Mitigation | Where addressed |
|---|---|---|---|
| R1 | In-memory state lost across serverless isolates (heartbeats, mention 6/day limiter, cost-budget maps, `defaultOnCost` singleton) | Move to Postgres or set per-invocation | Phase 4 |
| R2 | Fire-and-forget cost inserts can be killed when the function freezes | `waitUntil()` (or `await`) the insert | Task 4.4 |
| R3 | `dailyMetrics` exceeds Vercel `maxDuration` on a backlog | Bound work per invocation (already resumable via invariant #7); `maxDuration: 300` | Task 3.3 |
| R4 | Publisher tick (thread w/ 500ms inter-segment sleeps + token refresh) exceeds duration | Lower `batchSize`; `maxDuration: 60`; one thread/tick | Task 3.2 |
| R5 | `.ts`-suffixed imports (138 across 36 files) break Next's bundler | Repo-wide codemod, verified by typecheck | Task 2.2 |
| R6 | Neon Pool connection churn on serverless | Module-singleton pool reused per warm isolate + `pool.on('error')` | Task 2.4 |
| R7 | Token-refresh `FOR UPDATE` must not hit a transaction pooler | Use Neon direct/pooled WebSocket URL (already the case); never route token store through a non-transactional driver | Task 2.4 |
| R8 | OAuth callback server (`bun run auth`) uses `Bun.serve` + in-memory PKCE map | Fold into Hono routes; PKCE state in a signed cookie or short-lived DB row | Phase 5 |
| R9 | CORS preflight: Next must not swallow `OPTIONS` before Hono sees it | Catch-all handler exports `OPTIONS` too; Hono `cors` runs inside | Task 2.3 |
| R10 | Secrets accidentally exposed to client (`tokens` table, `XAI_API_KEY`) | No `NEXT_PUBLIC_` on secrets; web UI reads DB only via server components/actions | Phase 6 |

---

## 2. Target repo shape

Single Next.js app at repo root. The existing `src/` becomes a **server-only library**
imported by the API handler, the cron handlers, and the web-UI server components.

```
stratus/
  app/                          # NEW — Next.js App Router
    layout.tsx, globals.css
    (ui)/                       # web UI route group (cookie-protected)
      page.tsx                  # Today / brief
      calendar/page.tsx
      metrics/page.tsx
      replies/page.tsx
      voice/page.tsx
      inbox/page.tsx
      cost/page.tsx
      login/page.tsx
    api/
      [[...route]]/route.ts     # NEW — mounts the whole Hono app via hono/vercel
      cron/
        publisher/route.ts      # NEW — Vercel Cron target (every minute)
        daily-metrics/route.ts  # NEW — Vercel Cron target (03:00 UTC)
    actions/                    # server actions for the UI (optional)
  lib/
    server/                     # thin server-only re-exports of src/ for the UI
  src/                          # EXISTING Hono backend — minimal edits
    app.ts                      # exports `app`; Bun.serve + worker bootstrap removed
    x/ ...                      # routes, workers (bodies reused by cron), client, db
    db/ ...                     # Neon client (ws swap), schema, migrations (unchanged)
    middleware/ ...             # bearer, cors, costTracker (unchanged, run under Hono)
    heartbeats.ts               # reimplemented over Postgres
  extension/                    # UNCHANGED (stays on Vite; only base URL flips at runtime)
  vercel.json                   # NEW — crons + function maxDuration
  next.config.ts, tsconfig.json # reconciled with Next
  drizzle.config.ts             # unchanged
  package.json                  # Next + scripts; Bun dev-only
```

Key invariant of this shape: **`app/api/[[...route]]/route.ts` is the only HTTP
surface for the existing API** — Hono keeps owning routing, middleware, CORS, and
cost tracking. We are not rewriting routes into the file tree.

---

## PHASE 0 — Pre-flight (no code changes)

### Task 0.1 — Snapshot & branch
- **Steps:** Create branch `migrate/vercel-nextjs`. Tag current state `pre-vercel-migration`. Confirm `bun test` and `bun run typecheck` are green on `edge` first (record any pre-existing failures so they're not blamed on the migration).
- **Verify:** `git status` clean on new branch; baseline test/typecheck output captured in the PR description.
- **Commit:** n/a (branch + tag only).

### Task 0.2 — Provision Vercel + confirm Neon reachability from Vercel
- **Steps:** Create the Vercel project (Pro plan). Confirm the **existing Neon** `DATABASE_URL` is the pooled/transaction-capable connection string (Neon's default pooled URL over the serverless driver supports transactions — keep it). Do **not** point at any non-transactional endpoint (R7). Note Neon's region; later pin Vercel functions to the nearest region.
- **Verify:** From a scratch Vercel preview (a throwaway `/api/dbping` returning `select 1`), confirm a query succeeds. Remove the scratch route after.
- **Commit:** n/a.

### Task 0.3 — Inventory env vars to move
- **Reference (from `.env.example` + `process.env.*` usage):**
  `DATABASE_URL`, `API_TOKEN`, `ALLOWED_ORIGINS`, `X_CLIENT_ID`, `X_CLIENT_SECRET`,
  `X_OAUTH_REDIRECT_URI`, `X_BEARER_TOKEN` (optional), `SELF_X_USER_ID`,
  `XAI_API_KEY`, `DAILY_METRICS_ENABLED`, `X_DAILY_BUDGET_USD`,
  `WINNER_REREAD_MIN_VIEWS`, `MENTION_API_REPLIES` (unused flag),
  plus NEW: `CRON_SECRET` (Vercel-provided), `UI_PASSWORD` + `UI_SESSION_SECRET` (web-UI login).
  **Drop:** `PORT`, `STRATUS_DEPLOY_HOST`, `GIT_SHA` file path (Vercel injects `VERCEL_GIT_COMMIT_SHA`).
- **Steps:** Add all to Vercel project env (Production + Preview). Mark every secret as server-only (never `NEXT_PUBLIC_`).
- **Verify:** `vercel env ls` shows the full set; no secret has a `NEXT_PUBLIC_` prefix.
- **Commit:** Update `.env.example` with the new vars (`CRON_SECRET`, `UI_PASSWORD`, `UI_SESSION_SECRET`) and a comment removing `PORT`/`STRATUS_DEPLOY_HOST`.

---

## PHASE 1 — Next.js skeleton alongside the Hono app

Goal: a buildable Next.js app that does **not yet** touch `src/`. Keep `bun run start`
working in parallel until Phase 7 cutover so nothing is lost.

### Task 1.1 — Install Next + adapter deps
- **Steps:** Add deps: `next`, `react`, `react-dom`, `hono` (already present), `@vercel/functions` (for `waitUntil`), `ws`, `@types/ws`. Add devdep `vitest` (Phase 8). Keep Bun as the local runtime/package manager; Next runs under Node on Vercel.
- **Verify:** `bun install` clean; `node -e "require('next/package.json')"` prints a version ≥ 15.
- **Commit:** `chore(migrate): add next, hono/vercel, ws, @vercel/functions deps`.

### Task 1.2 — `next.config.ts` + `tsconfig` reconciliation
- **Steps:**
  - Create `next.config.ts` (App Router defaults; `serverExternalPackages: ['@neondatabase/serverless', 'ws']` so the driver isn't bundled oddly).
  - Reconcile `tsconfig.json`: remove `allowImportingTsExtensions` and `noEmit`-only assumptions that conflict with Next; let Next manage `jsx`, `moduleResolution: bundler`, `plugins: [{ name: 'next' }]`. Keep `strict`. Ensure `paths` doesn't break `src/` imports.
  - Keep **Biome** for lint/format (it's runtime-agnostic). **Decline** the ESLint/`eslint-config-next` scaffold to avoid a second linter.
- **Verify:** `bunx next build` succeeds on the empty app (a placeholder `app/page.tsx` "stratus" + `app/layout.tsx`).
- **Commit:** `chore(migrate): next.config + tsconfig reconciled, biome retained`.

### Task 1.3 — `package.json` scripts
- **Steps:** Add `dev: next dev`, `build: next build`, `start: next start`. Rename the old Bun server script to `start:bun-legacy: bun run src/app.ts` (kept until cutover). Keep `db:*`, `lint`, `typecheck` (`tsc --noEmit` still valid for type-checking source). Add `test: vitest run` (wired in Phase 8; leave `test:bun: bun test` until then).
- **Verify:** `bun run dev` serves the placeholder page on `localhost:3000`.
- **Commit:** `chore(migrate): package scripts for next dev/build/start`.

---

## PHASE 2 — Mount the Hono backend under Next (the core lift)

### Task 2.1 — De-Bun the server entry (`src/app.ts`)
- **Steps:**
  - Keep the Hono app construction (middleware wiring, `mountX`, `mount` cost/healthz/grok).
  - Add `app.basePath('/api')` **or** (preferred) keep routes as-is and let the catch-all live at `app/api/[[...route]]/route.ts` with Hono unaware of the prefix — see Task 2.3 for the exact prefix strategy. Pick **one** and document it.
  - **Delete** the `if (import.meta.main) { Bun.serve(...) ; startXWorkers(); ... SIGTERM/SIGINT ... }` block. Export `app` as default + named.
  - The graceful-shutdown drain is irrelevant on serverless; the DB-layer crash-safety invariants (#5/#7) already cover abrupt termination.
- **Verify:** `bun run typecheck` passes for `src/app.ts`; grep confirms no `Bun.serve`/`startXWorkers` remain in `src/app.ts`.
- **Commit:** `refactor(migrate): src/app.ts exports Hono app, drops Bun.serve + worker bootstrap`.

### Task 2.2 — Strip `.ts` import suffixes (codemod, R5)
- **Steps:** Across `src/**` and `scripts/**` (NOT `extension/**` — it stays on Vite), rewrite relative imports `from './x.ts'` / `from '../x.ts'` → drop the `.ts`. Use a scoped codemod; do not touch `node:`/package imports. ~138 lines / 36 files.
  - Caveat: the cross-boundary shim `extension/src/replyBand.ts` imports `'../../src/shared/replyBand.ts'` (with suffix) — **leave the extension side as Vite wants it**; only change occurrences inside `src/`/`scripts/`. If `src/shared/replyBand.ts`'s *own* relative imports change, re-verify the extension build in Task 7.4.
- **Verify:** `bun run typecheck` green; `grep -rnE "from '(\.{1,2}/[^']*)\.ts'" src scripts` returns nothing.
- **Commit:** `refactor(migrate): drop .ts import suffixes in src/ and scripts/ for Next bundler`.

### Task 2.3 — Catch-all API route handler (`app/api/[[...route]]/route.ts`)
- **Steps:**
  - `import { handle } from 'hono/vercel'` and `import app from '../../../src/app'`.
  - Export `const runtime = 'nodejs'` (NOT edge — the Neon WebSocket Pool + transactions need Node).
  - Export every method the API uses **including `OPTIONS`** so Hono's CORS preflight is reached (R9): `export const GET = handle(app); export const POST = handle(app);` … and `PATCH/PUT/DELETE/OPTIONS`.
  - **Prefix strategy:** the extension currently calls `/x/...`, `/cost/...`. With the handler at `/api/[[...route]]`, requests arrive as `/api/x/...`. Set the Hono app `basePath('/api')` so its routers match. The extension then sets its base URL to `https://<app>/api` (Task 7.4) and keeps its hardcoded `/x/...` paths. Document this clearly in a header comment.
- **Verify:** `bun run dev`, then `curl -s localhost:3000/api/healthz` returns the health JSON; `curl -s -H "Authorization: Bearer $API_TOKEN" localhost:3000/api/cost/today` returns JSON; an unauthenticated `/api/x/posts/scheduled` returns 401; an `OPTIONS` with `Origin: chrome-extension://abc` returns the CORS headers.
- **Commit:** `feat(migrate): mount Hono app under /api via hono/vercel catch-all`.

### Task 2.4 — Neon driver for Node/Vercel (`src/db/client.ts`, R6/R7)
- **Steps:**
  - Replace the Bun-global WebSocket wiring with: `import ws from 'ws'; neonConfig.webSocketConstructor = ws;` (guard so it still works under Bun locally: only set when no global `WebSocket`).
  - Keep `Pool` + `drizzle-orm/neon-serverless` (transactions required by token store + publisher claim). Keep the pool a **module singleton** (reused across warm invocations) and add `pool.on('error', …)`.
  - Confirm `DATABASE_URL` is Neon's transaction-capable endpoint (R7). Add a one-line comment forbidding swapping to the HTTP `neon()` driver for the token-store/publisher paths.
- **Verify:** Hit an endpoint that does a transaction in dev (e.g. trigger a publisher tick handler in Task 3.2, or a read route), confirm no "WebSocket is not defined" and no transaction errors. `select 1` via `/api/cost/today` works.
- **Commit:** `fix(migrate): Neon serverless Pool uses ws constructor on Node, keep transactions`.

### Task 2.5 — `Bun.file` → `fs` in healthz (`src/routes/healthz.ts`)
- **Steps:** Replace `Bun.file('.git-sha').text()` with reading `process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_SHA ?? 'dev'`. The env path already wins when set; drop the file branch.
- **Verify:** `/api/healthz` returns a `gitSha` field equal to the Vercel commit SHA in a preview deploy (or `dev` locally).
- **Commit:** `fix(migrate): healthz reads git SHA from env, drops Bun.file`.

### Task 2.6 — Full endpoint smoke (all 36)
- **Steps:** With `bun run dev`, run a scripted curl pass (reuse/extend `scripts/smoke-*.ts` against `http://localhost:3000/api`) hitting each router's read endpoints and a couple of writes against a throwaway row. Confirm `XAI_API_KEY`-gated routers (`/replies`, `/posts/draft`, `/grok`, voice extract) mount when the key is present and 404 cleanly when absent.
- **Verify:** Every endpoint returns the same shape as the legacy Bun server (diff a few against the still-running `start:bun-legacy`).
- **Commit:** `test(migrate): endpoint smoke parity under /api`.

---

## PHASE 3 — Workers → Vercel Cron endpoints

The worker **bodies are already pure callable functions** (`tickPublisher(opts)`,
`runDailyMetrics(deps, opts)`). Only the schedulers (`setInterval`/`setTimeout`) are
discarded. Cron just invokes the body once per fire.

### Task 3.1 — Cron auth helper
- **Steps:** Create `src/cron/guard.ts`: verify the `Authorization: Bearer ${CRON_SECRET}` header Vercel sends to cron routes (Vercel injects `CRON_SECRET`); reject otherwise with 401. Reuse the constant-time compare from `src/middleware/auth.ts`.
- **Verify:** Unit test the guard (allow correct secret, reject wrong/missing).
- **Commit:** `feat(cron): shared CRON_SECRET guard`.

### Task 3.2 — Publisher cron (`app/api/cron/publisher/route.ts`, R4)
- **Steps:**
  - `export const runtime = 'nodejs'`, `export const maxDuration = 60`.
  - Guard with Task 3.1. Ensure `defaultOnCost` is installed (Task 4.3) before calling the worker body. Get a valid access token, call `tickPublisher({ batchSize: 3, … })` — **lower `batchSize`** so worst-case (a multi-segment thread with 500ms sleeps + token refresh) fits 60s. Return the `TickResult` as JSON.
  - Drop the in-process re-entrancy `current` promise — Vercel doesn't overlap a cron with itself, and the DB `FOR UPDATE SKIP LOCKED` claim already prevents double-publish across any concurrent manual call.
  - Stamp the publisher heartbeat (Task 4.1) at the end.
- **Verify:** Locally `curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/publisher` claims+publishes a due test row (or returns "nothing due"). Confirm a `pending` row with a future `scheduled_for` is NOT published.
- **Commit:** `feat(cron): publisher endpoint invoking tickPublisher`.

### Task 3.3 — Daily-metrics cron (`app/api/cron/daily-metrics/route.ts`, R3)
- **Steps:**
  - `runtime = 'nodejs'`, `maxDuration = 300`.
  - Guard + install `defaultOnCost`. Respect `DAILY_METRICS_ENABLED !== 'false'`.
  - Call `runDailyMetrics(deps, { … })`. **Bound work per invocation:** add/confirm a `maxSnapshotBatches` cap (the discover `maxResults` knob already exists; mirror it for `snapshotDue`). Because reads are retire-before-snapshot (invariant #7) the work is resumable — any overflow is simply caught next run. In steady state the per-day candidate set is small (everything is retired after one read), so one invocation suffices; the cap is a safety net for post-downtime backlogs.
  - There is **no boot catch-up** on serverless — delete the `runOnce()`-on-boot and `msUntilNextUtcHour` re-arm logic (now dead).
  - Stamp the dailyMetrics heartbeat.
- **Verify:** Locally invoke the endpoint; confirm it (a) writes ≤1 `account_snapshots` row/day, (b) discovers + snapshots due tweets, (c) retires before snapshotting, (d) pulls mentions. Re-invoking immediately should find nothing new (idempotent).
- **Commit:** `feat(cron): daily-metrics endpoint invoking runDailyMetrics, bounded + no boot catch-up`.

### Task 3.4 — Retire `src/x/index.ts::startXWorkers` wiring
- **Steps:** Keep `mountX(app)` (routes). Remove `startXWorkers()` and `setDefaultOnCost` from the boot path (cost install moves to Task 4.3; schedulers are gone). Keep `startPublisher`/`startDailyMetrics` source for reference or delete; the **bodies** (`tickPublisher`, `runDailyMetrics`) are the contract the crons depend on — do not change their signatures.
- **Verify:** `grep -rn "setInterval\|startXWorkers\|startPublisher\|startDailyMetrics" src app` shows only definitions, no live invocations in any served path. `bun run typecheck` green.
- **Commit:** `refactor(cron): remove in-process worker scheduling; crons own the cadence`.

---

## PHASE 4 — Relocate per-process state (serverless-safety, R1/R2)

### Task 4.1 — Heartbeats over Postgres (`src/heartbeats.ts`)
- **Steps:** Replace the in-memory `Map` with a `worker_heartbeats` table (`name text PK, last_beat_at timestamptz`). `beat(name)` upserts `now()`; `heartbeatStatus()` reads rows and computes staleness against the same thresholds (publisher >5min, dailyMetrics >25h). Add a Drizzle migration.
- **Verify:** After invoking each cron locally, `/api/healthz` reports fresh heartbeats; manually back-date a row and confirm `/api/healthz` returns 503 with `staleWorkers`.
- **Commit:** `feat(migrate): Postgres-backed worker heartbeats for serverless /healthz`.

### Task 4.2 — Mention refresh limiter over Postgres (`src/x/routes/mentions.ts`)
- **Steps:** Replace the router-closure `let limiter` (6/day backstop) with a DB-counted check: count `POST /mentions/refresh`-driven pulls in the current UTC day (e.g. a `mention_refresh_log` table, or count today's `fetched_at` distinct pulls). Enforce the cap from the DB so it holds across isolates. The panel keeps its own 4/day localStorage budget independently.
- **Verify:** Hit the refresh endpoint 7× in a script; the 7th is rejected with the over-budget response.
- **Commit:** `fix(migrate): mention refresh cap enforced in Postgres, not process memory`.

### Task 4.3 — `defaultOnCost` installed per-isolate (`src/x/cost-boot.ts` new)
- **Steps:** Create a tiny module whose top-level code calls `setDefaultOnCost(makeOnCost('x', { dailyBudgetUsd: Number(process.env.X_DAILY_BUDGET_USD ?? 0.15) }))`. Import it from: the catch-all API handler, the publisher cron, and the daily-metrics cron. Module top-level runs once per isolate — cheap and correct. (Alternatively pass `onCost` explicitly into the worker bodies; module-install is less invasive.)
- **Verify:** Trigger a billed X read (mentions refresh) and confirm a `cost_events` row lands with the correct platform/price.
- **Commit:** `fix(migrate): install defaultOnCost per isolate for API + cron`.

### Task 4.4 — Make cost inserts survive function freeze (`src/middleware/costTracker.ts`, R2)
- **Steps:** Replace the fire-and-forget `.execute().then().catch()` with `waitUntil(insertPromise)` from `@vercel/functions` when running on Vercel (fallback to `await` locally/Bun). This guarantees the insert completes before the isolate is frozen. Keep the `console.warn` on $0-priced billed calls. The `dailyBudgets` Map + watchdog: derive the daily budget from env per request (no cross-invocation memory) — read today's spend from `cost_events` when `/cost/today` needs the `overBudget` flag rather than from an in-memory accumulator.
- **Verify:** Under a preview deploy, fire a couple of billed calls and confirm every one produces a `cost_events` row (no drops). `/api/cost/today` reflects them.
- **Commit:** `fix(migrate): cost_events insert via waitUntil; budget state read from DB`.

---

## PHASE 5 — OAuth setup flow as routes (R8)

The `bun run auth` standalone `Bun.serve` (PKCE start/callback/disconnect) must move
online so token setup works without the box.

### Task 5.1 — Fold OAuth into the Hono app
- **Steps:** Add a Hono sub-router (mounted under `/api/auth/x`) with `start`, `callback`, `disconnect` reusing `src/x/auth.ts` (PKCE gen, authorize URL, code exchange) and `src/x/token-store.ts::writeStore`. Replace the in-memory `state→verifier` Map with **a signed, httpOnly cookie** (or a short-lived `oauth_pkce` DB row keyed by `state`, deleted on callback) — serverless has no shared memory between the start and callback invocations.
- **Steps (config):** Update `X_OAUTH_REDIRECT_URI` to `https://<app>/api/auth/x/callback` and register it in the X app (console.x.com, **Production** environment per the CLAUDE.md gotcha). Keep a `127.0.0.1` variant for `vercel dev` if needed.
- **Verify:** In a preview deploy, run the full connect flow end-to-end; confirm the `tokens` row (`id='default'`) is written and `/api/x/...` calls succeed afterward. Re-confirm invariant #3: the rotated refresh token is persisted before the access token is returned (unchanged logic, just new transport).
- **Commit:** `feat(migrate): OAuth PKCE setup as /api/auth/x routes with cookie/DB state`.

### Task 5.2 — Retire `src/x/server.ts` (`bun run auth`)
- **Steps:** Delete or mark deprecated the standalone `Bun.serve` OAuth server and its npm script. The Hono routes from 5.1 replace it.
- **Verify:** `grep -rn "Bun.serve" src` returns nothing.
- **Commit:** `chore(migrate): remove standalone Bun.serve OAuth server`.

---

## PHASE 6 — Web UI (the new value)

Mirror the extension's side-panel tabs as Next.js pages. **Read the DB directly from
server components** (no HTTP hop, no bearer in the browser); use server actions for
writes. Protect the whole `(ui)` route group with a minimal cookie login (single user).

### Task 6.1 — Minimal UI auth (cookie login)
- **Steps:** `app/(ui)/login/page.tsx` posts a password to a server action comparing against `UI_PASSWORD` (constant-time); on success set a signed httpOnly session cookie (HMAC with `UI_SESSION_SECRET`). A `middleware.ts` (matcher: `/(ui)` paths, excluding `/login` and `/api`) redirects unauthenticated users to `/login`. This is **separate** from the API's `API_TOKEN` bearer (which the extension keeps using).
- **Verify:** Visiting `/` unauthenticated redirects to `/login`; correct password grants access; cookie tampering is rejected.
- **Commit:** `feat(ui): cookie-based single-user login gate`.

### Task 6.2 — `lib/server/` data accessors
- **Steps:** Create server-only modules that wrap the same queries the routes use (reuse the **pure builders** already exported: `buildBestTimes`, `aggregatePillars`, `buildAccountSeries`, `buildReplyOutcomes`, brief helpers, `rankTargets`, etc.). Mark them server-only (`import 'server-only'`). No secret ever reaches a client component.
- **Verify:** A server component calling `getBrief()` renders without leaking env.
- **Commit:** `feat(ui): server-only data accessors reusing pure builders`.

### Task 6.3 — Pages (one task each; ship incrementally)
Build in this order, each behind the login gate, each a `(ui)` page + any server actions:
1. **Today** (`/`) — the `/x/brief` payload: follower delta/sparkline, yesterday's posts/replies, profile-click leaders, today's slots + cadence gaps, reply quota, 70/30 ratio, today's spend, Radar/Inbox/Targets sections. **Commit per section** if large.
2. **Calendar + Composer** (`/calendar`) — list/create/edit/delete scheduled posts + threads + drafter (`/x/posts/draft`), reusing the URL-surcharge guard server-side.
3. **Metrics** (`/metrics`) — replies/posts performance, account series, best-times grid, pillars.
4. **Replies** (`/replies`) — generate (band-gated), variants picker, outcomes.
5. **Voice/Targets** (`/voice`) — saved tweets, template chips/extract, targets roster.
6. **Inbox** (`/inbox`) — mentions, one-click Grok draft.
7. **Cost** (`/cost`) — `/cost/today` + `/cost/daily` charts.
- **Verify (each):** Page renders real data from Neon; writes round-trip; no client bundle contains `XAI_API_KEY`/tokens (inspect the built chunks).
- **Commit:** `feat(ui): <tab> page` per page.

### Task 6.4 — Design pass
- **Steps:** Apply a coherent dark theme (the extension's aesthetic) via `globals.css`/Tailwind if added. Keep it utilitarian — this is a personal dashboard.
- **Verify:** `bunx next build` clean; Lighthouse not required.
- **Commit:** `style(ui): dashboard theme`.

---

## PHASE 7 — Deploy config & migrations runner

### Task 7.1 — `vercel.json` (crons + durations)
- **Steps:**
```json
{
  "crons": [
    { "path": "/api/cron/publisher", "schedule": "* * * * *" },
    { "path": "/api/cron/daily-metrics", "schedule": "0 3 * * *" }
  ],
  "functions": {
    "app/api/cron/daily-metrics/route.ts": { "maxDuration": 300 },
    "app/api/cron/publisher/route.ts": { "maxDuration": 60 }
  }
}
```
  Pin the region near Neon (project settings) to cut DB latency.
- **Verify:** `vercel deploy` (preview) lists both crons in the dashboard; the per-minute publisher cron is accepted (Pro plan).
- **Commit:** `chore(deploy): vercel.json crons + function maxDuration`.

### Task 7.2 — Migrations against Neon
- **Steps:** Migrations stay `drizzle-kit migrate` (the 9 existing files + the new ones from Tasks 4.1/4.2/5.1 are standard Postgres). Vercel does **not** run migrations for you. Choose: (a) a CI step (GitHub Action) that runs `drizzle-kit migrate` against `DATABASE_URL` on merge to `main`, or (b) a documented manual `bun run db:migrate` pre-deploy. Add a guard so a deploy never goes out ahead of its migrations. Update `deploy.sh` → delete (box-specific) or repurpose as the migrate-only script.
- **Verify:** Fresh Neon branch + `drizzle-kit migrate` applies all migrations cleanly; the new tables (`worker_heartbeats`, mention-refresh log, oauth state if used) exist.
- **Commit:** `chore(deploy): migrations runner for Vercel (CI or pre-deploy), drop systemd deploy.sh`.

### Task 7.3 — Healthcheck / monitoring
- **Steps:** Keep `/api/healthz` (now Postgres-heartbeat-backed). Add a Vercel monitor or an external uptime ping hitting `/api/healthz` so a stale worker still pages you (replacing the old `curl -f` gate). Note: with cron-driven workers, "stale" means a cron stopped firing — `/api/healthz` 503 still catches it.
- **Verify:** Disable the publisher cron temporarily; after the 5-min threshold `/api/healthz` returns 503.
- **Commit:** `feat(deploy): healthz monitoring for cron-driven workers`.

### Task 7.4 — Extension cutover (config only)
- **Steps:** In the extension Settings, set base URL to `https://<app>/api` (matches the `basePath('/api')` from Task 2.3). Update `extension/public/manifest.json` `host_permissions` to add the new Vercel origin (keep `127.0.0.1`/`localhost` for local). Rebuild (`npm run build` in `extension/`) and reload unpacked. **No source/path changes** — the hardcoded `/x/...` paths now resolve under `/api`.
- **Verify:** From the extension: load Today tab (brief), schedule a test post, confirm it publishes via the publisher cron within ~1–2 min, save a voice tweet, generate a reply. Confirm CORS preflight passes from `chrome-extension://…`.
- **Commit:** `chore(extension): point at Vercel /api, update host_permissions`.

---

## PHASE 8 — Tests, parity, decommission

### Task 8.1 — `bun:test` → Vitest
- **Steps:** Add `vitest.config.ts`. Swap imports `from 'bun:test'` → `from 'vitest'` in the 5 test files (`src/app.test.ts`, `src/test.test.ts`, `src/shared/replyBand.test.ts`, `extension/src/shared/radar.test.ts`, `extension/src/shared/metricsAria.test.ts`). Replace the two `Bun.file(new URL('../reply prompt.md', import.meta.url)).text()` reads in `src/test.test.ts` with `fs.readFile`. The `describe/expect/test` API matches, so most is a one-line swap. (Extension tests can run under Vitest too, independent of the Next build.)
- **Verify:** `bun run test` (vitest) green; all prompt-sync and pure-function suites pass.
- **Commit:** `test(migrate): port bun:test suites to vitest`.

### Task 8.2 — CI pipeline
- **Steps:** GitHub Action: `bun install` → `bunx tsc --noEmit` → `bunx vitest run` → `bunx next build`. Block merge on red. Optionally the migrations step (7.2).
- **Verify:** A PR runs the pipeline green.
- **Commit:** `ci(migrate): typecheck + vitest + next build gate`.

### Task 8.3 — Parity soak (run both in parallel for a few days)
- **Steps:** Keep the Hetzner box running (read-only / publisher disabled there to avoid double-publish — **only one** publisher may own the schedule) while the Vercel deploy takes over publishing. Watch: posts ship on time, daily metrics snapshot at 03:00 UTC, costs tracked, no double-posts (the `FOR UPDATE SKIP LOCKED` claim guarantees this even if both ran, but disable one to be safe).
- **Verify:** 3 consecutive days: scheduled posts published within tolerance, `account_snapshots` gets one row/day, `cost_events` matches expectations, `/api/healthz` green.
- **Commit:** n/a (observation; record results in the PR).

### Task 8.4 — Decommission the box
- **Steps:** After soak passes: stop `stratus.service`, archive the box's `.env` (X creds, token row already in Neon — confirm the live `tokens` row works from Vercel first), remove the systemd unit, delete `deploy.sh`/`STRATUS_DEPLOY_HOST` references, retire the duckdns host or repoint DNS. Remove `start:bun-legacy` and any now-dead worker-scheduler code.
- **Verify:** Box is off; everything runs from Vercel for a full day including the 03:00 UTC pass.
- **Commit:** `chore(migrate): decommission Hetzner box, remove legacy Bun server path`.

### Task 8.5 — Docs sync
- **Steps:** Update `CLAUDE.md` (stack, deploy, workers→cron, env), `PLAN.md`, `README`, and `.claude/skills/stratus` (base URL default → Vercel). Note the Vercel Pro requirement and the cron-timing caveat. Update the memory pointer in `MEMORY.md`.
- **Verify:** A fresh read of `CLAUDE.md` accurately describes the Vercel/Neon/cron architecture.
- **Commit:** `docs(migrate): sync CLAUDE.md/PLAN.md/README/skill for Vercel architecture`.

---

## Appendix A — What explicitly does NOT change
- Neon Postgres, the Drizzle schema, and all 9 existing migrations.
- The static-bearer `API_TOKEN` auth contract (extension unchanged but for base URL).
- `xFetch` (the single X call-site, invariant #4), pricing, error parsing.
- Token rotation atomicity (invariant #3) — same transaction, new transport.
- Retire-before-snapshot / claim-before-call money invariants (#5, #7) — the worker
  **bodies** are reused verbatim; only their schedulers change.
- All cost-cheat-sheet pricing and budgets.
- The Chrome extension's React/Vite/MV3 build.

## Appendix B — Effort & sequencing summary
| Phase | Theme | Risk | Rough size |
|---|---|---|---|
| 0 | Pre-flight, Vercel/Neon, env | low | S |
| 1 | Next skeleton | low | S |
| 2 | **Hono lift under /api** (core) | med | M |
| 3 | Workers → cron | med | M |
| 4 | De-memory state | med | M |
| 5 | OAuth as routes | med | S–M |
| 6 | **Web UI** (the new value) | low-med | L |
| 7 | Deploy config + extension cutover | low | S–M |
| 8 | Tests, soak, decommission | low | M |

Critical path to a working backend on Vercel: **Phases 2 → 3 → 4 → 7.1/7.2**. The web
UI (Phase 6) is independent of the backend lift and can proceed in parallel once
Phase 2 is green. Do **not** decommission the box (8.4) until the soak (8.3) passes.

## Appendix C — Hard gotchas (carry-overs from CLAUDE.md still in force)
- Register the OAuth redirect in the X **Production** app environment, not Development.
- Never disable the URL-surcharge guard ($0.20 vs $0.015) to make a test pass.
- Self-serve reply restriction + `selfXUserId` checks are unchanged — keep them.
- Cron is the **only** publisher in production — running the box's publisher
  simultaneously risks contention (mitigated by `SKIP LOCKED`, but disable one).
