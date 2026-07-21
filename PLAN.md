# stratus — build plan

> Replaces `X-API-IMPLEMENTATION-PLAN.md` as the canonical *build* plan. That file is now reference-only for X API behavior, costs, and policy quirks — not for what we build next.

## Goal

A small, deployed-anywhere service that does three things for one user (me):

1. **Schedule posts a week ahead.** Drop posts into a calendar; a worker publishes at the scheduled minute.
2. **Track metrics over time.** Snapshot every published post on a cadence so I can see what worked.
3. **Stash other people's tweets.** A "voice library" of hooks/threads to analyze for style and structure.

Everything is fronted by Hono with a cost-tracking middleware. Postgres on Neon for portability.

Hard ceiling on scope: if a feature isn't in service of those three, it doesn't get built.

> **Niche N0 (2026-07-18):** goal-serving *configuration* — persona/beliefs/reply-persona (prompt grounding), the content pillars (output taxonomy) + channels (input taxonomy), and the doctrine numbers (reply quota, 70/30 ratio, 2–10x target band) — is now owned by a first-class **`niches`** DB entity, editable from the Settings **Niche** card without a deploy (the §8.6 move applied to identity). Exactly one active niche (v1); pillars/channels are niche-owned and filtered to the active niche, drafts refuse `no_pillars_for_niche` rather than leak another niche's pillars. `src/my_niche.md` is now only the seed prose for the `builder` niche's `description` — the live source of truth is the `niches` table. See CLAUDE.md §"Niche N0" and `plans/2026-07-16-niche.md`.

> **Me layer M1 (2026-07-18):** the *dynamic* personal layer that complements the static persona — a new extension **Me tab** holds evergreen facts, dated events, current emotions, free notes, and measurable goals (`me_entries`/`me_goals`, migration `0016`). A fresh slice is injected at the **variable tail** of every post/reply draft (post drafter + reply single + reply batch; templates byte-untouched — always-on, no toggle), a "What the AI sees" preview shows the exact block, the Sunday digest narrates goal progress, and the Playbook measures whether me-context replies out-convert cold ones (`meEffectiveness`, gated n≥20/side). $0 X API, ~+$0.0005–0.001 per existing draft call. `x_me`/`x_add_me_entry` let any Claude session journal into it. See CLAUDE.md §"Me layer M1" and `plans/2026-07-16-me-profile.md`.

> **AI layer (2026-07-19):** goals-1/4 infrastructure — every place the app writes words became **provider-swappable and prompt-editable**. A second LLM provider (**OpenRouter** — Claude/GPT/Gemini/etc.) is selectable in **Settings → AI** with a model/temperature/token/effort picker; drafts can run on any model with exact spend logged under platform `openrouter`. All 10 AI prompts are editable in a **Settings → Prompts** editor (override-rows-only storage in `prompt_overrides`; "Restore Default Prompts" reverts everything). Three new authoring surfaces: **thread drafter** (idea → draft thread in the Composer), **rewrite assist** ("Improve with AI" → 3 variants), **idea generator** (pillars+winners → proposals for the Idea Inbox). The Playbook gains a per-model outcome cell. **API keys live in env only, never the DB** (explorer/MCP-visible). $0 X API, $0 recurring LLM. Two tables, migration `0013`. See CLAUDE.md §"AI layer" and `plans/2026-07-17-ai-layer.md`.

> **Overhaul 7.7 — Radar ↔ Reply Master unification (2026-07-21):** goals-2/4 tooling — the Radar's "Draft replies" and the Reply Master are now **one system**. Every draft (single or batch) is **three genuinely different variants** (extends / contrarian / debate). Clicking a Radar row opens the tweet and injects three variant chips next to the reply box; clicking one **types that variant in and marks the draft posted** (paste-time semantics) *and* confirms the radar draft into a real `reply_drafts` row — so a radar-originated reply gets the full measurement chain (outcomes join, angle crosstab, latency, quota, and an **exact, no-longer-text-matched batch-vs-single Playbook split** via the new `reply_drafts.source` column). A round **⊕** on any timeline tweet pushes it into the queue regardless of band (`band:'manual'` — queue metadata, never a classifier verdict, coerced away from the reply snapshot). $0 X API; Grok per-click only (single ~$0.003–0.006, batch of 20×3 ~$0.02–0.08). Migration `0014` (radar_drafts `variants`/`model`/`reply_draft_id`, reply_drafts `source`). See CLAUDE.md §"Overhaul 7.7" and `plans/2026-07-16-radar-reply-unification.md`.

## Product, in one paragraph each

