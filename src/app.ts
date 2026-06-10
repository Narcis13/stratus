// Top-level Hono app — platform-agnostic. Mounts shared routes (`/healthz`,
// later `/cost/*`) and per-platform routers (currently just `/x/*` via
// `mountX(app)` once Phase 1 calendar lands).
//
// `bun run src/app.ts` starts the server. Importing this module without
// running it (e.g. from tests) does NOT bind a port — see `import.meta.main`.

import { Hono } from 'hono';
import { mountGrok } from './grok/index.ts';
import { bearerAuth } from './middleware/auth.ts';
import { corsMiddleware } from './middleware/cors.ts';
import { cost } from './routes/cost.ts';
import { healthz } from './routes/healthz.ts';
import { mountX, startXWorkers } from './x/index.ts';

export const app = new Hono();

// CORS first — preflight OPTIONS must short-circuit before bearerAuth.
app.use('*', corsMiddleware());

app.route('/', healthz);

// Bearer guard on every API surface. `/healthz` is mounted above and stays public.
app.use('/x/*', bearerAuth());
app.use('/cost/*', bearerAuth());
app.use('/grok/*', bearerAuth());

app.route('/', cost);
mountX(app);
mountGrok(app);

if (import.meta.main) {
  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  const server = Bun.serve({ port, fetch: app.fetch });
  console.log(`stratus listening on http://127.0.0.1:${server.port}`);
  const workers = startXWorkers();

  // Graceful shutdown: stop timers, drain any in-flight worker tick, then exit.
  // Without this, a deploy restart can kill the process mid-createPost — the
  // tweet ships but the row stays 'publishing'/'pending' (double-post window).
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received — draining workers…`);
    // Backstop: systemd SIGKILLs at 90s; bail before then if a tick hangs.
    const force = setTimeout(() => {
      console.error('shutdown: drain timed out after 30s — exiting anyway');
      process.exit(1);
    }, 30_000);
    force.unref();
    void (async () => {
      await workers.stop();
      await server.stop();
      console.log('shutdown: clean exit');
      process.exit(0);
    })();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
