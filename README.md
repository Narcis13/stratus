# Stratus

> A single-operator, deploy-anywhere control plane for growing on **X (Twitter)** — built on a thin, typed, cost-aware wrapper over **X API v2** and **xAI's Grok**, with a Chrome side-panel cockpit and a fleet of in-process workers.

Stratus is not a SaaS. It is **one person's growth machine** — mine — engineered the way a solo builder engineers their own tools: lean, observable, and ruthless about cost. It does three things, and only three things:

1. **Schedules posts a week ahead** — a calendar plus a 60-second publisher worker that posts at minute-jittered times so the feed never looks like a cron job.
2. **Tracks metrics over time** on every tweet you publish — through the scheduler *or* manually from the X app — via a daily reconcile pass plus a decaying polling cadence that retires each tweet after 30 days.
3. **Stashes other people's tweets** (a "voice library") for style and structure analysis, with strict per-author cost guardrails.

On top of those three pillars sit two force-multipliers built later: a **Grok-backed Reply Master** that drafts high-signal replies (the single highest-leverage growth activity for a small account), and a **Chrome MV3 extension** that turns x.com itself into the cockpit — one-click tweet stashing, one-click reply drafting, and a full scheduling UI.

**Hard scope ceiling:** if a feature is not in service of those goals, it does not get built. This README documents exactly what *is* built, down to the column types and the retry backoff curves, and then — wearing the hat of an X growth strategist — lays out where this machine should go next.

---

## Table of contents

