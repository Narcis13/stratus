// Bearer-token guard for the personal API. One shared secret in env (API_TOKEN);
// every protected route compares the Authorization header against it. Constant-time
// compare so a probing attacker can't infer the token from response timing.

import type { MiddlewareHandler } from 'hono';

export function bearerAuth(): MiddlewareHandler {
  const token = process.env.API_TOKEN;
  if (!token) throw new Error('API_TOKEN is required');
  const expected = `Bearer ${token}`;

  return async (c, next) => {
    const header = c.req.header('Authorization') ?? '';
    if (!timingSafeEqual(header, expected)) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    await next();
  };
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
