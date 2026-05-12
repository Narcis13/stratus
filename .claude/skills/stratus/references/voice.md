# Voice library workflows

The voice library stashes other people's tweets for later style/structure analysis. Three data flows feed it: manual tracking via `voicePull`, opt-in metrics polling, and DOM scrapes from the Chrome extension.

## Mental model

```
tracked_authors      ── one row per author we care about
  └─ voice_tweets     ── many tweets per author
       └─ voice_metrics_snapshots  ── time-series per tweet (opt-in)
```

`source` on `tracked_authors`:

- `manual` — added via `POST /x/voice/track`. Both `pullEnabled` and `metricsPollingEnabled` default to true.
- `auto_from_scrape` — auto-created when the extension scrapes a tweet from a previously-unknown author. Both flags default to **false** — promote explicitly if you want active polling.

## Common operations

### Add a new author to track

```bash
curl -sX POST "$STRATUS_BASE_URL/x/voice/track" \
  -H "Authorization: Bearer $STRATUS_API_TOKEN" -H 'Content-Type: application/json' \
  -d '{"username":"naval","maxPolledTweets":20}'
```

- Cost: one `$0.010` X user-lookup. If you're tracking N authors back-to-back, that's `N × $0.010` — flag before running for a long list.
- `maxPolledTweets` (default 20) caps how many of the author's tweets the metrics worker will poll concurrently. Conservative defaults keep the per-author spend bounded.
- Re-tracking an existing author resets both flags to true and updates `source='manual'` (use this to "promote" an `auto_from_scrape` row).

### List tracked authors

```bash
curl -s "$STRATUS_BASE_URL/x/voice/authors" \
  -H "Authorization: Bearer $STRATUS_API_TOKEN" | jq
# Optional: ?source=manual or ?source=auto_from_scrape
```

Each row includes `tweetCount` (left join with `voice_tweets`), so a freshly-tracked author shows `0` until the first pull.

### Promote an auto-scrape author to actively tracked

Cheaper than `POST /voice/track` because it skips the X lookup:

```bash
curl -sX PATCH "$STRATUS_BASE_URL/x/voice/authors/naval" \
  -H "Authorization: Bearer $STRATUS_API_TOKEN" -H 'Content-Type: application/json' \
  -d '{"pullEnabled":true,"metricsPollingEnabled":true,"source":"manual"}'
```

### Pull recent tweets on demand

The `voicePull` worker runs in-process on a cadence. To force a pull right now:

```bash
curl -sX POST "$STRATUS_BASE_URL/x/voice/pull/naval" \
  -H "Authorization: Bearer $STRATUS_API_TOKEN" -H 'Content-Type: application/json' \
  -d '{"maxResults":20}'
```

- **Always clamp `maxResults`** on busy accounts. Other-user reads are `$0.005/result`, so an unclamped pull on a power user can be expensive. Default page size on the X side is 100.
- `fullScan: true` ignores the `since_id` checkpoint and rescans from the top — only use for a fresh author or to backfill after a long pause.
- Returns `{ scanned, inserted }`.

### Query the stash

```bash
# Most recent originals from naval, ≥500 likes
curl -s "$STRATUS_BASE_URL/x/voice/tweets?author=naval&minLikes=500&limit=20" \
  -H "Authorization: Bearer $STRATUS_API_TOKEN" | jq

# Substring search across all tracked authors
curl -s "$STRATUS_BASE_URL/x/voice/tweets?q=leverage&limit=50" \
  -H "Authorization: Bearer $STRATUS_API_TOKEN" | jq

# Include replies (default excludes)
curl -s "$STRATUS_BASE_URL/x/voice/tweets?author=naval&includeReplies=true" \
  -H "Authorization: Bearer $STRATUS_API_TOKEN" | jq
```

`author` accepts either a numeric X user id or a `@username`. The `minLikes` filter uses the latest snapshot's `public_metrics.like_count`; tweets without a snapshot count as 0.

### Snapshot history for a single voice tweet

```bash
curl -s "$STRATUS_BASE_URL/x/voice/metrics/$TWEET_ID" \
  -H "Authorization: Bearer $STRATUS_API_TOKEN" | jq
```

Returns `snapshotAt` + `publicMetrics` (other-user reads can't see private metrics).

### Stop tracking (without losing data)

```bash
curl -sX DELETE "$STRATUS_BASE_URL/x/voice/track/naval" \
  -H "Authorization: Bearer $STRATUS_API_TOKEN"
```

Soft disable: both flags go false, all the author's active voice tweets are retired so `voiceMetricsPoll` stops spending on them. Historical rows stay. Re-enable via `POST /x/voice/track` (which resets the flags).

## Cost guardrails

| Op                                  | Per-call cost                  |
|-------------------------------------|--------------------------------|
| `POST /voice/track`                 | $0.010 (one user lookup)       |
| `POST /voice/pull` (each result)    | $0.005                         |
| Worker `voiceMetricsPoll` per snap  | $0.005 (off by default)        |
| `POST /voice/scrape` (per NEW user) | $0.010                         |
| `POST /voice/scrape` (text content) | $0 (DOM is authoritative)      |

`voiceMetricsPoll` is gated by `VOICE_METRICS_POLL_ENABLED=true` in the server env. There is no API to toggle this.

## Per-author guardrail (`maxPolledTweets`)

When `voiceMetricsPoll` is on, it only polls the latest `maxPolledTweets` tweets per author (default 20). Increase it explicitly if you want deeper history — it directly multiplies cost: 20 × ~18 polls × $0.005 ≈ $1.80/author/7 days.

## Extension scrape (informational)

The Chrome extension content script POSTs to `/x/voice/scrape` automatically when the user invokes scrape on a tweet. Manual use from the CLI is possible but the payload is fiddly — see [endpoints.md](endpoints.md#post-xvoicescrape) for the shape.
