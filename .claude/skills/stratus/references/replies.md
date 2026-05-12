# Reply drafts (Grok-backed)

`/x/replies/*` is a manual-assist surface: it drafts a reply with Grok, persists the draft, and tracks the user's status as they copy/paste it into X. **It never publishes** — see Rule 2 in SKILL.md (replying to non-self tweets is policy-blocked on self-serve).

The endpoint mounts only when `XAI_API_KEY` is set in the server env. If you call it and get `502 grok_upstream_error` with a connection failure, that's the reason.

## End-to-end flow

1. **Generate**: `POST /x/replies/generate` with the tweet's `context`. Returns a `reply_drafts` row with `replyText`, model, token usage, cost, and `status='generated'`.
2. **(Optional) Edit**: `PATCH /x/replies/:id` with `replyTextEdited`. The original `replyText` is preserved for comparison.
3. **(Optional) Mark copied**: `PATCH … { "status": "copied" }`. Useful if you want a "in-flight" state.
4. **Post on X manually** (the user types/pastes it on x.com).
5. **Record the post**: `PATCH … { "status": "posted", "postedTweetId": "1791…" }`. `postedTweetId` is the X snowflake of the published reply.
6. **(Optional) Discard**: `PATCH … { "status": "discarded" }`. Terminal.

Allowed status transitions:

```
generated → copied | posted | discarded
copied    → posted | discarded
posted    → discarded            (only re-open is to drop it from history)
discarded → ∅                    (terminal)
```

A bad transition returns `409 invalid_status_transition`.

## Crafting the `context` payload

Every field below is required (validation rejects missing/null fields with `400 invalid_context_*`):

```json
{
  "context": {
    "tweetId":  "1791000000000000001",
    "handle":   "naval",
    "author":   "Naval",
    "text":     "Inflation is a hidden tax on cash holders.",
    "url":      "https://x.com/naval/status/1791000000000000001",
    "postedAt": "2026-05-12T10:00:00Z",
    "metrics":  { "views": 12000, "replies": 30, "reposts": 5, "likes": 240 },
    "topComments": [
      { "author": "Alice",  "handle": "alice",  "text": "True for fiat. Bitcoin?" },
      { "author": "Bob",    "handle": "bobsled", "text": "Counterpoint: bonds." }
    ]
  }
}
```

Notes:

- `handle` is the @username (no `@`).
- `metrics.{views,replies,reposts,likes}` must all be present non-negative integers.
- `topComments` may be `[]`. Up to the first 10 are passed to Grok (the renderer slices it).
- `tweetId` is digits only (snowflake).

## Optional knobs

- `systemPromptOverride` — full string to replace the default system prompt for this single call. Persisted on the row, so you can audit which prompt produced which draft. The default is the REPLY-MASTER prompt in `src/x/replies/prompt.ts` (Grok-coded indie-builder voice).
- `model` — defaults to `grok-4.3`. Override only if the user asks.
- `reasoningEffort` — `none|low|medium|high`. Default `low`. Higher = more deliberate but slower and pricier (still cheap relative to anything else here).

## Quickstart

```bash
cat > /tmp/ctx.json <<'EOF'
{
  "context": {
    "tweetId":  "1791000000000000001",
    "handle":   "naval",
    "author":   "Naval",
    "text":     "Inflation is a hidden tax on cash holders.",
    "url":      "https://x.com/naval/status/1791000000000000001",
    "postedAt": "2026-05-12T10:00:00Z",
    "metrics":  { "views": 12000, "replies": 30, "reposts": 5, "likes": 240 },
    "topComments": []
  }
}
EOF

curl -sX POST "$STRATUS_BASE_URL/x/replies/generate" \
  -H "Authorization: Bearer $STRATUS_API_TOKEN" -H 'Content-Type: application/json' \
  -d @/tmp/ctx.json | jq
```

Pull from the source tweet's voice-library row to populate `context` if you've already scraped it:

```bash
TWEET_ID=1791000000000000001
ROW=$(curl -s "$STRATUS_BASE_URL/x/voice/tweets?author=naval&q=inflation&limit=5" \
  -H "Authorization: Bearer $STRATUS_API_TOKEN" | jq ".[] | select(.tweetId==\"$TWEET_ID\")")
# …compose context.json from $ROW + a /voice/metrics/$TWEET_ID call for the latest metrics.
```

## List / filter drafts

```bash
# Recent generated-but-not-posted, default newest first
curl -s "$STRATUS_BASE_URL/x/replies?status=generated&limit=20" \
  -H "Authorization: Bearer $STRATUS_API_TOKEN" | jq

# All drafts where the source tweet was naval's, last 24h
SINCE=$(date -u -v-1d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '-1 day' +%Y-%m-%dT%H:%M:%SZ)
curl -s "$STRATUS_BASE_URL/x/replies?sourceAuthor=naval&since=$SINCE&limit=50" \
  -H "Authorization: Bearer $STRATUS_API_TOKEN" | jq
```

## Editing & status flow

```bash
# Edit the drafted text
curl -sX PATCH "$STRATUS_BASE_URL/x/replies/$ID" \
  -H "Authorization: Bearer $STRATUS_API_TOKEN" -H 'Content-Type: application/json' \
  -d '{"replyTextEdited":"Counterpoint: bonds compound the same trap…"}'

# Mark as posted with the live tweet id
curl -sX PATCH "$STRATUS_BASE_URL/x/replies/$ID" \
  -H "Authorization: Bearer $STRATUS_API_TOKEN" -H 'Content-Type: application/json' \
  -d '{"status":"posted","postedTweetId":"1791000000000099999"}'
```

## Cost

Grok charges by tokens; each `/replies/generate` call writes a `cost_events` row tagged `platform='grok'`. The denormalized `costUsd` on the draft row is for UI display — don't sum it across the table for a billing total; use `GET /cost/today` (which reads `cost_events`) instead.

## When to use `/grok/ask` instead

`/grok/ask` is the raw Grok passthrough. Use it when:

- You don't want a `reply_drafts` row (e.g. brainstorming a thread).
- You want full multi-turn `messages[]` control.
- The output isn't a reply (rewriting copy, summarizing, etc.).

Otherwise prefer `/x/replies/generate` so the draft is tracked and easy to reopen.
