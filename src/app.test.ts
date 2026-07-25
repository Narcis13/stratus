// Money-path request tests (§9.6) over the real composed app — bearer auth,
// CORS preflight, and the calendar/drafter validation guards. Every asserted
// path fails (or short-circuits) BEFORE its first DB query or X/Grok call, so
// `bun test` stays network-free. DB-backed end-to-end checks live in
// scripts/smoke-authoring.ts / smoke-targets.ts / smoke-mentions.ts.

import { describe, expect, test } from 'bun:test';
import { app } from './app.ts';

const TOKEN = process.env.API_TOKEN ?? '';
const authed = TOKEN !== '';
const AUTH = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };

function futureIso(): string {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString();
}

describe('bearer auth', () => {
  test('missing token → 401', async () => {
    const res = await app.request('/x/posts/scheduled');
    expect(res.status).toBe(401);
  });

  test('wrong token → 401', async () => {
    const res = await app.request('/x/posts/scheduled', {
      headers: { authorization: 'Bearer definitely-not-the-token' },
    });
    expect(res.status).toBe(401);
  });

  test('cost dashboard is guarded too', async () => {
    const res = await app.request('/cost/today');
    expect(res.status).toBe(401);
  });
});

describe('cors preflight', () => {
  test('chrome-extension origin short-circuits OPTIONS without a bearer', async () => {
    const res = await app.request('/x/posts/scheduled', {
      method: 'OPTIONS',
      headers: {
        origin: 'chrome-extension://abcdefghijklmnop',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(
      'chrome-extension://abcdefghijklmnop',
    );
  });

  test('unknown web origin gets no allow-origin header', async () => {
    const res = await app.request('/x/posts/scheduled', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://evil.example',
        'access-control-request-method': 'POST',
      },
    });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe.if(authed)('calendar guards (§8.2 / §6.5)', () => {
  test('pending post with URL → 400 url_in_text (the $0.20 surcharge guard)', async () => {
    const res = await app.request('/x/posts/scheduled', {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({
        text: 'new post, read this: https://example.com/article',
        scheduledFor: futureIso(),
        status: 'pending',
      }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('url_in_text');
  });

  test('thread head with URL → 400 url_in_text (link belongs in a tail segment)', async () => {
    const res = await app.request('/x/posts/threads', {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({
        segments: ['hook with https://example.com', 'second segment'],
        scheduledFor: futureIso(),
        status: 'pending',
      }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('url_in_text');
  });

  test('thread needs at least two segments', async () => {
    const res = await app.request('/x/posts/threads', {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({ segments: ['only one'] }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('thread_needs_two_segments');
  });

  test('thread pending without scheduledFor → 400', async () => {
    const res = await app.request('/x/posts/threads', {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({ segments: ['one', 'two'], status: 'pending' }),
    });
    expect(res.status).toBe(400);
  });

  test('create status cannot be worker-owned', async () => {
    const res = await app.request('/x/posts/scheduled', {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({ text: 'hi', status: 'posted' }),
    });
    expect(res.status).toBe(400);
  });
});

describe.if(authed && Boolean(process.env.XAI_API_KEY))('drafter guards (§8.1/§8.5)', () => {
  test('invalid pillar → 400 before any Grok spend', async () => {
    const res = await app.request('/x/posts/draft', {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({ pillar: 'growth-hacks' }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_pillar');
  });

  test('reup requires a numeric tweet id', async () => {
    const res = await app.request('/x/posts/reup', {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({ tweetId: 'not-a-tweet-id' }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_tweet_id');
  });

  test('AI.5: unknown provider → 400 before any LLM spend', async () => {
    const res = await app.request('/x/posts/draft', {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({ provider: 'gemini' }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_provider');
  });
});

describe.if(authed)('pillars guards (§8.6)', () => {
  test('invalid slug → 400 before any DB write', async () => {
    const res = await app.request('/x/pillars', {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({ slug: 'Bad Slug!', label: 'L', body: 'B' }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_slug');
  });

  test('missing label/body → 400', async () => {
    const res = await app.request('/x/pillars', {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({ slug: 'valid-slug' }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_label_or_body');
  });
});

describe.if(authed)('backfill guard', () => {
  test('non-numeric tweet id → 400 before any read or DB write', async () => {
    const res = await app.request('/x/posts/backfill', {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({ tweetId: 'not-a-tweet-id' }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_tweet_id');
  });

  test('missing tweet id → 400', async () => {
    const res = await app.request('/x/posts/backfill', {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe.if(authed && Boolean(process.env.XAI_API_KEY))('pillar draft guard (§8.6)', () => {
  test('invalid mode → 400 before any Grok spend', async () => {
    const res = await app.request('/x/pillars/draft', {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({ mode: 'sideways' }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_mode');
  });
});

describe.if(authed)('batch reply guards (Radar §7.2)', () => {
  test('non-array tweets → 400 invalid_tweets before any Grok spend', async () => {
    const res = await app.request('/x/replies/generate-batch', {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({ tweets: 'nope' }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_tweets');
  });

  test('empty tweets → 400 empty_tweets', async () => {
    const res = await app.request('/x/replies/generate-batch', {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({ tweets: [] }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('empty_tweets');
  });

  test('a non-numeric tweet id is rejected', async () => {
    const res = await app.request('/x/replies/generate-batch', {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({ tweets: [{ tweetId: 'abc', handle: 'a', text: 'x' }] }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_tweet_id_0');
  });

  test('AI.5: unknown provider → 400 before any LLM spend', async () => {
    const res = await app.request('/x/replies/generate-batch', {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({
        tweets: [{ tweetId: '123', handle: 'a', text: 'x' }],
        provider: 'gemini',
      }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_provider');
  });
});

describe.if(authed)('reply band gate (§7.3)', () => {
  const deadContext = {
    tweetId: '123456',
    handle: 'someone',
    author: 'Some One',
    text: 'a quiet post nobody saw',
    url: 'https://x.com/someone/status/123456',
    postedAt: new Date(Date.now() - 24 * 60 * 60_000).toISOString(),
    metrics: { views: 50, replies: 2, reposts: 0, likes: 1 },
    topComments: [],
  };

  // A dead post (old, tiny, not bait) refuses with 422 BEFORE any Grok spend —
  // and before the niche read (N0.4: refuse-before-work keeps this path
  // byte-identical to the pre-niche behavior).
  test('dead post without override → 422 band_gate', async () => {
    const res = await app.request('/x/replies/generate', {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({ context: deadContext }),
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe('band_gate');
  });

  test('AI.5: unknown provider → 400 invalid_provider, ahead of the band gate', async () => {
    const res = await app.request('/x/replies/generate', {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({ context: deadContext, provider: 'gemini' }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_provider');
  });
});
