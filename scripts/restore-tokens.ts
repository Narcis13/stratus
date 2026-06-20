// One-shot: restore the X OAuth token row into SQLite from a legacy .tokens.json,
// then refresh it (rotating + persisting the new refresh token BEFORE returning —
// invariant #3) and confirm the access token works against X with a single
// getMe ($0.001).
//
// RUN WITH THE SERVICE STOPPED. X rotates the refresh_token on every refresh and
// invalidates a reused one; the refresh must therefore happen in exactly one
// process. The in-process mutex in token-store only serializes within a process,
// not across the running service + this script.
//
//   TOKENS_FILE=./.tokens.json bun run scripts/restore-tokens.ts
//
// Requires X_CLIENT_ID + X_CLIENT_SECRET (and SQLITE_PATH, to hit the same DB the
// service uses) in the environment — on the server: `set -a && . ./.env && set +a`.

import { getMe } from '../src/x/endpoints.ts';
import {
  type StoredTokens,
  getValidAccessToken,
  readStore,
  writeStore,
} from '../src/x/token-store.ts';

const file = process.env.TOKENS_FILE ?? './.tokens.json';
const clientId = process.env.X_CLIENT_ID;
const clientSecret = process.env.X_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error('FATAL: X_CLIENT_ID / X_CLIENT_SECRET must be set (needed for the refresh call).');
  process.exit(1);
}

const raw = (await Bun.file(file)
  .json()
  .catch((e: unknown) => {
    console.error(`FATAL: cannot read ${file}: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  })) as Record<string, unknown>;

// Tolerate camelCase (current) and snake_case (older dumps).
const accessToken = (raw.accessToken ?? raw.access_token) as unknown;
const refreshToken = (raw.refreshToken ?? raw.refresh_token) as unknown;
const expiresAt = (raw.expiresAt ?? raw.expires_at) as unknown;
const scope = (raw.scope ?? '') as string;
const connectedAt = (raw.connectedAt ?? raw.connected_at ?? Date.now()) as number;
if (
  typeof accessToken !== 'string' ||
  typeof refreshToken !== 'string' ||
  typeof expiresAt !== 'number'
) {
  console.error(
    'FATAL: token file must have string accessToken/refreshToken and numeric expiresAt.',
  );
  process.exit(1);
}

const existing = await readStore();
if (existing) {
  console.log(
    `note: a token row already exists (xUsername=${existing.xUsername ?? '?'}); overwriting from file.`,
  );
}

const stored: StoredTokens = {
  accessToken,
  refreshToken,
  expiresAt,
  scope,
  connectedAt,
  ...(typeof raw.xUserId === 'string' ? { xUserId: raw.xUserId } : {}),
  ...(typeof raw.xUsername === 'string' ? { xUsername: raw.xUsername } : {}),
};
await writeStore(stored);
const expired = Date.now() > expiresAt;
const ageH = Math.round(Math.abs(Date.now() - expiresAt) / 3_600_000);
console.log(
  expired
    ? `seeded token row (access token expired ~${ageH}h ago → a refresh will fire).`
    : `seeded token row (access token still valid ~${ageH}h → verifying without a refresh).`,
);

let liveToken: string;
try {
  liveToken = await getValidAccessToken({ clientId, clientSecret });
} catch (e) {
  console.error('\nFATAL: token refresh FAILED — the refresh token is dead or already rotated.');
  console.error(e instanceof Error ? e.message : String(e));
  console.error('\n→ Re-authorize the account: run `bun run auth` and complete the OAuth flow.');
  process.exit(2);
}

const me = (await getMe(liveToken)) as {
  id: string;
  username: string;
  name: string;
  public_metrics?: { followers_count: number; following_count: number; tweet_count: number };
};
console.log(`\nX API LIVE ✓  @${me.username} (id ${me.id}) — "${me.name}"`);
if (me.public_metrics) {
  const m = me.public_metrics;
  console.log(
    `followers=${m.followers_count} following=${m.following_count} tweets=${m.tweet_count}`,
  );
}

const after = await readStore();
const refreshed = after != null && after.expiresAt !== expiresAt;
const until = after?.expiresAt ? new Date(after.expiresAt).toISOString() : '?';
if (refreshed) {
  console.log(
    `\nrefresh fired — rotated refresh token persisted before return (invariant #3); valid until ${until}.`,
  );
  console.log(
    'DONE. The source token file is now STALE (its refresh token was rotated) — do not re-import it.',
  );
} else {
  console.log(`\ntoken was still fresh — no refresh needed; valid until ${until}.`);
  console.log('DONE. The stored row matches the source file (no rotation occurred).');
}
process.exit(0);
