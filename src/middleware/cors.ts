// CORS for the personal API. The Chrome extension sends `Authorization` on
// every call, which is a non-simple header → browser issues a preflight without
// the bearer token. Mount this BEFORE bearerAuth so OPTIONS short-circuits.
//
// Allowed origins:
//   - any `chrome-extension://*` (the unpacked-extension ID changes per install)
//   - comma-separated origins from `ALLOWED_ORIGINS` (deployed UI, future surfaces)

import type { MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';

export function corsMiddleware(): MiddlewareHandler {
  const staticOrigins = readStaticOriginsFromEnv();
  return cors({
    origin: (origin) => (matchOrigin(origin, staticOrigins) ? origin : null),
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  });
}

export function matchOrigin(origin: string, staticOrigins: ReadonlySet<string>): boolean {
  if (!origin) return false;
  if (origin.startsWith('chrome-extension://')) return true;
  return staticOrigins.has(origin);
}

function readStaticOriginsFromEnv(): ReadonlySet<string> {
  return new Set(
    (process.env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}
