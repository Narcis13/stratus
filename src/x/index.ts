// Public surface of the X platform slice. `app.ts` is the only outside caller —
// it wires routes via `mountX(app)` and starts in-process workers via
// `startXWorkers()`. Nothing else should import from inside `src/x/`.

import type { Hono } from 'hono';
import { makeOnCost } from '../middleware/costTracker.ts';
import { setDefaultOnCost } from './client.ts';
import { calendar } from './routes/calendar.ts';
import { metrics } from './routes/metrics.ts';
import { createPostsRouter } from './routes/posts.ts';
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
  app.route('/x', calendar);
  app.route('/x', metrics);
  app.route('/x', createPostsRouter(loadConfig()));
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
  stops.push(startOwnReconcile(cfg));
  stops.push(startMetricsPoll({ clientId: cfg.clientId, clientSecret: cfg.clientSecret }));

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
