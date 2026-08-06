// The discovery pull's reply exclusion — a COST lever, so it gets the same
// URL-level scrutiny as the mention pager (invariant #5: X bills every result in
// the response body, so the only place a reply can be made free is the request).
//
// Why it exists: under the Cannon the account types 100+ manual replies a day
// and each one billed $0.001 on the 03:00 pull — ~$0.10/pass and rising, for
// numbers the $0 DOM harvest measures better (it carries parent views, parent
// reply count and latency; the API returns none of those). A manual
// `POST /posts/reconcile` re-billed the same tweets on top of that, because the
// once-only retire guarantee protects the DB, not the wallet.
//
// These tests stub globalThis.fetch and assert the built URL, because that URL
// IS the invoice. Two of them are deliberately negative: `exclude` must be
// ABSENT unless asked for, and turning it on must not touch the max_results
// clamp — the two knobs bill independently and a regression in either is money.

import { afterAll, describe, expect, test } from 'bun:test';
import { getUserTweets } from './endpoints.ts';
import { settingsByGroup, settingsRegistry } from './settings/registry.ts';

const SELF = '999';
const seenRequests: URL[] = [];
const realFetch = globalThis.fetch;

// One empty page — these tests assert the REQUEST, never the parsing.
const stub = ((input: string | URL | Request) => {
  seenRequests.push(
    new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url),
  );
  return Promise.resolve(
    new Response(JSON.stringify({ data: [], meta: { result_count: 0 } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}) as typeof globalThis.fetch;

async function drain(opts: Parameters<typeof getUserTweets>[2]): Promise<URL> {
  seenRequests.length = 0;
  globalThis.fetch = stub;
  try {
    for await (const _ of getUserTweets('tok', SELF, opts)) {
      // empty fixture — the loop exists to run the generator to completion
    }
  } finally {
    globalThis.fetch = realFetch;
  }
  const [url] = seenRequests;
  if (!url) throw new Error('no request was made');
  return url;
}

afterAll(() => {
  globalThis.fetch = realFetch;
});

describe('getUserTweets exclude=replies (the discovery cost lever)', () => {
  test('excludeReplies sends exclude=replies — the replies are never in the body, so never billed', async () => {
    const url = await drain({ excludeReplies: true, maxResults: 100 });
    expect(url.pathname).toBe(`/2/users/${SELF}/tweets`);
    expect(url.searchParams.get('exclude')).toBe('replies');
  });

  test('absent by default — the knob must be the only thing that stops paying for replies', async () => {
    const url = await drain({ maxResults: 100 });
    expect(url.searchParams.has('exclude')).toBe(false);
  });

  test('exclusion does not disturb the max_results clamp (invariant #5, independent lever)', async () => {
    const url = await drain({ excludeReplies: true, maxResults: 7 });
    // Clamped up to X's floor of 5 → 7, NOT widened to the 100 default.
    expect(url.searchParams.get('max_results')).toBe('7');
    expect(url.searchParams.get('exclude')).toBe('replies');
  });

  test('rides alongside since_id and the private metric fields — the pull is still the snapshot', async () => {
    const url = await drain({ excludeReplies: true, sinceId: '1234', ownedPrivate: true });
    expect(url.searchParams.get('exclude')).toBe('replies');
    expect(url.searchParams.get('since_id')).toBe('1234');
    expect(url.searchParams.get('tweet.fields')).toContain('non_public_metrics');
  });
});

describe('x.workers.discoveryExcludeReplies', () => {
  const KEY = 'x.workers.discoveryExcludeReplies';

  test('defaults ON — the reply-heavy pull is the expensive path, so opting IN to it is the deliberate act', () => {
    const def = settingsByGroup()
      .find((g) => g.id === 'workers')
      ?.defs.find((d) => d.key === KEY);
    expect(def?.type).toBe('boolean');
    expect(def?.default).toBe(true);
    // Server-only: it changes what a worker buys, and nothing in the panel
    // gates on it client-side.
    expect(def?.scope).toBe('server');
    expect(settingsRegistry.get(KEY)?.default).toBe(true);
  });

  test('rejects a non-boolean so a stray "false" string cannot silently re-enable the spend', () => {
    expect(settingsRegistry.validate(KEY, false)).toBeNull();
    expect(settingsRegistry.validate(KEY, 'false')).toBe('not_a_boolean');
    expect(settingsRegistry.validate(KEY, 0)).toBe('not_a_boolean');
  });
});
