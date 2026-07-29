// AI.7 — thread drafter route guards + insert shape over the real (in-memory)
// SQLite DB (`bun run test` uses SQLITE_PATH=:memory:). The drafter router
// carries no auth of its own (the /x bearer is shared, covered by app.test), so
// it mounts on a bare Hono like prompts.test / niche.test. The pre-spend guards
// need no LLM key; the 503 test force-unsets BOTH provider keys so it never
// spends, even on a dev machine that has a key set (§7 / N.8 wizard discipline).

import { afterAll, describe, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { metricsSnapshots, postsPublished, scheduledPosts } from '../db/schema.ts';
import { calendar } from './calendar.ts';
import { drafter, insertThreadDraft, topWinners } from './drafter.ts';

const app = new Hono();
app.route('/x', drafter);
app.route('/x', calendar);

const createdThreadIds: string[] = [];
afterAll(() => {
  for (const id of createdThreadIds) {
    db.delete(scheduledPosts).where(eq(scheduledPosts.threadId, id)).run();
  }
});

async function post<T>(path: string, body: unknown): Promise<{ status: number; body: T }> {
  const res = await app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}

describe('draft-thread route guards (AI.7)', () => {
  test('invalid tweetCount → 400 before any LLM spend', async () => {
    const { status, body } = await post<{ error: string }>('/x/posts/draft-thread', {
      tweetCount: 'many',
    });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_tweet_count');
  });

  test('unknown provider → 400 before any LLM spend', async () => {
    const { status, body } = await post<{ error: string }>('/x/posts/draft-thread', {
      provider: 'gemini',
    });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_provider');
  });

  test('no LLM configured → 503 llm_not_configured (refuse before spend)', async () => {
    const xai = process.env.XAI_API_KEY;
    const openrouter = process.env.OPENROUTER_API_KEY;
    process.env.XAI_API_KEY = '';
    process.env.OPENROUTER_API_KEY = '';
    try {
      const { status, body } = await post<{ error: string }>('/x/posts/draft-thread', {
        idea: 'a real steer that would otherwise spend',
      });
      expect(status).toBe(503);
      expect(body.error).toBe('llm_not_configured');
    } finally {
      process.env.XAI_API_KEY = xai ?? '';
      process.env.OPENROUTER_API_KEY = openrouter ?? '';
    }
  });
});

describe('rewrite route guards (AI.8)', () => {
  test('empty text → 400 before any LLM spend', async () => {
    const { status, body } = await post<{ error: string }>('/x/posts/rewrite', { text: '   ' });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_text');
  });

  test('oversized text → 400 before any LLM spend', async () => {
    const { status, body } = await post<{ error: string }>('/x/posts/rewrite', {
      text: 'x'.repeat(2001),
    });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_text');
  });

  test('oversized instruction → 400 before any LLM spend', async () => {
    const { status, body } = await post<{ error: string }>('/x/posts/rewrite', {
      text: 'a real draft',
      instruction: 'x'.repeat(501),
    });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_instruction');
  });

  test('unknown provider → 400 before any LLM spend', async () => {
    const { status, body } = await post<{ error: string }>('/x/posts/rewrite', {
      text: 'a real draft',
      provider: 'gemini',
    });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_provider');
  });

  test('no LLM configured → 503 llm_not_configured (refuse before spend)', async () => {
    const xai = process.env.XAI_API_KEY;
    const openrouter = process.env.OPENROUTER_API_KEY;
    process.env.XAI_API_KEY = '';
    process.env.OPENROUTER_API_KEY = '';
    try {
      const { status, body } = await post<{ error: string }>('/x/posts/rewrite', {
        text: 'a draft that would otherwise spend',
      });
      expect(status).toBe(503);
      expect(body.error).toBe('llm_not_configured');
    } finally {
      process.env.XAI_API_KEY = xai ?? '';
      process.env.OPENROUTER_API_KEY = openrouter ?? '';
    }
  });
});

// JD.1 — the few-shot block must not fill up with the drafter's own output.
// Fixtures sit 400 days back (clear of every brief/digest/monitor window and of
// the spoken-for calendar day bands) and carry absurd view counts so they rank
// above every other suite's rows in the shared in-memory DB; the seeds are torn
// down inside the test itself, not just in afterAll, so no other file ever sees
// them. Published rows are written `retired: true` (NT.7) — an un-retired seed
// is a candidate for the daily *billed* metrics pass.
describe('topWinners provenance dilution (JD.1)', () => {
  const OLD = new Date(Date.now() - 400 * 24 * 60 * 60_000);
  const seeds = [
    { tweetId: 'jd1-m-a', text: 'JD1 machine A', views: 9_000_003, source: 'drafter' },
    { tweetId: 'jd1-m-b', text: 'JD1 machine B', views: 9_000_002, source: 'drafter' },
    { tweetId: 'jd1-m-c', text: 'JD1 machine C', views: 9_000_001, source: 'drafter' },
    { tweetId: 'jd1-h-api', text: 'JD1 hand-written (api row)', views: 9_000_000, source: 'api' },
    // No scheduled row at all — posted off stratus, discovered by the pull.
    { tweetId: 'jd1-h-none', text: 'JD1 hand-written (no row)', views: 8_999_999, source: null },
  ];
  const ids = seeds.map((s) => s.tweetId);

  async function seed(rows: typeof seeds): Promise<void> {
    await db.insert(postsPublished).values(
      rows.map((s) => ({
        tweetId: s.tweetId,
        text: s.text,
        postedAt: OLD,
        isReply: false,
        source: 'scheduled',
        retired: true,
      })),
    );
    await db.insert(metricsSnapshots).values(
      rows.map((s) => ({
        tweetId: s.tweetId,
        snapshotAt: OLD,
        publicMetrics: { impression_count: s.views, like_count: 1 },
      })),
    );
    const scheduled = rows.flatMap((s) =>
      s.source
        ? [{ text: s.text, status: 'posted', source: s.source, postedTweetId: s.tweetId }]
        : [],
    );
    await db.insert(scheduledPosts).values(scheduled);
  }

  async function teardown(): Promise<void> {
    await db.delete(metricsSnapshots).where(inArray(metricsSnapshots.tweetId, ids));
    await db.delete(postsPublished).where(inArray(postsPublished.tweetId, ids));
    await db.delete(scheduledPosts).where(inArray(scheduledPosts.postedTweetId, ids));
  }

  afterAll(teardown);

  test('caps drafter-authored anchors and keeps the hand-written ones', async () => {
    await seed(seeds);
    try {
      const winners = await topWinners();
      const texts = winners.map((w) => w.text);

      // Both hand-written posts survive even though all three machine posts
      // outperformed them.
      expect(texts).toContain('JD1 hand-written (api row)');
      expect(texts).toContain('JD1 hand-written (no row)');
      // The cap bites on the *lowest*-viewed machine post, not on an arbitrary one.
      expect(texts).not.toContain('JD1 machine C');
      expect(texts.filter((t) => t.startsWith('JD1 machine'))).toEqual([
        'JD1 machine A',
        'JD1 machine B',
      ]);

      // A tighter limit still spends its slots the same way: two machine rows,
      // then the best hand-written one.
      const three = await topWinners(3);
      expect(three.map((w) => w.text)).toEqual([
        'JD1 machine A',
        'JD1 machine B',
        'JD1 hand-written (api row)',
      ]);
    } finally {
      await teardown();
    }
  });

  test('an all-machine history contributes at most two anchors, never three', async () => {
    // The cap is a cap, not a quota: with nothing hand-written to promote, the
    // block gets shorter rather than filling up with the drafter's own voice.
    await seed(seeds.slice(0, 3));
    try {
      const winners = await topWinners(3);
      // Foreign rows from other suites may take the freed third slot — assert
      // over MY seeds, which are the top three by views either way.
      expect(winners.map((w) => w.text).filter((t) => t.startsWith('JD1'))).toEqual([
        'JD1 machine A',
        'JD1 machine B',
      ]);
    } finally {
      await teardown();
    }
  });
});

describe('insertThreadDraft (AI.7)', () => {
  test('lands a draft head + segment tails sharing a threadId; GET returns siblings', async () => {
    const { threadId, rows } = await insertThreadDraft('ai-craft', ['hook', 'body one', 'payoff']);
    createdThreadIds.push(threadId);

    expect(rows).toHaveLength(3);
    const head = rows[0];
    expect(head?.status).toBe('draft');
    expect(head?.threadPosition).toBe(1);
    expect(head?.source).toBe('drafter');
    expect(head?.pillar).toBe('ai-craft');
    expect(head?.scheduledFor).toBeNull();
    expect(rows[1]?.status).toBe('segment');
    expect(rows[1]?.threadPosition).toBe(2);
    expect(rows[2]?.status).toBe('segment');
    expect(rows.every((r) => r.threadId === threadId)).toBe(true);

    // Done-when: GET /posts/scheduled/:id returns the thread with siblings.
    const res = await app.request(`/x/posts/scheduled/${head?.id}`);
    expect(res.status).toBe(200);
    const detail = (await res.json()) as { threadId: string | null; thread?: unknown[] };
    expect(detail.threadId).toBe(threadId);
    expect(detail.thread).toHaveLength(3);
  });
});
