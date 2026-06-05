// Public surface of the X platform slice. `app.ts` is the only outside caller —
// it wires routes via `mountX(app)` and starts in-process workers via
// `startXWorkers()`. Nothing else should import from inside `src/x/`.

import type { Hono } from 'hono';
import { makeOnCost } from '../middleware/costTracker.ts';
import { setDefaultOnCost } from './client.ts';
import { calendar } from './routes/calendar.ts';
import { metrics } from './routes/metrics.ts';
import { createPostsRouter } from './routes/posts.ts';
import { replies } from './routes/replies.ts';
import { createVoiceRouter } from './routes/voice.ts';
import { startDailyMetrics } from './workers/dailyMetrics.ts';
import { startPublisher } from './workers/publisher.ts';

interface XConfig {
  selfXUserId: string;
  clientId: string;
  clientSecret: string;
}

function loadConfig(): XConfig {
  return {
    selfXUserId: requireEnv('SELF_X_USER_ID'),
    clientId: requireEnv('X_CLIENT_ID'),
    clientSecret: requireEnv('X_CLIENT_SECRET'),
  };
}

export function mountX(app: Hono): void {
  const cfg = loadConfig();
  app.route('/x', calendar);
  app.route('/x', metrics);
  app.route('/x', createPostsRouter(cfg));
  app.route('/x', createVoiceRouter());
  // Grok-backed; refuse to mount when the key is missing — same shape as mountGrok.
  if (process.env.XAI_API_KEY) {
    app.route('/x', replies);
  } else {
    console.log('x/replies: XAI_API_KEY not set — /x/replies/* not mounted');
  }
}

export interface XWorkers {
  stop(): void;
}

export function startXWorkers(): XWorkers {
  // Install before any worker tick so the very first X call is logged.
  setDefaultOnCost(makeOnCost('x'));

  const cfg = loadConfig();
  const stops: Array<() => void> = [];

  stops.push(startPublisher(cfg));
  // One daily 03:00 UTC pass that discovers own tweets/replies and snapshots
  // each once at ~24h (replaces the old 60s metricsPoll + 24h ownReconcile).
  if (process.env.DAILY_METRICS_ENABLED !== 'false') {
    stops.push(startDailyMetrics(cfg));
  } else {
    console.log(
      'dailyMetrics: timer disabled via DAILY_METRICS_ENABLED=false (manual POST /x/posts/reconcile still works)',
    );
  }
  // The voice library is a pure DOM-scrape swipe file now — no X-API author
  // pulls or metrics polling, so there are no voice workers to start.

  return {
    stop() {
      for (const s of stops) s();
      setDefaultOnCost(null);
    },
  };
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}
