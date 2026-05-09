// Scratchpad for hitting X with your stored token.
// `bun run play` — runs end-to-end. Edit freely; it's not a test.

import { createPost, getMe, searchRecent } from './endpoints.ts';
import { getValidAccessToken } from './token-store.ts';

const token = await getValidAccessToken({
  clientId: requireEnv('X_CLIENT_ID'),
  clientSecret: requireEnv('X_CLIENT_SECRET'),
});

console.log('--- getMe ---');
const me = await getMe(token);
console.log(me);

console.log('\n--- searchRecent (3 results) ---');
let n = 0;
for await (const tweet of searchRecent(token, 'from:elonmusk -is:retweet', { maxResults: 3 })) {
  console.log(`@${tweet.author_id} ${tweet.created_at}\n  ${tweet.text}\n`);
  if (++n >= 3) break;
}

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
