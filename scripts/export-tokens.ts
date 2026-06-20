// Dump the local SQLite token row to a JSON file shaped like the legacy
// .tokens.json, so a freshly-authorized token (from `bun run auth`) can be
// shipped to the production server and imported with scripts/restore-tokens.ts.
//
// Fresh tokens are still valid (~2h), so restore-tokens.ts won't refresh them on
// import — it just seeds the row and confirms with getMe. Move the file ONCE and
// don't keep running the local service against these tokens (it would rotate the
// refresh token out from under the server — invariant #3).
//
//   SQLITE_PATH=./stratus.db bun run scripts/export-tokens.ts [outfile]
//   (default outfile: ./.tokens.export.json)

import { readStore } from '../src/x/token-store.ts';

const out = process.argv[2] ?? './.tokens.export.json';
const stored = await readStore();
if (!stored) {
  console.error('FATAL: no token row in the local DB — run `bun run auth` first.');
  process.exit(1);
}

await Bun.write(
  out,
  `${JSON.stringify(
    {
      accessToken: stored.accessToken,
      refreshToken: stored.refreshToken,
      expiresAt: stored.expiresAt,
      scope: stored.scope,
      connectedAt: stored.connectedAt,
      ...(stored.xUserId ? { xUserId: stored.xUserId } : {}),
      ...(stored.xUsername ? { xUsername: stored.xUsername } : {}),
    },
    null,
    2,
  )}\n`,
);
// chmod 600 — it holds live credentials.
await Bun.$`chmod 600 ${out}`.quiet().catch(() => {});
const validFor = Math.round((stored.expiresAt - Date.now()) / 60_000);
console.log(`wrote ${out} (access token valid ~${validFor} min; @${stored.xUsername ?? '?'}).`);
process.exit(0);
