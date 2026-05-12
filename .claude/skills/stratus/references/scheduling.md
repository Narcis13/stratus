# Scheduling a week of posts

The headline workflow: queue 3–4 posts/day for the next 7 days, with safety checks for the things that silently fail.

## Pre-flight

1. `curl -fsS "$STRATUS_BASE_URL/healthz"` — must return `{"ok":true}`.
2. `STRATUS_API_TOKEN` exported; if not, source it from project `.env`:
   ```bash
   export STRATUS_API_TOKEN=$(grep ^API_TOKEN= .env | cut -d= -f2-)
   ```
3. Confirm the user's local timezone — the API only accepts UTC, so you must convert.

## Default cadences

- **3/day**: `09:00`, `13:00`, `18:00` local
- **4/day**: `08:30`, `12:30`, `16:30`, `20:00` local

Convert each slot for each of the 7 days into UTC ISO 8601 (`YYYY-MM-DDTHH:MM:SSZ`).

## Per-post validation (run before any POST)

For each draft:

1. **URL guard** — refuse if `text` matches `/(^|\s)https?:\/\//`. The publisher worker calls `createPost` *without* `allowUrlSurcharge`, so URL-bearing posts crash at the 60s tick and end up `status='failed'`. There is no API knob to bypass this. Tell the user to strip the link or post manually.
2. **Length** — `text.length > 280` → reject. Warn at >270 to leave slack.
3. **Empty/whitespace-only** → reject (the API will too: `400 text_required`).
4. **Time monotonicity (optional)** — within a day, sort by `scheduledFor` ascending. The publisher doesn't care, but it makes the calendar list readable.

## Dry-run preview

Before submitting, print a table grouped by day. Example:

```
2026-05-14 Thu
  09:00Z  shipping notes from the weekend — what worked and what flopped
  13:00Z  the URL-surcharge thing in stratus: $0.20 vs $0.015, or 13x…
  18:00Z  hot take: most "automation" is just a cron job in a fancy shirt
```

Get explicit user confirmation before submitting.

## Bulk submission

Use [../scripts/schedule_week.sh](../scripts/schedule_week.sh), which takes a JSON array of `{text, scheduledFor}` and POSTs each row, halting on the first non-2xx:

```bash
cat > /tmp/week.json <<'EOF'
[
  { "text": "monday morning, day 1", "scheduledFor": "2026-05-19T07:00:00Z" },
  { "text": "monday lunch deep work cue", "scheduledFor": "2026-05-19T11:00:00Z" },
  { "text": "monday wrap, what shipped", "scheduledFor": "2026-05-19T16:00:00Z" }
]
EOF
bash .claude/skills/stratus/scripts/schedule_week.sh /tmp/week.json
```

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
