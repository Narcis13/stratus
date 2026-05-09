// Local single-user token store. JSON file, gitignored.
// Plain text for now — fine for one developer. When this becomes a multi-user
// app, swap for the AES-GCM/KMS pattern from X-API-IMPLEMENTATION-PLAN.md §4.4.

import type { TokenSet } from './auth.ts';
import { refreshTokens } from './auth.ts';

const REFRESH_BUFFER_MS = 60_000; // refresh 60s before actual expiry

interface StoredTokens extends TokenSet {
  xUserId?: string;
  xUsername?: string;
  connectedAt: number;
  lastRefreshAt?: number;
}

export async function readStore(path: string): Promise<StoredTokens | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  return (await file.json()) as StoredTokens;
}

export async function writeStore(path: string, tokens: StoredTokens): Promise<void> {
  await Bun.write(path, `${JSON.stringify(tokens, null, 2)}\n`);
}

/**
 * Read tokens, refresh if expired, persist the new set BEFORE returning the access token.
 * If persistence fails, the new refresh token would be lost — we throw instead.
 */
export async function getValidAccessToken(args: {
  storePath: string;
  clientId: string;
  clientSecret: string;
}): Promise<string> {
  const stored = await readStore(args.storePath);
  if (!stored) throw new Error(`no tokens at ${args.storePath} — run \`bun run auth\` first`);

  if (stored.expiresAt > Date.now() + REFRESH_BUFFER_MS) {
    return stored.accessToken;
  }

  const fresh = await refreshTokens({
    clientId: args.clientId,
    clientSecret: args.clientSecret,
    refreshToken: stored.refreshToken,
  });

  // Persist BEFORE returning — see §3.3 in CLAUDE.md / §4.3 in the X plan.
  const next: StoredTokens = {
    ...stored,
    ...fresh,
    lastRefreshAt: Date.now(),
  };
  await writeStore(args.storePath, next);
  return next.accessToken;
}
