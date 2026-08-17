# `x_query` recipes for the Radar corpus

`x_query` runs a single `SELECT` (or `WITH … SELECT`), read-only, 500 rows max,
`tokens` off-limits. Use it for what `x_radar` / `x_radar_tweet` can't answer —
long windows, per-handle history, cohort splits. Timestamps are **epoch
milliseconds** (`datetime(col / 1000, 'unixepoch')` to read them).

**What SQL cannot do here:** recompute `admitted`. That verdict comes from the
live sweep settings and is only produced by the route. Where a recipe below needs
it, it types the thresholds in by hand — read them off `x_radar`'s echoed `sweep`
block (or `x_settings`) first, and say in the answer that the numbers were pinned
by hand rather than recomputed.

## Volume and reach of the sweep

**Rows per day, and where the sweeping happened.**

```sql
SELECT date(first_seen_at / 1000, 'unixepoch') AS day,
       coalesce(source_path, 'unknown')        AS path,
       count(*)                                AS sightings
FROM radar_sightings
WHERE first_seen_at >= (unixepoch() - 30 * 86400) * 1000
GROUP BY day, path
ORDER BY day DESC, sightings DESC;
```

`source_path` is the question the passive `/home` corpus structurally cannot
answer: how much of the operator's opportunity flow happens off the timeline.

**Band mix over the window** — how much of the queue is the sweep's own doing
versus roster/cannon bypasses and hand pins.

```sql
SELECT band, count(*) AS n, round(avg(seen_count), 2) AS avg_seen
FROM radar_sightings
WHERE last_seen_at >= (unixepoch() - 30 * 86400) * 1000
GROUP BY band ORDER BY n DESC;
```

## Who keeps showing up

**Per-handle sighting counts, with the relationship and what was done about it.**

```sql
SELECT s.handle,
       count(*)                                   AS sightings,
       sum(s.seen_count)                          AS times_seen,
       max(s.views)                               AS best_views,
       coalesce(p.stage, '—')                     AS stage,
       sum(CASE WHEN d.tweet_id IS NOT NULL THEN 1 ELSE 0 END) AS drafted
FROM radar_sightings s
LEFT JOIN people p ON p.handle = s.handle AND p.retired = 0
LEFT JOIN (SELECT DISTINCT tweet_id FROM radar_drafts) d ON d.tweet_id = s.tweet_id
WHERE s.last_seen_at >= (unixepoch() - 30 * 86400) * 1000
GROUP BY s.handle
ORDER BY sightings DESC
LIMIT 40;
```

An author with many sightings and `drafted = 0` is either a room the operator
doesn't play in, or a standing miss — `x_person` decides which.

## The misses

**Never worked, over a long window** (no draft ever written, no reply ever
posted), with the sweep gates typed in — replace the four numbers with the live
`sweep` echo before running.

```sql
SELECT s.tweet_id, s.handle, s.views, s.replies, s.likes,
       round(s.views * 1.0 / max((s.last_seen_at - s.posted_at) / 60000, 1), 2) AS vpm,
       datetime(s.last_seen_at / 1000, 'unixepoch') AS last_seen,
       substr(s.text, 1, 90) AS snippet
FROM radar_sightings s
WHERE s.last_seen_at >= (unixepoch() - 30 * 86400) * 1000
  AND s.posted_at IS NOT NULL
  AND s.views   >= 500                                    -- sweep.minViews
  AND s.replies >= 2                                      -- sweep.minReplies
  AND (s.last_seen_at - s.posted_at) / 60000 <= 60        -- sweep.maxAgeMin
  AND s.tweet_id NOT IN (SELECT tweet_id FROM radar_drafts)
  AND s.tweet_id NOT IN (
        SELECT source_tweet_id FROM reply_drafts WHERE status = 'posted')
ORDER BY vpm DESC
LIMIT 50;
```

Anything older than a day or two here is history, not a to-do — read it as "what
kind of post do I keep letting go", then set the sweep or the roster accordingly.

**Drafted but never taken** — replies that were written and left on the card.

```sql
SELECT d.tweet_id, d.handle, d.status, d.model, d.angle,
       datetime(d.drafted_at / 1000, 'unixepoch') AS drafted
FROM radar_drafts d
WHERE d.drafted_at >= (unixepoch() - 30 * 86400) * 1000
  AND d.reply_draft_id IS NULL
ORDER BY d.drafted_at DESC
LIMIT 50;
```

## The cohort split: my drafts vs Grok's

`radar_drafts.model` is copied onto the confirmed `reply_drafts.model`, so
`'claude-code-mcp'` versus a Grok model id separates the two populations. Own
reply metrics come from the **$0 DOM harvest** (`harvest_rows`, `mode='replies'`,
latest capture per tweet) — `metrics_snapshots` is frozen history since the billed
reads were deleted on 2026-08-12, so don't build the split on it.

```sql
WITH latest AS (
  SELECT tweet_id, max(captured_at) AS captured_at, views, likes, comments
  FROM harvest_rows
  WHERE mode = 'replies'
  GROUP BY tweet_id
)
SELECT r.model,
       count(*)                  AS n,
       round(avg(l.views), 0)    AS avg_views,
       round(avg(l.likes), 2)    AS avg_likes,
       round(avg(l.comments), 2) AS avg_comments
FROM reply_drafts r
JOIN latest l ON l.tweet_id = r.posted_tweet_id
WHERE r.status = 'posted' AND r.source = 'radar'
GROUP BY r.model
ORDER BY n DESC;
```

**Gate this at n ≥ 20 per side** (§7.19 — the Playbook's own cell gate). Below
that the answer is "not enough data", never a number quoted as advice. Both sides
also have to be measured over the same stretch: `model='claude-code-mcp'` starts
at n=0 on 2026-08-17, so an early lead is a young cohort, not a finding.

**How much of the posted-reply flow is each cohort** (the §7.415a watch item — if
machine-drafted replies become the bulk of what gets posted, the reply guidance
loader starts feeding on its own output):

```sql
SELECT coalesce(model, '—') AS model, count(*) AS posted
FROM reply_drafts
WHERE status = 'posted'
  AND created_at >= (unixepoch() - 30 * 86400) * 1000
GROUP BY model ORDER BY posted DESC;
```

## Sanity checks on the feed itself

**Is the mirror alive?** (the extension ships sightings best-effort and never
retries, so silence is a real possibility.)

```sql
SELECT count(*) AS rows_24h,
       datetime(max(last_seen_at) / 1000, 'unixepoch') AS newest
FROM radar_sightings
WHERE last_seen_at >= (unixepoch() - 86400) * 1000;
```

A `newest` hours old while the operator says they were scrolling means the
browser toggle (`radarSightingSync`) is off, or the panel is not configured —
ask, don't guess. The same failure mode cost the passive harvest three weeks.
