# Voice library workflows

The voice library is a **swipe file** of other people's tweets, kept for style/structure/format reference. As of the 2026-06-01 pivot it is a **pure DOM-scrape store** — the Chrome extension reads tweets and author cards straight off x.com and POSTs them here. **No X API is ever touched: every `/x/voice/*` route is `$0`.** There is no `track`, no `pull`, no metrics polling.

> Migration note: the old `POST /x/voice/track`, `POST /x/voice/pull/:username`, `DELETE /x/voice/track/:username`, and `GET /x/voice/metrics/:tweetId` routes are **gone**, along with the `tracked_authors` and `voice_metrics_snapshots` tables and the `voicePull`/`voiceMetricsPoll` workers. If a user asks for any of those, explain the swipe-file model below.

## Mental model

```
voice_authors        ── one row per author, keyed by lowercased @handle
  └─ voice_tweets     ── many saved tweets per author
```

- Authors are identified by their **lowercased `@handle`** — the only stable id scrapeable without the API. The numeric `xUserId` is filled opportunistically when the page exposes it (nullable).
- `voice_tweets.scrapedHtml` is the innerHTML of X's `[data-testid="tweetText"]` node — emoji `<img>`, line breaks, and links exactly as rendered. That's what lets a saved tweet be reused as a faithful **format template**.
- `retired` is a soft-archive boolean on **both** authors and tweets. Archived rows are hidden by default and resurface with `?retired=true`.
- `source` is `extension_scrape` (seen via a tweet/hover card) or `profile_scrape` (full profile header captured via "Save author"). `enrichedAt` is non-null once the full profile header has been scraped.

## How rows get created (the extension, not the API)

You generally **don't** create voice rows from the CLI — the extension does it:

- **"Save to stratus"** on a tweet → `POST /x/voice/scrape` with `{ tweet, author? }`. Stubs the author from the tweet's handle/display name, then `fill`-upserts any hover-card fields. Saves/refreshes the tweet.
- **"Save author"** on a profile page → `PUT /x/voice/authors/:handle` with the full profile header (bio, follower/following counts, pinned tweet). Authoritative: provided fields overwrite weaker hover-card guesses; stamps `enrichedAt`.

Both are DOM reads. Manual CLI use is possible (shapes below) but fiddly — prefer the extension.

### POST /x/voice/scrape (payload shape)

```json
{
  "tweet": {
    "tweetId": "1791000000000000000",
    "handle": "naval",
    "displayName": "Naval",
    "text": "Seek wealth, not money or status.",
    "html": "Seek wealth, not money or status.",
    "createdAt": "2026-05-12T10:00:00Z",
    "url": "https://x.com/naval/status/1791000000000000000"
  },
  "author": {
    "handle": "naval",
    "displayName": "Naval",
    "bio": "…",
    "followersCount": 2100000,
    "followingCount": 60,
    "xUserId": "745273"
  }
}
```

- `tweet` is required; only `tweetId` (digits) and `handle` (`^[A-Za-z0-9_]{1,15}$`, `@`/case stripped) are mandatory. `text` may be empty (image-only tweets). `html`, `createdAt`, `url`, `displayName` are optional.
- `author` is optional. A malformed `author` block is non-fatal — the tweet's own handle/display name still anchors the author row.
- Re-scraping a known tweet refreshes `text`/`scrapedHtml`/`url` and stamps `updatedAt`; `createdAt`/`savedAt` stay put. Re-scraping a known author only **fills null** columns — it never clobbers richer data from a profile scrape.
- Returns `201 { tweet, author }`.

### PUT /x/voice/authors/:handle (enrich)

All fields optional, but a body with **nothing usable** is rejected `400 invalid_profile`:

```json
{
  "displayName": "Naval",
  "bio": "…",
  "followersCount": 2100000,
  "followingCount": 60,
  "pinnedTweetId": "1444…",
  "pinnedTweetText": "…",
  "xUserId": "745273",
  "profileUrl": "https://x.com/naval"
}
```

Upserts the author with `source='profile_scrape'`, stamps `enrichedAt`+`updatedAt`. On an existing row, only the columns the scrape actually caught are overwritten (a missed bio won't wipe a good one). Returns the row.

## Reading & curating from the CLI (the common case)

### Query the stash

```bash
# Most recent saved tweets from one author (author = @handle, lowercased)
curl -s "$STRATUS_BASE_URL/x/voice/tweets?author=naval&limit=20" \
  -H "Authorization: Bearer $STRATUS_API_TOKEN" | jq

# Substring search across all authors (case-insensitive, ILIKE)
curl -s "$STRATUS_BASE_URL/x/voice/tweets?q=leverage&limit=50" \
  -H "Authorization: Bearer $STRATUS_API_TOKEN" | jq

# Include archived tweets (default hides them)
curl -s "$STRATUS_BASE_URL/x/voice/tweets?author=naval&retired=true" \
  -H "Authorization: Bearer $STRATUS_API_TOKEN" | jq
```

Params (all optional): `author` (a `@handle` — **not** a numeric id anymore), `q` (substring on `text`), `retired=true`, `limit` (default 50, max 200). Rows include `authorDisplayName` (joined) and `scrapedHtml`, ordered by `createdAt desc`. There is **no** `minLikes`/`includeReplies`/metrics filter — those died with the API-read model.

### List authors

```bash
curl -s "$STRATUS_BASE_URL/x/voice/authors" \
  -H "Authorization: Bearer $STRATUS_API_TOKEN" | jq
# include archived authors:
curl -s "$STRATUS_BASE_URL/x/voice/authors?retired=true" \
  -H "Authorization: Bearer $STRATUS_API_TOKEN" | jq
```

Each row carries the profile fields plus `tweetCount` (left-joined). Ordered by handle.

### Archive / unarchive (soft)

```bash
# Tweet
curl -sX PATCH "$STRATUS_BASE_URL/x/voice/tweets/$TWEET_ID" \
  -H "Authorization: Bearer $STRATUS_API_TOKEN" -H 'Content-Type: application/json' \
  -d '{"retired":true}'

# Author
curl -sX PATCH "$STRATUS_BASE_URL/x/voice/authors/naval" \
  -H "Authorization: Bearer $STRATUS_API_TOKEN" -H 'Content-Type: application/json' \
  -d '{"retired":true}'
```

Body must be exactly `{"retired": <bool>}` — anything else is `400 invalid_retired`. `404 not_found` if the handle/id is unknown.

### Hard delete

```bash
# A tweet
curl -sX DELETE "$STRATUS_BASE_URL/x/voice/tweets/$TWEET_ID" \
  -H "Authorization: Bearer $STRATUS_API_TOKEN"

# An author — 409 if it still has tweets
curl -sX DELETE "$STRATUS_BASE_URL/x/voice/authors/naval" \
  -H "Authorization: Bearer $STRATUS_API_TOKEN"
```

Deleting an author returns `409 { error: "author_has_tweets", tweets: <n> }` while any tweet still references it. Retire or delete its tweets first, then delete the author.

## Cost

Every route here is **`$0`** — Postgres only, no X API. The whole point of the pivot: other-user reads cost 5× owned reads ($0.005 vs $0.001), so the swipe file captures by DOM scrape in the extension instead. **Do not reintroduce an X-API read (`searchRecent`, `getTweet`, `getUserByUsername`) to "fetch" or "pull" voice content without an explicit budget conversation.**
