#!/usr/bin/env bash
# scripts/deploy.sh — push current working tree to the server and restart.
#
#   usage:  ./scripts/deploy.sh                  # defaults to $STRATUS_DEPLOY_HOST
#           ./scripts/deploy.sh root@1.2.3.4     # different host
#
# Host resolution (§9.8): arg > STRATUS_DEPLOY_HOST env > STRATUS_DEPLOY_HOST
# in .env. No hardcoded IP — the box can move without editing this script.
#
# Safe to run repeatedly. On first run it also uploads .env (then never again).

set -euo pipefail

APPDIR=/home/stratus/app
LOCAL_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cd "$LOCAL_ROOT"

if [[ ! -f .env ]]; then
  echo "ERROR: $LOCAL_ROOT/.env not found — create it before deploying." >&2
  exit 1
fi

REMOTE="${1:-${STRATUS_DEPLOY_HOST:-$(grep -E '^STRATUS_DEPLOY_HOST=' .env | cut -d= -f2- || true)}}"
if [[ -z "$REMOTE" ]]; then
  echo "ERROR: no deploy host. Pass one (./scripts/deploy.sh root@host) or set STRATUS_DEPLOY_HOST in .env." >&2
  exit 1
fi

# Stamp the deployed commit so /healthz can report exactly what's running.
GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
  GIT_SHA="${GIT_SHA}-dirty"
fi
echo "==> deploying $GIT_SHA"

echo "==> rsync code to $REMOTE:$APPDIR"
rsync -az --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude 'extension/node_modules' \
  --exclude 'extension/dist' \
  --exclude '.tokens.json' \
  --exclude 'stratus.db' \
  --exclude 'stratus.db-wal' \
  --exclude 'stratus.db-shm' \
  --exclude '*.sqlite' \
  --exclude '.env' \
  --exclude '.env.local' \
  --exclude '.DS_Store' \
  ./ "$REMOTE":"$APPDIR/"

echo "==> stamp git SHA"
ssh "$REMOTE" "echo 'GIT_SHA=$GIT_SHA' > $APPDIR/.git-sha"

echo "==> fix ownership"
ssh "$REMOTE" "chown -R stratus:stratus $APPDIR"

echo "==> upload .env if missing (one-time)"
if ! ssh "$REMOTE" "test -f $APPDIR/.env"; then
  scp .env "$REMOTE":"$APPDIR/.env"
  ssh "$REMOTE" "chown stratus:stratus $APPDIR/.env && chmod 600 $APPDIR/.env"
  echo "    .env uploaded. EDIT IT on the server if needed:"
  echo "    ssh $REMOTE 'nano $APPDIR/.env'"
fi

echo "==> diff server .env keys against .env.example"
EXPECTED_KEYS=$(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' .env.example | cut -d= -f1 | sort)
SERVER_KEYS=$(ssh "$REMOTE" "grep -E '^[A-Za-z_][A-Za-z0-9_]*=' $APPDIR/.env | cut -d= -f1" | sort)
MISSING_KEYS=$(comm -23 <(echo "$EXPECTED_KEYS") <(echo "$SERVER_KEYS"))
if [[ -n "$MISSING_KEYS" ]]; then
  echo "    WARNING: server .env is missing keys present in .env.example:"
  echo "$MISSING_KEYS" | sed 's/^/      /'
  echo "    add them: ssh $REMOTE 'nano $APPDIR/.env'  (then restart: systemctl restart stratus)"
else
  echo "    server .env has every key from .env.example"
fi

echo "==> bun install"
ssh "$REMOTE" "sudo -u stratus -H bash -lc 'cd $APPDIR && bun install --frozen-lockfile'"

# Migration status BEFORE restart (§9.8): a restart against an un-migrated
# schema is the silent way to crash every worker tick. We run the bun:sqlite
# migrator (scripts/migrate.ts) — NOT `drizzle-kit migrate`, whose CLI can't
# connect to bun:sqlite (it demands better-sqlite3/@libsql, unshipped). It's
# idempotent and throws on a bad migration so this aborts before restart.
# Sourcing .env makes it target the same SQLITE_PATH the service uses; the app
# also auto-migrates at boot, so this is belt-and-suspenders.
echo "==> run migrations (idempotent)"
ssh "$REMOTE" "sudo -u stratus -H bash -lc 'cd $APPDIR && set -a && . ./.env && set +a && bun run scripts/migrate.ts' " || {
  echo "ERROR: migrations failed — NOT restarting the service." >&2
  exit 1
}

echo "==> enable + restart service"
# enable corrects the 2026-06-19 manual `systemctl disable` (done to stop the
# crash-looping Neon-era service during the SQLite migration window).
ssh "$REMOTE" "systemctl enable stratus.service >/dev/null 2>&1 || true; systemctl restart stratus.service"

echo "==> health check"
sleep 2
ssh "$REMOTE" "systemctl is-active stratus.service" || {
  echo "ERROR: service did not start. Logs:"
  ssh "$REMOTE" "journalctl -u stratus --no-pager -n 50"
  exit 1
}
ssh "$REMOTE" "curl -fsS http://127.0.0.1:3000/healthz && echo"
echo "==> deployed $GIT_SHA."