- [1. Philosophy & who this is for](#1-philosophy--who-this-is-for)
- [2. The three goals (and the scope ceiling)](#2-the-three-goals-and-the-scope-ceiling)
- [3. Architecture at a glance](#3-architecture-at-a-glance)
- [4. Technology stack](#4-technology-stack)
- [5. Repository map](#5-repository-map)
- [6. Getting started — the 20-minute path](#6-getting-started--the-20-minute-path)
  - [6.1 Prerequisites](#61-prerequisites)
  - [6.2 Clone, install, and the env file](#62-clone-install-and-the-env-file)
  - [6.3 Create your X app (console.x.com)](#63-create-your-x-app-consolexcom)
  - [6.4 Provision the database (Neon + Drizzle)](#64-provision-the-database-neon--drizzle)
  - [6.5 Connect your X account (OAuth)](#65-connect-your-x-account-oauth)
  - [6.6 Run the service](#66-run-the-service)
  - [6.7 First smoke test](#67-first-smoke-test)
- [7. Configuration reference (every environment variable)](#7-configuration-reference-every-environment-variable)
- [8. The cost model — read this before you touch anything](#8-the-cost-model--read-this-before-you-touch-anything)
- [9. The six non-negotiable invariants](#9-the-six-non-negotiable-invariants)
- [10. The X primitive layer](#10-the-x-primitive-layer)
- [11. HTTP API reference](#11-http-api-reference)
- [12. The background workers](#12-the-background-workers)
- [13. Database schema — full specification](#13-database-schema--full-specification)
- [14. The Grok (xAI) integration](#14-the-grok-xai-integration)
- [15. The Reply Master system](#15-the-reply-master-system)
- [16. The voice library](#16-the-voice-library)
- [17. The Chrome extension](#17-the-chrome-extension)
- [18. The operator skill & scheduling scripts](#18-the-operator-skill--scheduling-scripts)
- [19. Testing](#19-testing)
- [20. Deployment](#20-deployment)
- [21. Operations & day-2 runbook](#21-operations--day-2-runbook)
- [22. Troubleshooting](#22-troubleshooting)
- [23. Security model](#23-security-model)
- [24. Phase status & roadmap](#24-phase-status--roadmap)
- [25. X growth strategy — the coach's playbook](#25-x-growth-strategy--the-coachs-playbook)
- [26. Future enhancement plan](#26-future-enhancement-plan)
- [27. Glossary](#27-glossary)
- [28. FAQ](#28-faq)
- [29. Credits & license](#29-credits--license)

---

## 1. Philosophy & who this is for

Stratus is built by and for **the relentless solo builder** — the person who would rather engineer a tool than rent one, who treats their own attention and their own API bill as scarce resources, and who is playing a long game on X without chasing virality.

The operator behind this codebase is **[@13_narcissus](https://x.com/13_narcissus)**, whose bio reads:

> *"I help myself to evade the 9-5 crafting my own tools. The only way to lose is to quit!"*

That single sentence is the design brief for the whole repository. Every decision in Stratus reflects it:

- **Tool-first independence.** No managed scheduler, no third-party analytics SaaS, no growth-hacking dashboard. You own the queue, the metrics history, and the wallet.
- **Cost-consciousness as a first-class concern.** X API v2 bills per call — sometimes per *result*. A naive integration can burn real money in a single loop. Stratus treats cost as a load-bearing invariant, not an afterthought: there is a single chokepoint that prices every call, a Postgres ledger that records every cent, and hard guards that refuse the expensive mistakes (see [§8](#8-the-cost-model--read-this-before-you-touch-anything)).
- **Pareto prioritization.** The codebase is small on purpose. Five workers, not a queue cluster. One bearer token, not multi-tenant auth. `setInterval`, not Redis + BullMQ. The 20% of infrastructure that delivers 80% of the outcome.
- **Build-in-public, zero fluff.** Stratus *is itself* a content pillar — the worked example of a lean tool that controls real costs. The voice it speaks in (in its Grok prompts, in its reply drafts) is the operator's voice: truth-seeking, lightly contrarian, useful before clever.

If you are an indie hacker, a build-in-public creator, or a cost-aware engineer who wants a self-hosted growth cockpit you can read end-to-end in an afternoon and trust with your API key — this is for you. If you want a turnkey multi-account social suite, this is emphatically *not* for you, and that is by design.

---

## 2. The three goals (and the scope ceiling)

Everything in Stratus exists to serve one of these three jobs:

### Goal 1 — Schedule posts a week ahead
A calendar of drafted and queued tweets lives in Postgres (`scheduled_posts`). A `publisher` worker wakes every 60 seconds, finds the posts whose scheduled minute has arrived, and posts them to X. Times are **minute-jittered** (anchors at human hours, random minutes in `[5, 35]`) so the account never posts at a robotic `:00`/`:30`.

### Goal 2 — Track metrics over time
Every tweet you actually publish — whether through Stratus or by hand in the X app — becomes a row in `posts_published`. A daily `ownReconcile` pass discovers tweets you posted manually; a `metricsPoll` worker samples each tweet's metrics on a **decaying cadence** (every 5 minutes when fresh, every 24 hours after a week, retired at 30 days), appending an immutable time-series to `metrics_snapshots`. You get a real performance history, not just a snapshot.

### Goal 3 — Stash other people's tweets (the voice library)
Authors you want to learn from go into `tracked_authors`; their tweets are mirrored into `voice_tweets` (via the API or via one-click extension scraping), and — optionally, behind a cost gate — their public metrics are tracked over a 7-day window. This is your private corpus for studying *what actually works* in your niche, structurally and stylistically.

### The two force-multipliers (built on top)
- **Reply Master** — Grok drafts a high-signal reply to any tweet you're looking at; you edit, copy, post manually, and record the result. Replies are the highest-ROI growth lever for a small account, and this is the tool that industrializes them. (See [§15](#15-the-reply-master-system).)
- **The Chrome extension** — a side-panel cockpit plus in-page buttons on x.com. (See [§17](#17-the-chrome-extension).)

### Explicitly out of scope (v1)
These are *deliberately not built*. Do not "helpfully" add them:

- Replies to non-self tweets and cross-account quote tweets (blocked by X's Feb 2026 programmatic-reply policy).
- Media uploads (requires OAuth 1.0a for `/2/media/upload` as of May 2026 — not worth the complexity for solo use).
- Follower / mute / block sync (not one of the three goals).
- An idempotency draft-row pattern (single-user, low write volume; the reconcile pass catches any drift).
- Multi-tenant auth (one user, one shared bearer token).
- Publishing the extension to the Chrome Web Store (it loads unpacked from your local clone).
- Per-tier budget caps (one wallet; the cost dashboard *is* the cap).

If one of these ever becomes genuinely necessary, the relevant section gets lifted from `X-API-IMPLEMENTATION-PLAN.md` *then* — not preemptively.

---

## 3. Architecture at a glance

Stratus is a single Bun process exposing a Hono HTTP API, fronted (in production) by Caddy for HTTPS, talking to a Neon Postgres database, with five `setInterval` workers running in-process. A Chrome MV3 extension is the primary human interface. An optional Grok integration powers reply drafting.

```
                       ┌────────────────────────────────────────────────────┐
                       │                  Chrome MV3 extension                │
                       │  ┌────────────┐         ┌────────────────────────┐  │
   x.com / twitter.com │  │ side panel │         │  content script (x.com)│  │
   ────────────────────┼──┤ (React 19) │         │  "Save to stratus" +   │  │
                       │  │ Calendar / │         │  "🪄 Reply Master"     │  │
                       │  │ Composer / │         │  buttons, DOM scraping │  │
                       │  │ Drafts /   │         └───────────┬────────────┘  │
                       │  │ Voice /    │                     │ messages       │
                       │  │ Replies /  │         ┌───────────▼────────────┐  │
                       │  │ Settings   │         │  background worker      │  │
                       │  └─────┬──────┘         │  (single auth chokepoint)│ │
                       │        │ direct fetch    └───────────┬────────────┘  │
                       └────────┼─────────────────────────────┼───────────────┘
                                │  Authorization: Bearer <API_TOKEN>
                                ▼                              ▼
        ┌───────────────────────────────────────────────────────────────────┐
        │                       Caddy (HTTPS :443, Let's Encrypt)            │
        │                       reverse_proxy → 127.0.0.1:3000               │
        └───────────────────────────────────┬───────────────────────────────┘
                                             ▼
        ┌───────────────────────────────────────────────────────────────────┐
        │                  Bun process — Hono app (src/app.ts)               │
        │                                                                    │
        │  middleware:  cors → bearerAuth → (routes)                          │
        │                                                                    │
        │  shared routes:   GET /healthz (public)   GET /cost/today           │
        │  grok route:      POST /grok/ask                                    │
        │  X routes (/x):   calendar · metrics · posts · replies · voice      │
        │                                                                    │
        │  in-process workers (setInterval):                                  │
        │    publisher (60s) · ownReconcile (24h) · metricsPoll (60s)         │
        │    voicePull (1h)  · voiceMetricsPoll (60s, opt-in)                 │
        │                                                                    │
        │  one chokepoint out to X:   xFetch  (src/x/client.ts)              │
        │  one chokepoint out to Grok: askGrok (src/grok/client.ts)          │
        │       every call prices itself → cost_events ledger                 │
        └───────────────────────────────────┬───────────────────────────────┘
                                             ▼
        ┌───────────────────────────────────────────────────────────────────┐
        │                     Neon Postgres (Drizzle ORM)                    │
        │  tokens · scheduled_posts · posts_published · metrics_snapshots     │
        │  tracked_authors · voice_tweets · voice_metrics_snapshots           │
        │  reply_drafts · cost_events                                          │
        └───────────────────────────────────────────────────────────────────┘
                                             ▲
                                             │  $0.001–$0.20 per call
                       ┌─────────────────────┴───────────────────┐
                       │   X API v2 (api.x.com)   ·   xAI (api.x.ai) │
                       └─────────────────────────────────────────┘
```

### The load-bearing architectural principle: per-platform vertical slices

Stratus is structured so that **each social platform is a self-contained folder** that never reaches into a sibling. Today there is exactly one platform — X — living under `src/x/`. The day LinkedIn (or Threads, or Bluesky) arrives, it becomes `src/linkedin/` with the *same shape*, registered in `app.ts`, and **nothing inside `src/x/` changes.**

Only a thin shared layer at the top knows about more than one platform:

- `src/app.ts` — the Hono app that mounts platform routers and starts workers.
- `src/middleware/` — bearer auth, CORS, and the platform-tagged cost tracker.
- `src/db/` — the Neon/Drizzle singletons and the one cross-platform table (`cost_events`).
- `src/routes/` — cross-platform routes (`/cost/today`, `/healthz`).

The cost ledger is the canonical example: `cost_events` carries a `platform` column (`'x'`, `'grok'`, later `'linkedin'`), and the cost dispatcher in `src/middleware/costTracker.ts` selects the right price table by platform string. The shared layer never hardcodes an X assumption.

This isolation is *the* reason the codebase can grow without rotting. Respect it.

---

## 4. Technology stack

| Layer | Choice | Version | Why |
|---|---|---|---|
| Runtime | **Bun** | ≥ 1.1.0 | Runs `.ts` directly (no build step), native `fetch`/`Bun.serve`/`Bun.file`, native test runner |
| Language | **TypeScript** | ^5.7.2 | `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `allowImportingTsExtensions`, `noEmit` |
| HTTP framework | **Hono** | ^4.12.18 | Tiny, fast, Web-standard `Request`/`Response`; `app.fetch` plugs straight into `Bun.serve` |
| Database | **Neon Postgres** | — | Serverless Postgres; survives process restarts; snapshots itself |
| ORM / migrations | **Drizzle ORM** + **drizzle-kit** | ^0.45.2 / ^0.31.10 | Typed schema, generated SQL migrations, `drizzle-kit studio` for inspection |
| DB driver | **@neondatabase/serverless** | ^1.1.0 | WebSocket-pooled driver (with a Bun `WebSocket` shim) |
| Lint / format | **Biome** | ^1.9.4 | One tool; `noExplicitAny: error`, `useImportType: error`, 100-col, single quotes |
| Tests | **bun:test** | (bundled) | Vitest-compatible API, no extra dependency |
| AI drafting | **xAI Grok** (`grok-4.3`) | Responses API | High-signal reply generation; raw `fetch`, no SDK |
| Extension | **Vite 6 + React 19** | — | Chrome MV3 side panel + content script; unpacked load |
| Reverse proxy (prod) | **Caddy** | — | Automatic Let's Encrypt HTTPS (X requires HTTPS OAuth callbacks) |
| Process supervisor (prod) | **systemd** | — | `Restart=on-failure`, env file, sandboxing |
| Host (prod) | **Hetzner Cloud CX23** | — | 2 vCPU / 4 GB / 40 GB Ubuntu |

**Planned but not present:** anything beyond the above. No Redis, no BullMQ, no Docker, no Kubernetes, no Terraform. The whole point is that five `setInterval` calls in one Bun process, backed by `SELECT … FOR UPDATE SKIP LOCKED`, is enough for a single operator — and it is.

### Compiler configuration (`tsconfig.json`)

`target`/`module`: ESNext · `moduleResolution`: bundler · `strict`: true · `noUncheckedIndexedAccess`: true · `noImplicitOverride`: true · `exactOptionalPropertyTypes`: true · `verbatimModuleSyntax`: true · `allowImportingTsExtensions`: true · `noEmit`: true · `resolveJsonModule`: true · `isolatedModules`: true. Bun executes TypeScript; `tsc` is type-check-only.

### Linter configuration (`biome.json`)

Schema pinned to `1.9.4`; VCS-aware (`useIgnoreFile`); ignores `dist` and `node_modules`; 2-space indent, 100-column width, single quotes, trailing commas everywhere, semicolons always. Linter rules: recommended + `suspicious.noExplicitAny: error`, `style.useImportType: error`, `style.useExportType: error`. There is exactly one sanctioned `any` in the codebase (the Bun `WebSocket` shim in `src/db/client.ts`).

### Package scripts (`package.json`)

| Script | Command | Use |
|---|---|---|
| `bun run start` | `bun run src/app.ts` | Start the API + workers |
| `bun run auth` | `bun run src/x/server.ts` | OAuth callback server |
| `bun run play` | `bun run src/x/playground.ts` | Example calls against your token |
| `bun test` | `bun test` | Unit tests |
| `bun run typecheck` | `tsc --noEmit` | Type-check only |
| `bun run lint` | `biome check .` | Lint |
| `bun run format` | `biome format --write .` | Format |
| `bun run db:generate` | `drizzle-kit generate` | Generate a migration |
| `bun run db:migrate` | `drizzle-kit migrate` | Apply migrations |
| `bun run db:push` | `drizzle-kit push` | Push schema (dev) |
| `bun run db:studio` | `drizzle-kit studio` | Schema GUI |

---

## 5. Repository map

```
stratus/
├── src/
│   ├── app.ts                    Hono app: mounts middleware + routers, starts workers, Bun.serve
│   │
│   ├── db/
│   │   ├── client.ts             Neon Pool + Drizzle singletons (db, pool); WebSocket shim
│   │   ├── shared-schema.ts      cost_events table (the ONE cross-platform table)
│   │   └── migrations/           drizzle-kit generated SQL + snapshots + journal
│   │       ├── 0000_bumpy_rocket_raccoon.sql     initial 8 tables
│   │       ├── 0001_blushing_oracle.sql          adds reply_drafts
│   │       └── meta/             _journal.json, 0000/0001 snapshots
│   │
│   ├── middleware/
│   │   ├── auth.ts               bearerAuth() — constant-time token compare
│   │   ├── cors.ts               corsMiddleware() — chrome-extension://* + ALLOWED_ORIGINS
│   │   └── costTracker.ts        makeOnCost(platform) — dispatch to price table, insert cost_events
│   │
│   ├── routes/
│   │   ├── cost.ts               GET /cost/today — UTC-day spend aggregation
│   │   └── healthz.ts            GET /healthz — public liveness + version
│   │
│   ├── grok/                     xAI Grok vertical (a cross-vertical helper, not a social platform)
│   │   ├── client.ts             askGrok — the ONE place all xAI calls go through; cost logging
│   │   ├── index.ts              mountGrok(app); re-exports askGrok, GrokApiError, types
│   │   ├── pricing.ts            grok-4.3 token price table; priceFor, isKnownModel
│   │   └── routes/ask.ts         POST /grok/ask
│   │
│   ├── x/                        ALL X-specific code (the per-platform vertical slice)
│   │   ├── auth.ts               OAuth 2.0 PKCE: pair gen, authorize URL, exchange, refresh, revoke
│   │   ├── token-store.ts        Postgres tokens row; getValidAccessToken refreshes with rotation
│   │   ├── client.ts             xFetch — the ONE place all X API calls go through; setDefaultOnCost
│   │   ├── fields.ts             field-selection defaults (defaultPostParams)
│   │   ├── errors.ts             XApiError + classify (RFC 7807 problem-details parsing)
│   │   ├── pagination.ts         paginate(next_token) async iterator
│   │   ├── endpoints.ts          getMe, getUserByUsername, getTweet, searchRecent,
│   │   │                         getUserTweets, createPost, deletePost
│   │   ├── pricing.ts            X price table (switch keyed off endpoint + method)
│   │   ├── server.ts             Bun.serve OAuth callback — `bun run auth`
│   │   ├── playground.ts         `bun run play` — example calls against your stored token
│   │   ├── index.ts              mountX(app) + startXWorkers() — the only sanctioned boundary in
│   │   ├── db/schema.ts          tokens, scheduled_posts, posts_published, metrics_snapshots,
│   │   │                         tracked_authors, voice_tweets, voice_metrics_snapshots, reply_drafts
│   │   ├── replies/prompt.ts     DEFAULT_SYSTEM_PROMPT + buildGrokInput (Reply Master persona)
│   │   ├── routes/
│   │   │   ├── calendar.ts       /x/posts/scheduled CRUD
│   │   │   ├── metrics.ts        /x/metrics/:tweetId
│   │   │   ├── posts.ts          /x/posts/reconcile (createPostsRouter factory)
│   │   │   ├── replies.ts        /x/replies/* (Grok-backed reply drafts)
│   │   │   └── voice.ts          /x/voice/* (createVoiceRouter factory)
│   │   └── workers/
│   │       ├── publisher.ts      60s: publish due scheduled_posts
│   │       ├── ownReconcile.ts   24h: discover own tweets into posts_published
│   │       ├── metricsPoll.ts    60s: sample own-tweet metrics on a decaying ladder
│   │       ├── voicePull.ts      1h: mirror tracked authors' tweets
│   │       └── voiceMetricsPoll.ts  60s (opt-in): sample voice-tweet metrics
│   │
│   ├── my_niche.md               the operator's niche/positioning (feeds the Grok voice)
│   └── test.test.ts              unit tests for the pure-function bits
│
├── extension/                    Chrome MV3 side-panel UI (own package.json, Vite + React 19)
│   ├── public/manifest.json      MV3 manifest
│   ├── sidepanel.html            side-panel entry
│   ├── vite.config.ts            three rollup entries: sidepanel, background, content
│   ├── dist/                     built, unpacked-loadable output
│   └── src/
│       ├── background.ts         service worker — the single auth chokepoint
│       ├── content.ts            x.com content script — buttons + DOM scraping
│       ├── shared/               messages.ts, bgClient.ts, types.ts
│       └── sidepanel/            App, Calendar, Composer, Drafts, Voice, Replies, Settings,
│                                 api.ts, storage.ts, replyMasterStorage.ts, datetime.ts, main.tsx
│
├── .claude/skills/stratus/       operator skill (drives the HTTP API from Claude)
│   ├── SKILL.md                  workflows A–F, safety rules, endpoint surface
│   ├── references/               endpoints.md, replies.md, scheduling.md, voice.md
│   └── scripts/md_to_schedule.ts markdown blockquotes → jittered weekly schedule JSON
│
├── CLAUDE.md                     session orientation + the non-negotiable invariants
├── PLAN.md                       canonical build plan (phased)
├── X-API-IMPLEMENTATION-PLAN.md  reference spec for X API behavior/cost/policy (not a build plan)
├── X-API-PRICING-REFERENCE.md    pricing reference card
├── IPSE-Implementation-PRD.md    the eventual full product (Identity Graph) — OUT OF SCOPE here
├── REPLY-MASTER-PLAN.md          the Reply Master implementation plan (built as "Phase 6")
├── REPLY GUIDE.md                the reply growth philosophy ("Reply Guy → Growth Engine")
├── Grok-API-docs.md              vendored xAI API reference
├── DEPLOY.html                   Hetzner + Caddy + systemd deployment runbook
├── drizzle.config.ts             points drizzle-kit at both schema files
├── package.json                  scripts + deps
├── tsconfig.json
└── biome.json
```

### Where new code goes

- New **X-specific** code → `src/x/` (a new endpoint in `endpoints.ts`, a new route, a new worker).
- New **cross-platform infrastructure** → `src/db/`, `src/middleware/`, `src/routes/`, or `src/app.ts`.
- A **new platform** → a new sibling folder (`src/linkedin/`) shaped exactly like `src/x/`, registered in `app.ts`, with `drizzle.config.ts` pointed at its schema.

`src/x/` must never import from a sibling platform folder, and vice versa. They share only the top-level layer.

---

## 6. Getting started — the 20-minute path

This walks a brand-new operator from an empty machine to a live, posting Stratus instance. There are five external things you need: a machine with Bun, an X developer app, a Neon database, (optionally) an xAI key, and a few minutes for the OAuth dance.

### 6.1 Prerequisites

- **Bun ≥ 1.1.0** — install from [bun.sh](https://bun.sh): `curl -fsSL https://bun.sh/install | bash`
- **A Neon Postgres database** — free tier is fine. Get the pooled connection string. (Any Postgres works, but the driver is `@neondatabase/serverless`, which expects a Neon-style endpoint.)
- **An X developer account** with an app in the **Production** environment of [console.x.com](https://console.x.com). (Development environment has a `client-forbidden` bug for some flows — use Production.)
- **(Optional) an xAI API key** from [console.x.ai](https://console.x.ai) if you want Reply Master / `/grok/ask`.

### 6.2 Clone, install, and the env file

```bash
git clone <your-fork-url> stratus
cd stratus
bun install
```

Create a `.env` in the repo root. The complete set of variables is documented in [§7](#7-configuration-reference-every-environment-variable); the minimum to boot the API server is:

```bash
# --- required: the app will throw on boot without these ---
DATABASE_URL="postgresql://USER:PASS@HOST/dbname?sslmode=require"
API_TOKEN="<run: openssl rand -hex 32>"     # the shared bearer for API + extension
SELF_X_USER_ID="<your numeric X user id>"   # used to guard self-replies
X_CLIENT_ID="<from console.x.com>"
X_CLIENT_SECRET="<from console.x.com>"

# --- required only for the OAuth server (bun run auth) ---
X_OAUTH_REDIRECT_URI="http://127.0.0.1:3000/auth/x/callback"

# --- optional ---
XAI_API_KEY="<from console.x.ai>"           # gates /grok/ask and /x/replies/*
PORT="3000"                                  # default 3000
ALLOWED_ORIGINS=""                           # extra web origins (extension is matched automatically)
```

> **Don't know your `SELF_X_USER_ID` yet?** You'll get it for free from `bun run play` (which calls `getMe`) after you connect your account in step 6.5. Boot the OAuth server first, connect, run `play`, copy the id, then fill it in.

### 6.3 Create your X app (console.x.com)

1. Go to [console.x.com](https://console.x.com) and create a project + app in the **Production** environment.
2. Under **User authentication settings**, enable **OAuth 2.0**, set the app type to a **confidential client** (Stratus uses a client secret with PKCE), and request these scopes — they map exactly to `SCOPES` in `src/x/auth.ts`:
   `tweet.read`, `tweet.write`, `tweet.moderate.write`, `users.read`, `follows.read`, `mute.read`, `like.read`, `like.write`, `bookmark.read`, `media.write`, and critically **`offline.access`** (without it there is no refresh token and you re-auth every two hours).
3. Add the callback / redirect URL. For local auth: `http://127.0.0.1:3000/auth/x/callback`. **Use `127.0.0.1`, not `localhost`** — X's allowlist treats them as different hosts. For a deployed auth flow: `https://YOUR_DOMAIN/auth/x/callback`.
4. Copy the **Client ID** and **Client Secret** into your `.env`.

### 6.4 Provision the database (Neon + Drizzle)

The schema is defined in Drizzle (`src/db/shared-schema.ts` + `src/x/db/schema.ts`) and the migrations are pre-generated under `src/db/migrations/`. Apply them:

```bash
bun run db:migrate     # apply the committed migrations to your database
bun run db:studio      # (optional) inspect the schema visually
```

After migrating you will have nine application tables (documented exhaustively in [§13](#13-database-schema--full-specification)) plus drizzle's own migration bookkeeping.

### 6.5 Connect your X account (OAuth)

Stratus persists your OAuth tokens to the `tokens` table (single row, `id='default'`). To populate it, run the one-shot OAuth callback server and complete the PKCE flow in your browser:

```bash
bun run auth      # starts the OAuth server on http://127.0.0.1:3000
```

It prints a start URL. Open it; you'll be 302-redirected to x.com's authorize page; click **Authorize app**. X redirects back to `/auth/x/callback`, Stratus exchanges the code for tokens **within the 30-second window X allows**, and writes them to Postgres. You'll see:

```
✓ Connected. Tokens written to Postgres (tokens.id='default'). Scopes: tweet.read tweet.write … Now run `bun run play`.
```

The OAuth server is a **dev tool — do not deploy it as a public service.** Its in-memory `state → codeVerifier` map is wiped on restart, and each pending state self-expires after 5 minutes.

To disconnect later (revoke + delete the row): `curl -X POST http://127.0.0.1:3000/auth/x/disconnect`.

### 6.6 Run the service

```bash
bun run start     # = bun run src/app.ts
```

You'll see `stratus listening on http://127.0.0.1:3000`, and the workers will announce themselves (publisher always on; reconcile / metrics / voice-pull on by default; voice-metrics-poll off unless opted in). The server also logs which optional features mounted (e.g. `/x/replies/*` only mounts if `XAI_API_KEY` is set).

### 6.7 First smoke test

```bash
# 1. liveness (public, no auth) — also runs a `select 1` against the DB
curl -s http://127.0.0.1:3000/healthz
# → {"ok":true,"version":"0.1.1"}

# 2. authenticated: today's spend (should be ~$0 on a fresh boot)
curl -s http://127.0.0.1:3000/cost/today \
  -H "Authorization: Bearer $API_TOKEN"

# 3. schedule a tweet two minutes from now (UTC ISO 8601!)
curl -s -X POST http://127.0.0.1:3000/x/posts/scheduled \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text":"hello from stratus","scheduledFor":"2026-06-01T12:02:00Z","status":"pending"}'

# 4. watch the calendar; within ~60s of the scheduled minute the publisher posts it
curl -s "http://127.0.0.1:3000/x/posts/scheduled?status=posted" \
  -H "Authorization: Bearer $API_TOKEN"
```

When the row flips `pending → posted` and carries a `postedTweetId`, the full loop works: API → DB → 60s publisher tick → live tweet. (This exact loop was smoke-tested end-to-end on 2026-05-10.) From there, the metrics poller will begin sampling that tweet automatically.

---

## 7. Configuration reference (every environment variable)

Stratus reads configuration exclusively from environment variables. Variables marked **required** cause a thrown error (or `process.exit(1)` in the auth server) at boot if absent — fail-fast by design.

| Variable | Required? | Default | Read by | Purpose |
|---|---|---|---|---|
| `DATABASE_URL` | **Yes** | — | `src/db/client.ts` | Neon Postgres connection string. No default; throws if missing. |
| `API_TOKEN` | **Yes** | — | `src/middleware/auth.ts` | The single shared bearer token guarding `/x/*`, `/cost/*`, `/grok/*`. The extension's "bearer" must equal this. |
| `SELF_X_USER_ID` | **Yes** | — | `src/x/index.ts` | Your numeric X user id; threaded into `createPost` to enforce the self-reply guard and into reconcile/metrics. |
| `X_CLIENT_ID` | **Yes** | — | auth, token-store, index, server | OAuth 2.0 client id from console.x.com. |
| `X_CLIENT_SECRET` | **Yes** | — | auth, token-store, index, server | OAuth 2.0 client secret (confidential client). |
| `X_OAUTH_REDIRECT_URI` | Auth only | — | `src/x/server.ts` | The registered callback URL; must exactly match console.x.com. Use `127.0.0.1` locally. |
| `PORT` | No | `3000` | `src/app.ts`, `src/x/server.ts` | HTTP listen port. Caddy fronts this on 443 in production. |
| `ALLOWED_ORIGINS` | No | `''` | `src/middleware/cors.ts` | Comma-separated extra web origins for CORS. The extension is matched automatically via `chrome-extension://*`. |
| `XAI_API_KEY` | No | — | `src/grok/*`, `src/x/index.ts` | xAI/Grok API key. If unset, `/grok/ask` and `/x/replies/*` are **not mounted**. |
| `OWN_RECONCILE_ENABLED` | No | `true` | `src/x/index.ts` | Set to `false` to disable the daily reconcile timer (manual `POST /x/posts/reconcile` still works). |
| `METRICS_POLL_ENABLED` | No | `true` | `src/x/index.ts` | Set to `false` to disable own-tweet metrics polling. |
| `VOICE_PULL_ENABLED` | No | `true` | `src/x/index.ts` | Set to `false` to disable the hourly voice pull. |
| `VOICE_METRICS_POLL_ENABLED` | No | **`false`** | `src/x/index.ts` | **Opt-in.** Set to `true` to enable polling *other* authors' tweet metrics (other-user reads cost $0.005 each — gated for that reason). |
| `X_BEARER_TOKEN` | No | — | (deploy/app-only reads) | Optional app-only bearer for read endpoints; referenced in the deploy runbook. |
| `DOMAIN` | Deploy only | — | deploy scripts | Your public domain (or sslip.io) for Caddy + the OAuth callback. |

**Worker gate semantics** are deliberately asymmetric:

- The three "cheap" workers (`OWN_RECONCILE_ENABLED`, `METRICS_POLL_ENABLED`, `VOICE_PULL_ENABLED`) default **on** and you disable them with `=false`.
- The one "expensive" worker (`VOICE_METRICS_POLL_ENABLED`) defaults **off** and you enable it with `=true`. This is a money safety: polling other people's metrics is 5× the cost of your own, so it never starts by accident.

---

## 8. The cost model — read this before you touch anything

X API v2 bills per call, and for some endpoints **per result returned**. Stratus has already burned real money on naive mistakes; the cost model exists so you don't repeat them. Two facts drive everything:

1. **X bills for what it *returns*, not what your code *iterates*.** Asking for `max_results: 100` and `break`-ing after 3 still costs ~100 reads.
2. **Some writes are 13× others.** A post containing a URL is billed at **$0.20**, versus **$0.015** for the same post without one.

### The cost cheat sheet (April 2026 prices, USD)

| Surface | Cost | Notes |
|---|---|---|
| Own post / mention / like / followers / following / mute / block read | **$0.001** | 24h UTC dedup |
| Bookmarks read | $0.005 | Billing bug — should be $0.001; defer bookmark sync |
| Other-user post read, search results | **$0.005** | Per result |
| Third-party user lookup | **$0.010** | `getUserByUsername` |
| Post create (no URL) | **$0.015** | |
| **Post create (URL in text)** | **$0.20** | ⚠️ guarded in `createPost` |
| Like / Repost / Bookmark write | $0.015 | (not exposed in v1) |
| Delete | **$0.010** | |

### Cadence-derived budgets

These are the per-tweet lifetime costs of the polling workers, derived from the cadence ladders in [§12](#12-the-background-workers):

- **Own posts:** ~113 polls × $0.001 ≈ **$0.113 per tweet** over 30 days, then the row is retired and never polled again.
- **Voice tweets:** ~18 polls × $0.005 ≈ **$0.09 per tweet** over 7 days, then retired.
- **Per-author voice guardrail:** only the newest `max_polled_tweets` (default **20**) of a tracked author ever get enrolled for metrics polling. At the default, that's a ceiling of roughly 20 × $0.09 ≈ **$1.80 per author per 7-day window** — and only when `VOICE_METRICS_POLL_ENABLED=true`.
- **Reply drafting (Grok):** ~$0.0019 per generation; ~$0.19 per 100 drafts. Too cheap to gate.

### How spend is recorded

Every X call flows through `xFetch`, and every Grok call through `askGrok`. Both fire a cost callback that:

1. Prices the call (X via `src/x/pricing.ts`, Grok via token usage × `src/grok/pricing.ts`).
2. Inserts a row into the shared `cost_events` table, tagged with `platform` (`'x'` or `'grok'`).

This insert is **fire-and-forget**: a failed cost-log is caught and logged but never blocks or fails the originating call. A missing cost row is a dashboard gap, not a broken publish.

`GET /cost/today` then aggregates `cost_events` over the current **UTC day** (X bills on UTC), grouped by platform and endpoint. The cost dashboard *is* the budget cap — there is no automatic enforcement, by design.

### Known under-counting (be aware)

The pricing layer can only see the request path, not the request body or the per-result count:

- **The $0.20 URL surcharge** can't be inferred from `POST /2/tweets` alone, so a URL post currently records as $0.015 in the ledger. (The *guard* still blocks it at the call site — you just won't see the true price in `/cost/today`.)
- **Per-result endpoints** (search, user-tweets) pass `items: null` today because `xFetch` doesn't yet thread the result count into the cost hook, so paged reads under-report. This is flagged in-file as future work.

Neither gap costs you money silently at the API — they only make the *dashboard* conservative-low. The guards that actually prevent overspend (URL surcharge block, `max_results` clamps, retirement, per-author caps) are all live.

---

## 9. The six non-negotiable invariants

These are the rules that have already cost real money or locked accounts out. They are reproduced from `CLAUDE.md`. Memorize them before changing anything.

### Invariant 1 — The URL surcharge: $0.20 vs $0.015 (13×)
A post whose `text` matches `/(^|\s)https?:\/\//i` is billed at **$0.20**, not $0.015. `createPost` throws unless you pass `{ allowUrlSurcharge: true }`. **Don't disable the guard to make a test pass** — move the URL into a reply, or accept the cost explicitly. The publisher worker calls `createPost` *without* this flag, which means **any scheduled tweet containing a URL silently flips to `status='failed'` at the 60-second tick.** The Composer UI and the `md_to_schedule.ts` script both refuse URLs up front for this reason.

### Invariant 2 — The programmatic-reply restriction (Feb 2026)
Self-replies (your own threads) always work. Replying to *others* via `in_reply_to_tweet_id` is **blocked on self-serve tiers** unless the original author @-mentioned or quoted your app. `createPost` requires `selfXUserId` so a caller can't accidentally reply to a non-self tweet. This is why Reply Master only ever *drafts* — you post the reply by hand and record the result. v1 ships without reply-to-others and cross-account quote-tweet endpoints on purpose.

### Invariant 3 — Token-rotation atomicity
X rotates the **refresh token on every refresh**. If the new refresh token is lost between issuance and persistence, the account is **permanently locked out**. `token-store.ts::getValidAccessToken` opens a transaction, takes a `SELECT … FOR UPDATE` row lock, and **writes the rotated token to Postgres *before* returning the access token** — inside the same transaction. The lock prevents two concurrent callers from both spending the same refresh token (the loser would 4xx and the rotated token would never persist). **If you change this ordering, you will burn someone's account.**

### Invariant 4 — One place to call X
Every X API call goes through `xFetch` in `src/x/client.ts`. That is where retries, rate-limit handling, error parsing, and cost logging live. **Do not** sprinkle `fetch('https://api.x.com/...')` around the codebase — not in workers, routes, or scripts. (The sole exceptions are the OAuth token/revoke endpoints in `auth.ts`, which aren't bearer-authed v2 calls.) The same discipline applies to Grok via `askGrok`.

### Invariant 5 — `maxItems` does NOT cap cost — `max_results` does
X bills for every result in the response body, not what your JS iterates. A `for await (...) { if (++n >= 3) break; }` after requesting `max_results: 100` still costs ~100 reads. Any endpoint wrapping `paginate()` **must clamp the URL's per-request page size** to the caller's intent (see `searchRecent`: `Math.min(100, Math.max(10, opts.maxResults ?? 100))`). The `maxItems` argument only stops *additional* page fetches; the page already in flight is already billed.

### Invariant 6 — The cost middleware dispatches by platform
`cost_events` rows carry a `platform` column, and `src/middleware/costTracker.ts` selects the price table by platform. **Never hardcode X assumptions into the shared middleware.** The entire per-platform folder shape depends on the shared layer staying platform-agnostic.

---

## 10. The X primitive layer

`src/x/` contains a small, typed wrapper over X API v2. Every higher-level feature (routes, workers) is built from these primitives. This section documents each one.

### 10.1 `auth.ts` — OAuth 2.0 PKCE

Implements the RFC 7636 PKCE authorization-code flow against three X endpoints:

- `X_AUTHORIZE_URL = https://x.com/i/oauth2/authorize`
- `X_TOKEN_URL = https://api.x.com/2/oauth2/token`
- `X_REVOKE_URL = https://api.x.com/2/oauth2/revoke`

**Exports:**

- `SCOPES` (readonly tuple) and `SCOPE_STRING` (space-joined) — the eleven scopes listed in §6.3. `offline.access` is mandatory (it's what yields a refresh token).
- `generatePkcePair(): Promise<PkcePair>` — generates 32 random bytes → base64url `codeVerifier` (43–128 chars), then `codeChallenge = base64url(sha256(verifier))` via `crypto.subtle.digest`.
- `buildAuthorizeUrl({ clientId, redirectUri, state, codeChallenge }): string` — builds the authorize URL with `response_type=code`, `scope=SCOPE_STRING`, `code_challenge_method=S256`, etc.
- `exchangeCodeForTokens({ clientId, clientSecret, code, redirectUri, codeVerifier }): Promise<TokenSet>` — POSTs `grant_type=authorization_code` with HTTP Basic auth. **Must happen within 30 seconds of the redirect.**
- `refreshTokens({ clientId, clientSecret, refreshToken }): Promise<TokenSet>` — POSTs `grant_type=refresh_token`. The returned set carries a **new** refresh token — persist it (Invariant 3).
- `revokeToken({ clientId, clientSecret, token, tokenTypeHint }): Promise<void>` — revokes an access or refresh token.

`TokenSet` is `{ accessToken, refreshToken, expiresAt /* epoch ms */, scope }`. The private `postToken` helper maps X's `expires_in` (seconds) to an absolute `expiresAt = Date.now() + expires_in * 1000`.

### 10.2 `token-store.ts` — the Postgres token store

A single-row store (`tokens.id = 'default'`) holding the live access/refresh pair. Replaces the old `.tokens.json` file.

**Exports:**

- `StoredTokens` — `TokenSet` plus `xUserId?`, `xUsername?`, `connectedAt`, `lastRefreshAt?`.
- `readStore(): Promise<StoredTokens | null>` — reads the `default` row.
- `writeStore(stored): Promise<void>` — upserts (`onConflictDoUpdate`).
- `deleteStore(): Promise<void>` — deletes the row (used by disconnect).
- `getValidAccessToken({ clientId, clientSecret }): Promise<string>` — **the critical path.** Opens a transaction, `SELECT … FOR UPDATE` on the row, and:
  - throws if no row (`run bun run auth first`);
  - returns the existing access token if it's valid for at least another `REFRESH_BUFFER_MS = 60_000` ms;
  - otherwise refreshes, and **writes the rotated token inside the same transaction before returning** the new access token.

This is the live enforcement of Invariant 3. The row lock serializes refreshes so concurrent workers can't double-spend a refresh token.

### 10.3 `client.ts` — `xFetch`, the single chokepoint

`X_API_BASE = https://api.x.com`. Every X v2 call goes through `xFetch<T>(endpoint, opts)`.

**`FetchOptions`:** `method?` (default `GET`), `query?`, `body?` (JSON-serialized), `token` (bearer, required), `maxAttempts?` (**default 4**), `onCost?`, `signal?`.

**`CostInfo`** (passed to `onCost`): `endpoint`, `method`, `status`, `durationMs`, `attempts`, `rateLimitRemaining`, `rateLimitResetAt`.

**Behavior:**

- Builds the URL, attaches `Authorization: Bearer`, `content-type`/`accept: application/json`, and the body if present.
- Reads `x-rate-limit-remaining` / `x-rate-limit-reset` headers on every response.
- **Retry policy:** retries on `429` or `500–504`, up to `maxAttempts`. For a `429` with a reset header, it waits until the reset time (+ 0–499 ms jitter, **capped at 60 s**); otherwise exponential backoff `1s → 2s → 4s → 8s` (capped at 16 s) + jitter. Network errors retry too; already-classified `XApiError`s do not.
- **`onCost` fires exactly once per logical call** — on terminal success or terminal failure, never on an intermediate retry.

**`setDefaultOnCost(fn)`** installs a process-wide cost hook so endpoint wrappers needn't thread `onCost` through every call. `startXWorkers()` installs `makeOnCost('x')` once at boot; a per-call `onCost` still wins if provided.

### 10.4 `fields.ts` — field-selection defaults

X v2 returns minimal fields unless you ask. This file centralizes the field sets as `as const` tuples:

- `POST_FIELDS` — id, text, created_at, author_id, conversation_id, in_reply_to_user_id, referenced_tweets, public_metrics, entities, lang, attachments.
- `POST_FIELDS_OWNED_PRIVATE` — `POST_FIELDS` + `non_public_metrics`, `organic_metrics` (only valid on owned reads ≤30 days old; they silently null after).
- `USER_FIELDS`, `MEDIA_FIELDS`, `EXPANSIONS`.
- `defaultPostParams({ ownedPrivate? })` — returns the query map (`tweet.fields`, `user.fields`, `media.fields`, `expansions`), swapping in the private metric fields when `ownedPrivate` is set.

### 10.5 `errors.ts` — RFC 7807 parsing & classification

X v2 errors are RFC 7807 problem-details JSON; the `type` URI is the routing key.

- `XApiError` — `status`, `type`, `detail`, `rawBody`, `requestId`.
- `classify(err): ErrorClass` — maps to one of: `auth_invalid` (401), `duplicate_content` (treat as silent success), `reply_restriction` (Feb 2026 policy), `user_suspended`, `rate_limited`, `usage_capped` (2M post-reads/month account cap), `scope_or_permission`, `server_error` (5xx), `unknown`.
- `fromResponse(res): Promise<XApiError>` — parses the body (RFC 7807 or `{ errors: [...] }`), extracting `x-request-id` for tracing.

### 10.6 `pagination.ts` — the `next_token` iterator

`paginate<T>(fetchPage, opts): AsyncIterable<T>` — yields items across pages following `meta.next_token`. `PaginateOptions` are `maxItems?`, `maxPages?`, `perPageSleepMs?`.

**The cost caveat (Invariant 5) lives here in the header comment:** `maxItems` is a JS-side trim, *not* a billing cap. Callers must also lower the per-request page size. Documented hard caps: `/users/:id/tweets` 3,200; `/users/:id/mentions` 800; `/tweets/:id/retweeted_by` and `/liking_users` 100; `search/all` is server-rate-limited to 1 req/sec (pass `perPageSleepMs: 1100`).

### 10.7 `endpoints.ts` — typed endpoint wrappers

Each function is a thin typed wrapper over `xFetch`. Added one at a time, only when a route or worker needs it.

**Reads:**

| Function | Endpoint | Cost | Notes |
|---|---|---|---|
| `getMe(token)` | `GET /2/users/me` | $0.001 | Owned read; how you discover `SELF_X_USER_ID`. |
| `getUserByUsername(token, username)` | `GET /2/users/by/username/:u` | $0.010 | Third-party lookup; resolves username → id for voice tracking. |
| `getTweet(token, id, { ownedPrivate? })` | `GET /2/tweets/:id` | $0.001 owned / $0.005 other | Requests private metrics only when `ownedPrivate`. |
| `searchRecent(token, query, { maxResults? })` | `GET /2/tweets/search/recent` | $0.005/result | 7-day window. **Clamps page size to `[10,100]`** (Invariant 5). |
| `getUserTweets(token, xUserId, opts)` | `GET /2/users/:id/tweets` | $0.001 owned / $0.005 other per result | Clamps page size to `[5,100]`; supports `sinceId`, `ownedPrivate`; uses `pagination_token`; hard cap 3,200. |

**Writes:**

| Function | Endpoint | Cost | Guards |
|---|---|---|---|
| `createPost(token, body, opts)` | `POST /2/tweets` | $0.015 / $0.20 with URL | URL surcharge guard (Invariant 1) + self-reply guard (Invariant 2). |
| `deletePost(token, id)` | `DELETE /2/tweets/:id` | $0.010 | — |

`createPost` is where Invariants 1 and 2 are enforced before a single byte hits X: it throws on a URL in `text` unless `allowUrlSurcharge`, and throws on `in_reply_to_tweet_id` unless `selfXUserId` is provided (so it can verify a self-reply) or `allowReplyToOthers` is set.

Two consistency notes worth knowing: `searchRecent` clamps to `[10,100]` while `getUserTweets` clamps to `[5,100]` (different lower bounds, both default 100), and `searchRecent` paginates on `next_token` while `getUserTweets` paginates on `pagination_token`.

### 10.8 `pricing.ts` — the X price table

`priceFor(endpoint, method, status, items): number` — a switch keyed off `(method, path)`:

- `status >= 400` → **$0** (X doesn't bill 4xx or retried 5xx).
- `POST /2/tweets` → $0.015 · `DELETE /2/tweets/:id` → $0.010 · `GET /2/users/me` → $0.001 · `GET /2/tweets/:id` → $0.005 (conservatively priced as other-user) · `GET /2/tweets/search/recent` → $0.005 × `(items ?? 1)`.
- Anything unmapped → **$0** (a grep-able "unknown endpoint" gap, never a fabricated price).

### 10.9 `server.ts` & `playground.ts` — dev tools

- `server.ts` (`bun run auth`) — the OAuth callback server described in §6.5. Routes: `/` and `/auth/x/start` (begin flow), `/auth/x/callback` (exchange + persist), `/auth/x/disconnect` (revoke + delete). In-memory state with a 5-minute expiry. **Not for deployment.**
- `playground.ts` (`bun run play`) — a scratchpad: fetches a valid token, logs `getMe`, runs a tiny `searchRecent`. Editable; not a test.

---

## 11. HTTP API reference

All routes are served by the Hono app in `src/app.ts`. Middleware order is **CORS → bearer auth → routes**, so the credential-less preflight `OPTIONS` short-circuits before the auth check.

- `GET /healthz` is **public** (no bearer) so health probes work.
- Everything under `/x/*`, `/cost/*`, and `/grok/*` requires `Authorization: Bearer <API_TOKEN>` (constant-time compared).

### 11.1 Shared routes

| Method | Path | Auth | Description | Response |
|---|---|---|---|---|
| `GET` | `/healthz` | public | Runs `select 1`; reports app version. | `200 {ok:true,version}` or `503 {ok:false,version,error}` |
| `GET` | `/cost/today` | bearer | Aggregates `cost_events` over the current UTC day, grouped by platform then endpoint. | `200 {from,to,totalUsd,totalCalls,byPlatform:[{platform,costUsd,calls,byEndpoint:[…]}]}` |

### 11.2 Calendar routes (`/x/posts/scheduled`) — table `scheduled_posts`

| Method | Path | Body / Query | Behavior | Returns |
|---|---|---|---|---|
| `POST` | `/x/posts/scheduled` | `{ text, scheduledFor?, mediaIds?, status? }` | Creates a scheduled post. `text` required + non-empty. `scheduledFor` is UTC ISO or null. `status` may only be `draft` or `pending` on create; `pending` requires `scheduledFor`. If omitted, status defaults to `pending` when a time is set, else `draft`. | `201` the inserted row |
| `GET` | `/x/posts/scheduled` | query `from`, `to`, `status` | Filters by `scheduledFor` window and/or status. Ordered `scheduledFor asc nulls last`, then `createdAt desc`. | `200` array |
| `PATCH` | `/x/posts/scheduled/:id` | `{ text?, scheduledFor?, mediaIds?, status? }` | Edits a post. `:id` must be a UUID. **`409 cannot_edit_posted`** if already posted. Cannot set status to `posted` via PATCH. | `200` updated row |
| `DELETE` | `/x/posts/scheduled/:id` | — | Hard-deletes. **`409 cannot_delete_posted`** if already posted. | `204` |

**Status lifecycle:** `draft` → `pending` → `posted` (terminal, write-locked) / `failed` (editable, retryable) / `cancelled`.

### 11.3 Metrics route — tables `posts_published`, `metrics_snapshots`

| Method | Path | Behavior | Returns |
|---|---|---|---|
| `GET` | `/x/metrics/:tweetId` | Reads a published post plus its full snapshot history (oldest-first, chart-ready). `:tweetId` validated `^\d{1,32}$`; `404 not_found` if not tracked. | `200 {tweetId,postedAt,retired,pollCount,nextPollAt,lastSeenAt,snapshots:[{snapshotAt,publicMetrics,nonPublicMetrics,organicMetrics}]}` |

### 11.4 Posts / reconcile route — table `posts_published`

| Method | Path | Body | Behavior | Returns |
|---|---|---|---|---|
| `POST` | `/x/posts/reconcile` | `{ fullScan?, maxResults? }` | One-shot invocation of the same logic as the daily `ownReconcile` worker — discovers own tweets not yet tracked. `maxResults` clamped to `min(3200, …)`. | `200 {scanned,inserted}` or `500 reconcile_failed` |

### 11.5 Replies routes (`/x/replies`) — table `reply_drafts` (mounted only if `XAI_API_KEY` set)

| Method | Path | Body / Query | Behavior | Returns |
|---|---|---|---|---|
| `POST` | `/x/replies/generate` | `{ context, systemPromptOverride?, model?, reasoningEffort? }` | Validates the full `context` (tweetId, handle, author, text, url, postedAt, metrics, topComments), builds the Grok prompt, calls `askGrok` (max 280 output tokens, temp 0.7), and stores the draft (`status='generated'`). | `201` draft; upstream Grok errors mapped to `429`/`502` |
| `GET` | `/x/replies` | query `status`, `sourceAuthor`, `limit` (≤200, default 50), `since` | Lists drafts, newest-first. | `200` array |
| `GET` | `/x/replies/:id` | — | Single draft (UUID). | `200` or `404` |
| `PATCH` | `/x/replies/:id` | `{ replyTextEdited?, status?, postedTweetId? }` | Edits text / advances status. **Transitions enforced:** `generated → copied\|posted\|discarded`, `copied → posted\|discarded`, `posted → discarded`, `discarded` terminal (`409 invalid_status_transition` otherwise). `postedTweetId` requires final status `posted`. | `200` updated |
| `DELETE` | `/x/replies/:id` | — | Hard-deletes. | `204` |

### 11.6 Voice routes (`/x/voice`) — tables `tracked_authors`, `voice_tweets`, `voice_metrics_snapshots`

| Method | Path | Body / Query | Behavior | Returns | Cost |
|---|---|---|---|---|---|
| `POST` | `/x/voice/track` | `{ username, maxPolledTweets? }` | Resolves username → id (`getUserByUsername`), upserts a `tracked_authors` row with `source='manual'` and both flags **on**. | `201` author | **$0.010** |
| `GET` | `/x/voice/authors` | query `source` | Lists authors with a left-joined tweet count. | `200` array | free |
| `PATCH` | `/x/voice/authors/:username` | `{ pullEnabled?, metricsPollingEnabled?, maxPolledTweets?, source? }` | Flips flags on an existing author (promote/demote). No API call. | `200` updated | free |
| `DELETE` | `/x/voice/track/:username` | — | **Soft disable:** both flags off + retires all the author's voice tweets to stop spend. | `200 {author,retiredVoiceTweets}` | free |
| `POST` | `/x/voice/pull/:username` | `{ fullScan?, maxResults? }` | On-demand pull of that author's tweets. | `200` pull result | $0.005/result |
| `POST` | `/x/voice/scrape` | `{ original, replies?, pollMetrics? }` | **Extension DOM-scrape ingest.** Stores scraped tweets (content is free — no API read); for each *new* author does one `getUserByUsername` and inserts with `source='auto_from_scrape'` and both flags **off**. | `200` ingest summary | **$0.010 per new author only** |
| `GET` | `/x/voice/tweets` | query `author`, `q`, `minLikes`, `includeReplies`, `limit` (≤200) | Lists stashed tweets joined to author + latest snapshot metrics. | `200` array | free |
| `GET` | `/x/voice/metrics/:tweetId` | — | Snapshot history (public metrics only) for a voice tweet. | `200` history | free |

### 11.7 Grok route — table `cost_events` (mounted only if `XAI_API_KEY` set)

| Method | Path | Body | Behavior | Returns |
|---|---|---|---|---|
| `POST` | `/grok/ask` | `{ prompt? \| messages?, system?, model?, reasoningEffort?, maxOutputTokens?, temperature? }` | Raw Grok call (brainstorming, multi-turn). Logs a `cost_events` row tagged `grok`. | `200` full `AskGrokResult` (`text,model,usage,costUsd,durationMs,requestId`); upstream errors mapped to `429`/`502` |

---

## 12. The background workers

Five workers run in-process via `setInterval`, started by `startXWorkers()` in `src/x/index.ts`. They all share the same defensive shape:

- A `running` re-entrancy flag — a tick is skipped entirely if the previous one hasn't finished.
- The tick body wrapped in try/catch, so a thrown error logs but never kills the interval.
- A returned disposer (`clearInterval`) collected into the `stop()` handle.

Three of them — the ones that make a **paid X call inside a row lock** — use `SELECT … FOR UPDATE SKIP LOCKED` so no two ticks (or future replicas) ever double-process a row. The two reconcile-style pullers use idempotent insert-or-noop instead.

`startXWorkers()` also installs the cost logger (`setDefaultOnCost(makeOnCost('x'))`) *before* any worker tick, so the very first X call is recorded.

### 12.1 `publisher` — publish due posts (60 s, always on)

- Selects up to 10 `pending` posts where `scheduledFor <= now`, ordered by time, one at a time under `FOR UPDATE SKIP LOCKED` (lock held across the X call).
- Calls `createPost(token, {text}, {selfXUserId})` — **$0.015**.
- On success: inserts a `posts_published` row (`source='scheduled'`, `nextPollAt=now`, `onConflictDoNothing`) and flips the scheduled row to `posted` with `postedTweetId`.
- On failure: sets `status='failed'`, records `errorClass` (via `classify`) and `errorDetail` (truncated 2000 chars). The row stays editable for retry.

### 12.2 `ownReconcile` — discover own tweets (24 h, on by default)

- Purpose: find tweets you posted **manually in the X app** (and recover any publisher rows whose transaction rolled back after X committed — the accepted no-idempotency trade-off).
- Computes a `sinceId` checkpoint = the newest `posts_published.tweetId` (bigint snowflake sort), so steady-state it reads ~0–5 tweets/day.
- Calls `getUserTweets(token, selfXUserId, { maxResults, sinceId })` — **$0.001/tweet** (owned). Default `maxResults` 500; the route clamps user input to 3,200.
- Inserts each new tweet into `posts_published` (`source='manual'`, `isReply` from `in_reply_to_user_id`, `inReplyToTweetId` from the `replied_to` referenced tweet, `conversationId`, `nextPollAt=now`, `onConflictDoNothing`).
- Also callable one-shot via `POST /x/posts/reconcile`. No row lock needed (idempotent insert-or-noop).

### 12.3 `metricsPoll` — own-tweet metrics cadence (60 s, on by default)

- Selects up to 10 rows where `retired=false AND nextPollAt <= now` under `FOR UPDATE SKIP LOCKED`.
- Calls `getTweet(token, tweetId, { ownedPrivate })` — **$0.001**. `ownedPrivate` is true only while the tweet is < 30 days old (private/organic metrics null out after that).
- Appends a `metrics_snapshots` row (public/non-public/organic) and bumps `pollCount` (only on a real snapshot).
- **The cadence ladder** (`nextPollDelay(ageMs)`, unit-tested):

  | Tweet age | Next poll in | ~polls |
  |---|---|---|
  | < 30 min | +5 min | ~6 |
  | 30 min – 6 h | +15 min | ~22 |
  | 6 h – 48 h | +1 h | ~42 |
  | 2 d – 7 d | +6 h | ~20 |
  | 7 d – 30 d | +24 h | ~23 |
  | ≥ 30 d | **retire** | — |

  ≈ 113 polls × $0.001 ≈ **$0.113/tweet** over 30 days.
- **Retirement:** at 30 days, or immediately on a 404/403 (deleted/suspended). Transient errors push `nextPollAt += 5 min` without crediting `pollCount`.

### 12.4 `voicePull` — mirror tracked authors (1 h, on by default)

- Walks all `pullEnabled=true` authors, ordered `lastPulledAt asc nulls first` (never-pulled first; fair rotation). Per-author errors are isolated.
- Per author: `sinceId` checkpoint = newest stored tweet for that author; `getUserTweets(token, authorXUserId, { maxResults, sinceId })` — **$0.005/tweet**. Default `maxResults` = the author's `maxTweetsPerPull`.
- Buffers tweets newest-first and **enrolls only the first `maxPolledTweets`** (default 20) for metrics polling — *this* is the per-author cost guardrail. Inserts with `source='tracked_pull'`, `onConflictDoNothing`; only fresh inserts in the enrolled slice get `nextPollAt=now`, the rest `null`; existing rows only bump `lastSeenAt`.
- Updates `tracked_authors.lastPulledAt`. Also callable per-author via `POST /x/voice/pull/:username`. Exports `retireAuthorVoiceTweets` (used by the soft-disable on `DELETE /x/voice/track`).

### 12.5 `voiceMetricsPoll` — voice-tweet metrics cadence (60 s, **opt-in**)

- Gated by `VOICE_METRICS_POLL_ENABLED=true` (the gate lives in `startXWorkers`, not the worker itself).
- Selects up to 10 due rows under `FOR UPDATE SKIP LOCKED`; calls `getTweet(token, tweetId)` (never requests private metrics) — **$0.005**.
- Appends a `voice_metrics_snapshots` row (public metrics only — the table has no private columns).
- **The (lighter) cadence ladder** (`nextVoicePollDelay(ageMs)`, unit-tested):

  | Tweet age | Next poll in | ~polls |
  |---|---|---|
  | < 6 h | +1 h | ~6 |
  | 6 h – 48 h | +6 h | ~7 |
  | 2 d – 7 d | +24 h | ~5 |
  | ≥ 7 d | **retire** | — |

  ≈ 18 polls × $0.005 ≈ **$0.09/tweet** over 7 days.
- **Retirement:** at 7 days, or on a 404/403. Transient errors push `nextPollAt += 1 h`. The `maxPolledTweets` cap is enforced upstream in `voicePull` (only the top-N tweets ever get a `nextPollAt`); this worker only drains the queue.

---

## 13. Database schema — full specification

Stratus stores everything in Neon Postgres. The schema is defined in two Drizzle files — `src/db/shared-schema.ts` (the one cross-platform table) and `src/x/db/schema.ts` (all eight X tables) — and materialized by two generated migrations (`0000` created the initial eight; `0001` added `reply_drafts`). The Drizzle definitions are the single source of truth; the SQL migrations are faithful generated output with no drift.

A few schema-wide conventions:

- **No check constraints and no unique constraints beyond primary keys.** State machines (the `status` columns) are enforced in application code, not the database.
- **Natural keys as PKs where possible.** Business entities are keyed by their X-native ids (`tweet_id`, `x_user_id` as `text` PKs), which makes the reconcile/pull workers' upsert-by-id idempotent for free.
- **Three PK strategies:** X-native text ids for entities; `bigserial` for append-only time-series and the ledger; `uuid` (`gen_random_uuid()`) for queue/draft rows.
- **The polling pattern.** Two "live" tables (`posts_published`, `voice_tweets`) carry `next_poll_at` + `poll_count` + `retired`, each with a **partial index `WHERE retired = false`** so the workers' "what's due to poll" query stays cheap as retired rows pile up. Retirement is the cost-control backbone — it caps how long metered polling runs.

### 13.1 `tokens` — OAuth credential store

The most safety-critical table. Holds the single user's live OAuth 2.0 access/refresh pair (replaces `.tokens.json`). Refresh tokens rotate on every refresh; writes here must persist the new refresh token before returning the access token (Invariant 3).

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `id` | text | no | — | **PK** (always `'default'`) |
| `access_token` | text | no | — | |
| `refresh_token` | text | no | — | rotates every refresh |
| `expires_at` | timestamptz | no | — | triggers refresh when within 60 s |
| `scope` | text | yes | — | |
| `x_user_id` | text | yes | — | the connected account |
| `x_username` | text | yes | — | |
| `connected_at` | timestamptz | yes | — | first OAuth connect |
| `last_refresh_at` | timestamptz | yes | — | bumped on each rotation |

**Lifecycle:** created on first `bun run auth`; updated on every token refresh; never auto-deleted (the disconnect endpoint deletes it explicitly). **Indexes:** none (single row).

### 13.2 `scheduled_posts` — the calendar queue (Goal 1)

One row per drafted/queued tweet. The 60-second publisher reads from here.

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | **PK** |
| `text` | text | no | — | tweet body |
| `media_ids` | text[] | yes | — | media not yet supported |
| `scheduled_for` | timestamptz | yes | — | publish time; null = unscheduled draft |
| `status` | text | no | — | `draft`/`pending`/`posted`/`failed`/`cancelled` |
| `posted_tweet_id` | text | yes | — | set on publish |
| `error_class` | text | yes | — | from `classify` |
| `error_detail` | text | yes | — | truncated failure detail |
| `source` | text | no | `'api'` | api / extension |
| `created_at` | timestamptz | no | `now()` | |
| `updated_at` | timestamptz | no | `now()` | |

**Index:** `scheduled_posts_status_scheduled_idx` on `(status, scheduled_for)` — the publisher's "find due pending rows" query. **Lifecycle:** created via the calendar route or extension; publisher transitions it to `posted` (+`posted_tweet_id`) or `failed`. **Relationship:** referenced by `posts_published.scheduled_post_id` (1 → 0..1).

### 13.3 `posts_published` — own published tweets (Goal 2 root)

One row per tweet you actually published — via the scheduler *or* manually (the reconcile pass discovers manual ones). This is the root the metrics poller walks.

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `tweet_id` | text | no | — | **PK** (the X id) |
| `scheduled_post_id` | uuid | yes | — | **FK → scheduled_posts.id**; null = manual |
| `text` | text | no | — | |
| `posted_at` | timestamptz | no | — | |
| `is_reply` | boolean | no | `false` | |
| `in_reply_to_tweet_id` | text | yes | — | |
| `conversation_id` | text | yes | — | thread grouping |
| `source` | text | no | — | scheduled / manual |
| `next_poll_at` | timestamptz | yes | — | next metrics sample |
| `poll_count` | integer | no | `0` | |
| `retired` | boolean | no | `false` | true after ~30 days |
| `last_seen_at` | timestamptz | yes | — | last reconcile/poll sighting |

**Index:** `posts_published_next_poll_idx` on `(next_poll_at)` **partial WHERE `retired = false`**. **Lifecycle:** created by the publisher or reconcile; the metrics poller advances `next_poll_at`, increments `poll_count`, and retires at 30 days. **Relationships:** child of `scheduled_posts`; parent of `metrics_snapshots`.

### 13.4 `metrics_snapshots` — own-tweet metric time-series

Append-only. One row per metrics poll of one owned tweet.

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `id` | bigserial (bigint) | no | auto | **PK** |
| `tweet_id` | text | no | — | **FK → posts_published.tweet_id** |
| `snapshot_at` | timestamptz | no | `now()` | |
| `public_metrics` | jsonb | yes | — | likes/retweets/replies/impressions |
| `non_public_metrics` | jsonb | yes | — | nulls after 30 days |
| `organic_metrics` | jsonb | yes | — | nulls after 30 days |

**Index:** `metrics_snapshots_tweet_snapshot_idx` on `(tweet_id, snapshot_at DESC)`. **Lifecycle:** insert-only; never updated or deleted. **Relationship:** child of `posts_published`.

### 13.5 `tracked_authors` — voice-library author registry (Goal 3)

One row per author whose tweets you mirror. Carries the per-author cost guardrails.

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `x_user_id` | text | no | — | **PK** |
| `username` | text | no | — | |
| `added_at` | timestamptz | no | `now()` | |
| `last_pulled_at` | timestamptz | yes | — | last `voicePull` |
| `source` | text | no | `'manual'` | `manual` / `auto_from_scrape` |
| `pull_enabled` | boolean | no | `true` | gate for `voicePull` |
| `max_tweets_per_pull` | integer | no | `50` | per-pull fetch cap |
| `metrics_polling_enabled` | boolean | no | `true` | gate for `voiceMetricsPoll` |
| `max_polled_tweets` | integer | no | `20` | **cost guardrail** — caps metric-polled tweets |

**Lifecycle:** created manually (`/x/voice/track`, both flags on) or by extension scrape (`auto_from_scrape`, both flags **off** — you promote explicitly). Soft-disabling flips both flags off and retires the author's tweets. **Relationship:** parent of `voice_tweets`. **Index:** none (small registry).

### 13.6 `voice_tweets` — mirrored other-author tweets

The stashed tweets themselves. Includes `scraped_html` for the extension-scraping path.

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `tweet_id` | text | no | — | **PK** |
| `author_x_user_id` | text | no | — | **FK → tracked_authors.x_user_id** |
| `text` | text | no | — | |
| `created_at` | timestamptz | no | — | the tweet's own post time |
| `is_reply` | boolean | no | `false` | |
| `in_reply_to_tweet_id` | text | yes | — | |
| `conversation_id` | text | yes | — | |
| `source` | text | no | — | `tracked_pull` / `extension_scrape` |
| `scraped_html` | text | yes | — | raw HTML when scraped |
| `fetched_at` | timestamptz | no | `now()` | |
| `last_seen_at` | timestamptz | yes | — | |
| `next_poll_at` | timestamptz | yes | — | next voice-metrics sample |
| `poll_count` | integer | no | `0` | |
| `retired` | boolean | no | `false` | true after ~7-day window |

**Indexes:** `voice_tweets_author_created_idx` on `(author_x_user_id, created_at DESC)`; `voice_tweets_next_poll_idx` on `(next_poll_at)` **partial WHERE `retired = false`**. **Lifecycle:** created by `voicePull` or scrape; `voiceMetricsPoll` advances/retires it. **Relationships:** child of `tracked_authors`; parent of `voice_metrics_snapshots`.

### 13.7 `voice_metrics_snapshots` — voice-tweet metric time-series

Same shape as `metrics_snapshots`, but **public metrics only** (you can't see private metrics on tweets you don't own).

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `id` | bigserial (bigint) | no | auto | **PK** |
| `tweet_id` | text | no | — | **FK → voice_tweets.tweet_id** |
| `snapshot_at` | timestamptz | no | `now()` | |
| `public_metrics` | jsonb | yes | — | only public metrics exist |

**Index:** `voice_metrics_snapshots_tweet_snapshot_idx` on `(tweet_id, snapshot_at DESC)`. **Lifecycle:** insert-only. **Relationship:** child of `voice_tweets`.

### 13.8 `reply_drafts` — Grok-generated reply drafts (added in migration 0001)

Stores AI-drafted replies with full provenance of the source tweet, the prompt context, token/cost accounting, and an edit→publish lifecycle.

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | **PK** |
| `source_tweet_id` | text | no | — | the tweet being replied to |
| `source_author_username` | text | no | — | |
| `source_author_display_name` | text | yes | — | |
| `source_text` | text | no | — | original tweet |
| `source_url` | text | no | — | |
| `source_posted_at` | timestamptz | yes | — | |
| `context_snapshot` | jsonb | no | — | full context at generation time |
| `reply_text` | text | no | — | Grok's draft |
| `reply_text_edited` | text | yes | — | your edit |
| `model` | text | no | — | Grok model id |
| `prompt_tokens` | integer | yes | — | |
| `completion_tokens` | integer | yes | — | |
| `cost_usd` | **text** | yes | — | denormalized UI convenience (string, not numeric) |
| `grok_request_id` | text | yes | — | upstream trace id |
| `system_prompt_override` | text | yes | — | per-draft prompt override |
| `status` | text | no | `'generated'` | `generated`/`copied`/`posted`/`discarded` |
| `posted_tweet_id` | text | yes | — | set when published |
| `created_at` | timestamptz | no | `now()` | |
| `updated_at` | timestamptz | no | `now()` | |

**Indexes:** `reply_drafts_source_created_idx` on `(source_tweet_id, created_at DESC)`; `reply_drafts_status_created_idx` on `(status, created_at DESC)`. **Lifecycle:** created at generation; edited and advanced through the status machine; `posted_tweet_id` set on publish. **Relationships:** none enforced — `source_tweet_id` is a loose reference (you can draft a reply to any tweet, not just one already in the DB). **Note:** `cost_usd` here is `text`, unlike the `numeric(10,5)` in `cost_events`, so it won't aggregate in SQL — it's a display convenience; the authoritative Grok cost lives in `cost_events`.

### 13.9 `cost_events` — cross-platform spend ledger (shared layer)

The only non-X table; lives in `src/db/shared-schema.ts`. Every billable X *and* Grok call logs a row here. This is the data behind `/cost/today` — the dashboard that *is* the budget cap.

| Column | Type | Null | Default | Key |
|---|---|---|---|---|
| `id` | bigserial (bigint) | no | auto | **PK** |
| `ts` | timestamptz | no | `now()` | |
| `platform` | text | no | — | `'x'` / `'grok'` / later `'linkedin'` — the dispatcher key |
| `endpoint` | text | yes | — | |
| `status` | integer | yes | — | HTTP status |
| `items` | integer | yes | — | result count billed |
| `cost_usd` | numeric(10,5) | yes | — | precise spend |
| `duration_ms` | integer | yes | — | |
| `attempts` | integer | yes | — | retry count |
| `request_id` | text | yes | — | upstream id |

**Indexes:** `cost_events_ts_idx` on `(ts DESC)`; `cost_events_platform_ts_idx` on `(platform, ts DESC)`. **Lifecycle:** insert-only. **Relationship:** standalone — deliberately platform-agnostic (Invariant 6).

### 13.10 Relationship map

```
scheduled_posts ──1:0..1──> posts_published ──1:N──> metrics_snapshots
                            (scheduled_post_id FK,    (tweet_id FK)
                             null = manually posted)

tracked_authors ──1:N──> voice_tweets ──1:N──> voice_metrics_snapshots
                        (author_x_user_id FK)   (tweet_id FK)

tokens         (standalone — OAuth credentials)
cost_events    (standalone — cross-platform spend ledger)
reply_drafts   (standalone — source_tweet_id is a loose, unconstrained reference)
```

Four enforced foreign keys, all `ON DELETE no action ON UPDATE no action`:
1. `metrics_snapshots.tweet_id → posts_published.tweet_id`
2. `posts_published.scheduled_post_id → scheduled_posts.id` (nullable)
3. `voice_metrics_snapshots.tweet_id → voice_tweets.tweet_id`
4. `voice_tweets.author_x_user_id → tracked_authors.x_user_id`

---

## 14. The Grok (xAI) integration

`src/grok/` is a cross-vertical helper that sits *beside* `src/x/` (Grok is an AI provider, not a social platform). It powers Reply Master and the raw `/grok/ask` endpoint. Like `xFetch`, it has a single chokepoint: **`askGrok`**.

### 14.1 Connection & model

| Item | Value |
|---|---|
| Env var | `XAI_API_KEY` (gates the whole vertical) |
| Base URL | `https://api.x.ai/v1` |
| Endpoint | `POST /v1/responses` (the **Responses API**, not legacy `/chat/completions`) |
| Default model | `grok-4.3` (aliases `grok-4.3-latest`, `grok-latest`) |

If `XAI_API_KEY` is unset, `mountGrok` logs a notice and does **not** mount `/grok/ask`; `mountX` likewise skips `/x/replies/*`. `askGrok` throws if invoked without the key.

### 14.2 `askGrok(opts): Promise<AskGrokResult>`

**`AskGrokOptions`:** `model?`, `prompt?` (single-turn convenience), `system?`, `messages?` (multi-turn), `reasoningEffort?` (`none`/`low`/`medium`/`high`), `maxOutputTokens?`, `temperature?`, `maxAttempts?` (default 3), `signal?`. Either `prompt` or non-empty `messages` is required.

**Request body** sent to xAI: `{ model, input: [{role,content},…], reasoning?: {effort}, max_output_tokens?, temperature? }`. Note the Responses API uses `input` (not `messages`) and returns `output_text` (not `choices[0].message.content`); `askGrok` implements this by hand with raw `fetch` — no OpenAI SDK.

**`AskGrokResult`:** `{ text, model, usage: {inputTokens, cachedInputTokens, outputTokens, totalTokens}, costUsd, durationMs, requestId }`.

**Retry policy:** up to `maxAttempts` (default 3); retries on `429`/`500–504`, honoring `retry-after` (capped 60 s) else exponential backoff + jitter. Aborts and already-classified `GrokApiError`s are never retried.

### 14.3 Pricing (`src/grok/pricing.ts`)

`grok-4.3` token rates (May 2026 USD), per 1M tokens:

| | Per 1M tokens |
|---|---|
| Input | $1.25 |
| Cached input | $0.20 |
| Output | $2.50 |

`priceFor(model, usage)` resolves aliases, returns 0 for unknown models, and computes `billableInput = max(0, inputTokens − cachedInputTokens)` (xAI reports `input_tokens` *including* the cached slice, so the cached portion is billed at the cache rate and the remainder at full input rate). **Known limitation:** tiered pricing above the 200K-token context window is not modeled, so very long contexts under-report.

### 14.4 Cost logging

`askGrok` does its own fire-and-forget insert into `cost_events` (`platform='grok'`, `endpoint='/v1/responses'`), so Grok spend shows up in `/cost/today` with no schema change. On the error path it still logs a zero-cost row before throwing. This deliberately bypasses the endpoint-priced `costTracker` middleware (which is for X), because Grok is priced by tokens, not by endpoint.

### 14.5 The `/grok/ask` route

`POST /grok/ask` (bearer-guarded) validates the body via `parseBody` (requires `prompt` or non-empty `messages`; type-checks `system`, `model`, `reasoningEffort`, `maxOutputTokens`, `temperature`). On success it returns the full `AskGrokResult`. A `GrokApiError` maps to `502` (401/403/other) or `429` (rate limit); any other failure is `502 grok_request_failed`. Use this for brainstorming, multi-turn drafting, or any non-reply output where you want the raw model.

---

## 15. The Reply Master system

Replies are the single highest-leverage growth activity for a small account (see [§25](#25-x-growth-strategy--the-coachs-playbook) for the strategy). Reply Master industrializes them — **as a manual-assist tool, never an auto-poster** (Invariant 2 forbids programmatic replies to others).

### 15.1 The flow

1. On an x.com tweet-detail page, the extension's content script attaches a **🪄 Reply Master** button to the focused tweet's action row.
2. Click → the content script scrapes a rich `PostContext` (tweet text, author, metrics parsed from the action-row `aria-label`, and up to 10 top comments) → sends it through the background worker → `POST /x/replies/generate`.
3. The server builds the Grok prompt (`buildGrokInput`), calls `askGrok` (max 280 output tokens, temperature 0.7, reasoning effort `low` by default), and stores a `reply_drafts` row (`status='generated'`).
4. The returned reply text is **copied to your clipboard** and written to a `chrome.storage.local` handoff slot.
5. The side panel's **Replies** tab sees the storage change and swaps the new draft into its editor (a "live" badge). You edit (debounced `PATCH`), Copy (→ `copied`), Regenerate, Mark posted (optional tweet-id → `posted`), or Discard.
6. You paste and post the reply by hand on X, then record the result. **Nothing in this loop touches X's composer programmatically.**

### 15.2 The persona (`src/x/replies/prompt.ts`)

`DEFAULT_SYSTEM_PROMPT` defines a sharp, opinionated voice — a solo indie builder, "Grok-coded, truth-seeking, zero fluff, lightly contrarian, cost-conscious" — with:

- **An objective:** every reply must elevate the original and earn a profile visit.
- **A 3-part architecture:** HOOK → UNIQUE NUGGET → ENGAGEMENT HOOK, in 2–3 sentences.
- **Hard constraints:** ≤270 characters, one idea, no threads/lists, no "Hot take:"-style label prefixes, no hashtags/emoji unless the original used them, output the reply text only.
- **Death traps:** no "Great post!", no self-promo / link drops, no rage-bait.

`buildGrokInput(ctx, override?)` returns a two-message array (system + a rendered user turn with the original tweet, an engagement line `likes= reposts= replies= views=`, and the top replies, up to `MAX_TOP_COMMENTS = 10`). The prompt lives in code (not the DB) so it's testable without standing up the route, and is overridable per-request via `systemPromptOverride` (the extension persists your override across generations).

The default prompt is the worked expression of the operator's niche (§1) — which is exactly why it's worth tuning to your own.

### 15.3 The status machine

`generated → {copied, posted, discarded}` · `copied → {posted, discarded}` · `posted → {discarded}` · `discarded` is terminal. A bad transition returns `409 invalid_status_transition`. `postedTweetId` may only be set when the final status is `posted`. The side-panel editor and the `PATCH /x/replies/:id` route both enforce this.

---

## 16. The voice library

The voice library is your private corpus for studying what works in your niche. Its mental model is a three-level hierarchy:

```
tracked_authors  →  voice_tweets  →  voice_metrics_snapshots
```

### 16.1 Two ways an author enters the library

| Source | How | Default flags | Cost |
|---|---|---|---|
| `manual` | `POST /x/voice/track {username}` (or the side-panel) | `pull_enabled` + `metrics_polling_enabled` **on** | $0.010 lookup |
| `auto_from_scrape` | The extension's "Save to stratus" button on x.com | both flags **off** (you promote later) | $0.010 per *new* author only; content free |

This asymmetry is a money safety. Manually tracking an author is an explicit, paid decision to actively mirror them. Scraping a tweet in passing should *not* silently enroll its author for paid pulls — so scraped authors land paused, visible in the side panel's "promote to actively track" list, and you opt them in deliberately.

### 16.2 Cost guardrails

- `voicePull` (hourly) reads at **$0.005/tweet**; `max_tweets_per_pull` (default 50) bounds each pull.
- `voiceMetricsPoll` is **opt-in** (`VOICE_METRICS_POLL_ENABLED=true`) and only ever polls the newest `max_polled_tweets` (default 20) of each author. At the default that's ≈ 20 × $0.09 ≈ **$1.80/author per 7-day window**.
- **Soft-disabling** an author (`DELETE /x/voice/track/:username`) flips both flags off *and retires their tweets*, stopping all spend while keeping the history. Re-tracking re-enables.
- **Promote-via-PATCH** is cheaper than re-tracking because it skips the $0.010 username lookup.

### 16.3 Browsing

`GET /x/voice/tweets` joins each stashed tweet to its author and its latest metrics snapshot (via a correlated subquery), with substring search (`q`, wildcards escaped), a `minLikes` floor (on the latest snapshot, NULL→0), an `includeReplies` toggle, and a limit (≤200, default 50). The side panel's **Voice** tab is the UI for all of this.

---

## 17. The Chrome extension

A React 19 + Vite 6 Chrome **Manifest V3** extension that turns x.com into the Stratus cockpit. It is loaded **unpacked** from `extension/dist/` (never published to the Web Store).

### 17.1 The manifest (`public/manifest.json`)

- **MV3**, `name: stratus`, version `0.0.1`.
- **`action`** — toolbar button (`Open stratus`); clicking it opens the side panel (wired in the background worker via `setPanelBehavior`).
- **`background`** — `service_worker: background.js`, `type: module` (ephemeral ES-module worker).
- **`content_scripts`** — `content.js` on `https://x.com/*` and `https://twitter.com/*` at `document_idle`.
- **`side_panel`** — `default_path: sidepanel.html`.
- **`permissions`** — `sidePanel`, `storage`, `clipboardWrite`.
- **`host_permissions`** — `https://x.com/*`, `https://twitter.com/*`, `http://127.0.0.1/*`, `http://localhost/*`.

> **Deployment caveat:** `host_permissions` currently whitelists only localhost API hosts. If you point the extension at a remote Stratus URL (e.g. your Hetzner domain), add that origin to `host_permissions` or the background fetch may be blocked.

Because the MV3 service worker is ephemeral, the background holds no in-memory session state — it re-reads settings from `chrome.storage.local` on every request.

### 17.2 Build & load

```bash
cd extension
bun install
bun run build        # vite build → extension/dist/
# then: chrome://extensions → Developer mode → Load unpacked → select extension/dist/
```

`vite build` produces three rollup entries (`sidepanel`, `background`, `content`) with fixed output names (`background.js`, `content.js`) because the manifest references them by name. `minify: false` keeps the output readable for debugging. `bun run dev` is a watch-rebuild loop (a Chrome extension can't use Vite's HMR dev server).

### 17.3 Message-passing architecture

Three contexts — **side panel** (React), **content script** (x.com DOM), **background** (service worker) — communicate via a typed wire format (`shared/messages.ts`):

```ts
ApiRequest  = { type:'stratus/api', method, path, query?, body? }
ApiResponse = { ok:true, status, data } | { ok:false, status, code }
```

The **background worker is the single auth chokepoint** for content-script traffic: it's the only context that reads the bearer for those requests, loads `{apiUrl, bearer}` from `chrome.storage.local` (returning `code:'unconfigured'` if either is empty), stamps the `Authorization` header, fetches, and normalizes errors (`network_error`, `http_<status>`, `background_error`). The **side panel** takes a parallel direct-fetch path (`sidepanel/api.ts`) for latency, reading the same settings itself. Both attach the same bearer.

### 17.4 The side-panel tabs (`src/sidepanel/`)

- **Calendar** — a 7-day forward view, posts bucketed by local day with status badges; click a post to edit it in the Composer.
- **Composer** — create/edit a scheduled post with a 280-char counter, a local-time picker (converted to UTC ISO), automatic draft↔pending status transitions, and a **client-side mirror of the URL-surcharge warning** (Invariant 1). Posted rows are locked read-only.
- **Drafts** — lists `draft` posts (no scheduled time); click to open in the Composer.
- **Voice** — the voice-library browser: author cards (manual vs auto, tracked vs paused), promote/pause actions, debounced tweet search, latest metrics per tweet.
- **Replies** — "Reply Master": the live draft editor (auto-swaps in new drafts from the content-script button via the `replyMaster:lastDraft` storage slot), debounced edits, Copy/Regenerate/Mark-posted/Discard, day-grouped history ("Today"/"Yesterday") with status filters and per-status counts, and a persisted system-prompt override.
- **Settings** — `apiUrl`, `bearer` (= server `API_TOKEN`), and `replyHarvestLimit` (0–10 surrounding tweets to also save on a status page). Until both URL and bearer are set, every other tab is disabled and the app force-routes here.

Cross-tab state lives in `App.tsx`: `editingId` (clicking a post anywhere jumps to the Composer in edit mode) and `refreshKey` (bumped on save to remount Calendar/Drafts/Replies).

### 17.5 The content script (`src/content.ts`)

Runs on x.com / twitter.com. X virtualizes tweets in and out of the DOM constantly, so the script uses a single document-wide `MutationObserver` (coalesced via `requestAnimationFrame`) and `WeakSet`-based dedup to attach buttons exactly once per action row (anchored on the `[data-testid="reply"]` button's `div[role="group"]`):

- **"Save to stratus"** — scrapes the tweet (id, username, display name, text, timestamp, url) at click time and `POST`s it to `/x/voice/scrape`. On a tweet-detail page it can also harvest up to `replyHarvestLimit` surrounding tweets (parents above + replies below). DOM scraping is the deliberate cost-avoidance path — no paid other-user API reads for content.
- **"🪄 Reply Master"** — only on the focused tweet of a status page. Scrapes the rich `PostContext` (including metrics from the action-row `aria-label` — each metric matched independently by regex since order varies by locale — and up to 10 top comments), reads the current system-prompt override, and `POST`s to `/x/replies/generate`, then copies the result and hands it to the side panel.

### 17.6 Local storage keys

| Key | Written by | Read by | Purpose |
|---|---|---|---|
| `apiUrl` | Settings | background, side-panel api | Stratus base URL (trailing slash stripped) |
| `bearer` | Settings | background, side-panel api | `= API_TOKEN` |
| `replyHarvestLimit` | Settings | content script | 0–10 surrounding tweets to also save |
| `replyMaster:lastDraft` | content script, Replies tab | Replies tab | handoff slot for the newest draft |
| `replyMaster:systemPromptOverride` | Replies tab | content script + Replies tab | Grok prompt override (empty = server default) |

Everything is `chrome.storage.local` (no `sync`, no `session`), with `onChanged` listeners for cross-context reactivity.

---

## 18. The operator skill & scheduling scripts

`.claude/skills/stratus/` is a Claude skill that drives the Stratus HTTP API conversationally. It never touches X directly — everything goes through the bearer-guarded service.

### 18.1 `SKILL.md`

Connects to `$STRATUS_BASE_URL` (deployed default, falling back to `http://127.0.0.1:3000`) with `Authorization: Bearer $STRATUS_API_TOKEN`. It documents the full 24-route surface and six workflows (A–F): schedule a week, audit/edit the calendar, read tweet metrics, manage the voice library, draft replies, and read the cost dashboard. Its preflight discipline: source env → `curl /healthz` → stop on 503/401 (never retry a 401). It encodes the five "learned-the-expensive-way" safety rules (URL surcharge, reply-to-others policy, UTC ISO scheduling, voice cost reminders, posted-row write-lock) and never echoes the bearer.

### 18.2 `references/scheduling.md` & `md_to_schedule.ts`

The scheduling cadence rules (also enforced by the converter script):

- **3/day anchors: 09, 13, 18 local; 4/day anchors: 08, 12, 16, 20 local.**
- **Minute jitter in `[5, 35]`, seconds `00`, distinct per slot across the 7 days** — explicitly so the account doesn't look like a cron job firing at `:00`/`:30`.

`md_to_schedule.ts` converts a markdown file of blockquoted tweets into a jittered weekly schedule:

```bash
bun run md_to_schedule.ts <md-file> <IANA-timezone> <YYYY-MM-DD start> <3|4 slots/day>
```

Each tweet is one contiguous run of `> ` lines; the script must find exactly `slots × 7` (21 or 28) tweets. It **refuses URLs** (exit 4) and tweets over 280 chars (warns over 270), samples distinct jitter minutes without replacement per slot column, and converts local wall-time to UTC in a DST-safe way (using `Intl.DateTimeFormat` offset back-calculation, stepping dates at midday UTC to dodge DST edges). Output is non-deterministic (fresh jitter each run), so the previewed JSON must be the submitted JSON. It pairs with `schedule_week.sh`, which POSTs each row sequentially and halts on the first non-2xx.

### 18.3 `references/replies.md` & `references/voice.md`

These mirror §15 and §16 — the reply status machine and full context schema, and the voice-library cost model and promote-vs-retrack guidance. They are the operator-facing version of this README's strategy sections.

---

## 19. Testing

```bash
bun test            # runs src/test.test.ts
bun run typecheck   # tsc --noEmit
bun run lint        # biome check .
```

The unit tests cover exactly the **pure-function money/lockout/policy invariants** — no network, no DB, by design:

1. `containsUrl` — the URL-surcharge detector (flags http/https/HTTPS anywhere; ignores plain text and `undefined`).
2. `defaultPostParams` — private-metric field toggling.
3. `errors.classify` — 401 → `auth_invalid`, 403+"not permitted" → `reply_restriction`, 403+"Duplicate" → `duplicate_content`, 5xx → `server_error`.
4. `pricing.priceFor` — every priced endpoint, the search per-result multiply, the **4xx-returns-$0** rule, query-string stripping, and the unknown-endpoint-returns-$0 gap.
5. `metricsPoll` cadence ladder (`nextPollDelay`) — every boundary up to retirement at 30 days.
6. `voiceMetricsPoll` cadence ladder (`nextVoicePollDelay`) — every boundary up to retirement at 7 days.
7. `cors.matchOrigin` — any `chrome-extension://*` allowed, static set exact-match only (trailing slash fails), empty origin rejected, no scheme-smuggling.
8. PKCE — verifier ≥43 chars, challenge differs, both base64url; authorize URL contains `S256` + `offline.access` + `tweet.write`.

Integration and route tests are intentionally a separate concern (they belong in a sandbox where spend is controlled).

---

## 20. Deployment

The reference deployment (documented in `DEPLOY.html`) is a single **Hetzner Cloud CX23** (2 vCPU / 4 GB / 40 GB Ubuntu), with **Caddy** terminating HTTPS and reverse-proxying to the Bun app on `127.0.0.1:3000`, supervised by **systemd**. The database is the same Neon instance you use locally — tokens live in Neon, so there's nothing to copy.

### 20.1 The shape

```
Internet ──HTTPS:443──> Caddy (auto Let's Encrypt) ──> 127.0.0.1:3000 (Bun) ──> Neon Postgres
```

Caddy auto-issues certificates because X requires HTTPS for OAuth callbacks (except on `127.0.0.1`). Your domain is either a real `A`-record domain or a free `sslip.io`/`duckdns.org` hostname pointing at the server IP. The deploy tooling uses the `hcloud` CLI for server ops (`brew install hcloud`; `hcloud context create stratus`) — Terraform/cloud-init was deemed overkill for a single box.

### 20.2 The two scripts

`DEPLOY.html` describes two idempotent bash scripts under `scripts/`:

- **`bootstrap.sh`** (run once) — SSHes in as root; installs packages; configures a UFW firewall (deny incoming, allow 22/80/443); creates a non-root `stratus` user with `/home/stratus/app`; installs Bun and Caddy; writes the `Caddyfile` (`$DOMAIN { encode zstd gzip; reverse_proxy 127.0.0.1:3000 }`); and writes the systemd unit.
- **`deploy.sh`** (rerun every change) — `rsync -az --delete` (excluding `.git`, `node_modules`, `extension/node_modules`, `extension/dist`, `.env`, `.env.local`, `.tokens.json`) → `/home/stratus/app`; one-time `scp .env` then `chmod 600`; `bun install --frozen-lockfile`; `systemctl restart stratus.service`; health check via `systemctl is-active` + `curl -fsS http://127.0.0.1:3000/healthz`.

> **Note:** verify these scripts exist in your checkout before relying on them — `DEPLOY.html` was written when they were still to-be-created. There is a recent `scripts` commit in the history; confirm its contents.

### 20.3 The systemd unit

`stratus.service`: `ExecStart=/usr/local/bin/bun run src/app.ts`, `WorkingDirectory=/home/stratus/app`, `EnvironmentFile=/home/stratus/app/.env`, `User/Group=stratus`, `Restart=on-failure`, `RestartSec=3`, `LimitNOFILE=65535`, plus hardening (`NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome=false`, `ReadWritePaths=/home/stratus/app`, `PrivateTmp=true`).

### 20.4 Deploy-time env

Same `.env` as local, plus a public `X_OAUTH_REDIRECT_URI` (`https://$DOMAIN/auth/x/callback`) if you re-auth on the server. `ALLOWED_ORIGINS` can stay blank (the extension is matched by `chrome-extension://*`). `PORT=3000` (Caddy fronts 443). You can keep doing OAuth on your laptop with the `127.0.0.1` redirect — the rotated refresh token syncs through the shared Neon `DATABASE_URL`. There is no build step: Bun runs `.ts` directly.

### 20.5 Pointing the extension at production

Side panel → **Settings** → API base URL = `https://$DOMAIN` (no trailing slash), Bearer = `API_TOKEN`. Add the domain to the extension's `host_permissions` if needed (§17.1).

---

## 21. Operations & day-2 runbook

| Task | Command |
|---|---|
| Tail app logs | `journalctl -u stratus -f` |
| Tail Caddy logs | `journalctl -u caddy -f` |
| Restart / status | `systemctl restart stratus` · `systemctl status stratus` |
| Health check | `curl -fsS http://127.0.0.1:3000/healthz` |
| Today's spend | `curl -s https://$DOMAIN/cost/today -H "Authorization: Bearer $API_TOKEN"` |
| Server snapshot | `hcloud server create-image …` |
| DB backups | Neon snapshots Postgres itself |

**Disabling a worker without redeploying code** is just an env change + restart: set `METRICS_POLL_ENABLED=false` (or any gate) in `.env` and `systemctl restart stratus`. The manual `POST /x/posts/reconcile` still works even with the reconcile timer off.

---

## 22. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Boot throws `DATABASE_URL is required` / `API_TOKEN is required` / `<X var> is required` | A required env var is missing | Fill it in `.env` (§7). |
| `bun run play` says `no tokens row (id=default)` | You haven't completed OAuth | Run `bun run auth` and authorize. |
| OAuth callback 400s with "unknown/expired state" | The OAuth server restarted (in-memory state lost) or >5 min elapsed | Restart the flow from the start URL. |
| A scheduled post flips to `failed` with no obvious reason | The text contained a URL (Invariant 1) | Remove the URL or move it to a reply; the publisher never opts into the $0.20 surcharge. |
| Reply-to-others fails with a policy error | Feb 2026 programmatic-reply restriction (Invariant 2) | Reply Master only drafts; post manually and PATCH `status='posted'`. |
| `/x/replies/*` or `/grok/ask` returns 404 / not mounted | `XAI_API_KEY` not set | Set it and restart. |
| Extension shows `unconfigured` | `apiUrl`/`bearer` not set in Settings | Fill both in the Settings tab. |
| Extension fetch to a remote host is blocked | Remote origin not in `host_permissions` | Add it to the manifest (§17.1) and reload the extension. |
| "Save to stratus" returns `http_404` | The `/x/voice/scrape` server endpoint isn't deployed in your build | Update the server. |
| Cost dashboard looks low for a URL post or a search | Known under-counting (§8) | Expected — the *guards* still prevent overspend; only the ledger is conservative. |
| `getValidAccessToken` errors after a refresh | Possible token-rotation race | Never bypass the `FOR UPDATE` transaction in `token-store.ts` (Invariant 3). |

---

## 23. Security model

- **One shared secret.** `API_TOKEN` is the single bearer guarding `/x/*`, `/cost/*`, `/grok/*`. The extension uses the same token. Multi-tenant auth is out of scope (one user). The bearer compare is **constant-time** to prevent timing inference.
- **`/healthz` is public** so liveness probes don't need the token.
- **CORS** allows any `chrome-extension://*` (the unpacked extension's id changes per install) plus whatever's in `ALLOWED_ORIGINS`. Methods `GET/POST/PATCH/DELETE/OPTIONS`, headers `Authorization`/`Content-Type`, preflight cached 600 s. CORS is mounted *before* bearer auth so the credential-less preflight short-circuits.
- **Tokens** live in Postgres as plaintext (single-user, single-tenant). The token-rotation transaction (Invariant 3) is the one piece of this you must never weaken.
- **The OAuth server is a dev tool** — don't expose it publicly.
- **Production hardening** is at the systemd level (`NoNewPrivileges`, `ProtectSystem=strict`, non-root user) and the firewall (UFW: only 22/80/443).
- **Never echo the bearer** in logs or skill output.

---

## 24. Phase status & roadmap

The canonical build plan is `PLAN.md`; the authoritative "what's actually wired" is `src/x/index.ts`. Current status:

| Phase | Scope | Status |
|---|---|---|
| **1 — Plumbing + Calendar** | Hono app, bearer + CORS, Drizzle/Neon, Postgres token store, pricing + costTracker, calendar routes, publisher worker | ✅ done |
| **2 — Metrics + own-reconcile** | `posts_published`, `getUserTweets`, `ownReconcile` + `metricsPoll`, `/x/metrics`, `/x/posts/reconcile`, cost dashboard | ✅ done |
| **3 — Voice library** | voice routes, `voicePull` (hourly), `voiceMetricsPoll` (opt-in) | ✅ done |
| **4 — Extension MVP** | Vite + React side panel, calendar/composer/drafts, CORS; smoke-tested end-to-end 2026-05-10 | ✅ done |
| **5 — Extension scraping → voice library** | MutationObserver "Save to stratus" buttons, `/x/voice/scrape` | 🟡 wired (scrape route + buttons exist; confirm everywhere the extension points) |
| **6 — Reply Master** (per `REPLY-MASTER-PLAN.md`) | `reply_drafts`, `/x/replies/*`, Grok integration, in-page reply button, side-panel Replies tab | ✅ done |

After Phase 5, the original plan says: **stop — analysis of the voice library is a separate project.** The growth-strategy and future-enhancement sections below are *my* recommendations for what comes next, not committed scope.

---

## 25. X growth strategy — the coach's playbook

> This section is written wearing a different hat: not the engineer documenting the machine, but the **growth strategist** advising the operator on how to point it. It synthesizes the operator's niche (`src/my_niche.md`) and the reply doctrine (`REPLY GUIDE.md`) into an actionable plan. The tooling already exists; this is how to *use* it.

### 25.1 Know exactly who you are (positioning)

You are **@13_narcissus — the relentless solo builder who engineers his own tools to escape the 9-5.** Not a guru. Not a thread-boy farming engagement. A quiet, tool-first independent who builds *for himself* and documents the journey with zero fluff. Your edge in a feed full of AI slopware and hustle-theater is **substance**: real tools, real costs, real psychology of long-term building.

Your five content pillars (already latent in everything you've written):

1. **Hands-on creation** — building lean tools. Stratus itself is the flagship worked example: a wrapper that tracks and *refuses* expensive API calls.
2. **Cost-conscious / efficiency engineering** — the 80/20 applied to builder workflows; the dollar discipline most builders never bother with.
3. **Builder psychology & discipline** — focus, the daily grind, accountability, celebrating small consistent wins.
4. **Awareness of the modern builder's traps** — AI slopware temptation, shiny-tool syndrome, scattered distraction.
5. **The no-quit mindset** — *"the only way to lose is to quit."*

Every scheduled post and every reply should be unmistakably one of these five. If a draft doesn't map to a pillar, it doesn't ship.

### 25.2 The core thesis: replies are the engine, posts are the proof

For an account your size, this is the single most important strategic fact, and it's why Reply Master exists:

- **Replies carry far more algorithmic weight than likes** — on the order of 13–27× for a reply, and reply-to-reply chains far higher again.
- **Replies borrow audiences.** A good reply to an account 2–10× your size puts you in front of *their* engaged followers — an audience you could never reach with an original post into your own small follower graph.
- **Original posts are the closer, not the opener.** When a borrowed-audience reader visits your profile, your pinned post and recent timeline have to convert them. That's what the scheduler is *for*: a consistently-stocked, high-signal timeline so every profile visit lands on proof.

The operating ratio: **70/30 — 70% strategic replies, 30% original posts**, until you're past ~10k followers. Then you can flip it.

### 25.3 The reply system (daily — the highest-leverage hour you'll spend)

1. **Build a target list of 10–20 niche voices** 2–10× your size in the indie-hacker / build-in-public / cost-aware-engineering lane. Put them on a private X list with notifications on. These are the accounts whose audiences you want to borrow.
2. **Reply fast — within the first 15–60 minutes.** Early replies on a tweet that's about to take off ride its distribution. Notifications on your target list is how you catch them.
3. **Every reply is a Value Amplifier.** The doctrine: *"Add signal, not noise. Elevate or stay silent."* Don't reply *to* the tweet — *elevate* it. The 3-part architecture (which the Grok prompt enforces): **HOOK** (reference the original) → **UNIQUE NUGGET** (your insight / data / story / contrarian take) → **ENGAGEMENT HOOK** (a question or bold statement that invites a response). 2–3 sentences, ≤270 chars.
4. **Use Reply Master to industrialize, not to automate.** Scrape the context, generate a draft, *edit it to sound like you*, post manually, record it. The human edit is non-negotiable — the draft is a 70%-there starting point, not a ship-it.
5. **Reply to your own replies fast.** Reply-to-reply chains have the highest multiplier of all; a quick follow-up nugget under your own reply compounds it.
6. **Avoid the death traps** the prompt already forbids: emoji-only replies, "Great post!", self-promo/link drops, rage-bait. They mark you as noise and the algorithm (and humans) learn to skip you.

### 25.4 The posting system (the proof, on autopilot)

1. **Batch-write a week at a time** in a markdown file of blockquoted tweets, run `md_to_schedule.ts`, preview the jittered calendar, confirm, submit. One sitting per week stocks the timeline.
2. **3–4 posts/day at human hours** (anchors 09/13/18 or 08/12/16/20 local), minute-jittered so it never reads as automation.
3. **Rotate the pillars.** A week's worth might be: two hands-on build logs, one cost/efficiency nugget, two psychology/discipline reflections, one trap-awareness take, one no-quit line. Variety within a coherent identity.
4. **No URLs in scheduled posts** — both because of the 13× surcharge guard (the publisher will silently fail them) *and* because link-posts are down-ranked. Put links in a reply under your own post if you must.
5. **Your pinned post is your single most valuable real estate.** Make it your best build-in-public banger — the thing a borrowed-audience visitor reads first. Revisit it monthly.

### 25.5 Use the voice library as a coach, not a museum

The voice library isn't for hoarding tweets — it's for *reverse-engineering what works in your exact niche*:

- Track the 10–20 accounts from your reply target list.
- Once a week, browse `voice_tweets` sorted by `minLikes` and study the **structure** of the top performers: how they open, how long they are, where the hook lands, whether they ask a question. Feed those patterns back into your own drafts and into the Grok system prompt.
- Promote (to paid metrics polling) only the handful of authors whose *velocity* you genuinely want to study over time. Keep the rest as a free content reference, and remember every promoted author can cost up to ~$1.80/7 days.

### 25.6 Close the loop with data

- **Weekly:** read `/cost/today` trends and your metrics history. Which replies drove profile visits and follows? (Profile-click metrics are exactly what `non_public_metrics` captures on your own tweets in the first 30 days — after that they null out, so the data is most valuable *early*.) Double down on the reply *styles* that converted.
- **Monthly:** review which content pillar earned the most engagement and which earned the most *follows* (they're often different — engagement ≠ growth). Reweight your weekly batch accordingly.
- **The metric that matters** for a builder your size isn't impressions — it's **follows per profile visit** and **replies that turned into relationships**. The DM ladder (a great reply → a real conversation → a relationship) is where the compounding actually happens.

### 25.7 The 90-day arc

- **Days 1–30 — systems on.** 30+ strategic replies/day, 3 posts/day, target list built, Reply Master in the daily loop. Goal: establish presence and voice consistency. Don't watch follower count; watch reply quality and profile visits.
- **Days 31–60 — optimize.** Use the voice library and your metrics history to learn which reply styles and which pillars convert. Tighten the Grok prompt to your winning voice. Start the DM relationship ladder with the people who reply back.
- **Days 61–90 — compound.** The early relationships start amplifying you. Begin reply-to-reply chains aggressively. If you've crossed ~10k, start shifting toward 50/50 replies/posts. Ship a build-in-public milestone post about Stratus itself — the tool is the content.

The whole machine exists to make this arc *cheap to run and impossible to fake*. The discipline is yours; Stratus just removes the friction and the overspend.

---

## 26. Future enhancement plan

These are *my* recommendations for where the machine should grow next — ordered roughly by leverage-per-unit-effort, and consistent with the scope ceiling. None of this is committed; it's a strategist-engineer's backlog.

### 26.1 Close the cost-accounting gaps (small effort, real correctness)
- **Thread `items` through `xFetch`** so per-result endpoints (search, user-tweets) record their true cost in `cost_events` instead of `null`. The pricing function already accepts `items`; the cost hook just needs to pass it.
- **Body-aware pricing for the URL surcharge** so a URL post records $0.20 (not $0.015) in the ledger. A `costHint` on `createPost` would do it. Today the *guard* is right but the *dashboard* under-reports.
- **A weekly/monthly cost rollup** (`/cost/week`, `/cost/month`) and a small chart in the extension. The dashboard is the budget cap — make it impossible to ignore.

### 26.2 Make the metrics actually visible (medium effort, high motivation payoff)
- **A metrics tab in the extension** that charts `metrics_snapshots` over time per tweet — impressions, likes, and (crucially) profile-clicks in the first 30 days. The data is already collected; it just isn't surfaced.
- **A "what converted" view** that correlates replies with subsequent profile-visit spikes. This is the single most strategically useful thing the data can tell a small account, and nothing in the UI shows it yet.
- **Best-time-to-post analysis** from your own history, feeding back into the scheduler's anchor hours.

### 26.3 Finish and harden Phase 5 (voice scraping)
- Confirm `/x/voice/scrape` is deployed everywhere the extension points (the content script currently can surface `http_404` against older builds).
- **Promote the extension's `host_permissions`** to include the production domain (or make it configurable), so the cockpit works against the deployed instance without manifest edits.
- **Dedup and thread-reconstruction** on scraped threads so `conversation_id` chains are navigable in the Voice tab.

### 26.4 Turn the voice library into a coach (the "separate project" the plan deferred)
This is where the real differentiated value is, and it's squarely in the operator's niche:
- **Structural analysis of top-performing voice tweets** — length, hook pattern, question-presence, opener type — surfaced as patterns, not raw text.
- **A "draft in the style of my best performers" mode** that feeds the voice library's winners into the Grok prompt as few-shot examples.
- **Velocity tracking** — which tracked authors are *accelerating*, so you reply to them while they're rising.

Keep this behind the existing cost gates; other-user reads are 5× and the per-author cap is load-bearing.

### 26.5 Reply Master, leveled up
- **A fast-model variant** (cheaper Grok tier) for high-volume first-pass drafts, reserving `grok-4.3` for the ones you'll actually post.
- **Self-tweet awareness** so the context scrape hides your own tweets in a thread.
- **Quoted-tweet context** so replies to QTs understand what's being quoted.
- **A lightweight regenerate rate-limit** so a frustrated click-storm doesn't run up token cost.
- **Reply outcome learning** — record which posted replies earned profile visits, and feed that signal back into prompt tuning.

### 26.6 Resilience & observability (when one process stops being enough)
- The architecture is honest that it's one process with `setInterval` workers. *Before* reaching for Redis/BullMQ, the `FOR UPDATE SKIP LOCKED` pattern already makes a second replica safe — so horizontal scale is a deploy change, not a rewrite. Document the two-replica story.
- **Structured logging + a tiny `/metrics` (Prometheus) endpoint** for worker tick health and per-worker spend, so a stuck worker is visible without tailing logs.
- **A dead-letter view** for `failed` scheduled posts and stuck reply drafts, surfaced in the extension.

### 26.7 The next platform (proving the architecture)
- When (if) it's time, add `src/linkedin/` as a sibling slice — same shape, registered in `app.ts`, its own pricing table in the `costTracker` registry. The single biggest validation of the per-platform isolation principle is doing it once and touching zero lines inside `src/x/`. Until there's a real reason, don't.

### 26.8 Explicitly still-out-of-scope (don't drift into these)
Media uploads, follower/mute/block sync, multi-tenant auth, Web Store publishing, programmatic replies to others, per-tier budget caps. They remain out of scope for the same reasons in §2. The discipline of *not* building these is part of what keeps the machine lean.

---

## Appendix A — Cookbook (copy-paste recipes)

Concrete, runnable recipes for the things you'll actually do day to day. Set `BASE` and `TOK` once:

```bash
export BASE="http://127.0.0.1:3000"          # or https://your-domain
export TOK="$API_TOKEN"                        # the shared bearer
auth() { printf 'Authorization: Bearer %s' "$TOK"; }
```

### A.1 Schedule a single tweet

```bash
curl -s -X POST "$BASE/x/posts/scheduled" \
  -H "$(auth)" -H 'Content-Type: application/json' \
  -d '{
    "text": "Day 47 of building my own tools instead of renting them. Today: a 60s publisher worker that posts on a jittered schedule so it never looks like a bot.",
    "scheduledFor": "2026-06-02T07:14:00Z",
    "status": "pending"
  }'
```

Remember `scheduledFor` is **UTC ISO 8601 (Zulu)**. If you think in a local timezone, convert first — 09:14 Europe/Bucharest in summer (UTC+3) is `06:14:00Z`.

### A.2 Save a draft now, schedule it later

```bash
# create a timeless draft (no scheduledFor → status defaults to draft)
DRAFT=$(curl -s -X POST "$BASE/x/posts/scheduled" \
  -H "$(auth)" -H 'Content-Type: application/json' \
  -d '{"text":"Shiny-tool syndrome is just procrastination with extra steps."}')
ID=$(echo "$DRAFT" | jq -r .id)

# later: attach a time and promote it to pending
curl -s -X PATCH "$BASE/x/posts/scheduled/$ID" \
  -H "$(auth)" -H 'Content-Type: application/json' \
  -d '{"scheduledFor":"2026-06-03T15:22:00Z","status":"pending"}'
```

### A.3 Audit the week's calendar

```bash
curl -s "$BASE/x/posts/scheduled?from=2026-06-01T00:00:00Z&to=2026-06-08T00:00:00Z" \
  -H "$(auth)" | jq -r '.[] | "\(.scheduledFor)  [\(.status)]  \(.text[0:60])"'
```

### A.4 Cancel or retry

```bash
# cancel a pending post (delete the row entirely)
curl -s -X DELETE "$BASE/x/posts/scheduled/$ID" -H "$(auth)" -i | head -1   # → 204

# retry a failed post: edit it back to pending with a fresh time
curl -s -X PATCH "$BASE/x/posts/scheduled/$ID" \
  -H "$(auth)" -H 'Content-Type: application/json' \
  -d '{"status":"pending","scheduledFor":"2026-06-02T09:05:00Z"}'
```

(You cannot edit or delete a `posted` row — both return `409`.)

### A.5 Read a tweet's metrics history

```bash
curl -s "$BASE/x/metrics/1799999999999999999" -H "$(auth)" \
  | jq '{tweetId, retired, pollCount, latest: (.snapshots[-1].publicMetrics)}'
```

If a tweet you posted manually isn't tracked yet, reconcile first (A.6).

### A.6 Force a reconcile (discover manually-posted tweets)

```bash
curl -s -X POST "$BASE/x/posts/reconcile" \
  -H "$(auth)" -H 'Content-Type: application/json' \
  -d '{"maxResults": 50}' | jq
# → {"scanned": 12, "inserted": 3}
```

Use `{"fullScan": true}` only when you deliberately want to re-walk history (it ignores the `sinceId` checkpoint and is more expensive).

### A.7 Track an author into the voice library

```bash
# $0.010 username lookup; both flags default ON
curl -s -X POST "$BASE/x/voice/track" \
  -H "$(auth)" -H 'Content-Type: application/json' \
  -d '{"username":"someindiehacker","maxPolledTweets":20}' | jq

# pull their recent tweets on demand ($0.005/result)
curl -s -X POST "$BASE/x/voice/pull/someindiehacker" \
  -H "$(auth)" -H 'Content-Type: application/json' \
  -d '{"maxResults":30}' | jq
```

### A.8 Browse the voice library by performance

```bash
# top tweets from a tracked author, by latest-snapshot likes
curl -s "$BASE/x/voice/tweets?author=someindiehacker&minLikes=100&limit=20" \
  -H "$(auth)" | jq -r '.[] | "♥\(.latestPublicMetrics.like_count // 0)  \(.text[0:70])"'
```

### A.9 Pause an author (stop spend, keep history)

```bash
# soft-disable: flips both flags off AND retires their tweets
curl -s -X DELETE "$BASE/x/voice/track/someindiehacker" -H "$(auth)" | jq
# → {"author": {...}, "retiredVoiceTweets": 18}

# promote a scrape-discovered author to active tracking (cheaper than re-track — no lookup)
curl -s -X PATCH "$BASE/x/voice/authors/someindiehacker" \
  -H "$(auth)" -H 'Content-Type: application/json' \
  -d '{"source":"manual","pullEnabled":true,"metricsPollingEnabled":true}' | jq
```

### A.10 Draft a reply with Grok

```bash
curl -s -X POST "$BASE/x/replies/generate" \
  -H "$(auth)" -H 'Content-Type: application/json' \
  -d '{
    "context": {
      "tweetId": "1799999999999999999",
      "handle": "someindiehacker",
      "author": "Some Indie Hacker",
      "text": "Everyone says ship fast but nobody tells you how to know what to ship.",
      "url": "https://x.com/someindiehacker/status/1799999999999999999",
      "postedAt": "2026-06-01T10:00:00Z",
      "metrics": {"views": 12000, "replies": 14, "reposts": 5, "likes": 220},
      "topComments": [
        {"author":"A Builder","handle":"abuilder","text":"talk to 5 users first"}
      ]
    },
    "reasoningEffort": "low"
  }' | jq '{id, replyText, model, costUsd}'
```

Then edit, copy, post by hand on X, and record the outcome:

```bash
DRAFT_ID="<uuid from above>"
curl -s -X PATCH "$BASE/x/replies/$DRAFT_ID" \
  -H "$(auth)" -H 'Content-Type: application/json' \
  -d '{"status":"posted","postedTweetId":"1800000000000000000"}'
```

### A.11 Raw Grok (brainstorming, not a reply)

```bash
curl -s -X POST "$BASE/grok/ask" \
  -H "$(auth)" -H 'Content-Type: application/json' \
  -d '{"prompt":"Give me 5 build-in-public tweet angles about cost-aware engineering. One line each, no hashtags.","reasoningEffort":"low","maxOutputTokens":300}' \
  | jq -r '.text'
```

### A.12 Check today's spend

```bash
curl -s "$BASE/cost/today" -H "$(auth)" \
  | jq '{totalUsd, totalCalls, byPlatform: [.byPlatform[] | {platform, costUsd, calls}]}'
```

---

## Appendix B — A worked weekly scheduling example

This shows the full `md_to_schedule.ts` round-trip. Write a markdown file where **each tweet is one contiguous run of `> ` blockquote lines** (a bare `>` is a blank line inside a tweet). Non-blockquote lines (headers, labels, tables, frontmatter) are ignored, so you can annotate freely.

`week.md` (for a 3/day week you need exactly **21** tweets):

```markdown
# Week of June 1 — 3/day

## Monday
**1.**
> Day 1 of treating my X account like a product.
> Replies are the engine. Posts are the proof.

**2.**
> Cost-aware engineering rule #1: the cheapest API call is the one
> you guard against making by accident.

**3.**
> "The only way to lose is to quit" is not motivation.
> It's just the math of compounding with a survivorship filter.

## Tuesday
**4.**
> ...

# (continue until you have 21 tweets)
```

Generate the jittered schedule (Europe/Bucharest, week starting 2026-06-01, 3 slots/day):

```bash
bun run .claude/skills/stratus/scripts/md_to_schedule.ts \
  week.md Europe/Bucharest 2026-06-01 3 > week.json
```

The script:

- Validates you provided exactly `3 × 7 = 21` tweets (exits non-zero otherwise).
- **Refuses any tweet containing a URL** (exit 4) and any over 280 chars (warns over 270).
- Places each tweet at its day/slot anchor (09/13/18 local for 3/day) with a **random minute in `[5,35]`, distinct per slot column across the week**, seconds `00`.
- Converts each local wall-time to UTC (DST-safe), emitting `...Z` ISO strings.

`week.json` is then an array of `{text, scheduledFor}` ready to POST. Because the jitter is fresh on every run, **the JSON you previewed is the JSON you submit** — don't regenerate between preview and submit. Submit it (sequentially, halting on the first error):

```bash
jq -c '.[]' week.json | while read -r row; do
  curl -s -X POST "$BASE/x/posts/scheduled" \
    -H "$(auth)" -H 'Content-Type: application/json' \
    -d "$(echo "$row" | jq '. + {status:"pending"}')" \
    | jq -r '"queued \(.scheduledFor)  \(.text[0:50])"' || break
done
```

Then verify the queue:

```bash
curl -s "$BASE/x/posts/scheduled?status=pending" -H "$(auth)" | jq 'length'
# → 21
```

---

## Appendix C — Useful SQL (for `drizzle-kit studio` or psql)

When you want to look past the HTTP API. These are read-only inspection queries.

**Spend by platform, last 7 days:**

```sql
select platform, round(sum(cost_usd), 4) as usd, count(*) as calls
from cost_events
where ts >= now() - interval '7 days'
group by platform
order by usd desc;
```

**The most expensive endpoints today:**

```sql
select endpoint, round(sum(cost_usd), 4) as usd, count(*) as calls
from cost_events
where ts >= date_trunc('day', now() at time zone 'utc')
group by endpoint
order by usd desc
limit 10;
```

**Tweets currently live in the metrics poller (not retired) and when they next poll:**

```sql
select tweet_id, poll_count, next_poll_at
from posts_published
where retired = false
order by next_poll_at
limit 20;
```

**Latest snapshot per tracked own-tweet (impressions + likes):**

```sql
select p.tweet_id,
       (s.public_metrics->>'impression_count')::int as impressions,
       (s.public_metrics->>'like_count')::int       as likes
from posts_published p
join lateral (
  select public_metrics
  from metrics_snapshots
  where tweet_id = p.tweet_id
  order by snapshot_at desc
  limit 1
) s on true
order by impressions desc nulls last
limit 20;
```

**Voice library: authors and how many of their tweets you've stashed:**

```sql
select a.username, a.source, a.pull_enabled, a.metrics_polling_enabled,
       count(t.tweet_id) as tweets
from tracked_authors a
left join voice_tweets t on t.author_x_user_id = a.x_user_id
group by a.x_user_id
order by tweets desc;
```

**Reply drafts you generated but never posted:**

```sql
select source_author_username, status, created_at, left(reply_text, 60) as preview
from reply_drafts
where status in ('generated', 'copied')
order by created_at desc
limit 20;
```

> These are for inspection only. Mutating rows directly bypasses the application-level state machines (status transitions, retirement logic, cost logging) — prefer the HTTP API for any change.

---

## 27. Glossary

- **Anchor hours** — the human posting times (09/13/18 or 08/12/16/20 local) that the scheduler jitters around.
- **Cadence ladder** — the decaying schedule on which a tweet's metrics are polled (fast when fresh, slow when old, retired at the end).
- **Cost event** — one row in `cost_events`; a single billable API call, priced and platform-tagged.
- **`FOR UPDATE SKIP LOCKED`** — the Postgres row-locking pattern that lets workers (and replicas) safely claim one row without stepping on each other.
- **Jitter** — the random minute offset (`[5,35]`) applied to each scheduled post so it doesn't fire at a robotic `:00`/`:30`.
- **Owned read** — a $0.001 read of your *own* data (vs. $0.005 for other-user reads).
- **Reconcile** — the daily pass that discovers tweets you posted manually and brings them under metrics tracking.
- **Retirement** — when a tweet's metrics polling stops permanently (30 days for owned, 7 for voice), capping its lifetime cost.
- **Self-reply** — a reply to your own tweet (always allowed), as opposed to a reply to others (policy-blocked on self-serve).
- **URL surcharge** — the 13× ($0.20 vs $0.015) penalty X charges for a post whose text contains a URL.
- **Voice library** — your private corpus of other people's tweets, stashed for style/structure study.
- **Voice tweet** — a mirrored tweet from a tracked author (`voice_tweets`), as opposed to one of your own published tweets (`posts_published`).
- **xFetch / askGrok** — the single chokepoints through which all X / Grok calls flow (retries, errors, cost logging).

---

## 28. FAQ

**Why Postgres for tokens instead of a file?** Because the deployed server and your laptop share one database. OAuth on the laptop with a `127.0.0.1` redirect, and the rotated refresh token is immediately available to the server — no token copying, no lockout risk from a stale file.

**Why `setInterval` workers instead of a queue?** One operator, low write volume. Five timers in one Bun process with `FOR UPDATE SKIP LOCKED` is correct, observable, and a fraction of the operational weight of Redis + BullMQ. The plan is explicit: don't reach for a queue unless something *actually* breaks at one process.

**Why does the publisher silently fail URL posts?** Because the URL surcharge is 13× and the publisher never opts into it (Invariant 1). It's a guard, not a bug — keep URLs out of scheduled text. The Composer warns you before you save.

**Can Stratus auto-reply to other people for me?** No, and it won't — X's Feb 2026 policy blocks programmatic replies to others on self-serve tiers (Invariant 2). Reply Master drafts; you post by hand.

**Why is voice-metrics polling off by default?** Because reading other people's metrics is 5× the cost of your own. It's the one worker that defaults off, enabled only with `VOICE_METRICS_POLL_ENABLED=true`, and even then bounded by the per-author `max_polled_tweets` cap.

**How much does this cost to run?** Pennies, if you respect the guards. Your own metrics tracking is ~$0.113/tweet over its 30-day life; reply drafts are ~$0.0019 each; scheduled posts are $0.015 each. The expensive path (voice metrics) is gated and capped. `/cost/today` is the live truth.

**Can I add LinkedIn?** Architecturally, yes — a `src/linkedin/` sibling slice with the same shape. But only when there's a real reason; the scope ceiling is deliberate.

**Is the extension on the Chrome Web Store?** No — it loads unpacked from `extension/dist/`. Single user, no review cycle, full debuggability.

**Where's the single source of truth for what's actually wired?** `src/x/index.ts` (`mountX` + `startXWorkers`). When this README and the code disagree, the code wins — open a PR to fix the README.

---

## 29. Credits & license

Built by **[@13_narcissus](https://x.com/13_narcissus)** — a solo builder crafting his own tools to evade the 9-5. Stratus is both the tool and one of its own content pillars: the worked example of a lean, cost-aware system you can read end-to-end and trust with your API key.

Companion documents in this repo:
- **`CLAUDE.md`** — session orientation and the non-negotiable invariants (read first if you're contributing).
- **`PLAN.md`** — the canonical phased build plan.
- **`X-API-IMPLEMENTATION-PLAN.md`** — the reference spec for X API behavior, cost, and policy (not a build plan).
- **`X-API-PRICING-REFERENCE.md`** — the pricing reference card.
- **`REPLY GUIDE.md`** + **`REPLY-MASTER-PLAN.md`** — the reply growth philosophy (distilled in §25) and the feature's build plan.
- **`IPSE-Implementation-PRD.md`** — the eventual full product (Identity Graph + agents), explicitly out of scope here.

No license file is present; treat this as a private, single-operator project unless the owner says otherwise.

---

*One machine, three goals, two force-multipliers, and a hard scope ceiling. Build the tool, run the play, don't quit.*
