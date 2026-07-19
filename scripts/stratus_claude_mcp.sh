#!/usr/bin/env bash
# Register the stratus MCP server with Claude Code.
#
# Host is the deployed domain (Caddy auto-HTTPS in front of the Bun app on :3000;
# UFW opens only 443, so the bare IP over HTTPS does NOT work — use the domain).
# The bearer is read from .env at runtime (never hardcoded), so this script is
# safe to commit.
set -euo pipefail

STRATUS_MCP_URL="https://stratus-narcis.duckdns.org/mcp"

# .env lives at the repo root, one level up from scripts/.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${STRATUS_ENV_FILE:-$SCRIPT_DIR/../.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "error: .env not found at $ENV_FILE" >&2
  exit 1
fi

# Pull API_TOKEN=... (strip the key, surrounding quotes, and any trailing CR).
STRATUS_TOKEN="$(grep -E '^API_TOKEN=' "$ENV_FILE" | head -n1 | cut -d= -f2- | tr -d '\r' | sed -E 's/^"(.*)"$/\1/; s/^'\''(.*)'\''$/\1/')"

if [[ -z "$STRATUS_TOKEN" ]]; then
  echo "error: API_TOKEN is empty or missing in $ENV_FILE" >&2
  exit 1
fi

# Replace any existing registration so re-running is idempotent.
claude mcp remove stratus >/dev/null 2>&1 || true

claude mcp add --transport http stratus "$STRATUS_MCP_URL" \
  --header "Authorization: Bearer $STRATUS_TOKEN"

echo "==> stratus MCP registered. Verify with: claude mcp list"
