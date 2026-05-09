// Tiny OAuth callback server. `bun run auth`, then visit /auth/x/start.
// Persists tokens to the Postgres `tokens` row (id='default') so the rest of
// the app — playground, workers, routes — can read them.
//
// Single-user dev tool. Don't deploy this — multi-user needs encryption,
// per-user storage, signed cookie state, CSRF, etc.

import {
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  generatePkcePair,
  revokeToken,
  SCOPES,
} from './auth.ts';
import { deleteStore, readStore, writeStore } from './token-store.ts';

const env = {
  clientId: requireEnv('X_CLIENT_ID'),
  clientSecret: requireEnv('X_CLIENT_SECRET'),
  redirectUri: requireEnv('X_OAUTH_REDIRECT_URI'),
  port: Number.parseInt(process.env.PORT ?? '3000', 10),
};

// In-memory state: `state → codeVerifier`. Restart the server = invalidate flows.
const pending = new Map<string, string>();

const server = Bun.serve({
  port: env.port,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === '/' || url.pathname === '/auth/x/start') {
      const { codeVerifier, codeChallenge } = await generatePkcePair();
      const state = crypto.randomUUID();
      pending.set(state, codeVerifier);
      // Auto-expire pending state after 5 minutes.
      setTimeout(() => pending.delete(state), 5 * 60_000);

      const authorizeUrl = buildAuthorizeUrl({
        clientId: env.clientId,
        redirectUri: env.redirectUri,
        state,
        codeChallenge,
      });
      return Response.redirect(authorizeUrl, 302);
    }

    if (url.pathname === '/auth/x/callback') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');
      if (error) return text(`X returned error: ${error}`, 400);
      if (!code || !state) return text('missing code or state', 400);

      const codeVerifier = pending.get(state);
      if (!codeVerifier) return text('unknown or expired state', 400);
      pending.delete(state);

      try {
        const tokens = await exchangeCodeForTokens({
          clientId: env.clientId,
          clientSecret: env.clientSecret,
          code,
          redirectUri: env.redirectUri,
          codeVerifier,
        });

        await writeStore({
          ...tokens,
          connectedAt: Date.now(),
        });

        return text(
          `✓ Connected. Tokens written to Postgres (tokens.id='default').\nScopes: ${tokens.scope}\n\nYou can close this tab and run \`bun run play\`.`,
        );
      } catch (err) {
        console.error(err);
        return text(`token exchange failed: ${(err as Error).message}`, 500);
      }
    }

    if (url.pathname === '/auth/x/disconnect' && req.method === 'POST') {
      const stored = await readStore();
      if (!stored) return text('no tokens stored', 404);
      await revokeToken({
        clientId: env.clientId,
        clientSecret: env.clientSecret,
        token: stored.refreshToken,
        tokenTypeHint: 'refresh_token',
      });
      await deleteStore();
      return text('disconnected');
    }

    return text('not found', 404);
  },
});

console.log(`auth server listening on http://127.0.0.1:${server.port}`);
console.log(`open http://127.0.0.1:${server.port}/auth/x/start to connect`);
console.log(`scopes: ${SCOPES.join(' ')}`);

function text(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) {
    console.error(`missing env var: ${key}. copy .env.example → .env and fill it in.`);
    process.exit(1);
  }
  return v;
}
