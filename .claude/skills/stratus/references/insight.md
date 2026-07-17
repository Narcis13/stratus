# Insight & infra reference — brief, playbook, digest, images, assets, data core, MCP

All `/x/*` routes bearer-guarded. Everything here is $0 unless marked. Use with
[coach.md](coach.md) for how to *read* these numbers; this file is the shapes.

## GET /x/brief

The growth-coach payload behind the Today tab. Pure SQL — $0. Day boundaries
(posts/replies/schedule/quota/quests) use the viewer's local day via
`tzOffsetMin`; **spend stays on the UTC billing day** (matches `/cost/today`).
Every read idempotently upserts today's `streaks` row (the streak diary).

Params: `tzOffsetMin` (optional int, JS `getTimezoneOffset()` semantics — UTC −
local, `-180` for UTC+3; `|v|≤960`; invalid → `400 invalid_tz_offset_min`).

Response — complete top-level shape:

```jsonc
{
  "generatedAt": "...", "tzOffsetMin": -180,
  "account": {
    "followers": 1234, "measuredAt": "...", "delta7d": 12,          // nulls when <2 snapshots
    "sparkline": [ { "snapshotAt": "...", "followers": 1234 } ],    // 14 days
    "conversion": { /* profile-visit→follow conversion, 7d & 28d; rate null <20 clicks */ }
  },
  "pinnedWatch": {                                                  // S0.9
    "pinnedTweetId": "...", "since": "...", "ageDays": 21,
    "stale": false,                                                 // pin unchanged >21d
    "pinnedViews": 500,
    "outperformer": { "tweetId","text","postedAt","views","ratio" } // last-30d original ≥3× the pin, or null
  },
  "yesterday": { "from","to", "posts": [BriefTweet], "replies": [BriefTweet],
                 "profileClickLeaders": [BriefTweet] },             // top 3 by profileVisits, trailing week
  "today": {
    "from","to",
    "scheduled": [ { "id","text","scheduledFor","status","mediaNote" } ],
    "anchors": [9,13,18],                                           // cadence ladder by filled-slot count
    "gaps": [ { "hour","n","avgViewsPerDay","score","sufficient" } ] // empty anchors, highest-value first (n≥3 gate)
  },
  "replyQuota": { "postedToday": 4, "target": { "min": 10, "max": 20 } },
  "quests": { "day": "2026-07-17", "items": [QuestItem], "streak": { /* count */ } },
  "week": { "from","to","posts","replies","replyPct","targetReplyPct" },
  "spend": { "from","to","xUsd","grokUsd","totalUsd", "byPlatform": [...] }   // UTC day
}
```

`BriefTweet` = `{tweetId, text, postedAt, isReply, measuredAt, metrics: {views,
likes, replies, retweets, quotes, bookmarks, profileVisits} | null}` — `metrics`
null until the 03:00 UTC pass snapshots the tweet (say "not measured yet", never
"0 views"). Quests are gentle by contract: a quest with no opportunity counts as
done with a `note` explaining why — the streak never punishes a quiet day.

## GET /x/playbook

The measured-feedback page (C4 + S0.x) — every number the machine has learned
about what works. Pure SQL, $0. **Every cell gates at n≥20 per side**
(`sufficient: false` below it — report "not enough data (n=…)", never the
number).

Params: `minN` (optional int 1–1000, default 20; invalid → `400 invalid_min_n`)
— exploration knob; it flows into every section EXCEPT `guidance.*`, which
always uses the default gate.

Response top-level keys:

```jsonc
{
  "minN": 20,
  "angleEffectiveness": { "overall": {...} /* + author-size buckets <1k/1k-10k/10k-100k/100k+/unknown */ },
  "pillarRegister":      {...},   // pillar × register scorecard (register stamped by the drafter)
  "structures":          {...},   // hookType/device effectiveness from extracted post_templates
  "batchVsSingle":       {...},   // single vs radar cohorts + unattributed
  "bandCalibration":     {...},   // per-band n / medians / hit-rate, bait split (BAND stays manual, ≥100)
  "relationshipLift":    {...},   // C3 block vs cold drafts; lift only when BOTH sides gate
  "mediaEffectiveness":  {...},   // media / text-only / unknown over own originals (S0.2)
  "ideaEffectiveness":   {...},   // idea-seeded vs unseeded, pooled + posts/replies split (S0.8)
  "latencyEffectiveness":{...},   // <15m / 15-60m / 1-6h / >6h / unknown + early-vs-late lift (S0.5)
  "rosterCoverage":      {...},   // trailing 7d in/above/below/unknown band + majorityInBand verdict (S0.7)
  "guidance": { "reply": "measured: …" | null, "post": "measured: …" | null }
}
```

