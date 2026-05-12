---
name: stratus
description: Drive the local stratus HTTP API for X (Twitter) operations — schedule posts a week ahead (3–4/day), browse/edit the calendar, read tweet metrics, manage the voice library of tracked authors, generate Grok-drafted reply drafts, and read the cost dashboard. Use when the user wants to plan/queue tweets, audit scheduled posts, inspect tweet performance, track or query other authors' tweets, draft replies via Grok, or check API spend. Talks to a Hono service on http://127.0.0.1:3000 by default, authenticated with a bearer token.
---

# Stratus operator skill

Stratus is a single-user service that fronts X API v2 with a typed wrapper plus background workers. This skill is the operator's manual for hitting its HTTP surface.

## Connection facts

- **Base URL**: `${STRATUS_BASE_URL:-http://127.0.0.1:3000}` — set `STRATUS_BASE_URL` if deployed elsewhere.
- **Auth header**: `Authorization: Bearer $STRATUS_API_TOKEN` on every endpoint except `/healthz`. The token is in the project's `.env` as `API_TOKEN`. Prefer `printenv STRATUS_API_TOKEN` (or read `.env`) — never echo it back to the user.
- **Content-Type**: `application/json` on every POST/PATCH.
- **Local server start**: `bun run start` (foreground; 60s publisher tick + other workers run in-process).

## Before any call — preflight

1. Check the server is up: `curl -fsS "$STRATUS_BASE_URL/healthz"` (no auth). If it returns `503` or refuses, stop and tell the user to run `bun run start` — do not attempt other endpoints.
2. Confirm the bearer is present (`echo "${STRATUS_API_TOKEN:?missing}"` in a subshell, do not print the value). If not exported, source it from `.env`: `export STRATUS_API_TOKEN=$(grep ^API_TOKEN= .env | cut -d= -f2-)`.
3. If a write op fails with `401 {"error":"unauthorized"}`, the bearer is wrong; do not retry.

## Endpoint map (full surface)

| Verb   | Path                              | Purpose                                       |
|--------|-----------------------------------|-----------------------------------------------|
| GET    | `/healthz`                        | DB round-trip check, no auth                  |
| GET    | `/cost/today`                     | Per-platform / per-endpoint UTC-day spend     |
| POST   | `/x/posts/scheduled`              | Create a draft or scheduled post              |
| GET    | `/x/posts/scheduled`              | List scheduled posts (`?from=&to=&status=`)   |
| PATCH  | `/x/posts/scheduled/:id`          | Edit text / time / mediaIds / status          |
| DELETE | `/x/posts/scheduled/:id`          | Hard-delete a non-posted row                  |
| POST   | `/x/posts/reconcile`              | Force own-reconcile worker run                |
| GET    | `/x/metrics/:tweetId`             | Snapshot history for one of MY posts          |
| POST   | `/x/voice/track`                  | Enroll an author (`$0.010` X lookup)          |
| GET    | `/x/voice/authors`                | List tracked authors + counts                 |
| PATCH  | `/x/voice/authors/:username`      | Flip pullEnabled/metricsPollingEnabled/etc.   |
| DELETE | `/x/voice/track/:username`        | Soft-disable an author                        |
| POST   | `/x/voice/pull/:username`         | On-demand pull of recent tweets               |
| POST   | `/x/voice/scrape`                 | Ingest DOM-scraped tweets (extension)         |
| GET    | `/x/voice/tweets`                 | Query stash (`?author=&q=&minLikes=&limit=`)  |
| GET    | `/x/voice/metrics/:tweetId`       | Snapshot history for a voice tweet            |
| POST   | `/x/replies/generate`             | Draft a reply with Grok                       |
| GET    | `/x/replies`                      | List drafts (`?status=&sourceAuthor=&limit=`) |
| GET    | `/x/replies/:id`                  | Get one draft                                 |
| PATCH  | `/x/replies/:id`                  | Edit / status-transition a draft              |
| DELETE | `/x/replies/:id`                  | Delete a draft                                |
| POST   | `/grok/ask`                       | Raw Grok ask (no DB persistence)              |

Full request/response shapes live in [references/endpoints.md](references/endpoints.md) — read it before crafting any non-trivial body.

## Non-negotiable safety rules

These were learned the expensive way. Violating them costs real money or fails silently at publish time.

### 1. URL surcharge — silently kills scheduled posts

