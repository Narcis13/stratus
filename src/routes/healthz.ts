// GET /healthz — 200 if the DB round-trips. Public (no bearer required) so that
// platform health probes don't need the API token.

import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client.ts';

export const healthz = new Hono();

healthz.get('/healthz', async (c) => {
  try {
    await db.execute(sql`select 1`);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ ok: false, error: (err as Error).message }, 503);
  }
});
