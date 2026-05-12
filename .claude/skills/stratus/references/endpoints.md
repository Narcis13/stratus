# Stratus endpoint reference

Full request/response shapes for every route. Use this when crafting a non-trivial body or interpreting a response. All paths are relative to `$STRATUS_BASE_URL`. All bodies are JSON. Every endpoint except `GET /healthz` requires `Authorization: Bearer $STRATUS_API_TOKEN`.

## Table of contents

- [Health](#health)
- [Cost](#cost)
- [Scheduled posts (calendar)](#scheduled-posts-calendar)
- [Published posts (reconcile)](#published-posts-reconcile)
- [Metrics (own tweets)](#metrics-own-tweets)
- [Voice — authors](#voice--authors)
- [Voice — pulls and scrapes](#voice--pulls-and-scrapes)
- [Voice — tweet stash queries](#voice--tweet-stash-queries)
- [Voice — metrics](#voice--metrics)
- [Replies — generate](#replies--generate)
- [Replies — CRUD](#replies--crud)
- [Grok ask](#grok-ask)
- [Error shapes](#error-shapes)
- [Cost cheatsheet for the operator](#cost-cheatsheet-for-the-operator)

---

## Health

### GET /healthz

No auth. `200 {"ok":true}` if DB round-trips, else `503 {"ok":false,"error":"..."}`.

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

---

## Scheduled posts (calendar)

DB-backed CRUD over `scheduled_posts`. The publisher worker drains `status='pending'` rows whose `scheduledFor <= now()` every 60 s.

Status lifecycle: `draft → pending → posted` (worker) | `pending → failed` (worker) | `* → cancelled` (user PATCH) | `* → DELETE` (user, except `posted`).

### POST /x/posts/scheduled

Body fields:

- `text` (string, required) — tweet body. Trim happens server-side; empty → `400 text_required`.
- `scheduledFor` (string|null, optional) — ISO 8601 UTC, e.g. `"2026-05-15T13:30:00Z"`. Required when status is `pending`.
- `mediaIds` (string[]|null, optional) — currently a no-op at publish time (media upload not supported), but the field is accepted for forward compat.
- `status` (`"draft"`|`"pending"`, optional) — if omitted: derived (`pending` if `scheduledFor` set, else `draft`). Cannot create with `posted`/`failed`/`cancelled`.

`201` returns the inserted row. `400 invalid_*` on bad shapes.

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
- `status` — one of `draft|pending|posted|failed|cancelled`

Order: `scheduledFor asc nulls last, createdAt desc`. Returns an array.

### PATCH /x/posts/scheduled/:id

Body fields (all optional, any subset):

- `text` (string)
- `scheduledFor` (string|null)
- `mediaIds` (string[]|null)
- `status` (`draft|pending|failed|cancelled`) — cannot set to `posted` here.

Constraints:

- `409 cannot_edit_posted` if row is already `posted`.
- If final status is `pending`, final `scheduledFor` must be non-null (`400 scheduled_for_required_when_pending`).

### DELETE /x/posts/scheduled/:id

`204` on success. `404 not_found` / `409 cannot_delete_posted`.

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

## Voice — authors

### POST /x/voice/track

Body:

- `username` (string, required) — `^[A-Za-z0-9_]{1,15}$`; leading `@` is stripped.
- `maxPolledTweets` (positive int, optional, default 20) — guardrail for `voiceMetricsPoll`.

Side effects: one `getUserByUsername` X call → `$0.010`. Upserts `tracked_authors` with `source='manual'`, both `pullEnabled` and `metricsPollingEnabled` set to `true` (overrides any prior soft-disable).

Errors: `404 user_not_found`, `502 resolve_failed`, `400 invalid_username`.

### GET /x/voice/authors

Query: `?source=manual|auto_from_scrape` (optional). Returns array, ordered by username, with `tweetCount` left-joined from `voice_tweets`.

### PATCH /x/voice/authors/:username

Body (any subset):

- `pullEnabled` (bool)
- `metricsPollingEnabled` (bool)
- `maxPolledTweets` (positive int)
- `source` (`manual|auto_from_scrape`)

`400 no_updates` if body is empty. `404 not_found` if username not tracked.

### DELETE /x/voice/track/:username

Soft disable. Flips both flags to `false` AND retires any active voice tweets for that author so `voiceMetricsPoll` stops spending on them. Returns `{ author, retiredVoiceTweets: <int> }`. Re-enable via `POST /x/voice/track` (which resets the flags to `true`).

---

## Voice — pulls and scrapes

### POST /x/voice/pull/:username

On-demand pull of recent tweets for an already-tracked author. Body:

- `fullScan` (bool, default false) — ignore the `since_id` checkpoint.
- `maxResults` (number, optional, hard cap 3200) — **always clamp this on busy accounts** ($0.005/result).

Returns `{ scanned, inserted }`. `404 not_found` if author isn't tracked.

### POST /x/voice/scrape

Extension-only ingest path. Body shape (no X API calls except a `$0.010` lookup per *new* author):

```json
{
  "original": {
    "tweetId": "1791…",
    "username": "naval",
    "displayName": "Naval",
    "text": "…",
    "createdAt": "2026-05-12T10:00:00Z",
    "url": "https://x.com/naval/status/1791…"
  },
  "replies": [ { "tweetId": "…", "username": "…", "text": "…", "createdAt": null, "url": null } ],
  "pollMetrics": false
}
```

New authors get `source='auto_from_scrape'` with BOTH `pullEnabled` and `metricsPollingEnabled` false — promote via `PATCH /x/voice/authors/:username` if you want active tracking. Returns counts of inserted/updated tweets and resolved/created/failed authors.

---

## Voice — tweet stash queries

### GET /x/voice/tweets

Query params (all optional):

- `author` — either a numeric X user id OR a `@username`. `[]` returned if username isn't tracked.
- `q` — case-insensitive substring match on `text` (ILIKE; `%` and `_` escaped).
- `minLikes` — number; filters by the latest snapshot's `public_metrics.like_count` (untracked → 0).
- `includeReplies` (default false) — `?includeReplies=true` to include reply tweets.
- `limit` (default 50, max 200).

Response rows include `latestPublicMetrics` (the most recent snapshot's `public_metrics` JSON, or null). Ordered by `createdAt desc`.

---

## Voice — metrics

### GET /x/voice/metrics/:tweetId

Snapshot history for one voice tweet. Same shape as `/x/metrics/:tweetId` but `snapshots[]` only carries `publicMetrics` (other-user reads can't see private metrics).

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
    ]
  }
  ```
- `systemPromptOverride` (string, optional) — replaces the default REPLY-MASTER system prompt for this call. Persisted on the row.
- `model` (string, optional) — default `grok-4.3`. Aliases `grok-4.3-latest`/`grok-latest` priced.
- `reasoningEffort` (`none|low|medium|high`, optional) — default `low`.

Response is the full draft row from `reply_drafts`:

```json
{
  "id": "uuid",
  "sourceTweetId": "1791…",
  "sourceAuthorUsername": "naval",
  "sourceText": "…",
  "sourceUrl": "https://x.com/naval/status/1791…",
  "contextSnapshot": { "...": "the full context echoed back" },
  "replyText": "…drafted reply…",
  "replyTextEdited": null,
  "model": "grok-4.3",
  "promptTokens": 412, "completionTokens": 89,
  "costUsd": "0.00214",
  "grokRequestId": "req_…",
  "systemPromptOverride": null,
  "status": "generated",
  "postedTweetId": null,
  "createdAt": "…", "updatedAt": "…"
}
```

Errors: `400 invalid_context_*` on validation; `502 grok_upstream_error` (with `status,type,code,message,requestId`) on xAI failure; `429` if xAI rate-limits.

## Replies — CRUD

### GET /x/replies

Query: `?status=&sourceAuthor=&limit=&since=`. Default limit 50 (max 200). `status` ∈ {generated, copied, posted, discarded}. `since` is an ISO timestamp filter on `createdAt`.

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
| `POST /x/voice/track`            | $0.010 (one user lookup)          | voice track             |
| `POST /x/voice/pull/:username`   | $0.005 / result                   | other-user reads        |
| `POST /x/voice/scrape`           | $0.010 / NEW author (deduped)     | scrape lookup           |
| Voice metrics poll tick (opt-in) | $0.005 each, ~18 over 7 days      | voiceMetricsPoll        |
| `POST /x/replies/generate`       | ~$0.001–0.005 (token-based)       | Grok Responses          |
| `POST /grok/ask`                 | token-based                       | Grok Responses          |
| `GET /cost/today`                | $0                                | shared cost_events read |
