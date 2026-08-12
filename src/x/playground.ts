// Scratchpad for hitting X with your stored token.
// `bun run play` — runs end-to-end. Edit freely; it's not a test.
//
// Only getMe and createPost are left: every billed READ endpoint was deleted
// 2026-08-12 (CLAUDE.md invariant #8), so there is nothing else to poke at.

import { createPost, getMe } from './endpoints.ts';
import { getValidAccessToken } from './token-store.ts';

const token = await getValidAccessToken({
  clientId: requireEnv('X_CLIENT_ID'),
  clientSecret: requireEnv('X_CLIENT_SECRET'),
});

console.log('--- getMe ---');
const me = await getMe(token);
console.log(me);

// Uncomment to test posting. Costs $0.015 (or $0.20 if you sneak in a URL).
//
// console.log('\n--- createPost ---');
// const post = await createPost(token, { text: 'hello from stratus thin layer' });
// console.log(post);

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`missing env: ${key}`);
  return v;
}
