# Stratus endpoint reference

Full request/response shapes for every route. Use this when crafting a non-trivial body or interpreting a response. All paths are relative to `$STRATUS_BASE_URL`. All bodies are JSON. Every endpoint except `GET /healthz` requires `Authorization: Bearer $STRATUS_API_TOKEN`.

## Table of contents

- [Health](#health)
- [Cost](#cost)
- [Daily brief](#daily-brief)
- [Scheduled posts (calendar)](#scheduled-posts-calendar)
- [Published posts (reconcile)](#published-posts-reconcile)
- [Metrics (own tweets)](#metrics-own-tweets)
- [Voice — scrape & enrich (ingest)](#voice--scrape--enrich-ingest)
- [Voice — authors](#voice--authors)
- [Voice — tweet stash](#voice--tweet-stash)
- [Harvest ingestion](#harvest-ingestion)
- [Replies — generate](#replies--generate)
- [Replies — CRUD](#replies--crud)
- [Grok ask](#grok-ask)
- [Error shapes](#error-shapes)
- [Cost cheatsheet for the operator](#cost-cheatsheet-for-the-operator)

---

## Health

### GET /healthz

No auth. `200` if the DB round-trips AND every registered worker heartbeat is fresh; `503` otherwise.

```json
{
  "ok": true,
  "version": "0.1.1",
  "workers": [
    { "name": "x.publisher",    "lastBeatAt": "...", "staleAfterMs": 300000,   "stale": false },
    { "name": "x.dailyMetrics", "lastBeatAt": "...", "staleAfterMs": 90000000, "stale": false }
  ]
}
```

On failure adds `"error"` (DB) and/or `"staleWorkers": ["x.publisher"]`. Publisher is stale after >5 min without a tick, dailyMetrics after >25 h without a run. `workers` is empty when hit without `startXWorkers` (tests).

---

## Cost

### GET /cost/today

Returns the current UTC day's spend, grouped by platform and endpoint. Rows come from `cost_events` written by `xFetch.onCost` (X) and `askGrok` (Grok).

Response:

```json
{
  "from": "2026-05-13T00:00:00.000Z",
  "to":   "2026-05-14T00:00:00.000Z",
  "totalUsd": 0.087,
  "totalCalls": 41,
  "byPlatform": [
    {
      "platform": "x",
      "costUsd": 0.072,
      "calls": 38,
      "byEndpoint": [
        { "endpoint": "/2/tweets", "costUsd": 0.045, "calls": 3 },
        { "endpoint": "/2/users/:id/tweets", "costUsd": 0.027, "calls": 27 }
      ]
    },
    {
      "platform": "grok",
      "costUsd": 0.015,
      "calls": 3,
      "byEndpoint": [ { "endpoint": "/v1/responses", "costUsd": 0.015, "calls": 3 } ]
    }
  ]
}
```

Platforms with a registered soft daily budget (X: `X_DAILY_BUDGET_USD`, default $0.15) also carry `"dailyBudgetUsd"` and `"overBudget"` on their entry. Crossing the budget logs a `BUDGET WATCHDOG` error server-side; it never blocks calls.

### GET /cost/daily

Trailing daily spend series, UTC days, today included, zero-filled (every day present even with no spend).

Query params:

- `days` (optional, default `30`, clamped 1–90). Non-numeric → `400 {"error":"invalid_days"}`.

```json
{
  "from": "2026-05-12T00:00:00.000Z",
  "days": 30,
  "budgets": { "x": 0.15 },
  "daily": [
    { "day": "2026-05-12", "totalUsd": 0.034, "totalCalls": 12,
      "byPlatform": [ { "platform": "x", "costUsd": 0.034, "calls": 12 } ] }
  ]
}
```

---

## Daily brief

### GET /x/brief

The growth-coach payload behind the extension's Today tab (OVERHAUL-PLAN §6.4): follower trend, yesterday's numbers, today's schedule + empty slots, reply quota, the week's 70/30 ratio, and today's spend in one $0 JSON (pure SQL, no X API reads).

Query params:

- `tzOffsetMin` (optional, default `0`) — JS `Date.getTimezoneOffset()` of the viewer, i.e. UTC − local in minutes (`-180` for UTC+3). Sets the local-day boundaries for `yesterday`/`today`/`replyQuota`. Spend ignores it and stays on the UTC billing day, matching `/cost/today`. Invalid values → `400 {"error":"invalid_tz_offset_min"}`.

Response (shapes elided where they repeat other endpoints):

```json
{
  "generatedAt": "2026-06-10T09:28:59.178Z",
  "tzOffsetMin": -180,
  "account": {
    "followers": 199,
    "measuredAt": "2026-06-10T08:20:35.077Z",
    "delta7d": 13,
    "sparkline": [ { "snapshotAt": "...", "followers": 186 } ]
  },
  "yesterday": {
    "from": "...", "to": "...",
    "posts":   [ { "tweetId": "...", "text": "...", "postedAt": "...", "isReply": false,
                   "measuredAt": "...", "metrics": { "views": 43, "likes": 1, "replies": 1,
                   "retweets": 0, "quotes": 0, "bookmarks": 0, "profileVisits": 0 } } ],
    "replies": [ "same shape, isReply: true" ],
    "profileClickLeaders": [ "same shape — top 3 by profileVisits over the trailing 7 days" ]
  },
  "today": {
    "from": "...", "to": "...",
    "scheduled": [ { "id": "uuid", "text": "...", "scheduledFor": "...", "status": "pending" } ],
    "anchors": [ 8, 12, 16, 20 ],
    "gaps": [ 16 ]
  },
  "replyQuota": { "postedToday": 12, "target": { "min": 10, "max": 20 } },
  "week": { "from": "...", "to": "...", "posts": 30, "replies": 120, "replyPct": 80, "targetReplyPct": 70 },
  "spend": {
    "from": "...", "to": "...",
    "xUsd": 0.081, "grokUsd": 0.012, "totalUsd": 0.093,
    "byPlatform": [ { "platform": "x", "costUsd": 0.081, "calls": 10 } ]
  }
}
```

Notes for the operator:

- `delta7d` diffs the latest `account_snapshots` row against the newest one ≥7 days old (oldest available when history is shorter; `null` with <2 snapshots). `sparkline` is the last 14 days.
- `anchors` are the cadence ladder hours (local): 3/day → `[9,13,18]`, 4/day → `[8,12,16,20]`, picked by how many pending/posted slots today already has. `gaps` are anchor hours no scheduled post sits nearest to — "you have no post slotted for 16:00".
- `replyQuota.postedToday` counts `reply_drafts` flipped to `posted` today (paste time); replies posted outside Reply Master only appear after the next 03:00 UTC discovery pass.
- `metrics` on yesterday's rows is `null` until the 03:00 UTC pass snapshots them — same once-only data as `/x/metrics/*`.

DB-backed CRUD over `scheduled_posts`. The publisher worker drains `status='pending'` rows whose `scheduledFor <= now()` every 60 s.

Status lifecycle: `draft → pending → publishing → posted` (worker) | `publishing → failed` (worker, definite X 4xx) | `* → cancelled` (user PATCH) | `* → DELETE` (user, except `posted`/`publishing`). A row stuck in `publishing` means the X outcome is unknown (5xx/network mid-call) — it is never auto-retried; the publisher logs it every tick and the daily reconcile picks the tweet up if it actually shipped.

URL guard: rows that are (or would become) `pending` with a URL in `text` are rejected with `400 {"error":"url_in_text","hint":...}` — a URL post bills at $0.20 instead of $0.015, so `createPost` would refuse it at the scheduled minute anyway (a silently lost slot). Drafts may hold URLs; the check re-runs when promoting to `pending`.

### POST /x/posts/scheduled

Body fields:

- `text` (string, required) — tweet body. Trim happens server-side; empty → `400 text_required`.
- `scheduledFor` (string|null, optional) — ISO 8601 UTC, e.g. `"2026-05-15T13:30:00Z"`. Required when status is `pending`.
- `mediaIds` (string[]|null, optional) — currently a no-op at publish time (media upload not supported), but the field is accepted for forward compat.
- `status` (`"draft"`|`"pending"`, optional) — if omitted: derived (`pending` if `scheduledFor` set, else `draft`). Cannot create with `publishing`/`posted`/`failed`/`cancelled`.

`201` returns the inserted row. `400 invalid_*` on bad shapes; `400 url_in_text` when creating a `pending` row whose text contains a URL.

Example:

```bash
curl -sX POST "$STRATUS_BASE_URL/x/posts/scheduled" \
  -H "Authorization: Bearer $STRATUS_API_TOKEN" -H 'Content-Type: application/json' \
  -d '{"text":"shipping notes","scheduledFor":"2026-05-15T13:30:00Z"}'
```

Response row:

```json
{
  "id": "8e3e…uuid",
  "text": "shipping notes",
  "mediaIds": null,
  "scheduledFor": "2026-05-15T13:30:00.000Z",
  "status": "pending",
  "postedTweetId": null,
  "errorClass": null,
  "errorDetail": null,
  "source": "api",
  "createdAt": "2026-05-13T19:01:22.000Z",
  "updatedAt": "2026-05-13T19:01:22.000Z"
}
```

### GET /x/posts/scheduled

Query params (all optional, ANDed):

- `from` (ISO date) — `scheduledFor >= from`
- `to` (ISO date) — `scheduledFor < to`
- `status` — one of `draft|pending|publishing|posted|failed|cancelled`

Order: `scheduledFor asc nulls last, createdAt desc`. Returns an array.

### PATCH /x/posts/scheduled/:id

Body fields (all optional, any subset):

- `text` (string)
- `scheduledFor` (string|null)
- `mediaIds` (string[]|null)
- `status` (`draft|pending|failed|cancelled`) — `posted`/`publishing` are worker-owned (`400 status_not_settable_via_patch`).

Constraints:

- `409 cannot_edit_posted` / `409 cannot_edit_publishing` if the row is in a worker-owned state.
- If final status is `pending`, final `scheduledFor` must be non-null (`400 scheduled_for_required_when_pending`).
- If final status is `pending`, final `text` must not contain a URL (`400 url_in_text`).

### DELETE /x/posts/scheduled/:id

`204` on success. `404 not_found` / `409 cannot_delete_posted` / `409 cannot_delete_publishing`.

---

## Published posts (reconcile)

### POST /x/posts/reconcile

Manually trigger the own-reconcile worker (also runs daily in-process when `OWN_RECONCILE_ENABLED!=false`). Picks up tweets we posted from the X app and inserts them into `posts_published` so metrics polling can begin.

Body (all optional):

- `fullScan` (bool, default false) — ignore the `since_id` checkpoint and rescan from the top.
- `maxResults` (number, default 500, hard cap 3200) — max tweets to fetch this pass.

Response: `{ "scanned": <int>, "inserted": <int> }`. Cost ≈ `$0.001 × scanned` (owned reads).

---

## Metrics (own tweets)

### GET /x/metrics/:tweetId

`tweetId` is the X snowflake (digits only, 1–32 chars). `404 not_found` if not in `posts_published`.

Response:

```json
{
  "tweetId": "1791…",
  "postedAt": "2026-05-10T13:30:00.000Z",
  "retired": false,
  "pollCount": 17,
  "nextPollAt": "2026-05-13T20:00:00.000Z",
  "lastSeenAt": "2026-05-13T19:30:12.000Z",
  "snapshots": [
    {
      "snapshotAt": "2026-05-10T13:35:00Z",
      "publicMetrics": { "retweet_count": 0, "reply_count": 0, "like_count": 3, "quote_count": 0, "bookmark_count": 1, "impression_count": 124 },
      "nonPublicMetrics": { "impression_count": 124, "url_link_clicks": 0, "user_profile_clicks": 2 },
      "organicMetrics":   { "impression_count": 124, "like_count": 3, "reply_count": 0, "retweet_count": 0, "url_link_clicks": 0, "user_profile_clicks": 2 }
    }
  ]
}
```

`nonPublicMetrics`/`organicMetrics` go null after 30 days from `postedAt`. The worker retires the row past the 30-day boundary.

---

## Voice — scrape & enrich (ingest)

The voice library is a **pure DOM-scrape swipe file** (pivoted 2026-06-01). **Every route below is `$0`** — Postgres only, no X API. Authors are keyed by lowercased `@handle`; the numeric `xUserId` is stored opportunistically (nullable). These two routes are how the Chrome extension feeds the library.

### POST /x/voice/scrape

Save a DOM-scraped tweet (and stub/fill its author). Body:

```json
{
  "tweet": {
    "tweetId": "1791…",     // digits, required
    "handle": "naval",       // ^[A-Za-z0-9_]{1,15}$, @/case stripped, required
    "displayName": "Naval",  // optional
    "text": "…",             // optional — may be "" for image-only tweets
    "html": "…",             // optional — innerHTML of [data-testid="tweetText"]
    "createdAt": "2026-05-12T10:00:00Z",  // optional ISO
    "url": "https://x.com/naval/status/1791…"  // optional
  },
  "author": {                // optional best-effort hover-card block
    "handle": "naval",
    "displayName": "Naval",
    "bio": "…",
    "followersCount": 2100000,
    "followingCount": 60,
    "xUserId": "745273"
  }
}
```

- `400 invalid_tweet` if `tweet.tweetId`/`tweet.handle` are missing/malformed. A bad `author` block is non-fatal (the tweet's own handle anchors the author row).
- Re-scrape refreshes `text`/`scrapedHtml`/`url` + `updatedAt` on the tweet; on the author it only **fills null** columns (never clobbers a richer profile scrape).
- `201 { tweet, author }`.

### PUT /x/voice/authors/:handle

Authoritative enrich from the author's profile header. Body (all optional, but ≥1 non-null required):

- `displayName`, `bio` (strings)
- `followersCount`, `followingCount` (non-negative ints)
- `pinnedTweetId` (digits), `pinnedTweetText` (string)
- `xUserId` (digits), `profileUrl` (string)

`400 invalid_handle` / `400 invalid_profile` (nothing usable). Upserts with `source='profile_scrape'`, stamps `enrichedAt`+`updatedAt`, overwrites only the columns the scrape caught. Returns the row.

---

## Voice — authors

### GET /x/voice/authors

Query: `?retired=true` to include archived authors (default hides them). Returns an array ordered by `handle`, each row carrying the profile fields (`displayName`, `bio`, `followersCount`, `followingCount`, `pinnedTweetId`, `pinnedTweetText`, `profileSummary`, `profileUrl`, `source`, `addedAt`, `enrichedAt`, `updatedAt`, `retired`) plus `tweetCount` (left-joined from `voice_tweets`).

### PATCH /x/voice/authors/:handle

Soft archive toggle. Body must be exactly `{ "retired": <bool> }` — else `400 invalid_retired`. `404 not_found` if the handle is unknown. Returns the updated row.

### DELETE /x/voice/authors/:handle

Hard delete. `409 { error: "author_has_tweets", tweets: <n> }` while any tweet still references the author — retire/delete its tweets first. `404 not_found` if unknown. `200 { deleted: <handle> }` on success.

---

## Voice — tweet stash

### GET /x/voice/tweets

Query params (all optional):

- `author` — a `@handle` (case/`@` stripped). `400 invalid_author` if malformed.
- `q` — case-insensitive substring match on `text` (ILIKE; `%` and `_` escaped).
- `retired=true` — include archived tweets (default hides them).
- `limit` (default 50, max 200; `400 invalid_limit` if not a positive int).

Rows: `tweetId`, `authorHandle`, `authorDisplayName` (joined), `text`, `scrapedHtml`, `createdAt`, `url`, `source`, `savedAt`, `updatedAt`, `retired`. Inner-joined to `voice_authors`, ordered by `createdAt desc`. (No `minLikes`/`includeReplies`/metrics filters — those died with the API-read model.)

### PATCH /x/voice/tweets/:tweetId

Soft archive toggle. `tweetId` must be digits (`400 invalid_tweet_id`). Body exactly `{ "retired": <bool> }` (`400 invalid_retired`). `404 not_found` if unknown. Returns the updated row.

### DELETE /x/voice/tweets/:tweetId

Hard delete. `404 not_found` if unknown. `200 { deleted: <tweetId> }` on success.

---

## Harvest ingestion

$0 — rows arrive DOM-scraped from the extension's Harvest tab ("Send to stratus" toggle, default on); no X API anywhere. Repeated harvests of the same tweet create new rows on purpose: the `(tweetId, capturedAt)` series in `harvest_rows` is the longitudinal view/bookmark curve.

### POST /x/harvest/runs

One run per harvest click. Body: `{ "handle": "@x", "mode": "posts"|"replies", "scope": "all"|"today"|"yesterday" }` (handle is `@`/case-normalized; `400 invalid_handle|invalid_mode|invalid_scope`). Returns `201` with the run row: `{ id, handle, mode, scope, rowCount, createdAt }`.

### POST /x/harvest/rows

Batched insert. Body: `{ "runId": "<uuid>", "rows": [ ... ] }`, max 500 rows per call (`400 too_many_rows`), `404 run_not_found` if the run id is unknown. Row schema:

```json
{
  "tweetId": "1791…",
  "handle": "13_narcissus",
  "text": "tweet body (may be empty)",
  "comments": 3, "reposts": 1, "likes": 12, "bookmarks": 2, "views": 845,
  "time": "2026-06-09T18:30:00Z",
  "orig": {
    "tweetId": "999…", "handle": "bigauthor", "text": "original post",
    "time": "2026-06-09T17:00:00Z", "comments": 19, "likes": 38, "views": 1500
  }
}
```

`time` may be null (timestamp not scraped). `orig` is replies-mode only — the tweet replied to, whose capture-time metrics feed BAND calibration. Validation errors come back as `400 { error: "invalid_row_…", index: <n> }` for the first bad row.

**Replies-mode reconcile (automatic):** each row is matched against `reply_drafts` — exact on `postedTweetId`, else a text+time fallback (collapsed-whitespace equality on what was actually posted, reply time within −10 min/+7 d of draft creation, same-source candidates preferred). A fallback match also **backfills the draft's missing `postedTweetId`**, which is what makes `GET /x/replies/outcomes` cover drafts never PATCHed after pasting. Response: `201 { inserted, matched, backfilled }`.

### GET /x/harvest/runs

`?limit=` (default 20, max 100). Recent runs newest-first, each with its cumulative `rowCount`.

---

## Replies — generate

### POST /x/replies/generate

Mounts only when `XAI_API_KEY` is set in the server env. Sends one Grok Responses-API call, then persists the draft to `reply_drafts`.

Body:

- `context` (required, object) — the source tweet + engagement + top replies. Schema:
  ```json
  {
    "tweetId":  "1791…",
    "handle":   "naval",          // no @
    "author":   "Naval",          // display name
    "text":     "tweet body",
    "url":      "https://x.com/naval/status/1791…",
    "postedAt": "2026-05-12T10:00:00Z",
    "metrics":  { "views": 12000, "replies": 30, "reposts": 5, "likes": 240 },
    "topComments": [
      { "author": "Display", "handle": "alice", "text": "…" }
    ],
    "signals":  { "band": "hot", "views": 12000, "replies": 30, "ageMin": 22, "vpm": 545, "bait": false }
  }
  ```
  `signals` is optional — the band verdict + classifier inputs the extension stamps at capture time (replyBand.ts), persisted in `contextSnapshot` so the draft is a labeled row for `GET /x/replies/outcomes`. `band` ∈ {hot, warm, skip, null}.
- `idea` (string, optional, ≤2000 chars) — the human steer, substituted into the prompt's `<idea>` tag. Romanian is fine; the reply comes out in English. Persisted on the row.
- `systemPromptOverride` (string, optional) — replaces the default REPLY-MASTER system prompt for this call. Persisted on the row.
- `model` (string, optional) — default `grok-4.3`. Aliases `grok-4.3-latest`/`grok-latest` priced.
- `reasoningEffort` (`none|low|medium|high`, optional) — default `low`.

The call uses Grok structured outputs (`{replies: [{text, angle}]}`) and asks for **two variants**, each tagged `extends` / `contrarian` / `debate`. A server-side specificity gate (digit OR first-person marker OR named tool) triggers exactly one automatic regenerate when no variant passes; `costUsd` then covers both calls. `replyText` is the first gate-passing variant; all variants ride along in `variants` for the picker.

Response is the full draft row from `reply_drafts`:

```json
{
  "id": "uuid",
  "sourceTweetId": "1791…",
  "sourceAuthorUsername": "naval",
  "sourceText": "…",
  "sourceUrl": "https://x.com/naval/status/1791…",
  "contextSnapshot": { "...": "the full context echoed back" },
  "replyText": "…primary variant…",
  "replyTextEdited": null,
  "variants": [
    { "text": "…primary variant…", "angle": "extends" },
    { "text": "…second variant…", "angle": "contrarian" }
  ],
  "idea": "seed text or null",
  "model": "grok-4.3",
  "promptTokens": 4400, "completionTokens": 240,
  "costUsd": "0.00350",
  "grokRequestId": "req_…",
  "systemPromptOverride": null,
  "status": "generated",
  "postedTweetId": null,
  "createdAt": "…", "updatedAt": "…"
}
```

Errors: `400 invalid_context_*` / `400 invalid_idea` on validation; `502 grok_upstream_error` (with `status,type,code,message,requestId`) on xAI failure; `502 grok_parse_error` if the structured output can't be parsed even after the retry; `429` if xAI rate-limits.

## Replies — CRUD

### GET /x/replies

Query: `?status=&sourceAuthor=&limit=&since=`. Default limit 50 (max 200). `status` ∈ {generated, copied, posted, discarded}. `since` is an ISO timestamp filter on `createdAt`.

### GET /x/replies/outcomes

First-party calibration data ($0, pure SQL): every `posted` draft joined to `posts_published` and its latest `metrics_snapshots` row via `postedTweetId`. Query: `?limit=&since=` (default/max limit 1000). Returns `{count, measured, unlinked, outcomes}`; each outcome row carries the capture-time `signals` (band verdict), `sourceMetrics`, and `outcome: {views, likes, replies, retweets, quotes, bookmarks, profileVisits}` — `profileVisits` is `user_profile_clicks`, the follow-precursor. `outcome` is null until the draft is linked (PATCH `postedTweetId`) **and** the daily pass has snapshotted the reply. Feeds `evals/analyze-own-replies.ts` (BAND recalibration at ≥100 measured).

### GET /x/replies/:id

`404 not_found` if id missing.

### PATCH /x/replies/:id

Body (any subset):

- `replyTextEdited` (string|null) — manual revision; the original `replyText` stays as-is.
- `status` — must follow the transition graph:
  - `generated → copied | posted | discarded`
  - `copied    → posted | discarded`
  - `posted    → discarded`
  - `discarded → ∅`
  Invalid transition: `409 invalid_status_transition`.
- `postedTweetId` (string|null) — only meaningful when final status is `posted` (`400 posted_tweet_id_requires_posted_status` otherwise).

### DELETE /x/replies/:id

`204` on success; `404 not_found` otherwise. Unlike scheduled posts, replies are deletable in any status (it's just a draft, not a publish record).

---

## Grok ask

### POST /grok/ask

Generic Grok Responses-API passthrough (no DB persistence beyond a `cost_events` row). Mounts only when `XAI_API_KEY` is set.

Body — either `prompt` or non-empty `messages`:

- `prompt` (string) — single-turn convenience.
- `system` (string, optional) — prepended as a system message.
- `messages` (`{role: 'system'|'user'|'assistant', content: string}[]`) — multi-turn.
- `model` (string, optional, default `grok-4.3`).
- `reasoningEffort` (`none|low|medium|high`).
- `maxOutputTokens` (int).
- `temperature` (number, 0..2).

Response:

```json
{
  "text": "…",
  "model": "grok-4.3",
  "usage": { "inputTokens": 412, "cachedInputTokens": 0, "outputTokens": 89, "totalTokens": 501 },
  "costUsd": 0.00214,
  "durationMs": 832,
  "requestId": "req_…"
}
```

Errors mirror `/x/replies/generate`'s upstream-error shape.

---

## Error shapes

Body validation: `{ "error": "snake_case_reason" }` with HTTP 400.

Auth: `{ "error": "unauthorized" }` 401.

Not found: `{ "error": "not_found" }` 404.

Conflict (write to posted, bad transition): `{ "error": "cannot_edit_posted" | "invalid_status_transition", ... }` 409.

Upstream X / Grok: `502 { error, status, type?, code?, message?, requestId? }`.

---

## Cost cheatsheet for the operator

| Op                               | Cost                              | Source                  |
|----------------------------------|-----------------------------------|-------------------------|
| `POST /x/posts/scheduled`        | $0 (DB only)                      | calendar                |
| Publisher tick → `createPost`    | $0.015 / post                     | per published row       |
| `POST /x/posts/reconcile`        | $0.001 × scanned                  | own-reconcile worker    |
| Metrics poll tick                | $0.001 each, ~113 over 30 days    | metricsPoll worker      |
| `POST /x/voice/scrape`           | $0 (DOM only, no X API)           | swipe-file ingest       |
| `PUT  /x/voice/authors/:handle`  | $0 (DOM only, no X API)           | author enrich           |
| `GET /x/voice/tweets` / `authors`| $0 (DB read)                      | swipe-file query        |
| `POST /x/replies/generate`       | ~$0.002–0.004 (2× on auto-retry)  | Grok Responses          |
| `POST /grok/ask`                 | token-based                       | Grok Responses          |
| `GET /cost/today`                | $0                                | shared cost_events read |
