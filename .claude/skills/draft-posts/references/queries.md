# Queries — every read this skill makes

All local, all `$0`, all through `mcp__stratus__x_query` (or
`bash .claude/skills/stratus/scripts/api.sh GET "/x/explorer/query?sql=..."` if the
MCP server isn't connected). Read-only: anything but a SELECT is rejected.

## Two gotchas that have already cost a run

**1 · Never hand-compute an epoch.** Timestamps are **milliseconds**. Writing the
constant yourself is how a run once filtered on 2025 instead of 2026 and pulled
255 rows for "this week". Always let SQLite do it:

```sql
CAST(strftime('%s','2026-08-31') AS INTEGER) * 1000        -- a date
(CAST(strftime('%s','now') AS INTEGER) - 14*86400) * 1000  -- 14 days ago
```

**2 · The tool has an output token cap, well below its 500-row limit.** A bare
`SELECT text FROM scheduled_posts WHERE …` over a week overflowed it and got
spilled to a file. Always `substr(replace(text, char(10), ' / '), 1, 110)` for
scanning, and only pull full text for rows you have already chosen.

---

## 1. Scoring readiness — always the first read

```sql
SELECT
  (SELECT value FROM app_settings WHERE key LIKE '%handle%' LIMIT 1)                    AS own_handle,
  (SELECT MAX(datetime(snapshot_at/1000,'unixepoch')) FROM metrics_snapshots)           AS last_metrics,
  (SELECT MAX(datetime(snapshot_at/1000,'unixepoch')) FROM account_snapshots)           AS last_acct,
  (SELECT followers_count FROM account_snapshots ORDER BY snapshot_at DESC LIMIT 1)      AS followers,
  (SELECT COUNT(*) FROM scheduled_posts WHERE status='pending')                          AS pending;
```

`last_metrics` is frozen at 2026-08-12 and will stay frozen — invariant #8 deleted
the paid pass. It is **not** a path to scoring; it is context for old rows only.

Then, what has been captured and when:

```sql
SELECT id, handle, mode, scope, row_count, datetime(created_at/1000,'unixepoch') AS created
FROM harvest_runs ORDER BY created_at DESC LIMIT 12;
```

**Own-post data exists only if a row has `handle = <own_handle>` AND `mode = 'posts'`.**
A `replies` or `thread` run on the own handle does not score originals.

---

## 2. Skeleton buckets — the rotation evidence (Step 2)

Adjust the CASE arms to the shapes actually present in that account's corpus, and
keep an `ELSE` baseline bucket — a skeleton is only meaningful **relative to that
account's ordinary question.**

```sql
SELECT
  CASE
    WHEN lower(text) LIKE '%would you rather%'                                        THEN 'A dilemma'
    WHEN lower(text) LIKE '%half of%' OR lower(text) LIKE '%other half%'
      OR lower(text) LIKE '%which one are you%'                                       THEN 'B faction split'
    WHEN lower(text) LIKE 'name a%' OR lower(text) LIKE 'name one%'
      OR lower(text) LIKE 'tell me%'                                                  THEN 'C challenge board'
    WHEN text LIKE '%- %- %' OR text LIKE '%>%>%'                                     THEN 'D bake-off list'
    WHEN lower(text) LIKE '%followers%' OR lower(text) LIKE '%impressions%'           THEN 'E milestone'
    WHEN text LIKE '%?%'                                                              THEN 'F baseline question'
    ELSE 'G statement'
  END AS shape,
  COUNT(*) n,
  ROUND(AVG(views))                                                    avg_views,
  ROUND(AVG(comments),1)                                               avg_comments,
  ROUND(AVG(likes),1)                                                  avg_likes,
  ROUND(SUM(CAST(comments AS REAL))/NULLIF(SUM(CAST(likes AS REAL)),0),2) reply_like,
  MAX(views)                                                           max_views
FROM harvest_rows
WHERE handle = '<handle>' AND mode = 'posts' AND views > 0
GROUP BY shape ORDER BY avg_comments DESC;
```

`SUM(comments)/SUM(likes)` is the right reply:like — it weights by volume.
`AVG(comments)/AVG(likes)` gives the same figure here but drifts on sparse buckets.

**Outlier discipline** — run this on any bucket whose average looks carried:

```sql
SELECT COUNT(*) n, ROUND(AVG(views)) avg_without_top
FROM (SELECT views FROM harvest_rows
      WHERE handle='<handle>' AND mode='posts' AND views > 0
        AND <the bucket's predicate>
      ORDER BY views DESC LIMIT -1 OFFSET 1);
```

Report both numbers in §1. A bucket that collapses when its top row leaves is a
lottery ticket, and saying so is the difference between analysis and astrology.

**The top rows themselves** — read these, the text is where the mechanism is:

```sql
SELECT text, views, comments, likes, bookmarks, text_len,
       datetime(tweet_time/1000,'unixepoch') tt
FROM harvest_rows WHERE handle='<handle>' AND mode='posts'
ORDER BY views DESC LIMIT 25;
```

Media rows are not text mechanisms — check `has_video` / `has_photo` before
promoting a skeleton whose best row is a video.

---

## 3. Novelty — what is already spent (Step 4)

```sql
SELECT substr(replace(text, char(10), ' / '), 1, 110) AS txt,
       datetime(posted_at/1000,'unixepoch') AS at
FROM posts_published
WHERE is_reply = 0
  AND posted_at > (CAST(strftime('%s','now') AS INTEGER) - 14*86400) * 1000
ORDER BY posted_at DESC LIMIT 70;
```

**Then the ones that haven't fired yet** — they are spent too, and they are not in
`posts_published`:

```sql
SELECT substr(replace(text, char(10), ' / '), 1, 110) AS txt,
       datetime(scheduled_for/1000,'unixepoch') AS fires_utc, status
FROM scheduled_posts WHERE status = 'pending' ORDER BY scheduled_for;
```

The last pending row is also **the tail your first new slot must clear** (Step 5).

---

## 4. Scoring the last set — only possible with an own-profile `posts` harvest

The join key is the tweet id: `scheduled_posts.posted_tweet_id` = `harvest_rows.tweet_id`.

```sql
WITH last_set AS (
  SELECT id, posted_tweet_id, text, pillar, length(text) AS len,
         datetime(scheduled_for/1000,'unixepoch') AS fired
  FROM scheduled_posts
  WHERE status = 'posted'
    AND scheduled_for >= CAST(strftime('%s','<week-start>') AS INTEGER) * 1000
    AND scheduled_for <  CAST(strftime('%s','<week-end>')   AS INTEGER) * 1000
),
scored AS (
  SELECT ls.*, h.views, h.comments, h.likes, h.bookmarks
  FROM last_set ls
  JOIN harvest_rows h ON h.tweet_id = ls.posted_tweet_id
  WHERE h.handle = '<own_handle>' AND h.mode = 'posts'
)
SELECT substr(replace(text, char(10), ' / '), 1, 60) AS txt, len,
       views, comments, likes,
       ROUND(CAST(comments AS REAL)/NULLIF(likes,0), 2) AS reply_like,
       ROUND(CAST(views AS REAL)/len, 1)               AS views_per_char
FROM scored ORDER BY views DESC;
```

A harvest run twice captures a post twice (that is deliberate — it is how the view
curve is built). Take the **freshest** row per tweet when scoring:

```sql
JOIN harvest_rows h ON h.id = (
  SELECT id FROM harvest_rows
  WHERE tweet_id = ls.posted_tweet_id AND handle='<own_handle>' AND mode='posts'
  ORDER BY captured_at DESC LIMIT 1)
```

**Per-stream roll-up** — the answer to last week's §10.1. Streams aren't stored, so
map tag → tweet id from the previous document's §11 table and aggregate in your
head or with a CASE over `posted_tweet_id`. Report per stream: n, **median** views,
median comments, reply:like. Medians, because one lottery post ruins a mean.

**The length cohorts** — §10.2:

```sql
SELECT CASE WHEN len < 110 THEN 'short (<110)'
            WHEN len > 215 THEN 'long (>215)'
            ELSE 'middle' END AS cohort,
       COUNT(*) n, ROUND(AVG(views)) avg_views, ROUND(AVG(comments),1) avg_comments
FROM scored GROUP BY cohort;
```

---

## 5. Hand-swaps — the operator edited the plan

A `scheduled_posts` row whose text doesn't match the previous document is data,
not an error. Pull the week's actual set and eyeball it against the doc's §11:

```sql
SELECT id, substr(replace(text, char(10), ' | '), 1, 70) AS txt,
       datetime(scheduled_for/1000,'unixepoch') AS fires_utc, status, pillar, length(text) AS len
FROM scheduled_posts
WHERE scheduled_for >= CAST(strftime('%s','<week-start>') AS INTEGER) * 1000
ORDER BY scheduled_for;
```

Report any swap neutrally in §0 — it is often the only unplanned A/B in the batch,
and it is the row whose result is most worth reading.

---

## 6. Optional context

```sql
-- account trajectory (frozen since 2026-08-12, historical only)
SELECT datetime(snapshot_at/1000,'unixepoch') d, followers_count
FROM account_snapshots ORDER BY snapshot_at DESC LIMIT 14;

-- what a captured thread's root was, and how it performed
SELECT DISTINCT orig_handle, substr(orig_text,1,200) AS root,
       orig_views, orig_comments, orig_likes
FROM harvest_rows WHERE run_id = '<run-id>';
```

`x_niche` (persona, beliefs, doctrine) and `x_playbook` (gated effectiveness) are
available and are **not** part of a normal run — pull one only if the operator
asks a question the corpus can't answer, and say which you pulled.