`createPost` in `src/x/endpoints.ts` rejects any text matching `/(^|\s)https?:\/\//i` unless `allowUrlSurcharge: true`. **The publisher worker does NOT pass that flag.** So if you schedule a tweet whose `text` contains a URL, it WILL flip to `status='failed'` with `error_class='unknown'` at the 60s tick — silently, from the user's POV.

- **Before scheduling, refuse any text containing `http://` or `https://`.** Tell the user to either strip the link or post that one manually from the X app (where the $0.20 surcharge is on them, not us).
- If they insist on a link in a scheduled post, there is no API escape hatch today — surface this and let them decide.

### 2. Reply-to-other-users is policy-blocked

Self-replies work; replying to a non-self tweet via `in_reply_to_tweet_id` is blocked on self-serve tiers (Feb 2026). `/x/replies/generate` is for **drafting** copy only — it never publishes. The user posts the draft manually from the X app, then PATCHes the draft to `status='posted'` (optionally with `postedTweetId`).

### 3. `scheduledFor` is UTC ISO 8601

Pass `"2026-05-15T13:30:00Z"`. The publisher's predicate is `scheduledFor <= now()` so timezones get normalized server-side; just send Zulu. When the user says "Tuesday at 9 AM" without a zone, ask what timezone they mean and convert. Today's date is in your auto-memory; honor it.

### 4. Voice-track / pull / scrape cost reminders

- `POST /x/voice/track` does ONE `getUserByUsername` lookup → `$0.010`. Cheap, but flag it before doing it for a list of 20 authors.
- `POST /x/voice/pull/:username` reads other-user tweets at `$0.005/result`. Always clamp via `maxResults` in the body when calling it on a busy author; default behavior fetches up to 100/page.
- `voiceMetricsPoll` is opt-in via env (`VOICE_METRICS_POLL_ENABLED=true`). Don't try to "enable polling" through the API — there's no endpoint for it.

### 5. `posted` rows are write-locked

PATCH and DELETE both return `409` on `status='posted'` rows in `/x/posts/scheduled`. There is no "unpublish" — the right move is to ask the user to delete the tweet on X, then they can recreate the row if they want to re-queue.

## Workflows

### A) Schedule a week of posts (3–4/day, the headline use case)

The expected shape is 21–28 posts spread across 7 days with a recognizable rhythm. Drive this through [scripts/schedule_week.sh](scripts/schedule_week.sh) — it takes a JSON file of `{ text, scheduledFor }` objects, validates each, and POSTs sequentially so a 401 stops the run early.

**Procedure:**

1. **Collect drafts from the user.** Ask for the texts up front, but don't ask for exact timestamps unless they care — propose a default cadence (see below) and let them confirm or override.
2. **Pick a cadence.** Sane defaults for "3–4 tweets/day":
   - 3/day: 09:00, 13:00, 18:00 local
   - 4/day: 08:30, 12:30, 16:30, 20:00 local
   - Pick the user's local timezone, convert each slot to UTC, render as `YYYY-MM-DDTHH:MM:SSZ`.
3. **URL audit.** For every draft, `grep -Eq '(^|\s)https?://'` — refuse the batch if any match and explain Rule 1.
4. **Length audit.** X's hard cap is 280 chars; warn at >270 (the publisher won't pre-validate length).
5. **Dry-run preview.** Print a table of `[time | first 60 chars of text]` and get user confirmation before submitting.
6. **Submit.** Use the script, or POST one-by-one with `status: "pending"`. The server defaults `status` to `pending` when `scheduledFor` is set, so omitting it is fine.
7. **Verify queue.** `GET /x/posts/scheduled?status=pending&from=$START&to=$END` and confirm the count matches what you submitted. Show the user.

Single-post curl:

```bash
curl -sX POST "$STRATUS_BASE_URL/x/posts/scheduled" \
  -H "Authorization: Bearer $STRATUS_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"text":"shipping notes from the weekend","scheduledFor":"2026-05-15T13:30:00Z"}'
```

Full week-ahead recipe + bulk script usage: [references/scheduling.md](references/scheduling.md).

### B) Audit / edit the calendar

