# Neon → SQLite migration runbook

**Context (2026-06-19):** Neon's free-tier compute quota locked the project out
(`exceeded the compute time quota`). The app has been migrated to local
**SQLite (`bun:sqlite`)** — code is done, tested, and ready. The Hetzner
`stratus.service` was **stopped and disabled** so nothing runs (no 3 AM X-API
spend) during the wait. Your Neon data is intact but unreadable until the quota
resets (start of the next billing month) or you upgrade.

This file is the exact sequence to run **once Neon unlocks**.

---

## What's already done

- App runs on SQLite (`src/db/client.ts` → `bun:sqlite`, schema in
  `src/db/shared-schema.ts` + `src/x/db/schema.ts`, both `sqlite-core`).
- Schema auto-migrates at boot; `src/db/migrations/0000_*.sql` is the SQLite DDL.
- `scripts/migrate-neon-to-sqlite.ts` — the one-shot data copy (idempotent).
- `deploy.sh` excludes `stratus.db*` from rsync (never overwrites the server DB)
  and re-enables the service.
- `.env.example` documents `SQLITE_PATH`; `DATABASE_URL` is now copy-only.

## Step 0 — is Neon back?

Dry-run (reads nothing, just connects + counts every table):

```bash
bun run scripts/migrate-neon-to-sqlite.ts
```

- Prints `exceeded the compute time quota` → still locked. Wait / upgrade.
- Prints per-table counts → unlocked. Proceed.

## Step 1 — prep the server `.env`

On the box (`ssh root@<host>`, file at `/home/stratus/app/.env`), make sure it has:

```
SQLITE_PATH=/home/stratus/app/stratus.db   # absolute, matches the service
DAILY_METRICS_ENABLED=false                # keep OFF until data is copied
DATABASE_URL=<the Neon URL>                # already present
```

`DAILY_METRICS_ENABLED=false` matters: it stops the 03:00 pass (and the boot
catch-up) from spending X-API money discovering tweets against an empty DB.

## Step 2 — deploy the SQLite code

```bash
./scripts/deploy.sh
```

This rsyncs the code, runs `drizzle-kit migrate` (creates the empty SQLite
schema on the server), and `enable`s + restarts the service. The deploy's
`.env` key-diff will remind you if `SQLITE_PATH` is missing.

## Step 3 — copy the data (the "one script")

Stop the service so the copy has the DB to itself, then run it as the app user:

```bash
ssh root@<host> "systemctl stop stratus.service"
ssh root@<host> "sudo -u stratus -H bash -lc \
  'cd /home/stratus/app && set -a && . ./.env && set +a && \
   bun run scripts/migrate-neon-to-sqlite.ts --apply'"
```

It copies every table in FK-safe order (`INSERT OR IGNORE`, so re-running is
safe), then runs `PRAGMA foreign_key_check`. Confirm the per-table
`neon=N copied=N` counts line up and it prints `Foreign key check: OK`.

> The OAuth token row is copied too, so no re-auth is needed. (If you'd rather
> start with a fresh token, run `bun run auth` instead — both are fine.)

## Step 4 — turn metrics back on and start

Set `DAILY_METRICS_ENABLED=true` in the server `.env`, then:

```bash
ssh root@<host> "systemctl start stratus.service"
curl -fsS https://stratus-narcis.duckdns.org/healthz && echo
```

Expect `{"ok":true,...}` with the DB round-trip passing and workers fresh.

## Step 5 — done. Decommission Neon

Once `/healthz` is green and the data looks right (spot-check `/x/metrics/account`,
`/x/voice/authors`, the calendar), you can delete the Neon project and drop
`DATABASE_URL` from the server `.env`. The runtime never touches Postgres again.

---

### Alternative: copy locally, ship the file

If you'd rather not run the script on the server, run the copy on your machine
(local `.env` `DATABASE_URL` + default `./stratus.db`), then ship the file to the
stopped service and start it:

```bash
bun run scripts/migrate-neon-to-sqlite.ts --apply     # writes ./stratus.db
ssh root@<host> "systemctl stop stratus.service"
scp ./stratus.db root@<host>:/home/stratus/app/stratus.db
ssh root@<host> "chown stratus:stratus /home/stratus/app/stratus.db && systemctl start stratus.service"
```

(rsync in `deploy.sh` excludes `stratus.db*`, so a later deploy won't clobber it.)
