// GET /healthz — 200 if the DB round-trips AND every registered worker
// heartbeat is fresh. Public (no bearer required) so that platform health
// probes don't need the API token. A dead publisher must page the deploy
// check (503), not fail silently while posts pile up.
//
// The endpoint is public, so DB failures report a generic flag only — the
// real error goes to the server log, never the response (§9.9).

import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import pkg from '../../package.json' with { type: 'json' };
import { db } from '../db/client.ts';
import { heartbeatStatus } from '../heartbeats.ts';

// Deployed commit (§9.8): deploy.sh writes `.git-sha` next to the app; an
// explicit GIT_SHA env (dev, CI) wins. Read once at boot — the SHA can't
// change without a restart.
const gitSha = await resolveGitSha();

async function resolveGitSha(): Promise<string | null> {
  if (process.env.GIT_SHA) return process.env.GIT_SHA;
  try {
    const raw = await Bun.file('.git-sha').text();
    const m = raw.match(/^GIT_SHA=(.+)$/m);
    return m?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

export const healthz = new Hono();

healthz.get('/healthz', async (c) => {
  const workers = heartbeatStatus();
  const staleWorkers = workers.filter((w) => w.stale).map((w) => w.name);

  let dbOk = true;
  try {
    db.run(sql`select 1`);
  } catch (err) {
    dbOk = false;
    console.error('healthz: db check failed:', err instanceof Error ? err.message : err);
  }

  const ok = dbOk && staleWorkers.length === 0;
  return c.json(
    {
      ok,
      version: pkg.version,
      gitSha,
      ...(dbOk ? {} : { error: 'db_unreachable' }),
      workers,
      ...(staleWorkers.length > 0 ? { staleWorkers } : {}),
    },
    ok ? 200 : 503,
  );
});
