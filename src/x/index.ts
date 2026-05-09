// Public surface of the X platform slice. `app.ts` is the only outside caller —
// it wires routes via `mountX(app)` and starts in-process workers via
// `startXWorkers()`. Nothing else should import from inside `src/x/`.

import type { Hono } from 'hono';
import { makeOnCost } from '../middleware/costTracker.ts';
import { setDefaultOnCost } from './client.ts';
import { calendar } from './routes/calendar.ts';
import { metrics } from './routes/metrics.ts';
import { createPostsRouter } from './routes/posts.ts';
import { createVoiceRouter } from './routes/voice.ts';
import { startMetricsPoll } from './workers/metricsPoll.ts';
import { startOwnReconcile } from './workers/ownReconcile.ts';
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
  app.route('/x', createVoiceRouter({ clientId: cfg.clientId, clientSecret: cfg.clientSecret }));
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
  if (process.env.OWN_RECONCILE_ENABLED !== 'false') {
    stops.push(startOwnReconcile(cfg));
  } else {
    console.log(
      'ownReconcile: timer disabled via OWN_RECONCILE_ENABLED=false (manual POST /x/posts/reconcile still works)',
    );
  }
  if (process.env.METRICS_POLL_ENABLED !== 'false') {
    stops.push(startMetricsPoll({ clientId: cfg.clientId, clientSecret: cfg.clientSecret }));
  } else {
    console.log('metricsPoll: disabled via METRICS_POLL_ENABLED=false');
  }

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
