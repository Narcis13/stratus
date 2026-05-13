# Scheduling a week of posts

The headline workflow: queue 3–4 posts/day for the next 7 days, with safety checks for the things that silently fail.

## Pre-flight

1. Make sure `STRATUS_BASE_URL` and `STRATUS_API_TOKEN` are exported. If not, pull them from `.env`:
   ```bash
   set -a; source .env; set +a
   export STRATUS_API_TOKEN="$API_TOKEN"
   ```
   The deployed instance is at `https://stratus-narcis.duckdns.org`; `STRATUS_BASE_URL` in `.env` already points there.
2. `curl -fsS "$STRATUS_BASE_URL/healthz"` — must return `{"ok":true}`.
3. Confirm the user's local timezone — the API only accepts UTC, so you must convert.

## Default cadences (anchored on hours, jittered minutes)

Pick an *hour anchor* per slot, then jitter the minute per day to keep the cadence from looking like a cron job at `:00`.

- **3/day** anchors: **09**, **13**, **18** local
- **4/day** anchors: **08**, **12**, **16**, **20** local

For each slot, each day, pick a fresh random minute in **[5, 35]** after the anchor, seconds `00`. Vary per slot AND per day — so the 09 anchor might land at 09:12 Mon, 09:23 Tue, 09:08 Wed, etc. Never repeat the same minute across multiple days for the same slot.

### Picking the jitter

