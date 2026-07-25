// Endpoints over `posts_published` — the catalog of own tweets we track
// metrics on. `POST /posts/reconcile` triggers a one-shot run of the daily
// discover+snapshot pass; the in-process timer runs it once a day at 03:00 UTC.
// `POST /posts/backfill` ingests one own tweet by id that discovery missed —
// a single ~$0.001 owned read, in-process (no service stop needed).

import { Hono } from 'hono';
import { type BackfillResult, backfillTweet, isTweetId } from '../backfill.ts';
import { getValidAccessToken } from '../token-store.ts';
import { type DailyMetricsDeps, runDailyMetrics } from '../workers/dailyMetrics.ts';

const RECONCILE_HARD_CAP = 3200; // /2/users/:id/tweets pagination cap (X plan §6.1)

export function createPostsRouter(deps: DailyMetricsDeps): Hono {
  const router = new Hono();

  // Targeted backfill for a tweet the daily discovery pass never captured. One
  // owned read (~$0.001) vs a full-timeline reconcile (~$0.20–0.50, invariant
  // #5), and it runs IN this process — no token-rotation race, no write-lock.
  router.post('/posts/backfill', async (c) => {
    const body = await readJson<{ tweetId?: unknown }>(c.req.raw);
    const tweetId = body?.tweetId;
    if (!isTweetId(tweetId)) return c.json({ error: 'invalid_tweet_id' }, 400);

    let result: BackfillResult;
    try {
      const token = await getValidAccessToken({
        clientId: deps.clientId,
        clientSecret: deps.clientSecret,
      });
      result = await backfillTweet(token, tweetId);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error('backfill route failed:', detail);
      return c.json({ error: 'backfill_failed', detail }, 500);
    }
    if (result.status === 'not_found') return c.json(result, 404);
    return c.json(result);
  });

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

async function readJson<T = Body>(req: Request): Promise<T | null> {
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as T;
  } catch {
    return null;
  }
}

function parseMaxResults(value: unknown): number | undefined | 'invalid' {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return 'invalid';
  return Math.min(RECONCILE_HARD_CAP, Math.floor(value));
}
