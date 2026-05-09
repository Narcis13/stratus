// Postgres-backed single-row token store. Replaces the old .tokens.json file.
// One row, id='default'. Plaintext columns for now — when this becomes a
// multi-user app, swap for the AES-GCM/KMS pattern from
// X-API-IMPLEMENTATION-PLAN.md §4.4.

import { eq } from 'drizzle-orm';
import { db } from '../db/client.ts';
import type { TokenSet } from './auth.ts';
import { refreshTokens } from './auth.ts';
import { tokens } from './db/schema.ts';

const REFRESH_BUFFER_MS = 60_000; // refresh 60s before actual expiry
const ROW_ID = 'default';

export interface StoredTokens extends TokenSet {
  xUserId?: string;
  xUsername?: string;
  connectedAt: number;
  lastRefreshAt?: number;
}

export async function readStore(): Promise<StoredTokens | null> {
  const rows = await db.select().from(tokens).where(eq(tokens.id, ROW_ID)).limit(1);
  return rows[0] ? rowToStored(rows[0]) : null;
}

export async function writeStore(stored: StoredTokens): Promise<void> {
  const values = storedToRow(stored);
  await db.insert(tokens).values(values).onConflictDoUpdate({ target: tokens.id, set: values });
}

export async function deleteStore(): Promise<void> {
  await db.delete(tokens).where(eq(tokens.id, ROW_ID));
}

/**
 * Read tokens, refresh if expired, persist BEFORE returning the access token.
 *
 * Holds a `SELECT … FOR UPDATE` row lock across the refresh + write so two
 * concurrent callers can't both POST /oauth2/token with the same refresh_token.
 * X rotates the refresh_token on every call — the loser would 4xx and the new
 * token would never be persisted, locking the account out permanently.
 */
export async function getValidAccessToken(args: {
  clientId: string;
  clientSecret: string;
}): Promise<string> {
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(tokens).where(eq(tokens.id, ROW_ID)).for('update');
    const row = rows[0];
    if (!row) throw new Error(`no tokens row (id=${ROW_ID}) — run \`bun run auth\` first`);

    const stored = rowToStored(row);
    if (stored.expiresAt > Date.now() + REFRESH_BUFFER_MS) {
      return stored.accessToken;
    }

    const fresh = await refreshTokens({
      clientId: args.clientId,
      clientSecret: args.clientSecret,
      refreshToken: stored.refreshToken,
    });

    const next: StoredTokens = { ...stored, ...fresh, lastRefreshAt: Date.now() };

    await tx.update(tokens).set(storedToRow(next)).where(eq(tokens.id, ROW_ID));
    return next.accessToken;
  });
}

type TokenRow = typeof tokens.$inferSelect;
type TokenInsert = typeof tokens.$inferInsert;

function rowToStored(row: TokenRow): StoredTokens {
  const out: StoredTokens = {
    accessToken: row.accessToken,
    refreshToken: row.refreshToken,
    expiresAt: row.expiresAt.getTime(),
    scope: row.scope ?? '',
    connectedAt: (row.connectedAt ?? row.expiresAt).getTime(),
  };
  if (row.xUserId != null) out.xUserId = row.xUserId;
  if (row.xUsername != null) out.xUsername = row.xUsername;
  if (row.lastRefreshAt != null) out.lastRefreshAt = row.lastRefreshAt.getTime();
  return out;
}

function storedToRow(s: StoredTokens): TokenInsert {
  return {
    id: ROW_ID,
    accessToken: s.accessToken,
    refreshToken: s.refreshToken,
    expiresAt: new Date(s.expiresAt),
    scope: s.scope,
    xUserId: s.xUserId ?? null,
    xUsername: s.xUsername ?? null,
    connectedAt: new Date(s.connectedAt),
    lastRefreshAt: s.lastRefreshAt != null ? new Date(s.lastRefreshAt) : null,
  };
}
