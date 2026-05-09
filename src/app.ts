// Top-level Hono app — platform-agnostic. Mounts shared routes (`/healthz`,
// later `/cost/*`) and per-platform routers (currently just `/x/*` via
// `mountX(app)` once Phase 1 calendar lands).
//
// `bun run src/app.ts` starts the server. Importing this module without
// running it (e.g. from tests) does NOT bind a port — see `import.meta.main`.

import { Hono } from 'hono';
import { bearerAuth } from './middleware/auth.ts';
import { healthz } from './routes/healthz.ts';
import { mountX } from './x/index.ts';

export const app = new Hono();

app.route('/', healthz);

// Bearer guard on every API surface. `/healthz` is mounted above and stays public.
app.use('/x/*', bearerAuth());
app.use('/cost/*', bearerAuth());

mountX(app);

if (import.meta.main) {
  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  const server = Bun.serve({ port, fetch: app.fetch });
  console.log(`stratus listening on http://127.0.0.1:${server.port}`);
}