`guidance.reply`/`guidance.post` are the exact one-liners the server injects into
reply/post drafting when gated — quote them verbatim when coaching ("the machine
currently recommends: …"). `rosterCoverage.majorityInBand` is computed over
known-size replies only, so a roster of unknowns doesn't sink the verdict.

### POST /x/playbook/extract-winners

Grok structure-extraction of my top measured non-reply posts into
`post_templates` (~$0.005/tweet, **≤20/call ≈ $0.10 max**). Rerunnable —
already-extracted rows are skipped, so a rerun only picks up new winners.
Body: `{limit?}` (int ≥1, clamped ≤20; invalid → `400 invalid_limit`).
`503 grok_not_configured` without the key.
Returns `{requested, extracted, failures: [{tweetId, error}], costUsd, remaining}`.

## GET /x/digest

The Sunday digest (C9): the week's facts (pure SQL, $0) + ONE Grok-narrated
coach note (~$0.01), **cached per Monday-week** in `digests`.

Params:
- `tzOffsetMin` (as brief) — local week boundaries.
- `week` (`YYYY-MM-DD`, any day inside the target Monday-week; invalid → `400
  invalid_week`; omit = current week).
- `refresh=true` — bypass the cache and re-spend (only when the user asks for a
  rewrite).
- `factsOnly=true` — skip narration entirely, $0 (what the MCP tool forces).

Response variants: cached hit `{…, narrative, cached: true}`; factsOnly
`{…, narrative: null, cached: false}`; missing key degrades to
`{…, narrative: null, narrativeError: "grok_not_configured"}` — facts always
come back, never a 5xx. A Grok failure caches nothing (next open retries free).

`facts` carries: follower points/delta, the week's tweets + top measured,
stage transitions (≥engaged), top fans this/prev week with new-this-week flags,
neglected targets (>7d) and allies (>14d), spend by platform, streak days,
playbook guidance lines, roster coverage, image spend, media-vs-text. The
narrative may only narrate these facts — if it names a number the facts don't
hold, that's a bug, not insight.

## GET /x/metrics/best-times (delta vs the core docs)

New param `tzOffsetMin` (as brief; invalid → `400 invalid_tz_offset_min`) —
buckets cells by the viewer's local wall clock (omit = raw UTC). Response now
echoes `tzOffsetMin` and `minN` (3), and `top` (5 cells) is **gated at n≥3
posts/cell** — a cell with the highest raw views but <3 posts is excluded from
`top` yet still present in the full `cells` grid. Cell shape: `{weekday (0=Sun),
hour, posts, avgViews, avgViewsPerDay, avgLikes, avgProfileVisits}` —
`avgViewsPerDay` (age-normalized) is the number to rank by.

## POST /x/images/generate (~$0.02/image, HARD budget)

xAI Grok Imagine backgrounds for the Studio (composited UNDER canvas-rendered
brand text — image models garble words). Body: `{prompt (required, ≤4000),
n? (1–2, default 1)}`. Guard order: `503 grok_not_configured` →
`400 invalid_body|invalid_prompt|prompt_too_long|invalid_n` →
`429 {error:'image_budget_exceeded', spentUsd, budgetUsd}` — **checked BEFORE
the paid call** when today's UTC `'xai'` spend ≥ `XAI_IMAGE_DAILY_BUDGET_USD`
(default $0.50; a hard stop, unlike the soft X watchdog) → `502 no_images` /
`grok_upstream_error` / `image_generation_failed`.

Success: `{images: [{dataUrl: "data:image/png;base64,…", mediaType,
revisedPrompt}], model: "grok-imagine-image", count, costUsd, requestId}` —
always base64 data URLs, never a raw xAI URL. Image spend logs under platform
`'xai'` (isolated from `'grok'` text spend).

## Asset library — /x/assets (all $0)

Studio PNGs stored as SQLite blobs. Metadata projection = `{id, kind, prompt,
mediaType, width, height, byteLength, usedOnTweetId, createdAt}` — the blob
never appears in list/metadata responses.

- `POST /x/assets` — `{pngBase64 (required), kind?, prompt?, mediaType?,
  width?, height?, usedOnTweetId?}`. `kind` ∈
  `quote|stat|banner|pfp|background|other` (else coerced to `other`). Errors:
  `400 invalid_body|invalid_png`, `413 asset_too_large` (>2MB). `201` = the
  metadata row.
- `GET /x/assets` — `{assets: [meta rows]}`, newest first, cap 200.
- `GET /x/assets/:id/png` — raw bytes with the right Content-Type
  (immutable-cached). `404 not_found`.
- `DELETE /x/assets/:id` — `{ok:true}` / `404`.

## Data explorer & read-only SQL (S1)

Read-only **by construction**: a second `{readonly: true}` SQLite connection;
whitelist from the Drizzle schema (migration scaffolding invisible); **`tokens`
is excluded entirely AND rejected by name**. Never try to write — it can't work,
and don't route around the guards.

- `GET /x/data/tables` → `{tables: [{name, rowCount, columns: [{name, type,
  notnull, pk}]}]}`.
- `GET /x/data/:table?limit=&offset=&sort=&dir=&q=` — paginated read. `limit`
  ≤200 (default 50), `sort` must be a real column (`400 invalid_sort`), `q` =
  escaped substring search across text columns. `404 unknown_table`. Returns
  `{table, columns, rows, total, limit, offset}`.
- `POST /x/data/query {sql}` — the power tool. Guard rules: single statement
  (one trailing `;` allowed → else `400 multiple_statements`); first keyword
  `SELECT`/`WITH` (else `400 not_a_select`); any mention of `tokens` →
  `400 tokens_forbidden`; runtime errors → `400 sql_error:<msg>`. Returns
  `{columns, rows, rowCount, truncated}` — `truncated: true` at the 500-row cap
  (say so when reporting results).
- `GET /explorer` — the browser UI shell, served WITHOUT bearer (data-free; it
  prompts for the token client-side). Point the user here for visual browsing.

SQL dialect notes: timestamps are epoch-ms integers
(`datetime(col/1000,'unixepoch')` to render); metrics live in JSON columns
(`json_extract(public_metrics,'$.impression_count')`); LIKE needs
`ESCAPE '\'` if you escape wildcards.

## MCP server — POST /mcp (16 tools, all $0 by construction)

Stateless JSON-RPC behind the same bearer (`GET/DELETE /mcp` → 405). Client
setup: `claude mcp add --transport http stratus https://<host>/mcp --header
"Authorization: Bearer $STRATUS_TOKEN"`. When these tools are available in a
session, prefer them over curl.

- **Schema tier** (S1 core direct): `x_list_tables`, `x_describe_table {table}`,
  `x_query {sql}` (same SELECT-only/tokens-blind/500-row rules).
- **Curated tier** (in-process route forwards): `x_brief {tzOffsetMin?}`,
  `x_playbook {minN?}`, `x_person {handle}`, `x_followups`, `x_conversations`,
  `x_metrics_account {days?}`, `x_best_times {minN?, tzOffsetMin?}`,
  `x_cost {days?}`, `x_search_voice {q}`, `x_digest {week?, tzOffsetMin?}` —
  digest **forces `factsOnly=true`** so an MCP read never spends on narration.
- **Write tier** (never X-billed): `x_add_idea {text, tags?}`,
  `x_add_person_note {handle, text}` (creates the person if unknown),
  `x_draft_post {text, pillar?, scheduledFor?}` — **status is hard-coded to
  `draft`**; no MCP call can ever reach the publisher. Only a human promotes
  draft→pending.

## Cost dashboard — /cost

Platforms: `'x'` (soft $0.15/day budget — log-only watchdog), `'grok'` (text
tokens), `'xai'` (images — hard $0.50/day budget).

- `GET /cost/today` → `{from, to, totalUsd, totalCalls, byPlatform: [{platform,
  costUsd, calls, dailyBudgetUsd?, overBudget?, byEndpoint: [...]}]}` — budget
  fields only on platforms with one configured. UTC day.
- `GET /cost/daily?days=` (default 30, clamp 1–90; `400 invalid_days`) →
  `{from, days, budgets: {x: 0.15, xai: 0.5}, daily: [{day, totalUsd,
  totalCalls, byPlatform}]}` — zero-filled series.
