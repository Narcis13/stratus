// AI image generation (SURFACES S4). POST /x/images/generate turns a prompt
// into base64 images via xAI's grok-2-image, for the Studio to composite UNDER
// its deterministic brand text (models garble words; text is canvas-rendered on
// top). Always mounted — the XAI key is checked at runtime (503 without it,
// same shape as pillar drafting), so the Studio can degrade gracefully.
//
// Money discipline:
//  - Never hand back a raw xAI URL — the module requests b64_json (and downloads
//    a stray URL server-side), so the extension only ever sees base64 (§S4 taint
//    trap: a cross-origin image taints the canvas and toBlob throws).
//  - A per-UTC-day image budget (XAI_IMAGE_DAILY_BUDGET_USD, default $0.50) is
//    checked BEFORE the paid call and refuses with 429 once crossed — a paint
//    session can't melt the wallet. Image spend is isolated under platform
//    'xai' in cost_events, so this reads exactly the image bucket.

import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { costEvents } from '../../db/shared-schema.ts';
import { GrokImageError, generateImages } from '../../grok/index.ts';

export const images = new Hono();

const MAX_PROMPT_LEN = 4000;
const DEFAULT_IMAGE_BUDGET_USD = 0.5;

function imageBudgetUsd(): number {
  const v = Number(process.env.XAI_IMAGE_DAILY_BUDGET_USD ?? String(DEFAULT_IMAGE_BUDGET_USD));
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_IMAGE_BUDGET_USD;
}

/** Today's (UTC day) image spend — only image generation logs under 'xai'. */
export async function imageSpendTodayUsd(): Promise<number> {
  const from = new Date();
  from.setUTCHours(0, 0, 0, 0);
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${costEvents.costUsd}), 0)` })
    .from(costEvents)
    .where(sql`${costEvents.platform} = 'xai' and ${costEvents.ts} >= ${from.getTime()}`);
  return Number(row?.total ?? 0);
}

images.post('/images/generate', async (c) => {
  if (!process.env.XAI_API_KEY) return c.json({ error: 'grok_not_configured' }, 503);

  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return c.json({ error: 'invalid_body' }, 400);
  const b = raw as Record<string, unknown>;

  const prompt = typeof b.prompt === 'string' ? b.prompt.trim() : '';
  if (prompt === '') return c.json({ error: 'invalid_prompt' }, 400);
  if (prompt.length > MAX_PROMPT_LEN) return c.json({ error: 'prompt_too_long' }, 400);

  // n is clamped, not rejected — a slider that overshoots just gets 2.
  let n = 1;
  if (b.n !== undefined) {
    if (typeof b.n !== 'number' || !Number.isInteger(b.n))
      return c.json({ error: 'invalid_n' }, 400);
    n = Math.max(1, Math.min(2, b.n));
  }

  // Budget gate BEFORE spending. Refuse when today's image spend is already at
  // or over the cap — a hard stop, unlike the soft X watchdog that only logs.
  const budget = imageBudgetUsd();
  const spent = await imageSpendTodayUsd();
  if (spent >= budget) {
    return c.json(
      { error: 'image_budget_exceeded', spentUsd: round5(spent), budgetUsd: budget },
      429,
    );
  }

  try {
    const result = await generateImages({ prompt, n });
    if (result.images.length === 0) {
      return c.json({ error: 'no_images', requestId: result.requestId }, 502);
    }
    return c.json({
      images: result.images.map((img) => ({
        dataUrl: `data:${img.mediaType};base64,${img.base64}`,
        mediaType: img.mediaType,
        revisedPrompt: img.revisedPrompt,
      })),
      model: result.model,
      count: result.images.length,
      costUsd: result.costUsd,
      requestId: result.requestId,
    });
  } catch (err) {
    if (err instanceof GrokImageError) {
      return c.json(
        {
          error: 'grok_upstream_error',
          status: err.status,
          message: err.message,
          requestId: err.requestId,
        },
        err.status === 429 ? 429 : 502,
      );
    }
    const detail = err instanceof Error ? err.message : String(err);
    console.error('/x/images/generate failed:', detail);
    return c.json({ error: 'image_generation_failed', detail }, 502);
  }
});

function round5(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}
