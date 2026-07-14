// S4 image-generation route — the money-guard paths that never touch the
// network: 503 without a key, 400 on bad input, and the 429 budget refusal
// (checked BEFORE the paid call, so no dummy xAI request escapes the test).

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { costEvents } from '../../db/shared-schema.ts';
import { images } from './images.ts';

const app = new Hono();
app.route('/x', images);

async function gen<T>(body: unknown): Promise<{ status: number; body: T }> {
  const res = await app.request('/x/images/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}

// '' is treated as "unset" everywhere the key is read (falsy) — same pattern as
// digest/icebreakers tests, which keeps biome's noDelete rule happy.
const savedKey = process.env.XAI_API_KEY;
const savedBudget = process.env.XAI_IMAGE_DAILY_BUDGET_USD;

afterEach(() => {
  process.env.XAI_API_KEY = savedKey ?? '';
  process.env.XAI_IMAGE_DAILY_BUDGET_USD = savedBudget ?? '';
});

describe('POST /x/images/generate — guards', () => {
  test('503 when XAI_API_KEY is unset (same as pillar drafting)', async () => {
    process.env.XAI_API_KEY = '';
    const { status, body } = await gen<{ error: string }>({ prompt: 'a calm gradient' });
    expect(status).toBe(503);
    expect(body.error).toBe('grok_not_configured');
  });

  describe('with a key set', () => {
    beforeEach(() => {
      process.env.XAI_API_KEY = 'test-key-not-used-guards-run-before-network';
    });

    test('empty prompt → 400', async () => {
      const { status, body } = await gen<{ error: string }>({ prompt: '   ' });
      expect(status).toBe(400);
      expect(body.error).toBe('invalid_prompt');
    });

    test('non-integer n → 400', async () => {
      const { status, body } = await gen<{ error: string }>({ prompt: 'ok', n: 1.5 });
      expect(status).toBe(400);
      expect(body.error).toBe('invalid_n');
    });

    test("over-budget → 429 before any spend (a paint session can't melt the wallet)", async () => {
      process.env.XAI_IMAGE_DAILY_BUDGET_USD = '0.50';
      const marker = `test-budget-${Date.now()}`;
      // Seed today's image spend past the cap.
      db.insert(costEvents)
        .values({
          platform: 'xai',
          endpoint: '/v1/images/generations',
          status: 200,
          items: 8,
          costUsd: 0.6,
          durationMs: 10,
          attempts: 1,
          requestId: marker,
        })
        .run();
      try {
        const { status, body } = await gen<{
          error: string;
          spentUsd: number;
          budgetUsd: number;
        }>({ prompt: 'a muted flat-vector background' });
        expect(status).toBe(429);
        expect(body.error).toBe('image_budget_exceeded');
        expect(body.spentUsd).toBeGreaterThanOrEqual(0.6);
        expect(body.budgetUsd).toBe(0.5);
      } finally {
        // Don't leak spend into the shared in-memory DB's other suites.
        db.delete(costEvents).where(eq(costEvents.requestId, marker)).run();
      }
    });
  });
});
