// RC.3 — `POST /x/replies/curate` guards + the keep-target clamp. The replies
// router carries no auth of its own (the /x bearer is shared, covered by
// app.test) and refuses to MOUNT without an LLM key in the composed app (§7.22),
// so it mounts here on a bare Hono like judge.test / drafter.test — which is
// also what makes these run on a machine with no keys and no API_TOKEN, unlike
// the batch guards in app.test.ts.
//
// NOTHING HERE MAY SPEND. Every 400 is refused before the call by construction
// (§7.4); the two tests that walk the whole ladder force-unset BOTH provider
// keys in a `finally` so they 503 even on a dev machine with a key set —
// reaching `llm_not_configured` IS the proof the request got all the way to the
// LLM layer without a network call happening.

import { afterAll, describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { radarDrafts } from '../db/schema.ts';
import { MAX_CURATE_TWEETS } from '../replies/curate.ts';
import { resetSettings, setSettings } from '../settings/registry.ts';
import { curateKeepTarget, replies } from './replies.ts';

const app = new Hono();
app.route('/x', replies);

afterAll(() => {
  resetSettings({ keys: ['x.radar.curatedCount', 'x.ai.batchReplyCap'] });
});

async function curate<T>(body: unknown): Promise<{ status: number; body: T }> {
  const res = await app.request('/x/replies/curate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}

/** A tweet the validator accepts — ids are numeric, handles ≤15 chars. */
function tweet(n: number): Record<string, unknown> {
  return {
    tweetId: String(1000000 + n),
    handle: `person${n}`,
    author: `Person ${n}`,
    text: `A post worth grading, number ${n}.`,
  };
}

/** Run `fn` with both provider keys unset, so the LLM layer refuses. */
async function withNoLlm<T>(fn: () => Promise<T>): Promise<T> {
  const xai = process.env.XAI_API_KEY;
  const openrouter = process.env.OPENROUTER_API_KEY;
  process.env.XAI_API_KEY = '';
  process.env.OPENROUTER_API_KEY = '';
  try {
    return await fn();
  } finally {
    process.env.XAI_API_KEY = xai ?? '';
    process.env.OPENROUTER_API_KEY = openrouter ?? '';
  }
}

describe('POST /x/replies/curate guards (RC.3) — all refuse before any spend', () => {
  test('non-object body → 400 invalid_body', async () => {
    const { status, body } = await curate<{ error: string }>(['not', 'an', 'object']);
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_body');
  });

  test('non-array tweets → 400 invalid_tweets', async () => {
    const { status, body } = await curate<{ error: string }>({ tweets: 'nope' });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_tweets');
  });

  test('empty tweets → 400 empty_tweets', async () => {
    const { status, body } = await curate<{ error: string }>({ tweets: [] });
    expect(status).toBe(400);
    expect(body.error).toBe('empty_tweets');
  });

  // The cap here is the radar ring buffer (100), NOT `x.ai.batchReplyCap` (25):
  // a queue bigger than what we will draft is the precondition for curating at
  // all, so borrowing the batch route's cap would refuse every call worth making.
  test(`${MAX_CURATE_TWEETS + 1} tweets → 400 too_many_tweets`, async () => {
    const tweets = Array.from({ length: MAX_CURATE_TWEETS + 1 }, (_, i) => tweet(i));
    const { status, body } = await curate<{ error: string }>({ tweets });
    expect(status).toBe(400);
    expect(body.error).toBe('too_many_tweets');
  });

  test('a non-numeric tweet id is rejected, indexed', async () => {
    const { status, body } = await curate<{ error: string }>({
      tweets: [tweet(0), { tweetId: 'abc', handle: 'someone', text: 'x' }],
    });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_tweet_id_1');
  });

  test('an empty tweet text is rejected', async () => {
    const { status, body } = await curate<{ error: string }>({
      tweets: [{ tweetId: '123', handle: 'someone', text: '   ' }],
    });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_tweet_text_0');
  });

  test('empty model → 400 invalid_model', async () => {
    const { status, body } = await curate<{ error: string }>({ tweets: [tweet(0)], model: '  ' });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_model');
  });

  test('unknown provider → 400 invalid_provider', async () => {
    const { status, body } = await curate<{ error: string }>({
      tweets: [tweet(0)],
      provider: 'gemini',
    });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_provider');
  });

  test('unknown reasoning effort → 400 invalid_reasoning_effort', async () => {
    const { status, body } = await curate<{ error: string }>({
      tweets: [tweet(0)],
      reasoningEffort: 'extreme',
    });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_reasoning_effort');
  });

  // Body validation runs in generate-batch's order — tweets first, then the LLM
  // params — so a request that is wrong twice reports the tweet, never the model.
  test('a bad tweet outranks a bad provider — the ladder order is the batch route one', async () => {
    const { status, body } = await curate<{ error: string }>({
      tweets: [{ tweetId: 'abc', handle: 'someone', text: 'x' }],
      provider: 'gemini',
    });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_tweet_id_0');
  });

  test('the full ladder passes and stops at the LLM gate — nothing spent, nothing written', async () => {
    const before = db.select().from(radarDrafts).all().length;
    const { status, body } = await withNoLlm(() =>
      curate<{ error: string }>({
        tweets: [tweet(0), tweet(1), tweet(2)],
        model: 'grok-4-fast',
        provider: 'grok',
        reasoningEffort: 'low',
      }),
    );
    expect(status).toBe(503);
    expect(body.error).toBe('llm_not_configured');
    // The route persists NOTHING by contract: the queue is the extension's
    // session buffer, and the score only reaches the DB on the follow-up
    // generate-batch call. A row here would mean that contract moved.
    expect(db.select().from(radarDrafts).all()).toHaveLength(before);
  });

  test(`a full ${MAX_CURATE_TWEETS}-tweet queue is accepted — the cap is a ceiling, not the batch size`, async () => {
    const tweets = Array.from({ length: MAX_CURATE_TWEETS }, (_, i) => tweet(i));
    const { status, body } = await withNoLlm(() => curate<{ error: string }>({ tweets }));
    expect(status).toBe(503);
    expect(body.error).toBe('llm_not_configured');
  });
});

// The live path costs money to reach, so the rule it turns on is pinned here
// directly (the JD.5 `rewriteWins` precedent). `min`, not the knob alone: the
// drafting call refuses a batch over `x.ai.batchReplyCap`, so a curated set
// above the cap would only move the refusal one click later.
describe('curateKeepTarget (RC.3) — the knob clamped by the batch cap', () => {
  test('defaults agree at 25, and the lower of the two always wins', () => {
    resetSettings({ keys: ['x.radar.curatedCount', 'x.ai.batchReplyCap'] });
    expect(curateKeepTarget()).toBe(25);

    setSettings({ 'x.radar.curatedCount': 40, 'x.ai.batchReplyCap': 30 });
    expect(curateKeepTarget()).toBe(30);

    setSettings({ 'x.radar.curatedCount': 10, 'x.ai.batchReplyCap': 50 });
    expect(curateKeepTarget()).toBe(10);

    resetSettings({ keys: ['x.radar.curatedCount', 'x.ai.batchReplyCap'] });
    expect(curateKeepTarget()).toBe(25);
  });
});
