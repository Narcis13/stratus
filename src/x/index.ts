// Public surface of the X platform slice. `app.ts` is the only outside caller —
// it wires routes via `mountX(app)` and (later) starts in-process workers via
// `startXWorkers()`. Nothing else should import from inside `src/x/`.

import type { Hono } from 'hono';
import { calendar } from './routes/calendar.ts';

export function mountX(app: Hono): void {
  app.route('/x', calendar);
}
