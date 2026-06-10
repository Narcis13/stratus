// GET /healthz — 200 if the DB round-trips AND every registered worker
// heartbeat is fresh. Public (no bearer required) so that platform health
// probes don't need the API token. A dead publisher must page the deploy
// check (503), not fail silently while posts pile up.

import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import pkg from '../../package.json' with { type: 'json' };
import { db } from '../db/client.ts';
import { heartbeatStatus } from '../heartbeats.ts';

export const healthz = new Hono();

healthz.get('/healthz', async (c) => {
  const workers = heartbeatStatus();
  const staleWorkers = workers.filter((w) => w.stale).map((w) => w.name);

  let dbOk = true;
  let dbError: string | undefined;
  try {
    await db.execute(sql`select 1`);
  } catch (err) {
    dbOk = false;
    dbError = (err as Error).message;
  }

  const ok = dbOk && staleWorkers.length === 0;
  return c.json(
    {
      ok,
      version: pkg.version,
      ...(dbError ? { error: dbError } : {}),
      workers,
      ...(staleWorkers.length > 0 ? { staleWorkers } : {}),
    },
    ok ? 200 : 503,
  );
});
