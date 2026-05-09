// Public surface of the X platform slice. `app.ts` is the only outside caller —
// it wires routes via `mountX(app)` and starts in-process workers via
// `startXWorkers()`. Nothing else should import from inside `src/x/`.

import type { Hono } from 'hono';
import { makeOnCost } from '../middleware/costTracker.ts';
import { setDefaultOnCost } from './client.ts';
import { calendar } from './routes/calendar.ts';
import { startPublisher } from './workers/publisher.ts';

export function mountX(app: Hono): void {
  app.route('/x', calendar);
}

export interface XWorkers {
  stop(): void;
}

export function startXWorkers(): XWorkers {
  // Install before any worker tick so the very first X call is logged.
  setDefaultOnCost(makeOnCost('x'));

  const stops: Array<() => void> = [];

  stops.push(
    startPublisher({
      selfXUserId: requireEnv('SELF_X_USER_ID'),
      clientId: requireEnv('X_CLIENT_ID'),
      clientSecret: requireEnv('X_CLIENT_SECRET'),
    }),
  );

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
