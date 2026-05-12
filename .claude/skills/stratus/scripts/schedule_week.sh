#!/usr/bin/env bash
# schedule_week.sh — bulk-submit scheduled tweets to a local stratus API.
#
# Usage:
#   schedule_week.sh path/to/posts.json
#
# Input file format: JSON array of objects with `text` and `scheduledFor` (UTC ISO 8601).
# Optional fields (passed through if present): `mediaIds`, `status`.
#
# [
#   { "text": "monday morning", "scheduledFor": "2026-05-19T07:00:00Z" },
#   { "text": "monday lunch",   "scheduledFor": "2026-05-19T11:00:00Z" }
# ]
#
# Env:
#   STRATUS_BASE_URL    default http://127.0.0.1:3000
#   STRATUS_API_TOKEN   required (the bearer)
#
# Behavior:
#   - Pre-flights /healthz; aborts if the server isn't up.
#   - Refuses any text containing http:// or https:// (publisher would silently fail
#     these — see SKILL.md "URL surcharge" rule).
#   - Warns on any text >270 chars (X cap is 280, leave slack).
#   - POSTs sequentially, halting on the first non-2xx so a 401 doesn't fan out.
#   - Prints OK <uuid> <iso> per row, FAIL <code> <error> on failure.
#   - Ends with: "Submitted N, OK n, failed m".

set -u
set -o pipefail

BASE_URL="${STRATUS_BASE_URL:-http://127.0.0.1:3000}"
TOKEN="${STRATUS_API_TOKEN:-}"

die() { echo "schedule_week: $*" >&2; exit 1; }

[ $# -eq 1 ] || die "usage: $0 path/to/posts.json"
[ -r "$1" ] || die "cannot read $1"
[ -n "$TOKEN" ] || die "STRATUS_API_TOKEN not set"
command -v jq >/dev/null 2>&1 || die "jq is required"

INPUT="$1"

# Validate JSON shape: must be array of objects with required fields.
jq -e 'type == "array" and length > 0 and all(.[]; type == "object" and (.text | type == "string" and length > 0) and (.scheduledFor | type == "string" and length > 0))' "$INPUT" >/dev/null \
  || die "input must be a non-empty JSON array of {text: non-empty string, scheduledFor: non-empty string}"

# URL & length audit first — cheaper than a network round-trip and catches the
# silent-failure mode (URL in scheduled text → publisher fails it at 60s tick).
URL_HITS=$(jq -r '.[] | select(.text | test("(^|\\s)https?://"; "i")) | .text' "$INPUT")
if [ -n "$URL_HITS" ]; then
  echo "schedule_week: refusing — these texts contain a URL (publisher will fail them):" >&2
  echo "$URL_HITS" | sed 's/^/  • /' >&2
  exit 2
fi

LONG_HITS=$(jq -r '.[] | select((.text | length) > 270) | "  • (\(.text | length) chars) \(.text[0:60])…"' "$INPUT")
if [ -n "$LONG_HITS" ]; then
  echo "schedule_week: warning — these texts exceed 270 chars (X cap is 280):" >&2
  echo "$LONG_HITS" >&2
  echo "Continue anyway? [y/N]" >&2
  read -r ans
  case "$ans" in y|Y|yes) ;; *) die "aborted by user" ;; esac
fi

# Pre-flight server.
HEALTH=$(curl -fsS -o /dev/null -w '%{http_code}' "$BASE_URL/healthz" 2>/dev/null || true)
[ "$HEALTH" = "200" ] || die "healthz returned $HEALTH — is 'bun run start' running at $BASE_URL?"

TOTAL=$(jq 'length' "$INPUT")
OK=0
FAILED=0
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

# Iterate rows; pass each row's payload through stdin to curl to avoid arg quoting hell.
for i in $(seq 0 $((TOTAL - 1))); do
  PAYLOAD=$(jq -c ".[$i]" "$INPUT")
  HTTP=$(curl -sS -o "$TMP" -w '%{http_code}' \
    -X POST "$BASE_URL/x/posts/scheduled" \
    -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    --data "$PAYLOAD")

  if [ "$HTTP" = "201" ]; then
    ID=$(jq -r '.id // "?"' "$TMP")
    SF=$(jq -r '.scheduledFor // "?"' "$TMP")
    echo "OK   $ID  $SF"
    OK=$((OK + 1))
  else
    ERR=$(jq -r '.error // .message // "(no body)"' "$TMP" 2>/dev/null || cat "$TMP")
    echo "FAIL $HTTP  $ERR  // payload=$PAYLOAD" >&2
    FAILED=$((FAILED + 1))
    # Halt on auth so we don't fan out a bad token.
    if [ "$HTTP" = "401" ]; then
      echo "schedule_week: aborting on 401 — fix STRATUS_API_TOKEN and retry" >&2
      break
    fi
  fi
done

echo "Submitted $TOTAL, OK $OK, failed $FAILED"
[ "$FAILED" -eq 0 ] || exit 1
