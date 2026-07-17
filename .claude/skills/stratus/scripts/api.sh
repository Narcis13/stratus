#!/usr/bin/env bash
# stratus API helper — kills the curl boilerplate.
#
#   api.sh GET  /x/brief
#   api.sh GET  '/x/posts/scheduled?status=pending'
#   api.sh POST /x/posts/scheduled '{"text":"hello","scheduledFor":"2026-07-20T07:14:00Z"}'
#   api.sh POST /x/replies/generate @/tmp/ctx.json
#   api.sh PATCH /x/replies/$ID '{"status":"posted","postedTweetId":"179..."}'
#   api.sh DELETE /x/posts/scheduled/$ID
#
# Reads STRATUS_BASE_URL / STRATUS_API_TOKEN from the environment; falls back to
# sourcing ./.env (API_TOKEN becomes the bearer). Prints the response body to
# stdout and the HTTP status to stderr; exits non-zero on >=400.

set -euo pipefail

METHOD="${1:?usage: api.sh METHOD PATH [JSON_BODY|@file]}"
PATH_Q="${2:?usage: api.sh METHOD PATH [JSON_BODY|@file]}"
BODY="${3:-}"

if [[ -z "${STRATUS_API_TOKEN:-}" && -f .env ]]; then
  set -a; source .env; set +a
  export STRATUS_API_TOKEN="${STRATUS_API_TOKEN:-${API_TOKEN:-}}"
fi
BASE="${STRATUS_BASE_URL:-https://stratus-narcis.duckdns.org}"
: "${STRATUS_API_TOKEN:?STRATUS_API_TOKEN not set (and no .env with API_TOKEN found)}"

ARGS=( -sS -X "$METHOD" "$BASE$PATH_Q"
       -H "Authorization: Bearer $STRATUS_API_TOKEN"
       -w '\n%{http_code}' )
if [[ -n "$BODY" ]]; then
  ARGS+=( -H 'Content-Type: application/json' -d "$BODY" )
fi

RESP=$(curl "${ARGS[@]}")
STATUS="${RESP##*$'\n'}"
BODY_OUT="${RESP%$'\n'*}"

echo "$BODY_OUT"
echo "HTTP $STATUS" >&2
[[ "$STATUS" -lt 400 ]]
