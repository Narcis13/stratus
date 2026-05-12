#!/usr/bin/env bash
# scripts/deploy.sh — push current working tree to the server and restart.
#
#   usage:  ./scripts/deploy.sh                  # defaults to root@116.203.39.245
#           ./scripts/deploy.sh root@1.2.3.4     # different host
#
# Safe to run repeatedly. On first run it also uploads .env (then never again).

set -euo pipefail

REMOTE="${1:-root@116.203.39.245}"
APPDIR=/home/stratus/app
LOCAL_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cd "$LOCAL_ROOT"

if [[ ! -f .env ]]; then
  echo "ERROR: $LOCAL_ROOT/.env not found — create it before deploying." >&2
  exit 1
fi

echo "==> rsync code to $REMOTE:$APPDIR"
rsync -az --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude 'extension/node_modules' \
  --exclude 'extension/dist' \
  --exclude '.tokens.json' \
  --exclude '.env' \
  --exclude '.env.local' \
  --exclude '.DS_Store' \
  ./ "$REMOTE":"$APPDIR/"

echo "==> fix ownership"
ssh "$REMOTE" "chown -R stratus:stratus $APPDIR"

echo "==> upload .env if missing (one-time)"
if ! ssh "$REMOTE" "test -f $APPDIR/.env"; then
  scp .env "$REMOTE":"$APPDIR/.env"
  ssh "$REMOTE" "chown stratus:stratus $APPDIR/.env && chmod 600 $APPDIR/.env"
  echo "    .env uploaded. EDIT IT on the server if needed:"
  echo "    ssh $REMOTE 'nano $APPDIR/.env'"
fi

echo "==> bun install"
ssh "$REMOTE" "sudo -u stratus -H bash -lc 'cd $APPDIR && bun install --frozen-lockfile'"

echo "==> restart service"
ssh "$REMOTE" "systemctl restart stratus.service"

echo "==> health check"
sleep 2
ssh "$REMOTE" "systemctl is-active stratus.service" || {
  echo "ERROR: service did not start. Logs:"
  ssh "$REMOTE" "journalctl -u stratus --no-pager -n 50"
  exit 1
}
ssh "$REMOTE" "curl -fsS http://127.0.0.1:3000/healthz && echo"
echo "==> deployed."