**Calendar.** I write 5–10 posts on a Sunday. Each row in `scheduled_posts` has `text`, `media_ids?`, `scheduled_for`, `status`. The worker wakes every 60 s, picks rows due in the last minute, posts them via the existing `createPost`, writes the resulting tweet ID back, and flips status. Failures stay `failed` with the error class — I retry by editing the row.

**Metrics.** Every tweet I publish — through the scheduler *or* manually from the X app when inspiration strikes — ends up in `posts_published` and gets a polling cadence. A daily **own-reconcile** worker calls `GET /2/users/:id/tweets` with replies included and upserts the last ~500 of my own tweets, queuing any unseen ones for polling. A second worker reads `posts_published` rows due for their next poll, fetches `public_metrics` (and `non_public_metrics` while ≤30 d old), and inserts a row in `metrics_snapshots`. Dashboard endpoint returns the time series. Cadence is a single snapshot at ~24h, then retire — owned reads at $0.001 keep this cheap (~$0.001/tweet). Profile visits (`user_profile_clicks`) ride along free in `non_public_metrics`.

**Voice library.** I add an X username to `tracked_authors`. An hourly job pulls their last N tweets **and replies** via `/2/users/:id/tweets`, upserts them into `voice_tweets`, and queues each into a lighter polling cadence — so I capture engagement velocity over time, not just a snapshot. A search endpoint lets me query by author / keyword / engagement threshold. No LLM analysis yet — just a clean store with time-series I can grep and feed an LLM later. Other-user reads are $0.005/tweet, so polling is bounded per-author (default: latest 20 tweets, ~7-day window).

## Stack additions

Keep the existing `src/auth.ts`, `src/client.ts`, `src/endpoints.ts`, `src/errors.ts`, `src/fields.ts`, `src/pagination.ts` exactly as they are — they're the thin X primitives. Phase 1 relocates them verbatim to `src/x/` (along with `token-store.ts`, `server.ts`, `playground.ts`) so non-X code can sit beside them without crowding. Then add on top:

