# Stratus endpoint reference

Full request/response shapes for every route. Use this when crafting a non-trivial body or interpreting a response. All paths are relative to `$STRATUS_BASE_URL`. All bodies are JSON. Every endpoint except `GET /healthz` requires `Authorization: Bearer $STRATUS_API_TOKEN`.

## Table of contents

- [Health](#health)
- [Cost](#cost)
- [Daily brief](#daily-brief)
- [Scheduled posts (calendar)](#scheduled-posts-calendar)
- [Threads](#threads)
- [Post drafter (Grok)](#post-drafter-grok)
- [Published posts (reconcile)](#published-posts-reconcile)
- [Metrics (own tweets)](#metrics-own-tweets)
- [Metrics — aggregates & insight](#metrics--aggregates--insight)
- [Voice — scrape & enrich (ingest)](#voice--scrape--enrich-ingest)
- [Voice — authors](#voice--authors)
- [Voice — targets](#voice--targets)
- [Voice — tweet stash](#voice--tweet-stash)
- [Voice — template extraction (Grok)](#voice--template-extraction-grok)
- [Harvest ingestion](#harvest-ingestion)
- [Mentions inbox](#mentions-inbox)
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
  "gitSha": "45aa395",
  "workers": [
    { "name": "x.publisher",    "lastBeatAt": "...", "staleAfterMs": 300000,   "stale": false },
    { "name": "x.dailyMetrics", "lastBeatAt": "...", "staleAfterMs": 90000000, "stale": false }
  ]
}
```

`gitSha` is stamped by `scripts/deploy.sh` — use it to confirm which build is live. On failure adds `"error"` (a generic `db_unreachable` — raw DB errors are not echoed) and/or `"staleWorkers": ["x.publisher"]`. Publisher is stale after >5 min without a tick, dailyMetrics after >25 h without a run. `workers` is empty when hit without `startXWorkers` (tests).

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

---

## Scheduled posts (calendar)

DB-backed CRUD over `scheduled_posts`. The publisher worker drains `status='pending'` rows whose `scheduledFor <= now()` every 60 s. Rows carry `threadId`/`threadPosition` (threads), `pillar` (content pillar, from the drafter), and `quoteTweetId` (self-quote re-ups).

Status lifecycle: `draft → pending → publishing → posted` (worker) | `publishing → failed` (worker, definite X 4xx) | `* → cancelled` (user PATCH) | `* → DELETE` (user, except `posted`/`publishing`). `segment` marks thread tail rows (see [Threads](#threads)). A row stuck in `publishing` means the X outcome is unknown (5xx/network mid-call) — it is never auto-retried; the publisher logs it every tick and the daily reconcile picks the tweet up if it actually shipped.

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
- `status` — one of `draft|pending|segment|publishing|posted|failed|cancelled`

Order: `scheduledFor asc nulls last, createdAt desc`. Returns an array.

### GET /x/posts/scheduled/:id

Single row (`404 not_found` if unknown). A thread member additionally carries `thread: [...]` — all sibling rows ordered by `threadPosition`, so an editor can render the whole chain in one call.

### PATCH /x/posts/scheduled/:id

Body fields (all optional, any subset):

- `text` (string)
- `scheduledFor` (string|null)
- `mediaIds` (string[]|null)
- `status` (`draft|pending|failed|cancelled`) — `posted`/`publishing` are worker-owned (`400 status_not_settable_via_patch`).

Constraints:

- `409 cannot_edit_posted` / `409 cannot_edit_publishing` if the row is in a worker-owned state.
- Thread tail rows (`status='segment'`) accept **text edits only** — schedule/status changes return `409 segment_schedule_rides_with_head`.
- If final status is `pending`, final `scheduledFor` must be non-null (`400 scheduled_for_required_when_pending`).
- If final status is `pending`, final `text` must not contain a URL (`400 url_in_text`).

### DELETE /x/posts/scheduled/:id

`204` on success. `404 not_found` / `409 cannot_delete_posted` / `409 cannot_delete_publishing`. Thread rows delete **as a unit via the head** (cascades to segments); `409 thread_has_locked_segments` if any segment is already posted/publishing.

---

## Threads

### POST /x/posts/threads

One thread = one schedulable unit, N `scheduled_posts` rows sharing a `threadId`. The head (`threadPosition` 1) is a normal draft/pending row carrying `scheduledFor`; tails land as `status='segment'` and the publisher chains them as self-replies (~500 ms apart, $0.015/segment) after the head posts. One failed/ambiguous segment freezes the rest as `failed` (`errorClass='thread_frozen'`) — the chain is never re-posted from the top.

Body:

- `segments` (string[], required) — 2–25 non-empty texts, in order (`400 thread_needs_two_segments` / `400 too_many_segments`).
- `scheduledFor` (string|null, optional) — head's publish time.
- `status` (`draft`|`pending`, optional) — head's status; same derivation rules as a single post.
- `pillar` (optional) — stamped on every row.

URL guard applies to **segment 1 only** when pending (`400 url_in_text`, hint: move the link to a later segment). A URL in a tail segment is the documented cheap pattern — link-in-first-reply, $0.015 + $0.015 = $0.030 vs $0.20.

Returns `201 { threadId, segments: [rows] }`.

---

## Post drafter (Grok)

Mounts only when `XAI_API_KEY` is set. Both routes make one Grok structured-outputs call (~$0.006) returning **three register-distinct drafts** (plain / spicy / reflective) that land as `status='draft'` rows in the calendar with their `pillar` — nothing posts until a human flips a row to `pending`. Few-shot grounded in the top-5 own posts by measured views.

### POST /x/posts/draft

Body (all optional):

- `pillar` — `1|2|3` or `'ai-craft'|'builder-51'|'unsexy-problems'` (`400 invalid_pillar`). Omit to let Grok pick per draft.
- `idea` (string, ≤2000 chars) — human steer; Romanian in, English out.
- `voiceTweetId` (digits) — remix: lifts the saved tweet's extracted structure (hook/skeleton/line breaks/length/device) into the prompt (`404 voice_tweet_not_found`). Falls back to the raw text if the tweet was never extracted.
- `model`, `reasoningEffort` (`none|low|medium|high`, default `low`).

Returns `201 { drafts: [rows + register], winnersUsed, model, costUsd, requestId }`. Errors: `502 grok_upstream_error` / `502 grok_parse_error` / `429`.

### POST /x/posts/reup

Same pipeline steered toward a **self-quote re-up**. Body: `{ tweetId (required, must be MY published tweet — 404 not_own_tweet otherwise), idea?, pillar?, model?, reasoningEffort? }`. Drafts carry `quoteTweetId`; the publisher re-verifies ownership at post time and posts with a verified self-quote (Feb 2026 policy — non-self quotes are refused).

---

## Published posts (reconcile)

### POST /x/posts/reconcile

One-shot run of the **daily `dailyMetrics` pass** (the in-process timer fires at 03:00 UTC unless `DAILY_METRICS_ENABLED=false`): account snapshot, own-timeline discovery, once-only metrics snapshots, winner re-reads, mentions pull. Picks up tweets posted from the X app and inserts them into `posts_published`.

Body (all optional):

- `fullScan` (bool, default false) — ignore the `since_id` checkpoint and rescan from the top.
- `maxResults` (number, default 500, hard cap 3200) — max tweets to discover this pass.

Response: `{ scanned, discovered, snapshotted, retired, failed, accountSnapshotted, mentionsScanned, mentionsNew, mentionsAnswered, rereadWinners }`. Cost ≈ `$0.001 × (scanned + snapshotted + mentionsScanned)` (owned reads).

---

## Metrics (own tweets)

### GET /x/metrics/:tweetId

`tweetId` is the X snowflake (digits only, 1–32 chars). `404 not_found` if not in `posts_published`.

Response:

```json
{
  "tweetId": "1791…",
  "postedAt": "2026-05-10T13:30:00.000Z",
  "retired": true,
  "pollCount": 1,
  "nextPollAt": "2026-05-11T13:30:00.000Z",
  "lastSeenAt": "2026-05-11T03:00:12.000Z",
  "snapshots": [
    {
      "snapshotAt": "2026-05-11T03:00:00Z",
      "publicMetrics": { "retweet_count": 0, "reply_count": 0, "like_count": 3, "quote_count": 0, "bookmark_count": 1, "impression_count": 124 },
      "nonPublicMetrics": { "impression_count": 124, "url_link_clicks": 0, "user_profile_clicks": 2 },
      "organicMetrics":   { "impression_count": 124, "like_count": 3, "reply_count": 0, "retweet_count": 0, "url_link_clicks": 0, "user_profile_clicks": 2 }
    }
  ]
}
```

Each tweet is snapshotted **once** at the first 03:00 UTC pass after it lands, then `retired=true` — there is no polling cadence, so expect a single snapshot (plus at most one day-7 "winner re-read" row when the first snapshot cleared 500 views; those carry `ageAtSnapshotMin`). `nextPollAt` is informational only. `nonPublicMetrics`/`organicMetrics` are only requested while the tweet is ≤28 days old at read time.

---

## Metrics — aggregates & insight

All $0 — pure SQL over already-billed snapshots.

### GET /x/metrics/posts · GET /x/metrics/replies

My non-reply posts / my replies, newest first, each with its latest snapshot. `?limit=` (default 50, max 200). Returns `{count, posts|replies: [{tweetId, text, postedAt, retired, pollCount, measuredAt, metrics: {views, likes, replies, retweets, quotes, bookmarks, profileVisits, urlLinkClicks} | null}]}` — `metrics` is null until the daily pass has read the tweet.

### GET /x/metrics/account

The follower-growth KPI series from `account_snapshots` (one row per UTC day, written by the daily pass). Returns `{count, latest, series: [{snapshotAt, followersCount, followingCount, tweetCount, listedCount, deltas, activity: {posts, replies}}]}` — `activity` counts what was published in each snapshot window, so a follower spike is attributable.

### GET /x/metrics/best-times

Engagement by posted UTC weekday × hour over my non-reply posts. Returns `{measuredPosts, top: [...5 best cells], cells: [{weekday (0=Sun, UTC), hour, posts, avgViews, avgViewsPerDay, avgLikes, avgProfileVisits}]}`. `avgViewsPerDay` normalizes by `ageAtSnapshotMin` (the daily pass reads tweets at 3–27 h old, so raw counts aren't comparable); null on cells with only pre-8.4 snapshots.

### GET /x/metrics/pillars

Performance by content pillar — joins `scheduled_posts.pillar` (originals) and `reply_drafts.pillar` (posted replies) to each tweet's latest snapshot. Returns `{count, pillars: [{pillar, posts, replies, measured, views, avgViews, likes, profileVisits, avgProfileVisits}]}`; untagged rows aggregate under `"unassigned"`.

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

`400 invalid_handle` / `400 invalid_profile` (nothing usable). Upserts with `source='profile_scrape'`, stamps `enrichedAt`+`updatedAt`, overwrites only the columns the scrape caught. When `followersCount` is present, also **appends a `voice_author_snapshots` point** — the append-only follower series that powers the targets roster's momentum. Returns the row.

---

## Voice — authors

### GET /x/voice/authors

Query: `?retired=true` to include archived authors (default hides them). Returns an array ordered by `handle`, each row carrying the profile fields (`displayName`, `bio`, `followersCount`, `followingCount`, `pinnedTweetId`, `pinnedTweetText`, `profileSummary`, `profileUrl`, `source`, `addedAt`, `enrichedAt`, `updatedAt`, `retired`) plus `tweetCount` (left-joined from `voice_tweets`).

### PATCH /x/voice/authors/:handle

Soft archive toggle. Body must be exactly `{ "retired": <bool> }` — else `400 invalid_retired`. `404 not_found` if the handle is unknown. Returns the updated row.

### DELETE /x/voice/authors/:handle

Hard delete. `409 { error: "author_has_tweets", tweets: <n> }` while any tweet still references the author — retire/delete its tweets first (the author's snapshot series is dropped in the same txn). `404 not_found` if unknown. `200 { deleted: <handle> }` on success.

---

## Voice — targets

### GET /x/voice/targets

The reply-target roster (§7.4), $0 pure SQL: non-retired voice authors whose `followersCount` sits in **2–10× my own follower count** (from the latest `account_snapshots` row — the daily getMe), ranked by **momentum** (followers/day between oldest and newest `voice_author_snapshots` point, span clamped ≥1 day; null with <2 points — those sink below measured authors, smallest first). Each row carries `lastRepliedAt`/`postedReplies` joined from posted `reply_drafts` on the lowercased source handle.

```json
{
  "myFollowers": 199,
  "measuredAt": "2026-06-10T08:20:35.077Z",
  "band": { "min": 398, "max": 1990 },
  "targets": [
    { "handle": "somebuilder", "displayName": "...", "followersCount": 850,
      "ratio": 4.3, "momentum": 12.5, "snapshotCount": 3,
      "lastRepliedAt": "2026-06-08T...", "postedReplies": 4,
      "profileUrl": "...", "enrichedAt": "..." }
  ]
}
```

Returns `{myFollowers: null, band: null, targets: []}` until the first daily pass has written an account snapshot. Momentum accrues from profile enrichment — each "Save author" click appends a follower point.

---

## Voice — tweet stash

### GET /x/voice/tweets

Query params (all optional):

- `author` — a `@handle` (case/`@` stripped). `400 invalid_author` if malformed.
- `q` — case-insensitive substring match on `text` (ILIKE; `%` and `_` escaped).
- `hook` — case-insensitive substring match on the extracted `hookType` (e.g. `?hook=stat`).
- `extracted` — `true` (only template-extracted tweets) or `false` (only un-extracted); anything else `400 invalid_extracted`.
- `retired=true` — include archived tweets (default hides them).
- `limit` (default 50, max 200; `400 invalid_limit` if not a positive int).

Rows: `tweetId`, `authorHandle`, `authorDisplayName` (joined), `text`, `scrapedHtml`, `createdAt`, `url`, `source`, `savedAt`, `updatedAt`, `retired`, plus the template columns `hookType`/`skeleton`/`lineBreakPattern`/`templateLength`/`device`/`templateExtractedAt`. Inner-joined to `voice_authors`, ordered by `createdAt desc`. (No `minLikes`/`includeReplies`/metrics filters — those died with the API-read model.)

### PATCH /x/voice/tweets/:tweetId

Soft archive toggle. `tweetId` must be digits (`400 invalid_tweet_id`). Body exactly `{ "retired": <bool> }` (`400 invalid_retired`). `404 not_found` if unknown. Returns the updated row.

### DELETE /x/voice/tweets/:tweetId

Hard delete. `404 not_found` if unknown. `200 { deleted: <tweetId> }` on success.

---

## Voice — template extraction (Grok)

Mounts only when `XAI_API_KEY` is set. One Grok structured-output pass per saved tweet distills the reusable **structure** — `{hookType, skeleton, lineBreakPattern, templateLength (short|medium|long), device}` — into `voice_tweets` columns (~$0.005/tweet, one-time, xAI tokens not X API). Structure only, never content: drafts that consume it (the `voiceTweetId` remix on `POST /x/posts/draft`) must transform, never reproduce.

### POST /x/voice/tweets/:tweetId/extract

(Re)extract one tweet. `400 invalid_tweet_id` / `404 not_found` / `502 extract_failed` (with `detail`; `empty_text` for image-only tweets). Returns `200 { tweet, costUsd }` with the updated row.

### POST /x/voice/extract-batch

Body: `{ "limit": <int> }` (optional, default 20, max 50 — ≤50 × $0.005 = $0.25 worst case per call). Processes never-extracted, non-retired tweets oldest-saved first, sequentially. Returns `200 { requested, extracted, failures: [{tweetId, error}], costUsd, remaining }`.

---

## Harvest ingestion

$0 — rows arrive DOM-scraped from the extension's Harvest tab ("Send to stratus" toggle, default on); no X API anywhere. Repeated harvests of the same tweet create new rows on purpose: the `(tweetId, capturedAt)` series in `harvest_rows` is the longitudinal view/bookmark curve.

### POST /x/harvest/runs

One run per harvest click. Body: `{ "handle": "@x", "mode": "posts"|"replies", "scope": "all"|"today"|"yesterday"|"since-last" }` (handle is `@`/case-normalized; `400 invalid_handle|invalid_mode|invalid_scope`; `since-last` is the extension's per-handle incremental cursor). Returns `201` with the run row: `{ id, handle, mode, scope, rowCount, createdAt }`.

### POST /x/harvest/rows

Batched insert. Body: `{ "runId": "<uuid>", "rows": [ ... ] }`, max 500 rows per call (`400 too_many_rows`), `404 run_not_found` if the run id is unknown. Row schema:

```json
{
  "tweetId": "1791…",
  "handle": "13_narcissus",
  "text": "tweet body (may be empty)",
  "comments": 3, "reposts": 1, "likes": 12, "bookmarks": 2, "views": 845,
  "time": "2026-06-09T18:30:00Z",
  "hasPhoto": false, "hasVideo": false, "isQuote": false,
  "textLen": 142, "lineBreaks": 2,
  "groupPosition": 1,
  "orig": {
    "tweetId": "999…", "handle": "bigauthor", "text": "original post",
    "time": "2026-06-09T17:00:00Z", "comments": 19, "likes": 38, "views": 1500
  }
}
```

`time` may be null (timestamp not scraped). `orig` is replies-mode only — the tweet replied to, whose capture-time metrics feed BAND calibration. The content-shape fields (`hasPhoto`/`hasVideo`/`isQuote`/`textLen`/`lineBreaks`) and `groupPosition` (replies mode: 1-based position inside the rendered reply group) are optional/nullable — older extension builds don't send them. Validation errors come back as `400 { error: "invalid_row_…", index: <n> }` for the first bad row.

**Replies-mode reconcile (automatic):** each row is matched against `reply_drafts` — exact on `postedTweetId`, else a text+time fallback (collapsed-whitespace equality on what was actually posted, reply time within −10 min/+7 d of draft creation, same-source candidates preferred). A fallback match also **backfills the draft's missing `postedTweetId`**, which is what makes `GET /x/replies/outcomes` cover drafts never PATCHed after pasting. Response: `201 { inserted, matched, backfilled }`.

### GET /x/harvest/runs

`?limit=` (default 20, max 100). Recent runs newest-first, each with its cumulative `rowCount`.

---

## Mentions inbox

Mentions of me (§7.5) — owned reads at $0.001/result. Pulled by the daily 03:00 UTC pass and on demand. Replying stays **manual paste**: draft via `/x/replies/generate` (send `override: true` — mention metrics are zeros — and `context.parent` with my post's text), copy, post on X, then PATCH the mention.

### GET /x/mentions

Query (optional): `status` (`unanswered|answered|dismissed`), `limit` (default 50, max 200). Rows newest-first, each with `parentText` left-joined from `posts_published` (my post the mention replies to — the thread context). Returns `{ counts: { unanswered }, mentions: [rows] }`.

### POST /x/mentions/refresh

Body (optional): `{ "maxResults": <int ≤200> }`. Incremental pull checkpointed on the max stored mention id — the inserted rows ARE the checkpoint, so an empty pull bills ~$0. Server-side cap **6 refreshes/day** → `429 { error: "refresh_limit", maxPerDay: 6 }`. Returns the pull result plus `refreshesRemaining`.

### PATCH /x/mentions/:tweetId

Body (any subset): `status` (`unanswered|answered|dismissed`; flipping to `answered` stamps `answeredAt`), `draftId` (uuid of the answering `reply_drafts` row, or null to unlink; `404 draft_not_found` if unknown). Returns the updated row.

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
    "signals":  { "band": "hot", "views": 12000, "replies": 30, "ageMin": 22, "vpm": 545, "bait": false },
    "parent":   { "text": "my post the target tweet replies to (mention-inbox thread context)" }
  }
  ```
  `signals` is optional — the band verdict + classifier inputs the extension stamps at capture time (`src/shared/replyBand.ts`), persisted in `contextSnapshot` so the draft is a labeled row for `GET /x/replies/outcomes`. `band` ∈ {hot, warm, skip, null}. `parent` is optional — rendered as a "MY POST (the tweet below is a reply to it)" block for mention replies.
- `idea` (string, optional, ≤2000 chars) — the human steer, substituted into the prompt's `<idea>` tag. Romanian is fine; the reply comes out in English. Persisted on the row.
- `override` (boolean, optional) — skip the band gate (below). Non-boolean → `400 invalid_override`.
- `systemPromptOverride` (string, optional) — replaces the default REPLY-MASTER system prompt for this call. Persisted on the row.
- `model` (string, optional) — default `grok-4.3`. Aliases `grok-4.3-latest`/`grok-latest` priced.
- `reasoningEffort` (`none|low|medium|high`, optional) — default `low`.

**Band gate (§7.3):** the server recomputes the reply band from the context *before* the Grok call (capture-stamped signal inputs preferred; otherwise derived from metrics + postedAt + the shared text-only bait check) and refuses `null`/`skip` targets with `422 { error: "band_gate", band, signals }` — no Grok spend, no reply slot burned on a dead post. `override: true` is the explicit escape hatch; always use it for mention replies (their metrics are zeros).

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

Errors: `400 invalid_context_*` / `400 invalid_idea` / `400 invalid_override` on validation; `422 band_gate` (dead target, no spend — resend with `override: true`); `502 grok_upstream_error` (with `status,type,code,message,requestId`) on xAI failure; `502 grok_parse_error` if the structured output can't be parsed even after the retry; `429` if xAI rate-limits.

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

| Op                                 | Cost                                       | Source                  |
|------------------------------------|--------------------------------------------|-------------------------|
| `POST /x/posts/scheduled` / threads| $0 (DB only)                               | calendar                |
| Publisher tick → `createPost`      | $0.015 / post ($0.015 per thread segment)  | per published row       |
| `POST /x/posts/reconcile`          | $0.001 × (scanned + snapshotted + mentions)| dailyMetrics pass       |
| Daily metrics snapshot             | **$0.001/tweet, once only** (+ at most one $0.001 day-7 winner re-read, cap 5/day) | dailyMetrics worker |
| Account snapshot (daily getMe)     | $0.001/day                                 | dailyMetrics worker     |
| Mentions pull / refresh            | $0.001/result (~$0.01–0.03/day)            | dailyMetrics + refresh  |
| `POST /x/posts/draft` / `reup`     | ~$0.006–0.01 (3 drafts)                    | Grok Responses          |
| `POST /x/voice/scrape`             | $0 (DOM only, no X API)                    | swipe-file ingest       |
| `PUT  /x/voice/authors/:handle`    | $0 (DOM only, no X API)                    | author enrich           |
| `GET /x/voice/tweets` / `authors` / `targets` | $0 (DB read)                    | swipe-file query        |
| Voice template extract             | ~$0.005/tweet, one-time (Grok, not X API)  | extract routes          |
| `POST /x/harvest/*`                | $0 (DOM only, no X API)                    | harvest ingest          |
| `POST /x/replies/generate`         | ~$0.002–0.004 (2× on auto-retry)           | Grok Responses          |
| `GET /x/replies/outcomes`          | $0 (DB read)                               | outcomes join           |
| `GET /x/brief` / `/x/metrics/*` aggregates | $0 (DB read)                       | pure SQL                |
| `POST /grok/ask`                   | token-based                                | Grok Responses          |
| `GET /cost/today` / `/cost/daily`  | $0                                         | shared cost_events read |
