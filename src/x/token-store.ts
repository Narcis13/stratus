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

// Serializes the refresh+persist critical section. The old Postgres path held a
// `SELECT … FOR UPDATE` row lock across the network refresh — impossible on the
// synchronous SQLite driver (you can't keep a transaction open across an await).
// Single process now, so an in-process promise chain is the correct lock: it
// guarantees two concurrent callers can't both POST /oauth2/token with the same
// rotating refresh_token (the loser would 4xx and its new token would be lost,
// locking the account out permanently — invariant #3).
let refreshGate: Promise<unknown> = Promise.resolve();

function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  // Chain regardless of the previous run's outcome; keep the tail non-rejecting
  // so one failed refresh can't poison the gate for every later caller.
  const run = refreshGate.then(fn, fn);
  refreshGate = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Read tokens, refresh if expired, persist BEFORE returning the access token.
 * The persist-before-return ordering is invariant #3: X rotates the
 * refresh_token on every refresh, so the new one must hit disk before we hand
 * back the access token.
 */
export async function getValidAccessToken(args: {
  clientId: string;
  clientSecret: string;
}): Promise<string> {
  const current = await readStore();
  if (!current) throw new Error(`no tokens row (id=${ROW_ID}) — run \`bun run auth\` first`);
  if (current.expiresAt > Date.now() + REFRESH_BUFFER_MS) return current.accessToken;

  return runExclusive(async () => {
    // Re-read inside the critical section — a queued refresh may have already
    // rotated the token while we waited on the gate.
    const latest = await readStore();
    if (!latest) throw new Error(`no tokens row (id=${ROW_ID}) — run \`bun run auth\` first`);
    if (latest.expiresAt > Date.now() + REFRESH_BUFFER_MS) return latest.accessToken;

    const fresh = await refreshTokens({
      clientId: args.clientId,
      clientSecret: args.clientSecret,
      refreshToken: latest.refreshToken,
    });

    const next: StoredTokens = { ...latest, ...fresh, lastRefreshAt: Date.now() };
    await writeStore(next); // persist the rotated refresh token BEFORE returning
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
