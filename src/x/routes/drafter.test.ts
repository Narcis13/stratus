// AI.7 — thread drafter route guards + insert shape over the real (in-memory)
// SQLite DB (`bun run test` uses SQLITE_PATH=:memory:). The drafter router
// carries no auth of its own (the /x bearer is shared, covered by app.test), so
// it mounts on a bare Hono like prompts.test / niche.test. The pre-spend guards
// need no LLM key; the 503 test force-unsets BOTH provider keys so it never
// spends, even on a dev machine that has a key set (§7 / N.8 wizard discipline).

import { afterAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { scheduledPosts } from '../db/schema.ts';
import { calendar } from './calendar.ts';
import { drafter, insertThreadDraft } from './drafter.ts';

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