```bash
# Everything queued in the next 7 days
START=$(date -u +%Y-%m-%dT00:00:00Z)
END=$(date -u -v+7d +%Y-%m-%dT00:00:00Z 2>/dev/null || date -u -d '+7 days' +%Y-%m-%dT00:00:00Z)
curl -s "$STRATUS_BASE_URL/x/posts/scheduled?from=$START&to=$END&status=pending" \
  -H "Authorization: Bearer $STRATUS_API_TOKEN" | jq

# Edit time on one row
curl -sX PATCH "$STRATUS_BASE_URL/x/posts/scheduled/$ID" \
  -H "Authorization: Bearer $STRATUS_API_TOKEN" -H 'Content-Type: application/json' \
  -d '{"scheduledFor":"2026-05-16T13:30:00Z"}'

# Retry a failed row: PATCH text/time then flip status back to pending
curl -sX PATCH "$STRATUS_BASE_URL/x/posts/scheduled/$ID" \
  -H "Authorization: Bearer $STRATUS_API_TOKEN" -H 'Content-Type: application/json' \
  -d '{"status":"pending","scheduledFor":"2026-05-15T14:00:00Z"}'

# Cancel (soft)
curl -sX PATCH "$STRATUS_BASE_URL/x/posts/scheduled/$ID" \
  -H "Authorization: Bearer $STRATUS_API_TOKEN" -H 'Content-Type: application/json' \
  -d '{"status":"cancelled"}'

# Delete (hard, only if not posted)
curl -sX DELETE "$STRATUS_BASE_URL/x/posts/scheduled/$ID" \
  -H "Authorization: Bearer $STRATUS_API_TOKEN"
```

### C) Tweet metrics

Metrics rows only exist for tweets in `posts_published`. If the user asks about a tweet that was posted manually from the X app, run `POST /x/posts/reconcile` first (own-reconcile worker) — it's `$0.001/tweet`, daily cap of 500 in one pass. Then read snapshots:

```bash
curl -s "$STRATUS_BASE_URL/x/metrics/$TWEET_ID" \
  -H "Authorization: Bearer $STRATUS_API_TOKEN" | jq
```

Snapshot cadence is ~113 polls over 30 days (≈$0.113/tweet), then `retired=true` and polling stops. `non_public_metrics`/`organic_metrics` are only populated within 30 days of `postedAt`.

### D) Voice library

Detailed flows in [references/voice.md](references/voice.md). Most common operations:

```bash
# Track an author
curl -sX POST "$STRATUS_BASE_URL/x/voice/track" \
  -H "Authorization: Bearer $STRATUS_API_TOKEN" -H 'Content-Type: application/json' \
  -d '{"username":"naval","maxPolledTweets":20}'

# Pull recent tweets on-demand (clamp maxResults!)
curl -sX POST "$STRATUS_BASE_URL/x/voice/pull/naval" \
  -H "Authorization: Bearer $STRATUS_API_TOKEN" -H 'Content-Type: application/json' \
  -d '{"maxResults":20}'

# Query the stash
curl -s "$STRATUS_BASE_URL/x/voice/tweets?author=naval&minLikes=500&limit=20" \
  -H "Authorization: Bearer $STRATUS_API_TOKEN" | jq

# Stop tracking (soft — keeps historical rows)
curl -sX DELETE "$STRATUS_BASE_URL/x/voice/track/naval" \
  -H "Authorization: Bearer $STRATUS_API_TOKEN"
```

### E) Reply drafts (Grok-backed)

Detailed flows in [references/replies.md](references/replies.md), including the full `context` payload shape. Quickstart:

```bash
curl -sX POST "$STRATUS_BASE_URL/x/replies/generate" \
  -H "Authorization: Bearer $STRATUS_API_TOKEN" -H 'Content-Type: application/json' \
  -d @context.json
```

The endpoint only **drafts** — copy/paste to X, then PATCH the draft to `posted` to record it in history.

### F) Cost dashboard

```bash
curl -s "$STRATUS_BASE_URL/cost/today" \
  -H "Authorization: Bearer $STRATUS_API_TOKEN" | jq
```

UTC day. Returns `{ from, to, totalUsd, totalCalls, byPlatform: [{platform, costUsd, calls, byEndpoint}] }`. Useful for sanity-checking before a voice-pull run.

## Output etiquette

- When the user asks "what's on the calendar," summarize as a table grouped by day, not raw JSON.
- When showing failures, surface `errorClass` and the first line of `errorDetail` rather than dumping the whole row.
- After a bulk schedule, print one-line totals (`Submitted 21, OK 21, failed 0`) and offer to GET-list back for verification.
- Never print the bearer token; if showing a curl snippet, use the placeholder `$STRATUS_API_TOKEN`.