A simple shell-friendly way (don't reuse the same RANDOM across slots):

```bash
# Random minute in [5, 35] inclusive — call once per slot, per day
JITTER=$(( (RANDOM % 31) + 5 ))   # 5..35
```

Or in jq when building the payload:

```bash
jq -n --arg date "2026-05-19" --argjson hour 9 '
  ($date + "T" + ("00" + ($hour | tostring))[-2:] + ":" +
   ("00" + ((5 + (now * 1000 | floor) % 31) | tostring))[-2:] + ":00Z")
'
```

Either way, **render as UTC ISO 8601** (`YYYY-MM-DDTHH:MM:SSZ`) before POSTing. Always show the user the final timestamps in the dry-run preview — the minute jitter must be visible so they can sanity-check.

## Per-post validation (run before any POST)

For each draft:

1. **URL guard** — refuse if `text` matches `/(^|\s)https?:\/\//`. The publisher worker calls `createPost` *without* `allowUrlSurcharge`, so URL-bearing posts crash at the 60s tick and end up `status='failed'`. There is no API knob to bypass this. Tell the user to strip the link or post manually.
2. **Length** — `text.length > 280` → reject. Warn at >270 to leave slack.
3. **Empty/whitespace-only** → reject (the API will too: `400 text_required`).
4. **Time monotonicity (optional)** — within a day, sort by `scheduledFor` ascending. The publisher doesn't care, but it makes the calendar list readable.

## Dry-run preview

Before submitting, print a table grouped by day. Example (note the jittered minutes — never round `:00`):

```
2026-05-14 Thu
  09:12Z  shipping notes from the weekend — what worked and what flopped
  13:27Z  the URL-surcharge thing in stratus: $0.20 vs $0.015, or 13x…
  18:08Z  hot take: most "automation" is just a cron job in a fancy shirt
2026-05-15 Fri
  09:23Z  …
  13:07Z  …
  18:31Z  …
```

Get explicit user confirmation before submitting.

## From a markdown file (the common case)

When the user hands you an md file of blockquote-formatted tweets (one tweet = one contiguous run of `> ` lines, often labeled `**1.**`/`**2.**`/…), use [../scripts/md_to_schedule.ts](../scripts/md_to_schedule.ts) to do the heavy lifting in one shot:

```bash
bun run .claude/skills/stratus/scripts/md_to_schedule.ts \
  /path/to/week.md Europe/Bucharest 2026-05-14 4 > /tmp/week.json
```

Positional args: `<md-file> <IANA timezone> <YYYY-MM-DD start-date> <slots/day 3|4>`.

The script:

- Strips YAML frontmatter and ignores all non-blockquote content (headers, labels, tables).
- Extracts each contiguous `> ` block as one tweet, in file order.
- Refuses on URL hits (Rule 1) or any tweet >280 chars; warns at >270.
- Refuses if tweet count != `slotsPerDay × 7` (so 21 for 3/day, 28 for 4/day).
- Generates jittered minutes in `[5,35]\{30}`, distinct per slot column across the 7 days.
- Converts each local `<anchor>:<minute>` to UTC for the supplied timezone (DST-safe via `Intl.DateTimeFormat`).
- Writes JSON to stdout, a short summary to stderr.

Always inspect the JSON (or render a preview table from it) before piping into `schedule_week.sh`. The minutes are non-deterministic — re-running produces a different jitter — so the version you preview must be the version you submit.

## Bulk submission

Use [../scripts/schedule_week.sh](../scripts/schedule_week.sh) on the JSON file (either md-derived or hand-built). It takes a JSON array of `{text, scheduledFor}` and POSTs each row, halting on the first non-2xx:

```bash
cat > /tmp/week.json <<'EOF'
[
  { "text": "monday morning, day 1", "scheduledFor": "2026-05-19T07:14:00Z" },
  { "text": "monday lunch deep work cue", "scheduledFor": "2026-05-19T11:08:00Z" },
  { "text": "monday wrap, what shipped", "scheduledFor": "2026-05-19T16:27:00Z" }
]
EOF
bash .claude/skills/stratus/scripts/schedule_week.sh /tmp/week.json
```

(The minutes above are *examples* of jitter — generate fresh ones per slot per day; never reuse `:00`.)

The script:

- Validates JSON shape and each row.
- Pre-flights `/healthz`.
- POSTs sequentially (so order in the calendar matches order in your file).
- Prints `OK <uuid>  <iso>` per row, `FAIL <http_status>  <error>` on failure.
- Returns a summary line: `Submitted N, OK n, failed m`.

## Verification

After submission, confirm the queue matches expectations:

```bash
START=$(date -u +%Y-%m-%dT00:00:00Z)
END=$(date -u -v+7d +%Y-%m-%dT00:00:00Z 2>/dev/null || date -u -d '+7 days' +%Y-%m-%dT00:00:00Z)
curl -s "$STRATUS_BASE_URL/x/posts/scheduled?from=$START&to=$END&status=pending" \
  -H "Authorization: Bearer $STRATUS_API_TOKEN" \
  | jq 'length, group_by(.scheduledFor[0:10]) | map({date: .[0].scheduledFor[0:10], count: length})'
```

Show the user the totals grouped by date.

## Editing after the fact

- **Reschedule one row**: `PATCH /x/posts/scheduled/:id` with `{ "scheduledFor": "…" }`. Time can move past or future.
- **Cancel one row**: `PATCH … { "status": "cancelled" }`. Soft — row stays in DB.
- **Hard delete**: `DELETE /x/posts/scheduled/:id` (200 only when status ≠ `posted`).
- **Retry a failed row**: PATCH `{ "status": "pending", "scheduledFor": "…" }`. The publisher will retry at the new time. Don't bother editing `errorClass` / `errorDetail` — the worker rewrites them on the next attempt.

## Bulk cancel

There is no bulk endpoint. If you need to wipe the next-week queue (e.g. the user wants to redo the cadence), `GET` with the window, then loop:

```bash
IDS=$(curl -s "$STRATUS_BASE_URL/x/posts/scheduled?from=$START&to=$END&status=pending" \
  -H "Authorization: Bearer $STRATUS_API_TOKEN" | jq -r '.[].id')
for id in $IDS; do
  curl -sX DELETE "$STRATUS_BASE_URL/x/posts/scheduled/$id" \
    -H "Authorization: Bearer $STRATUS_API_TOKEN" -o /dev/null -w "%{http_code} $id\n"
done
```

Always confirm with the user before destructive loops like this.
