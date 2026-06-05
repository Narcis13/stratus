// Endpoints over `posts_published` — the catalog of own tweets we track
// metrics on. `POST /posts/reconcile` triggers a one-shot run of the daily
// discover+snapshot pass; the in-process timer runs it once a day at 03:00 UTC.

import { Hono } from 'hono';
import { type DailyMetricsDeps, runDailyMetrics } from '../workers/dailyMetrics.ts';

const RECONCILE_HARD_CAP = 3200; // /2/users/:id/tweets pagination cap (X plan §6.1)

export function createPostsRouter(deps: DailyMetricsDeps): Hono {
  const router = new Hono();

  router.post('/posts/reconcile', async (c) => {
    const body = await readJson(c.req.raw);
    const fullScan = body?.fullScan === true;
    const maxResults = parseMaxResults(body?.maxResults);
    if (maxResults === 'invalid') return c.json({ error: 'invalid_max_results' }, 400);

    try {
      const result = await runDailyMetrics(deps, {
        fullScan,
        ...(maxResults !== undefined ? { maxResults } : {}),
      });
      return c.json(result);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error('reconcile route failed:', detail);
      return c.json({ error: 'reconcile_failed', detail }, 500);
    }
  });

  return router;
}

interface Body {
  fullScan?: unknown;
  maxResults?: unknown;
}

async function readJson(req: Request): Promise<Body | null> {
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Body;
  } catch {
    return null;
  }
}

function parseMaxResults(value: unknown): number | undefined | 'invalid' {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return 'invalid';
  return Math.min(RECONCILE_HARD_CAP, Math.floor(value));
}