**Server side**
- **Hono** — `hono` package, mounted on `Bun.serve`. The OAuth `bun run auth` server stays separate (it's a one-shot dev tool); the main app server is new.
- **Neon Postgres** — connection via `@neondatabase/serverless` (HTTP driver, works in long-running and edge contexts).
- **Drizzle ORM** + **drizzle-kit** — typed schema, generated migrations. Light enough to fit the spirit of the repo.
- **No Redis, no BullMQ.** Five `setInterval` workers in the same process, using `SELECT … FOR UPDATE SKIP LOCKED` for safety. Swap if it ever stops fitting.

**Client side (Chrome extension — see §"Chrome extension")**
- **Manifest V3 + Chrome Side Panel API** (Chrome 114+).
- **Vite + React + TypeScript** in a sibling `extension/` directory with its own `package.json`. Tailwind for speed; otherwise plain CSS.

## Repo layout (additions in **bold**)

The top level holds *platform-agnostic* infrastructure (DB, shared middleware, Hono composition). Every social platform — starting with X, eventually LinkedIn / Threads / Mastodon / etc. — lives in its own self-contained `src/<platform>/` folder. Platforms never reach across to each other; they only depend on `src/db/`, `src/middleware/`, and the public surface their siblings expose via `index.ts`.

```
src/
  **app.ts**              Hono app: mounts platform routers, shared middleware, starts platform workers
  **middleware/**
    **auth.ts**             API token guard (one shared secret in env) — platform-agnostic
    **cors.ts**             allows chrome-extension://* origins
    **costTracker.ts**      makeOnCost(db, platform) → CostInfo handler; dispatches to the platform's price table
  **db/**
    **client.ts**           neon() + drizzle() singletons — shared by every platform
    **shared-schema.ts**    cost_events (carries a `platform` column so dashboards can break down spend)
    **migrations/**         generated SQL — committed
  **routes/**
    **cost.ts**             GET /cost/today, /cost/range — cross-platform spend
    **healthz.ts**          GET /healthz

  **x/**                   *all X-specific code lives here so future platforms don't tangle with it*
    auth.ts               (unchanged — current src/auth.ts; OAuth 2.0 PKCE)
    client.ts             (unchanged — current src/client.ts; xFetch already exposes onCost)
    endpoints.ts          (unchanged; add wrappers as needed)
    errors.ts             (unchanged)
    fields.ts             (unchanged)
    pagination.ts         (unchanged)
    token-store.ts        → swap body for Postgres-backed read/write of the `tokens` row; same exports
    server.ts             X OAuth callback (unchanged) — `bun run auth`
    playground.ts         (unchanged)
    **pricing.ts**          X price table (the switch from §"Cost tracking middleware")
    **db/schema.ts**        tokens, scheduled_posts, posts_published, metrics_snapshots, tracked_authors, voice_tweets, voice_metrics_snapshots
    **routes/**
      **calendar.ts**       /x/posts/scheduled/*
      **metrics.ts**        /x/metrics/:tweetId, /x/metrics/poll
      **voice.ts**          /x/voice/track, /x/voice/tweets, /x/voice/scrape
    **workers/**
      **publisher.ts**            every 60s — drains due scheduled_posts
      **ownReconcile.ts**         daily — pulls my last ~500 tweets+replies, upserts, queues new ones
      **metricsPoll.ts**          every 60s — drains due metrics polls (own posts)
      **voicePull.ts**            hourly — refreshes tracked_authors (tweets AND replies)
      **voiceMetricsPoll.ts**     every 60s — drains due voice-tweet metrics polls
    **index.ts**            exports `mountX(app)` (wires routes under `/x`) and `startXWorkers()` — `app.ts` is the only outside caller

  # Future platforms — same shape, no surgery to anything above:
  #   src/linkedin/  auth.ts · client.ts · pricing.ts · db/schema.ts · routes/ · workers/ · index.ts
  #   src/threads/   …
  # drizzle.config.ts points at the union of schema files:
  #   schema: ['src/db/shared-schema.ts', 'src/x/db/schema.ts', 'src/<next>/db/schema.ts']
```

Conceptually: `src/<platform>/` is a self-contained vertical slice — its own auth, its own DB tables, its own routes, its own workers. The shared layer (`db/`, `middleware/`, `routes/cost.ts`, `app.ts`) is the only thing that knows about more than one platform. Adding LinkedIn later means creating `src/linkedin/`, registering it in `app.ts`, and pointing `drizzle.config.ts` at its schema — nothing inside `src/x/` changes.

## Database schema (Drizzle)

Eight tables. SQL-ish sketch — actual code split between `src/db/shared-schema.ts` (cost_events) and `src/x/db/schema.ts` (the seven X-owned tables). When LinkedIn arrives it brings its own `src/linkedin/db/schema.ts`.

```
tokens (single row, id='default')
  access_token text, refresh_token text, expires_at timestamptz,
  scope text, x_user_id text, x_username text,
  connected_at timestamptz, last_refresh_at timestamptz
  -- still plaintext for now; columns are typed bytea-ready for AES-GCM later

scheduled_posts
  id uuid pk, text text, media_ids text[],
  scheduled_for timestamptz null,                -- null when status='draft'
  status text not null,  -- 'draft' | 'pending' | 'posted' | 'failed' | 'cancelled'
  posted_tweet_id text, error_class text, error_detail text,
  source text not null default 'api',  -- 'api' | 'extension' | 'manual'
  created_at, updated_at
  index (status, scheduled_for)

posts_published
  tweet_id text pk, scheduled_post_id uuid null,
  text text, posted_at timestamptz,
  is_reply boolean default false,
  in_reply_to_tweet_id text null, conversation_id text null,
  source text not null,  -- 'scheduled' | 'manual' (set by publisher / reconcile)
  next_poll_at timestamptz, poll_count int default 0,
  retired boolean default false,  -- after 30d snapshot
  last_seen_at timestamptz,        -- updated each reconcile pass; lets us detect deletes
  index (next_poll_at) where retired=false

metrics_snapshots
  id bigserial pk, tweet_id text fk, snapshot_at timestamptz,
  public_metrics jsonb, non_public_metrics jsonb, organic_metrics jsonb
  index (tweet_id, snapshot_at desc)

tracked_authors
  x_user_id text pk, username text, added_at timestamptz,
  last_pulled_at timestamptz,
  source text not null default 'manual',         -- 'manual' | 'auto_from_scrape'
  pull_enabled boolean default true,             -- voicePull worker runs against this author
  max_tweets_per_pull int default 50,
  metrics_polling_enabled boolean default true,
  max_polled_tweets int default 20               -- caps voice metrics cost per author
  -- defaults flip to false when source='auto_from_scrape'; user opts in manually

voice_tweets
  tweet_id text pk, author_x_user_id text fk, text text,
  created_at timestamptz,
  is_reply boolean default false,
  in_reply_to_tweet_id text null, conversation_id text null,
  source text not null,  -- 'tracked_pull' | 'extension_scrape' | 'reply_thread'
  scraped_html text null,                         -- optional raw stash from extension
  fetched_at timestamptz, last_seen_at timestamptz,
  next_poll_at timestamptz null, poll_count int default 0,
  retired boolean default false
  index (author_x_user_id, created_at desc)
  index (next_poll_at) where retired=false

voice_metrics_snapshots
  id bigserial pk, tweet_id text fk, snapshot_at timestamptz,
  public_metrics jsonb
  -- no non_public/organic — not accessible for other-user posts
  index (tweet_id, snapshot_at desc)

cost_events                                       -- shared across platforms (src/db/shared-schema.ts)
  id bigserial pk, ts timestamptz default now(),
  platform text not null,                          -- 'x' | 'linkedin' | …
  endpoint text, status int, items int, cost_usd numeric(10,5),
  duration_ms int, attempts int, request_id text
  index (ts desc), index (platform, ts desc)
```

`tokens` becoming a DB row is what unlocks "accessible from everywhere" — the JSON file goes away. `getValidAccessToken` keeps the same signature; only its body changes (read row, refresh if needed, write back in one transaction).

## HTTP API (Hono)

Auth: every route requires `Authorization: Bearer ${API_TOKEN}` (one shared secret in env). Crude but enough for a personal tool deployed to one place.

All X-specific routes are namespaced under `/x/` — leaves `/linkedin/`, `/threads/` etc. clear for later. `/cost/*` and `/healthz` are cross-platform and stay top-level.

| Method | Path | Purpose |
|---|---|---|
| POST | `/x/posts/scheduled` | `{text, scheduledFor?, mediaIds?, status?}` → row inserted (`scheduledFor=null` → draft) |
| GET | `/x/posts/scheduled?from=&to=&status=` | calendar view; status filter for drafts |
| PATCH | `/x/posts/scheduled/:id` | edit text/time/status while not yet posted (e.g. promote draft → pending) |
| DELETE | `/x/posts/scheduled/:id` | cancel |
| POST | `/x/posts/now` | immediate publish (bypasses scheduler) |
| GET | `/x/posts/published?from=&to=&includeReplies=` | what shipped (mine, scheduler + manual) |
| POST | `/x/posts/reconcile` | run own-reconcile now (don't wait for daily tick) |
| GET | `/x/metrics/:tweetId` | full snapshot history (chart-ready) |
| POST | `/x/metrics/poll/:tweetId` | manual poll trigger |
| POST | `/x/voice/track` | `{username, maxPolledTweets?}` → resolve id, insert |
| DELETE | `/x/voice/track/:username` | stop tracking |
| POST | `/x/voice/pull/:username` | run voice-pull now (don't wait for hourly tick) |
| GET | `/x/voice/tweets?author=&q=&minLikes=&includeReplies=` | query stash |
| GET | `/x/voice/metrics/:tweetId` | voice-tweet snapshot history |
| **POST** | **`/x/voice/scrape`** | **bulk insert from extension: `{tweets: VoiceTweetInput[], pollMetrics?: bool}` — auto-creates unknown authors** |
| GET | `/cost/today` | sum + breakdown by platform & endpoint |
| GET | `/cost/range?from=&to=` | same over a window |
| GET | `/healthz` | 200 if DB reachable |

The Hono app mounts a CORS middleware allowing `chrome-extension://*` origins (`src/middleware/cors.ts`) at the root, before any platform router.

No reply / quote endpoints in v1 — Feb 2026 policy makes them awkward and they're not in the three goals.

## Scheduler

Five intervals in the same Bun process, all started from `app.ts` after `Bun.serve` boots. Each worker is a function, not a class.

| Worker | Interval | Reads | Writes |
|---|---|---|---|
| `publisher` | 60 s | `scheduled_posts` due | `posts_published`, queues metrics poll |
| `metricsPoll` | 60 s | `posts_published` due | `metrics_snapshots` |
| `voiceMetricsPoll` | 60 s | `voice_tweets` due | `voice_metrics_snapshots` |
| `ownReconcile` | 24 h (and on-demand) | X `/users/:id/tweets` | upserts `posts_published` |
| `voicePull` | 60 min (and on-demand) | X `/users/:id/tweets` per author | upserts `voice_tweets` |

```ts
// publisher: every 60s
async function tickPublisher() {
  const due = await db.query(`
    select * from scheduled_posts
    where status = 'pending' and scheduled_for <= now()
    order by scheduled_for asc
    for update skip locked
    limit 10
  `);
  for (const row of due) {
    try {
      const out = await createPost(token, { text: row.text }, { selfXUserId });
      await markPosted(row.id, out.id);
      await enqueueMetricsPoll(out.id);  // single snapshot at 24h
    } catch (err) {
      await markFailed(row.id, classify(err), err.message);
    }
  }
}
```

The metrics worker is the same shape — pulls rows from `posts_published` where `next_poll_at <= now() and not retired`, calls `getTweet(token, id, { ownedPrivate: true })`, inserts a snapshot, then retires the row (`nextPollDelay` returns null past 24h — one snapshot per tweet).

`ownReconcile` is the gateway that brings manually-posted tweets into the system. Pseudocode:
```ts
async function tickOwnReconcile() {
  const me = await getMe(token);
  let count = 0;
  for await (const tw of paginateUserTweets(token, me.id, { maxResults: 100 })) {
    if (++count > 500) break;  // cap per pass
    const inserted = await db.upsertPublished(tw, { source: 'manual' /* if not already known */ });
    if (inserted.isNew) await db.queueMetricsPoll(tw.id, /* first poll in 5min */);
    await db.touchLastSeen(tw.id);
  }
}
```
Run on a 24 h interval, plus exposed via `POST /posts/reconcile` so I can fire it the moment I post manually instead of waiting for the next tick.

`voicePull` mirrors that for tracked authors — paginates each author's last `max_tweets_per_pull` (replies included), upserts into `voice_tweets`. New tweets (within `max_polled_tweets` of the latest) get a `next_poll_at` set; older ones land flat without polling so we keep the cost bounded.

`voiceMetricsPoll` then drains those rows on the lighter cadence below.

### Cadence ladders

**Own posts** (`metricsPoll`, owned reads = $0.001 each). Simplified 2026-06-02
from the 30-day ~113-poll ladder to a **single snapshot at ~24h**, then retire:
```
< 24 h   → wait until 24h
≥ 24 h   → snapshot once, then retired
1 snapshot × $0.001 = $0.001/tweet
```
We want the day-after number ("how did yesterday's posts do"), not the intraday
curve. `nextPollAt` is seeded to `postedAt + 24h` by both the publisher and
ownReconcile, so the lone snapshot lands at 24h age even for replies discovered
late (a reply found 30h after posting is snapshotted immediately and retired).
The owned read carries `non_public_metrics.user_profile_clicks` ("profile
visits") and `organic_metrics` for free; 24h is inside X's 30-day window where
those private fields are still returned (§6.9). My replies to others ride the
same path — a reply is my own tweet, so it's an owned $0.001 read.
`GET /x/metrics/replies` and `GET /x/metrics/posts` list replies / non-reply
posts (newest first, `?limit=` 1–200) each with their latest snapshot; the
per-tweet time series stays at `GET /x/metrics/:tweetId`.

**Voice tweets** (`voiceMetricsPoll`, other-user reads = $0.005 each):
```
0–6 h    → +1 h        (6 polls)
6 h–48 h → +6 h        (7)
2 d–7 d  → +24 h       (5)
>7 d     → retired
≈ 18 polls × $0.005 = $0.09/tweet
```

Per-author guardrail: only the latest `max_polled_tweets` (default 20) of each author land in the polling queue. With 5 authors that's 100 active polled tweets ≈ $9/month worst-case, dropping fast as tweets retire after 7 days. Adjust `max_polled_tweets` per author when one is more interesting than another.

`SKIP LOCKED` means we could run two replicas later without collisions — but we won't, because one process is fine.

## Cost tracking middleware

`src/x/client.ts` already exposes `onCost`. We just wire it. The cost tracker itself is platform-agnostic — it takes a platform tag and dispatches to that platform's price table.

```ts
// src/middleware/costTracker.ts
import { priceFor as xPriceFor } from '../x/pricing.ts';
// import { priceFor as linkedinPriceFor } from '../linkedin/pricing.ts';  // when it lands

const priceTables: Record<string, (endpoint: string, status: number, items: number | null) => number> = {
  x: xPriceFor,
  // linkedin: linkedinPriceFor,
};

export function makeOnCost(db: Drizzle, platform: string): (info: CostInfo) => void {
  const price = priceTables[platform];
  return (info) => {
    const usd = price(info.endpoint, info.status, /*items*/ null);
    db.insert(costEvents).values({ platform, ...info, costUsd: usd }).execute();
  };
}
```

`src/x/pricing.ts` is one switch statement keyed off endpoint substrings (`/users/me` → 0.001, `/tweets/search/recent` → 0.005 × items, `POST /tweets` no URL → 0.015, etc.). Reuses the appendix in `X-API-IMPLEMENTATION-PLAN.md` §14 — that doc earns its keep here. A future `src/linkedin/pricing.ts` carries LinkedIn's own table; the dispatcher above is the only thing that has to learn about both.

Every X call site (workers + manual handlers) constructs its `xFetch` with `makeOnCost(db, 'x')`. No Hono middleware needed for this — the cost is per-X-call, not per-HTTP-call.

A *Hono* middleware does sit at the request boundary to log API usage and enforce the bearer token; that's what `src/middleware/auth.ts` is for.

## Deployment

Single long-running Bun process. Recommended: **Fly.io** (one machine, $0–5/mo, supports Bun, persistent process for the scheduler). Alternatives: Railway, a $5 Hetzner VPS with systemd. Cloudflare Workers don't fit because of the in-process scheduler.

Env vars:
```
DATABASE_URL=...neon
X_CLIENT_ID=...
X_CLIENT_SECRET=...
X_OAUTH_REDIRECT_URI=https://stratus.fly.dev/auth/x/callback
API_TOKEN=...                  # bearer for all /posts, /metrics, /voice, /cost
SELF_X_USER_ID=...             # cached after first /me
```

OAuth flow runs once against the deployed URL — that writes the token row to Neon. From then on the worker can refresh autonomously.

## Chrome extension (UI)

**Why an extension and not a web app.** Most of the time I'd use this UI is when I'm already on x.com — reading the timeline, looking at someone's hooks, having an idea. A side panel that's always open next to X means zero context switching. A web app at a separate URL means tab-juggling and copy-pasting. The extension is also the only realistic surface for "save this tweet I'm looking at" without manually copying IDs.

**Architecture (Manifest V3).**
- **Side panel** (`chrome.sidePanel`) — always-on column on the right of the browser. Hosts the calendar, composer, voice search, settings. React app served from `sidepanel.html`.
- **Content script** — injected on `*://x.com/*` and `*://twitter.com/*`. Adds a "Save to stratus" button to each tweet's action row (via a `MutationObserver`, since X virtualises the timeline). Reads tweet ID, author, text, public counts, replies, conversation ID from the DOM.
- **Service worker (background)** — stateless message bus. Receives scrape payloads from content scripts, attaches the auth header, POSTs to the API. Also handles `chrome.action` clicks → opens the side panel.

**Repo addition** — sibling to `src/`, with its own `package.json`. Same git history, separate build pipeline.

```
extension/
  manifest.json
  package.json              Vite + React + TypeScript + Tailwind
  vite.config.ts            multi-entry: sidepanel, content, background
  public/
    icons/                  16/48/128 PNGs
  src/
    background.ts           service worker — message router, auth header
    content.ts              x.com DOM scraper, "Save to stratus" buttons
    sidepanel/
      index.html
      main.tsx              mounts <App />
      App.tsx               router: Calendar | Drafts | Voice | Cost | Settings
      Calendar.tsx          7-day grid; click slot → composer; click post → editor
      Composer.tsx          text + scheduled_for picker; create / edit / cancel
      Drafts.tsx            list of status='draft' rows; promote to pending
      Voice.tsx             search & browse voice_tweets
      Cost.tsx              today + last 7d burn
      Settings.tsx          API URL + bearer token (chrome.storage.local)
    shared/
      api.ts                typed fetch client (mirrors server route shapes)
      types.ts              ScheduledPost, VoiceTweet, MetricsSnapshot, etc.
```

Types are duplicated from the server. Small enough to keep in sync by hand for now; if it gets painful, extract `src/api-types.ts` and import via a relative path from both sides.

**Side panel features (v1).**
- **Calendar** — 7-day grid (today + 6 ahead), each cell a 1-hour slot. Pending posts render in their slot with status colour. Click an empty slot → composer pre-filled with that timestamp. Click an existing post → editable composer with delete button.
- **Quick draft** — text box always visible at the panel header. Type, hit save → row inserted with `status='draft'`, `scheduled_for=null`. Drafts show in their own tab; drag (or click → "Schedule") onto a calendar slot to promote.
- **Voice search** — search box → `GET /voice/tweets?q=…`. Results show author, text, latest metrics. Click → opens X URL in new tab. "Pin" button to mark for later analysis.
- **Cost** — today's spend + 7-day sparkline, mostly so I notice when something runs hot.
- **Settings** — API base URL + bearer token, stored in `chrome.storage.local`. One-time setup.

**Scraping flow (content script).**
1. `MutationObserver` on `[data-testid="primaryColumn"]` adds a "Save to stratus" button to each tweet's action row (`[role="group"]` inside `[data-testid="tweet"]`).
2. On click, the script extracts from the tweet's DOM:
   - `tweetId` from `a[href*="/status/"]` permalink
   - `authorUsername` and `authorUserId` (the latter from internal data attributes when available)
   - `text` from `[data-testid="tweetText"]`
   - `createdAt` from the `<time datetime="…">` element
   - `publicMetrics` from the action-row counters (likes/replies/reposts/views)
   - `isReply`, `inReplyToTweetId`, `conversationId` if available
3. If on a tweet detail page (`/status/:id`), additionally collect the first 10 reply tweets in the thread via the same selectors.
4. Send `{tweets: [...]}` to the background worker → `POST /voice/scrape`.

The DOM scrape is intentionally cheap and forgiving — missing fields are nullable. The server treats this data as authoritative for `voice_tweets`; no X API call is made unless `pollMetrics=true` is set, in which case the tweet enters the voice metrics polling cadence ($0.005/poll × 18 ≈ $0.09 over 7 days).

**Auto-author handling.** When `/voice/scrape` sees an `authorUserId` not in `tracked_authors`, it inserts a row with `source='auto_from_scrape'`, `pull_enabled=false`, `metrics_polling_enabled=false`. So scraping someone doesn't silently kick off paid pulls. Promote them to active tracking from the side panel's Voice tab.

**Auth & CORS.**
- Side panel reads `apiUrl` and `bearer` from `chrome.storage.local`. Background worker injects `Authorization: Bearer …` on every request.
- Server's `cors()` middleware allows `chrome-extension://*` origins, plus the deployed UI origin if any.
- Extension manifest declares `host_permissions` for the API URL plus `https://x.com/*`, `https://twitter.com/*`.

**Future surface (not v1, but the extension is the right home for):**
- Inline metrics on my own tweets when viewing them on X ("this tweet is at 1.2× your 7-day median").
- One-click "find similar voice" — searches `voice_tweets` for hooks resembling the current page's tweet.
- Capture-on-paste — clipboard listener that suggests creating a draft when text is copied from a tweet.
- Drag-to-reorder thread segments in the composer.

These are easy to layer on once the v1 surface is shipped; they don't need new server routes beyond what's already listed.

## Phased build

Five short phases. Each ends with something usable.

**Phase 1 — Plumbing + Calendar (3–4 days)**
- Move existing X primitives into `src/x/` (auth, client, endpoints, errors, fields, pagination, token-store, server, playground) — pure relocation, no behavior change
- Add Drizzle + Neon: `src/db/client.ts`, `src/db/shared-schema.ts` (cost_events with `platform` column), `src/x/db/schema.ts`; generate first migration
- Port `src/x/token-store.ts` to read/write the `tokens` row
- `src/app.ts` + `src/middleware/auth.ts` + `src/routes/healthz.ts`
- `src/x/routes/calendar.ts` (CRUD on `scheduled_posts`), mounted under `/x` via `src/x/index.ts::mountX`
- `src/x/workers/publisher.ts` running on a 60 s interval
- `src/x/pricing.ts` + `src/middleware/costTracker.ts` wired into `xFetch.onCost` with `platform: 'x'`
- Smoke: schedule a post 2 min ahead, see it ship, see one row in `cost_events` with `platform='x'`

**Phase 2 — Metrics + own-reconcile (3–4 days)**
- `posts_published` insert when publisher succeeds (source `'scheduled'`)
- New endpoint wrapper in `src/x/endpoints.ts`: `getUserTweets(token, xUserId, opts)` (paginated, replies included)
- `src/x/workers/ownReconcile.ts` daily + manual `POST /x/posts/reconcile` (source `'manual'` for unseen rows)
- `src/x/workers/metricsPoll.ts` + cadence function for own posts
- `src/x/routes/metrics.ts` with `GET /x/metrics/:tweetId` returning the time series
- Cost dashboard route (`src/routes/cost.ts` → `/cost/today`, grouped by platform)
- Smoke: post manually from the X app, hit `/x/posts/reconcile`, see the row land and start collecting snapshots

**Phase 3 — Voice library + voice metrics (3–4 days)**
- `src/x/routes/voice.ts` track/untrack/pull/query/metrics
- `src/x/workers/voicePull.ts` hourly refresh — reuses `getUserTweets`, replies included, populates `next_poll_at` for the top `max_polled_tweets` per author
- `src/x/workers/voiceMetricsPoll.ts` + lighter cadence ladder
- Index strategy: `voice_tweets(author_x_user_id, created_at desc)` is enough for now; add full-text on `text` only if grep over the API gets clunky

**Phase 4 — Extension MVP: calendar + drafts (4–5 days)**
- `extension/` scaffold: Vite + React + TS, manifest.json, three entry points (background, content, sidepanel)
- Server: `src/middleware/cors.ts`, `'draft'` status accepted on `/x/posts/scheduled`, `status` filter on the GET
- Side panel: Settings (API URL + bearer), Calendar (7-day grid), Composer (create + edit), Drafts tab, basic styling
- Background worker: typed API client with auth-header injection (talks to `/x/...`)
- Smoke: install unpacked extension, configure, schedule a post from the side panel, see it appear in the API and ship at the right minute

**Phase 5 — Extension scraping into voice library (2–3 days)**
- Content script: `MutationObserver`-based "Save to stratus" buttons on tweet action rows
- Tweet detail page: scrape original + first 10 replies in one shot
- Server: `POST /x/voice/scrape` with auto-author handling and the `pollMetrics` flag
- Side panel Voice tab: search + author filter; "promote to actively tracked" toggle for auto-added authors
- Smoke: open a thread on x.com, click save, confirm 11 rows in `voice_tweets`, all with the correct `is_reply`/`conversation_id`

After Phase 5, stop. The next thing is analysis (LLM over `voice_tweets`, post-mortem reports over `metrics_snapshots`, agentic flows that pre-fill drafts from voice patterns) — that's a separate project, not more wrapper.

**Phases 6–10 — the Growth Engine overhaul (2026-06).** `OVERHAUL-PLAN.md` is the
milestone spec for everything after Phase 5; `CLAUDE.md`'s phase block tracks what
shipped. Summary of what landed:

**Phase 6 — Close the loops (shipped 2026-06-10).** Follower KPI snapshots
(`account_snapshots`, $0.001/day), reply outcomes join (`GET /x/replies/outcomes`),
harvest ingestion (`harvest_runs`/`harvest_rows`, $0), the Daily Brief
(`GET /x/brief` + Today tab), worker heartbeats in `/healthz`, publisher
double-post hardening, URL guard at schedule time, SIGTERM drain, `/cost/daily`
+ budget watchdog.

**Phase 7 — Reply Engine 2.0 (shipped 2026-06-10).** Prompt surgery (structured
outputs, two variants, idea steer, specificity gate, 350-token cap + prefix
caching), the Radar worked queue, server-side band gate (`422 band_gate` with
`override` escape hatch), target roster (`GET /x/voice/targets` + momentum),
mention inbox (`mentions` table, `GET/PATCH /x/mentions`, `POST /x/mentions/refresh`,
manual paste only).

**Phase 8 — Authoring 2.0 (shipped 2026-06-10).** Original-post drafter
(`POST /x/posts/draft` — three register-distinct drafts, pillar-tagged, few-shot
from measured winners, ~$0.006/call); threads (`POST /x/posts/threads`,
`thread_id`/`thread_position`/`segment` status, publisher chains self-replies
~500ms apart, link-in-first-reply at $0.030 instead of $0.20, frozen-on-failure);
template extraction (`POST /x/voice/tweets/:id/extract` + `/x/voice/extract-batch`,
~$0.005/tweet one-time, hook/skeleton/line-break/length/device columns + Remix);
best-time + pillar analytics (`GET /x/metrics/best-times` normalized by new
`age_at_snapshot_min`, `GET /x/metrics/pillars`, `pillar` columns); bounded day-7
winner re-read (cap 5/day, claim-before-read); self-quote re-up
(`POST /x/posts/reup`, publisher verifies `quote_tweet_id` against
`posts_published` before posting with `verifiedSelfQuote`).

**Phase 9 — Hardening (shipped 2026-06-10).** Pricing truthfulness (`costHint`
through `xFetch`, URL posts bill $0.20, $0-priced 2xx warnings, unknown-Grok-model
warning); reply/quote gates verify (`parentAuthorId`, `verifiedSelfQuote`);
locale-hardened metric parsing (`extension/src/shared/metricsAria.ts` +
`metrics_unparsed` reporting); harvester robustness (since-last cursor, replies
`groupPosition`, CSV formula-escape, content-shape columns); extension API-client
consolidation onto the background route + `GET /x/posts/scheduled/:id`;
money-path tests (`src/app.test.ts` + pure-function suites); deploy hardening
(migrations before restart, git SHA in `/healthz`, `STRATUS_DEPLOY_HOST` env);
tsconfig covers `scripts/` + `drizzle.config.ts`; `/healthz` stops echoing raw DB
errors.

**Phase 10 — Generated media: not started (gated).** Only after an image post
wins a manual A/B; requires OAuth 1.0a for `/2/media/upload`.

## Explicitly NOT doing

- No replies to non-self tweets, no cross-account quote tweets (Feb 2026 policy mess)
- No media uploads (OAuth 1.0a still required; not worth the complexity for solo use yet)
- No follower / mute / block sync (not in the three goals)
- No idempotency draft-row pattern (single-user, low write volume — duplicates are easy to delete; reconcile catches anything the publisher thought failed but actually shipped)
- No multi-tenant auth (one user, one bearer token shared between API and extension)
- No publishing the extension to the Chrome Web Store — load unpacked from a local clone; revisit only if a second person uses it
- No per-tier budget caps (one wallet, one human; the dashboard is the cap)

If any of those becomes necessary, lift the relevant section from `X-API-IMPLEMENTATION-PLAN.md` then — not now.

---

*Update `CLAUDE.md` to point at this file as the canonical build plan once Phase 1 lands.*
