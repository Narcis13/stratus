# stratus — Comprehensive Manual

> A single-user, deploy-anywhere growth engine for X (Twitter), built on a thin typed wrapper over the X API v2, a local SQLite store, in-process workers, and a Chrome MV3 side-panel extension. This manual is a code-verified reference to **everything currently implemented** as of the Circles milestone (extension v0.2.0, server v0.1.1).

---

## Table of contents

1. [What stratus is](#1-what-stratus-is)
2. [Architecture at a glance](#2-architecture-at-a-glance)
3. [The four goals & the Circles layer](#3-the-four-goals--the-circles-layer)
4. [Server: setup, run, deploy](#4-server-setup-run-deploy)
5. [The Chrome extension](#5-the-chrome-extension)
6. [Feature manual — by workflow](#6-feature-manual--by-workflow)
7. [HTTP API reference](#7-http-api-reference)
8. [Data model (SQLite tables)](#8-data-model-sqlite-tables)
9. [Cost model & money invariants](#9-cost-model--money-invariants)
10. [Workers & scheduling](#10-workers--scheduling)
11. [Non-negotiable invariants](#11-non-negotiable-invariants)
12. [Environment variables](#12-environment-variables)
13. [Common commands](#13-common-commands)

---

## 1. What stratus is

stratus is a personal X operations console for one operator. It does four things, all on top of one place that touches the X API (`xFetch`):

1. **Schedule posts a week ahead** — a calendar plus a 60-second publisher worker that ships tweets, threads, and self-quote re-ups.
2. **Track metrics over time** on every tweet you publish (via the scheduler or by hand from the X app) — a single daily reconcile pass at 03:00 UTC that discovers and snapshots.
3. **Stash other people's tweets** ("voice library" / swipe file) for style/structure analysis — captured by DOM scrape in the extension, so it costs **$0** of X API spend.
4. **Know the people behind the handles** — the **Circles** CRM layer: relationships, conversations, open loops, follow-ups, and a closed learning loop, built entirely from data the first three goals already collect.

**Hard scope ceiling:** if a feature isn't in service of those four goals, it doesn't get built. Explicitly out of scope in v1: replies to non-self tweets and cross-account quote tweets (X Feb-2026 policy), media uploads (OAuth 1.0a), follower/mute/block sync, multi-tenant auth, and publishing the extension to the Chrome Web Store.

---

## 2. Architecture at a glance

```
┌─────────────────────────────┐         ┌──────────────────────────────────────┐
│  Chrome MV3 extension        │  HTTPS  │  Hono server (Bun)                     │
│  (side panel + content js)   │────────▶│  bearer-guarded /x /cost /grok         │
│                              │  bearer │                                        │
│  • on-page capture ($0)      │         │  • xFetch — the ONE place X is called  │
│  • side-panel control UI     │         │  • Grok (xAI) drafting                 │
│  • background = token owner   │         │  • publisher + dailyMetrics workers    │
└─────────────────────────────┘         │  • SQLite (bun:sqlite + Drizzle)       │
                                          └──────────────────────────────────────┘
                                                        │
                                          ┌─────────────┴─────────────┐
                                          │  X API v2   │   xAI (Grok) │
                                          └─────────────────────────────┘
```

**Stack.** Bun ≥ 1.1, TypeScript strict, native `fetch` + `Bun.serve`, Hono for routing, `bun:sqlite` + Drizzle (`sqlite-core`) for state (the driver is **synchronous**), Biome for lint/format, in-process `setInterval`/`setTimeout` workers (no Redis/queue), and a Vite + React 19 Chrome extension.

**Per-platform isolation.** All X-specific code lives under `src/x/`. Cross-platform infrastructure (`src/db/`, `src/middleware/`, `src/routes/`, `src/app.ts`, `src/grok/`) never assumes X. Future platforms (LinkedIn, …) would get sibling `src/linkedin/` folders; nothing inside `src/x/` changes.

**Repo map (server).**

```
src/
  app.ts                Hono app — mounts routers, CORS+bearer middleware, boots workers, SIGTERM drain
  heartbeats.ts         in-process worker liveness registry (feeds /healthz)
  db/                   bun:sqlite + Drizzle singletons (auto-migrate at boot), shared-schema.ts (cost_events)
  middleware/           auth (bearer, constant-time), cors (chrome-extension://*), costTracker (platform-tagged)
  routes/               cost.ts (/cost/today, /cost/daily), healthz.ts (/healthz)
  grok/                 client.ts (askGrok → xAI /v1/responses), pricing.ts (per-token), routes/ask.ts
  shared/               replyBand.ts (canonical band classifier), channelSuggest.ts (both server + extension)
  x/
    auth.ts             OAuth 2.0 PKCE
    token-store.ts      single-row token store + rotation mutex (invariant #3)
    client.ts           xFetch — retries, error parsing, onCost
    endpoints.ts        getMe, getTweet(s), searchRecent, getUserTweets, getUserMentions, createPost, deletePost
    fields.ts errors.ts pagination.ts pricing.ts
    mentions.ts         pullMentions (checkpointed inbox pull + people hooks)
    db/schema.ts        every X-domain table
    posts/              prompt.ts (POST_PROMPT_TEMPLATE), pillars.ts, pillarDraft.ts
    replies/            prompt.ts (REPLY_PROMPT_TEMPLATE + batch)
    people/             stage, store, relationship, angles, followups, sightings, icebreakers  (Circles core)
    conversations.ts playbook.ts quests.ts digest.ts                                           (Circles core)
    routes/             calendar, posts, drafter, metrics, voice, voiceExtract, replies, radar,
                        mentions, brief, harvest, channels, pillars, people, followups,
                        conversations, playbook, digest, ideas, launch
    workers/            publisher.ts (60s), dailyMetrics.ts (03:00 UTC)
    index.ts            mountX(app) + startXWorkers() — the authoritative wiring list
extension/              Chrome MV3 side panel (own package.json, Vite + React)
```

The authoritative statement of what is actually wired is **`src/x/index.ts`** (`mountX` + `startXWorkers`).

---

## 3. The four goals & the Circles layer

Circles (goals 4) is CRM mechanics layered on the exhaust of goals 1–3 — no new recurring X spend. It was adopted in phases C0–C9, each ending usable:

| Phase | Delivers |
|---|---|
| **C0** | Stop the bleeding — top-comments persistence, radar drafts survive the browser (`radar_drafts`), harvest cursor visibility. |
| **C1** | People table + dossier — one row per human, auto-advancing relationship **stage**, append-only event timeline. |
| **C2** | Conversations & open loops — the mention inbox rendered as Slack-style threads, "the last word is theirs" on top. |
| **C3** | Relationship-aware reply drafting — the reply prompt stops meeting everyone for the first time. |
| **C4** | The Playbook — measured feedback signals become a page + prompt constraints (all gated n≥20). |
| **C5** | Follow-up engine, Top Fans, momentum alerts — "what to do today." |
| **C6** | Passive contact capture (hover cards) + Idea Inbox. |
| **C7** | The Launch Room — the first 30 minutes after a post goes live. |
| **C8** | Channels — topics become places (tags + a saved view over people/swipe/ideas/own-post performance). |
| **C9** | Warmth — quests & streaks, Sunday Digest, icebreakers. |

Canonical build docs: `PLAN.md` (goals 1–3), `CIRCLES-PLAN.md` (goal 4), `X-API-IMPLEMENTATION-PLAN.md` (reference-only X API spec), `CLAUDE.md` (session orientation + guardrails).

---

## 4. Server: setup, run, deploy

### Boot sequence (`src/app.ts`)

1. `corsMiddleware()` on `*` (preflight `OPTIONS` short-circuits before auth).
2. `/healthz` mounted **before** the bearer guard (stays public).
3. Bearer guard on three prefixes only: `/x/*`, `/cost/*`, `/grok/*`.
4. `mountX(app)` then `mountGrok(app)`.
5. `Bun.serve({ port: PORT ?? 3000 })`, then `startXWorkers()`.
6. `SIGTERM`/`SIGINT` → graceful `shutdown()`: drains in-flight worker ticks, stops the server, 30 s force-exit backstop. (Prevents a deploy restart mid-`createPost` from leaving a double-post ambiguity.)

`mountX` always mounts the $0 routers (brief, calendar, metrics, pillars, posts, voice, harvest, radar, ideas, channels, followups, people, launch, conversations, digest, playbook, mentions). The Grok-dependent routers (`replies`, `drafter`, `voiceExtract`) mount **only when `XAI_API_KEY` is set**. **Mount-order invariant:** `followups` mounts before `people` because `followups`/`fans` are valid usernames that `GET /people/:handle` would otherwise swallow.

### First-time setup

```bash
bun install
# create .env from .env.example (see §12), fill API_TOKEN, X_CLIENT_ID/SECRET, SELF_X_USER_ID, XAI_API_KEY
bun run auth        # OAuth server on http://127.0.0.1:3000 — authorize the X app, tokens land in SQLite
bun run start       # boots the Hono app + workers
```

Use **`127.0.0.1` not `localhost`** for the OAuth redirect URI. Use the **Production** app environment in console.x.com (Development has a `client-forbidden` bug).

### Deploying to the remote box

`scripts/deploy.sh` is safe to run repeatedly. It:

1. Resolves the host from arg > `STRATUS_DEPLOY_HOST` env > `STRATUS_DEPLOY_HOST` in `.env` (no hardcoded IP).
2. Stamps the short git SHA (with `-dirty` suffix on a dirty tree) into `.git-sha` on the server (surfaced as `gitSha` in `/healthz`).
3. `rsync -az --delete` the working tree (excludes `.git`, `node_modules`, `extension/dist`, `stratus.db*`, `.env`, …).
4. Uploads `.env` **once** (only if missing on the server), fixes ownership to `stratus:stratus`.
5. Diffs the server's `.env` keys against `.env.example` and **warns** about missing keys.
6. `bun install --frozen-lockfile`.
7. Runs migrations idempotently via `bun run scripts/migrate.ts` (the `bun:sqlite` migrator — **not** `drizzle-kit migrate`, whose CLI can't talk to `bun:sqlite`). **Aborts the restart if migrations fail.**
8. `systemctl enable + restart stratus.service`, then a `curl -f http://127.0.0.1:3000/healthz` health check (fails the deploy on a non-200).

```bash
./scripts/deploy.sh                  # uses STRATUS_DEPLOY_HOST
./scripts/deploy.sh root@1.2.3.4     # explicit host
```

The deployed instance answers at `https://stratus-narcis.duckdns.org` (a Hetzner box, systemd unit `stratus.service`, app dir `/home/stratus/app`).

---

## 5. The Chrome extension

**Version 0.2.0.** Chrome MV3, React 19 + Vite 6, TypeScript strict. It is (a) a side-panel control surface and (b) an on-page `x.com`/`twitter.com` capture/assist layer. **The server does all X-API and Grok work; the extension never calls the X API directly.** Everything the extension sends to the server routes through the **background service worker**, the single holder of the bearer token.

### Build & load

The build is **two passes into one `dist/`** because MV3 manifest content scripts load as *classic* scripts (no ES `import`):

- **Content pass** (`CONTENT_BUILD=1 vite build`): input `src/content.ts`, output a single self-contained **IIFE** `content.js` (`inlineDynamicImports`). This is why `extension/src/replyBand.ts` and `extension/src/channelSuggest.ts` are re-export shims of the canonical `src/shared/*` — Vite inlines them so server and page share one classifier.
- **Main pass** (`vite build`): inputs `sidepanel.html` + `src/background.ts`, output ES modules.

```bash
cd extension
npm run build      # rm -rf dist && CONTENT_BUILD=1 vite build && vite build
npm run dev        # same, main pass in --watch
npm run typecheck
```

**To load/reload in Chrome:** enable Developer mode at `chrome://extensions`, **Load unpacked → `extension/dist/`** (first time), or press **Reload** after each rebuild. Never published to the Web Store. Nothing works until **Settings** has the API URL + bearer token (the bearer must equal the server's `API_TOKEN`); all other tabs stay disabled and the app forces Settings until configured.

### Manifest permissions (and why)

| Permission | Why |
|---|---|
| `sidePanel` | the whole UI is a side panel; background sets `openPanelOnActionClick` and opens it on notification click |
| `storage` | `storage.local` (settings, reply drafts, harvest cursors, toggles), `storage.session` (radar buffer, launch state) |
| `clipboardWrite` | Reply Master / Radar / Conversations / Launch / Icebreaker copy-to-paste |
| `clipboardRead` | Cmd+B "type from clipboard" into X's Draft.js composer |
| `contextMenus` | "Send selection to stratus ideas" right-click menu |
| `alarms` | Launch Room — one alarm per pending scheduled post + a 15-min sync alarm |
| `notifications` | "«post» just went live — open the Launch Room" |
| host: `x.com`,`twitter.com` | content-script injection + harvest tab driving |
| host: `stratus-narcis.duckdns.org` | the deployed server (fetch target) |
| host: `127.0.0.1`,`localhost` | local-dev server target |

### Side-panel tabs

1. **Today** (default) — the growth-coach home. One `GET /x/brief` render plus stacked self-fetching sections: **Launch Room** (only within 30 min of a post firing), **quests + streak**, **Do next** (follow-ups), **Conversations** (threaded mentions), **Radar** (session hot/warm queue), **Targets** (2–10× roster), **Top fans**; then brief cards: followers KPI + 14-day sparkline + 7-day delta, today's plan (scheduled slots + cadence gaps), reply-quota bar + week replies/posts ratio, yesterday's posts/replies with metrics, profile-click leaders (each with a "quote re-up" button), spend today, and the **Sunday Digest** card.
2. **People** (C1 CRM) — stage-grouped roster with search + stage filter, and the **dossier**: stage picker (may demote), followers/last-inbound/last-outbound, notes editor, quick log (Note / "DM sent"), Openers (icebreakers), my replies to them with measured outcomes + angle chips, their mentions of me, their saved tweets, and the full event timeline. Unknown handle → "Start their file".
3. **Channels** (C8) — Discord-style `#slug` rail + room: tagged people, own-post performance in the mapped pillar, the tagged swipe slice, open tagged ideas, recent radar drafts; a create/edit form (slug, label, color, mapped pillar, keywords, active).
4. **Calendar** — 7-day grid + an unscheduled-drafts card; rows open in Composer.
5. **Composer** — single-post or **thread** mode (segment list, reorder, "link in tweet 1 = $0.20" warnings), live cost preview, "Move link to first reply", "Split into thread", "Suggest slot". Plus the **drafter**: pillar dropdown, idea seed (free text or Idea-Inbox dropdown), optional voice-tweet structure remix → 3 register-distinct drafts (plain/spicy/reflective).
6. **Harvest** — the human-paced timeline scraper UI (handle, mode Posts/Replies, scope All/Today/Yesterday/Since-last, pace, max rows, "Send to stratus" toggle).
7. **Voice** — the swipe file, with a **Tweets | Pillars** subtab. Tweets: search/hook/extracted filters, per-tweet template chips, channel-tag picker, remix, extract (Grok), retire/delete, batch extract. Pillars: edit label/body, activate, delete, AI-tweak, AI-draft a new pillar.
8. **Replies** ("Reply Master") — the reply-draft workbench: source-context disclosure, variant chips (`extends`/`contrarian`/`debate`), auto-PATCH editor, Copy, Regenerate, Mark posted, Discard, and a system-prompt override editor. Plus day-grouped history.
9. **Ideas** (C6) — quick-add + lifecycle list (open/consumed/discarded), channel tags, provenance backlinks.
10. **Playbook** (C4) — the measured feedback loop as a page: what the prompts inject now, angle effectiveness (+ by author size), band calibration, batch-vs-single, relationship lift, pillar×register, winning structures + the extract-winners button. Cells below n≥20 render "insufficient data".
11. **Settings** — API URL + bearer; toggles `applyPillarsToReplies` (off), `autoTypeReplyDraft` (off), `passiveCapture` (on); Harvest-cursor list with per-row Reset.

### On-page content-script behaviors (all $0)

One `MutationObserver` coalesces into a single `scan()` per animation frame. Per tweet:

- **Band badge** — reads DOM signals (metrics from the action-row `aria-label` via locale-hardened `parseMetricsAria`, age from `<time>`, views-per-minute, reply-bait heuristic), runs the canonical `classifyBand`, and paints the row: green left border (`hot`), amber (`warm`), dimmed 0.45 (`skip`), plus an inline badge like `1.5k · 8r · 22m · reply now`.
- **Radar streaming** — every hot/warm sighting streams to the background session ring buffer (2 s flush, 60 s per-tweet resend unless band changes; 500-char snippet).
- **Save to stratus** — a pill on each tweet's action row scrapes text + `tweetText` innerHTML (emoji-faithful template) + a best-effort author hover card → `POST /x/voice/scrape`. On success, offers up to 3 keyword-suggested channel chips.
- **Save author** — on a profile page, scrapes the full header → `PUT /x/voice/authors/:handle`.
- **Reply Master button** — on a `/status/<id>` page, scrapes `PostContext` (+ up to 10 top comments + band signals) → `POST /x/replies/generate`, copies the reply, stores it for the Replies tab. On a `band_gate` refusal it arms a 5 s "Dead post — click to force" window; a second click resends `override:true`. With `autoTypeReplyDraft` on, it types the draft into the reply box char-by-char instead.
- **Passive hover capture** (C6) — a naturally-rendered author `HoverCard` queues a `PersonSighting` (2 s flush, ≤50/batch) → `POST /x/people/sightings`. Gated by `passiveCapture` (default on).
- **Launch Room early replies** (C7) — while a launch is live and the launched tweet is open, parses early repliers from the DOM → `stratus/launch-report`.
- **Cmd+B type-from-clipboard** — types clipboard text char-by-char into a focused composer (the path X's Draft.js listens on).
- **Harvester** — a human-paced timeline scraper (eased scrolling, reading pauses, lazy-load waits) producing a formula-escaped CSV download + batched ingest to `/x/harvest/*`.

### Background service worker responsibilities

- **API transport** — the only holder of the bearer token; stamps `Authorization`, does the fetch, returns a typed `ApiResponse`.
- **Radar session buffer (single writer)** — `radar:sightings` (cap 100, LRU) + `radar:dismissed` (cap 500), all writes serialized through one promise chain (chrome.storage has no transactions). Handles report/dismiss/replies/click/rehydrate messages; mirrors clicks/dismissals to `PATCH /x/radar/drafts` best-effort.
- **Launch Room (single writer + alarms)** — 15-min sync alarm computes one fire alarm per pending post at `scheduledFor + 90 s`. At fire time it verifies the post actually shipped (`GET /x/posts/scheduled/:id`; retries while pending/publishing ≤5×), then opens the room + fires a notification. Mirrors new early repliers to `POST /x/launch/replies`.
- **Idea context menu** — "Send selection to stratus ideas" → `POST /x/ideas`, flashes a ✓/! action badge.

---

## 6. Feature manual — by workflow

### 6.1 Scheduling posts (Goal 1)

Create posts and threads in the **Composer**, browse them in the **Calendar**. Status lifecycle: `draft` (no schedule) → `pending` (publisher-eligible) → `publishing` (worker-claimed) → `posted` (locked) / `failed` (editable, retryable) / `cancelled`. `segment` = thread-tail row.

- **Single post:** `POST /x/posts/scheduled`. A `pending` row whose text contains a URL is rejected `400 url_in_text` (the $0.20 surcharge guard). Drafts may hold URLs; promoting to pending re-checks.
- **Threads:** `POST /x/posts/threads` — a head (position 1, schedulable) + N−1 `segment` tails sharing a `threadId`. The publisher posts the chain as self-replies ~500 ms apart. The URL guard applies to segment 1 only; a link in a tail is the **link-in-first-reply** pattern ($0.030 total instead of $0.20).
- **Self-quote re-up:** `POST /x/posts/reup {tweetId}` verifies the tweet is own (in `posts_published`), then drafts quote takes via the drafter pipeline; the publisher re-verifies ownership at post time.

The **publisher** worker ticks every 60 s: claims the oldest due `pending` row (flips to `publishing`, **commits before the X call**), posts, and finalizes to `posted`/`failed`. A 5xx/network error leaves the row `publishing` (ambiguous — never auto-retried; reconcile finds it if it shipped) and the publisher shouts about stuck rows each tick.

### 6.2 Tracking metrics (Goal 2)

The **dailyMetrics** worker runs once at **03:00 UTC** (and once on boot):

1. `getMe()` → one `account_snapshots` row/UTC day (follower KPI).
2. **Discover** — incremental `getUserTweets` with `since_id`, inserting new `posts_published` rows so tweets made in the X app are tracked.
3. **Snapshot** — reads **every non-retired tweet regardless of age** by batched id lookup (≤100/call), **retiring each batch before writing its snapshots** (invariant #7: a billed read must be unrepeatable). Whatever the metrics are at the pass is the single number kept.
4. **Winner re-read** — tweets whose only snapshot cleared `WINNER_REREAD_MIN_VIEWS` (default 500) get exactly one day-7+ re-read (cap 5/day, claim-before-read).
5. **Mention pull** (see 6.4).

View the results in **Today** (yesterday's numbers, profile-click leaders) and via `GET /x/metrics/*` — best-times heatmap, pillar effectiveness, account KPI series, per-tweet time-series. Manual trigger: `POST /x/posts/reconcile`.

### 6.3 Voice library / swipe file (Goal 3)

Everything is $0 DOM scrape:

- **Save to stratus** (on-page) → `POST /x/voice/scrape` stores the tweet + `scrapedHtml`.
- **Save author** → `PUT /x/voice/authors/:handle` (authoritative profile; appends a `voice_author_snapshots` follower point each enrich → momentum).
- **Voice tab** — query by author/text/hook/extracted; **template extraction** (`POST /x/voice/tweets/:id/extract`, one Grok pass ~$0.005) distills `{hookType, skeleton, lineBreakPattern, length, device}`; **remix** seeds the Composer drafter with a tweet's structure (structure only).
- **Targets roster** — `GET /x/voice/targets` bands non-retired authors to **2×–10× your own follower count** and ranks by **momentum** (followers/day), joined with your last-reply timestamps.

### 6.4 The people layer (Goal 4 / Circles)

**Stage engine.** Each person auto-advances through `stranger → noticed → engaged → responded → mutual → ally`:
- **noticed** — any `saved_tweet` / `saved_author` / `hover_sighting`.
- **engaged** — ≥1 of your replies (`my_reply`).
- **responded** — an inbound event *after* your first reply.
- **mutual** — ≥2 "exchange days" (a UTC day with both an inbound and an outbound event).
- **ally** — ≥4 exchange days within any rolling 60-day window.

Stages only ratchet **up** automatically; a human PATCH may demote, but the next qualifying recompute re-promotes. Thresholds are opening guesses, to revisit after ~30 days of real events.

**Dossier** (`GET /x/people/:handle`) — person + voice-author profile + full timeline + your replies to them with measured outcomes + a per-angle outcome crosstab + their mentions of you + their saved tweets + a merged follower series.

**Conversations** (C2) — `GET /x/conversations` regroups `posts_published ∪ mentions` by `conversation_id` on every read (no conversation table). Per thread: an **open loop** = an unanswered inbound with no post of yours after it; a **chain** = the owed inbound replies to *your* reply (the 75× moment). Ranking: chains first, then plain open loops (both oldest-debt-first), then settled. Read state (read/snooze/mute) lives in `conversation_meta`.

**Follow-up engine** (C5) — `GET /x/people/followups` classifies, in priority order: `chain_live` (unanswered chain reply <24 h) → `dm_ready` (advanced to responded/mutual within 7 d) → `neglected_target` (2–10× roster, no reply >7 d) → `neglected_ally` (stage ≥ mutual, silent 14 d) → `momentum` (heating-up lines, never a push). One item per person; snoozes via `PATCH /people/followups`. **Top Fans** (`GET /x/people/fans`) ranks inbound count over a window.

**Relationship-aware drafting** (C3) — the reply prompt gets a server-stamped relationship block (stage, exchange counts, measured angle preference gated at ≥3 measured replies, and your notes verbatim), injected at the variable tail so the prompt template stays byte-stable.

**Passive capture + Idea Inbox** (C6) — the roster grows itself from natural hover cards; ideas captured via the Ideas tab or the right-click context menu survive their first use (consumed with provenance backlinks).

**Launch Room** (C7) — for the first 30 minutes after a post ships, the extension opens a room with the live post, an "Open on X" link, a ticking clock, a checklist, and one-click Grok drafts for early commenters; those commenters accumulate CRM stage from the first exchange.

### 6.5 Drafting with Grok

- **Reply drafts** — `POST /x/replies/generate` (band-gated) returns two variants tagged `extends`/`contrarian`/`debate`. **Band gate:** computed server-side before the Grok call; a `null`/`skip` target refuses with `422 band_gate` (no spend), overridable with `override:true`. A **specificity gate** burns one regenerate if no variant carries a digit / first-person / named tool. ~$0.002–0.004/draft.
- **Batch replies** — `POST /x/replies/generate-batch` (Radar) drafts one reply per hot/warm tweet in a single call (no gate, no DB rows — attaches to the session buffer + `radar_drafts`).
- **Original posts** — `POST /x/posts/draft` returns three register-distinct drafts (plain/spicy/reflective), each declaring its pillar, grounded on your top-5 measured posts. ~$0.006–0.01/call.
- **Templates / pillars / icebreakers / digest** — see the API reference.

Every Grok call goes through `askGrok` → xAI `/v1/responses` (Responses API, structured outputs via `text.format`), which writes its own `cost_events` row tagged `platform='grok'`.

---

## 7. HTTP API reference

All routes are bearer-guarded except `GET /healthz`. Base is the server origin; X-domain routes are under `/x`. `[Grok]` marks routes that spend xAI tokens; everything else is $0 (pure SQL or DOM-fed).

### Health & cost
| Method | Path | Purpose |
|---|---|---|
| GET | `/healthz` | `{ok, version, gitSha, workers, staleWorkers?}`; **503** on DB-unreachable or a stale worker heartbeat (public, no bearer). |
| GET | `/cost/today` | current UTC day spend grouped by platform+endpoint (+ budget/overBudget). |
| GET | `/cost/daily?days=` | trailing UTC series (default 30, clamped 1–90, zero-filled). |
| POST | `/grok/ask` | `[Grok]` raw Grok passthrough. |

### Scheduling & authoring
| Method | Path | Purpose |
|---|---|---|
| POST | `/x/posts/scheduled` | create a single post (URL-in-text → `400 url_in_text` when pending). |
| POST | `/x/posts/threads` | create a thread (2–25 segments; URL guard on segment 1 only). |
| GET | `/x/posts/scheduled` | list (`from`,`to`,`status`). |
| GET | `/x/posts/scheduled/:id` | one row + thread siblings + `seededBy` idea. |
| PATCH | `/x/posts/scheduled/:id` | edit text/schedule/media/status (409 on posted/publishing). |
| DELETE | `/x/posts/scheduled/:id` | delete (thread deletes via head). |
| POST | `/x/posts/draft` | `[Grok]` 3 register-distinct original drafts (pillar/idea/remix). |
| POST | `/x/posts/reup` | `[Grok]` self-quote re-up drafts (verifies own tweet). |
| POST | `/x/posts/reconcile` | trigger the daily discover+snapshot pass (maxResults ≤3200). |

### Metrics
| Method | Path | Purpose |
|---|---|---|
| GET | `/x/metrics/replies` | your replies newest-first with latest metrics. |
| GET | `/x/metrics/posts` | your non-reply posts with latest metrics. |
| GET | `/x/metrics/account` | account KPI series + per-day deltas. |
| GET | `/x/metrics/best-times` | UTC weekday×hour engagement cells (age-normalized). |
| GET | `/x/metrics/pillars` | per-pillar effectiveness. |
| GET | `/x/metrics/:tweetId` | full snapshot time-series for one tweet. |

### Voice library
| Method | Path | Purpose |
|---|---|---|
| POST | `/x/voice/scrape` | save a tweet (+ stub/enrich author), $0. |
| PUT | `/x/voice/authors/:handle` | authoritative profile enrich (appends follower point). |
| GET/PATCH/DELETE | `/x/voice/authors[/:handle]` | list / retire / delete author. |
| GET | `/x/voice/targets` | 2–10× reply-target roster, ranked by momentum. |
| GET | `/x/voice/tweets` | query the stash (author/q/hook/extracted/retired/limit). |
| PATCH/DELETE | `/x/voice/tweets/:id` | retire / tags / addTags; delete. |
| POST | `/x/voice/tweets/:id/extract` | `[Grok]` extract one template (~$0.005). |
| POST | `/x/voice/extract-batch` | `[Grok]` batch extract (≤50). |

### Replies & radar
| Method | Path | Purpose |
|---|---|---|
| POST | `/x/replies/generate` | `[Grok]` band-gated 2-variant reply draft (422 `band_gate`; `override`). |
| POST | `/x/replies/generate-batch` | `[Grok]` one reply per hot/warm tweet (Radar; no gate, no DB rows). |
| GET | `/x/replies` | list drafts (status/sourceAuthor/limit/since). |
| GET | `/x/replies/outcomes` | posted drafts joined to measured metrics. |
| GET | `/x/replies/default-prompt` | the default reply system prompt ($0). |
| GET/PATCH/DELETE | `/x/replies/:id` | one / edit (status transitions, postedTweetId) / delete. |
| GET/PATCH | `/x/radar/drafts` | ready/clicked/expired list (lazy 48 h expiry); status advance. |
| PATCH | `/x/radar/drafts/:tweetId/tags` | tag all draft rows of a tweet (C8). |

### Mentions & conversations
| Method | Path | Purpose |
|---|---|---|
| GET | `/x/mentions` | inbox (status filter) + parent-post context. |
| POST | `/x/mentions/refresh` | on-demand pull (server cap 6/day). |
| PATCH | `/x/mentions/:tweetId` | status / link draft. |
| GET | `/x/conversations` | ranked Slack-style threads + counts. |
| PATCH | `/x/conversations/:conversationId` | read / snooze / mute. |

### People (Circles)
| Method | Path | Purpose |
|---|---|---|
| GET | `/x/people/followups` | the ranked follow-up queue. *(mounted before `:handle`)* |
| PATCH | `/x/people/followups` | snooze/unsnooze an item. |
| GET | `/x/people/fans` | Top Fans by inbound count over a window. |
| GET | `/x/people` | roster (stage/tag/q/sort/retired/limit filters). |
| GET | `/x/people/:handle` | the dossier. |
| PATCH | `/x/people/:handle` | notes / tags / stage override (may demote) / retired. |
| POST | `/x/people/:handle/events` | manual note / "DM sent" (creates person if missing). |
| POST | `/x/people/sightings` | passive hover batch (≤50). |
| POST | `/x/people/:handle/icebreakers` | `[Grok]` reply+DM openers (~$0.005; 404/422 refuse before spend). |

### Topics, ideas, brief, digest, playbook, launch, harvest
| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/x/channels` | list / create channels. |
| GET/PATCH/DELETE | `/x/channels/:slug` | room aggregate / edit / delete. |
| GET/POST/PATCH/DELETE | `/x/pillars[/:slug]` | content pillars CRUD. |
| POST | `/x/pillars/draft` | `[Grok]` propose a pillar (not persisted, ~$0.003). |
| GET/POST/PATCH/DELETE | `/x/ideas[/:id]` | Idea Inbox lifecycle. |
| GET | `/x/brief` | the Today payload (`tzOffsetMin`). |
| GET | `/x/digest` | `[Grok]` Sunday digest (facts $0 + ~$0.01 narration, cached/week). |
| GET | `/x/playbook` | six measured aggregations + guidance (n≥20 gated). |
| POST | `/x/playbook/extract-winners` | `[Grok]` one-time own-winner template extraction (~$0.10). |
| POST | `/x/launch/replies` | ingest early launch-window repliers (≤50), $0. |
| POST/GET | `/x/harvest/runs` | create / list harvest runs. |
| POST | `/x/harvest/rows` | ingest harvested rows (≤500/batch; replies-mode reconcile). |

---

## 8. Data model (SQLite tables)

State is local SQLite (`bun:sqlite`, WAL, `foreign_keys=ON`) via Drizzle `sqlite-core`. Auto-migrates at boot. The **synchronous** driver means transactions take sync callbacks (`.all()`/`.get()`/`.run()`, no `await` inside) and you can't bind a JS `Date` in a raw `sql` template (use `.getTime()`).

**Cross-platform (`src/db/shared-schema.ts`)**
- `cost_events` — every billed call (platform, endpoint, status, items, costUsd, durationMs, attempts, requestId). The `platform` column is the dispatch key (invariant #6).

**X-domain (`src/x/db/schema.ts`)**

| Table | Purpose |
|---|---|
| `tokens` | single-row OAuth token store (`id='default'`). |
| `content_pillars` | editable content pillars (drafter renders the active set + builds its enum). |
| `channels` | C8 topic rooms = tags + a saved view (label, color, mapped pillar, keywords). |
| `scheduled_posts` | the publish queue (status lifecycle, thread fields, pillar, register, quoteTweetId). |
| `posts_published` | every tweet the account published (scheduled + discovered); `retired` gates snapshots (inv #7). |
| `metrics_snapshots` | per-tweet metric snapshots (+ `ageAtSnapshotMin`). |
| `post_templates` | structure extracted from own winners (feeds the Playbook). |
| `account_snapshots` | one row/UTC day: follower/following/tweet/listed counts. |
| `voice_authors` | DOM-scraped swipe-file authors. |
| `voice_author_snapshots` | append-only follower series per enrich (target momentum). |
| `voice_tweets` | saved other-people's tweets + template columns + tags. |
| `reply_drafts` | Grok reply drafts (variants, contextSnapshot, cost, status, postedTweetId). |
| `radar_drafts` | server copy of batch-drafted radar replies (ready/clicked/expired, 48 h TTL). |
| `people` | C1 one row/human (stage, notes, tags, in/out watermarks). |
| `person_events` | append-only timeline (deterministic ids + INSERT OR IGNORE). |
| `person_snapshots` | follower series for non-voice people (C6 hover feed). |
| `ideas` | C6 Idea Inbox (open/consumed/discarded + provenance). |
| `followup_snoozes` | C5 follow-up queue snoozes (`kind:handle`). |
| `streaks` | C9 quests/streaks diary (local-day key). |
| `digests` | C9 Sunday Digest cache (per Monday week). |
| `mentions` | mention inbox (unanswered/answered/dismissed + parent). |
| `conversation_meta` | C2 read/snooze/mute state (threads recomputed on read). |
| `harvest_runs` / `harvest_rows` | harvest ingest (longitudinal view/bookmark curves). |

---

## 9. Cost model & money invariants

All X calls go through `xFetch`, which fires `onCost` on every 2xx. `makeOnCost('x', {dailyBudgetUsd})` prefers a `costHint` on billed calls, else prices via `src/x/pricing.ts`, writes a `cost_events` row, warns on a billed call that priced to $0 (unmapped endpoint), and runs a soft budget watchdog (`X_DAILY_BUDGET_USD`, default $0.15). Grok bypasses this — `askGrok` prices per-token and logs its own row.

**Price table (Apr 2026, USD).**

| Surface | Cost | Notes |
|---|---|---|
| Own post / mention / like / follower read | $0.001 | 24 h UTC dedup |
| Other-user post read / search result | $0.005 | |
| Third-party user lookup | $0.010 | |
| Post create (no URL) | $0.015 | |
| **Post create (URL in text)** | **$0.20** | ⚠️ 13× — guarded in `createPost` |
| Like / repost / bookmark write | $0.015 | |
| Delete | $0.010 | |
| Grok reply draft | ~$0.002–0.004 | xAI, not X |
| Grok original draft (3) | ~$0.006–0.01 | |
| Grok template extract | ~$0.003–0.005/tweet | one-time |

**Cadence-derived budgets.** Own tweets/replies: **1 snapshot × $0.001, then retired** (read once and only once). Voice library: **$0** (DOM scrape). Account KPI: **$0.001/day**. Mention inbox: **~$0.01–0.03/day**. Winner re-read: **≤$0.005/day**. A 4-tweet thread: **$0.060**; link-in-first-reply: **$0.030** instead of $0.20.

---

## 10. Workers & scheduling

- **publisher** (`src/x/workers/publisher.ts`) — `setInterval` every 60 s, single-flight. Claims the oldest due `pending` row and **commits `publishing` before the X call**; success → `posted` (+ `posts_published`), definite 4xx → `failed`, 5xx/network → stays `publishing` (ambiguous, never auto-retried). Threads post as self-replies ~500 ms apart (a failed segment freezes the rest as `thread_frozen`). Heartbeat stale > 5 min.
- **dailyMetrics** (`src/x/workers/dailyMetrics.ts`) — self-re-arming `setTimeout` to the next 03:00 UTC (runs once on boot). Account snapshot → discover → snapshot (retire-before-snapshot) → winner re-read → mention pull. Heartbeat stale > 25 h. Disable with `DAILY_METRICS_ENABLED=false` (manual `POST /x/posts/reconcile` still works).

Both register heartbeats consumed by `/healthz` (503 when stale) and drain their in-flight tick on graceful shutdown.

---

## 11. Non-negotiable invariants

These have already cost real money or locked the account out. Memorize before changing code.

1. **URL surcharge ($0.20 vs $0.015, 13×).** A post whose text matches `/(^|\s)https?:\/\//i` is billed at $0.20. `createPost` blocks unless `allowUrlSurcharge`; the calendar rejects such `pending` rows. Move URLs to a reply.
2. **Programmatic-reply restriction (Feb 2026).** Self-replies always work; replying to others via `in_reply_to_tweet_id` is blocked on self-serve unless the author @-mentioned/quoted the app. `createPost` requires `selfXUserId` and throws on a `parentAuthorId` mismatch.
3. **Token rotation atomicity.** X rotates the refresh token on every refresh; `getValidAccessToken` persists the new token **before** returning the access token, serialized through an in-process promise-chain mutex (the SQLite sync driver can't hold a lock across the HTTP refresh). Single-process only.
4. **One place to call X.** Every X call goes through `xFetch` — not in workers, routes, or scripts. That's where retries, error parsing, rate-limit headers, and `onCost` live.
5. **`maxItems` does NOT cap cost — `max_results` does.** X bills for every result in the response body, not what JS iterates. Any endpoint wrapping `paginate()` must clamp the URL's per-request page size (burned $0.49 once on a 3-result search).
6. **Cost middleware dispatches by platform.** `cost_events` rows carry a `platform` column; the shared middleware never hardcodes X assumptions.
7. **A billed read must be unrepeatable — retire before you snapshot.** `dailyMetrics` retires a whole batch in one committed txn *before* inserting any snapshot. At-most-once snapshots, never a double charge (an earlier version once read one tweet 3,712 times = $3.71).

---

## 12. Environment variables

Required: `API_TOKEN` (bearer, shared with the extension), `SELF_X_USER_ID`, `X_CLIENT_ID`, `X_CLIENT_SECRET`. Grok routes/worker-cost: `XAI_API_KEY`.

Optional / tuning: `PORT` (3000), `ALLOWED_ORIGINS`, `SQLITE_PATH` (`./stratus.db`; `:memory:` for tests), `SKIP_MIGRATE`, `X_DAILY_BUDGET_USD` (0.15), `DAILY_METRICS_ENABLED`, `WINNER_REREAD_MIN_VIEWS` (500), `GIT_SHA`, `STRATUS_DEPLOY_HOST` (deploy target). `MENTION_API_REPLIES` documents an unwired carve-out (no auto-replies).

---

## 13. Common commands

```bash
# Server
bun install
bun run auth           # OAuth server on http://127.0.0.1:3000
bun run start          # boot the Hono app + workers
bun run play           # example calls with stored tokens
bun test               # unit tests (runs against SQLITE_PATH=:memory:)
bun run typecheck      # tsc --noEmit
bun run lint           # biome check
bun run db:migrate     # bun:sqlite migrator (scripts/migrate.ts)

# Extension
cd extension
npm run build          # two-pass build into dist/ (load unpacked in Chrome)
npm run dev            # rebuild + watch
npm run typecheck

# Deploy
./scripts/deploy.sh                 # rsync + migrate + restart on STRATUS_DEPLOY_HOST
./scripts/deploy.sh root@host       # explicit host
```

---

*This manual reflects the code as of the Circles milestone. `CLAUDE.md` is the session-orientation + guardrails file; `PLAN.md` and `CIRCLES-PLAN.md` are the build plans; `X-API-IMPLEMENTATION-PLAN.md` is the X API reference. The authoritative statement of what is wired is `src/x/index.ts`.*
