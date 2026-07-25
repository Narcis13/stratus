// Template extraction over the voice-library swipe file (§8.3). One LLM
// structured-output pass per saved tweet distills the reusable STRUCTURE —
// hook shape, beat skeleton, line-break rhythm, length class, rhetorical
// device — into columns on `voice_tweets`. LLM-backed, so mounted under the
// XAI_API_KEY guard (same as replies/drafter; the AI.6 gate flip owns the
// mount); ~$0.005/tweet on Grok, one-time.
//
//   POST /voice/tweets/:tweetId/extract   (re)extract one tweet
//   POST /voice/extract-batch  { limit? }  backfill un-extracted tweets, ≤50/call
//
// The prompt is registry key `voice-extract` (AI.5) — DB override else the
// shipped default in ../voice/extractPrompt.ts, shared with the playbook
// extract-winners path. Provider comes from the AI settings (askLLM).
//
// ToS posture is hard law here: what's stored is structural metadata derived
// for personal analysis. Drafts that consume it (the §8.1 Remix path) must
// transform, never reproduce, scraped content.

import { and, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { GrokApiError } from '../../grok/index.ts';
import { type AskLlmResult, LlmNotConfiguredError, askLLM } from '../../llm/index.ts';
import { OpenRouterApiError } from '../../openrouter/index.ts';
import { voiceTweets } from '../db/schema.ts';
import { loadPromptSafe, renderPrompt } from '../prompts/registry.ts';
import {
  type ExtractedTemplate,
  TEMPLATE_EXTRACT_MAX_OUTPUT_TOKENS,
  TEMPLATE_SCHEMA,
  parseExtractedTemplate,
} from '../voice/extractPrompt.ts';

const TWEET_ID_RE = /^\d{1,32}$/;
const DEFAULT_BATCH_LIMIT = 20;
const MAX_BATCH_LIMIT = 50;

type VoiceTweetRow = typeof voiceTweets.$inferSelect;

// Shares the registry key (one prompt, one cache bucket) with the C4
// own-winner extraction in routes/playbook.ts, so the two paths can't drift.
async function extractOne(
  tweet: VoiceTweetRow,
): Promise<{ template: ExtractedTemplate; costUsd: number } | { error: string }> {
  if (!tweet.text.trim()) return { error: 'empty_text' };

  const prompt = loadPromptSafe('voice-extract');
  let result: AskLlmResult;
  try {
    result = await askLLM(
      {
        prompt: renderPrompt(prompt.body, { TWEET_TEXT: tweet.text }),
        jsonSchema: { name: 'tweet_template', schema: TEMPLATE_SCHEMA },
        promptCacheKey: prompt.cacheKey,
      },
      {
        defaults: {
          reasoningEffort: 'low',
          maxOutputTokens: TEMPLATE_EXTRACT_MAX_OUTPUT_TOKENS,
          temperature: 0.2,
        },
      },
    );
  } catch (err) {
    if (err instanceof LlmNotConfiguredError) return { error: 'llm_not_configured' };
    if (err instanceof GrokApiError) return { error: `grok_${err.status}` };
    if (err instanceof OpenRouterApiError) return { error: `openrouter_${err.status}` };
    return { error: err instanceof Error ? err.message : String(err) };
  }

  const template = parseExtractedTemplate(result.text);
  if (!template) return { error: 'parse_error' };

  await db
    .update(voiceTweets)
    .set({
      hookType: template.hookType,
      skeleton: template.skeleton,
      lineBreakPattern: template.lineBreakPattern,
      templateLength: template.length,
      device: template.device,
      templateExtractedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(voiceTweets.tweetId, tweet.tweetId));

  return { template, costUsd: result.costUsd };
}

export const voiceExtract = new Hono();

voiceExtract.post('/voice/tweets/:tweetId/extract', async (c) => {
  const tweetId = c.req.param('tweetId');
  if (!TWEET_ID_RE.test(tweetId)) return c.json({ error: 'invalid_tweet_id' }, 400);

  const [tweet] = await db.select().from(voiceTweets).where(eq(voiceTweets.tweetId, tweetId));
  if (!tweet) return c.json({ error: 'not_found' }, 404);

  const out = await extractOne(tweet);
  if ('error' in out) return c.json({ error: 'extract_failed', detail: out.error }, 502);

  const [row] = await db.select().from(voiceTweets).where(eq(voiceTweets.tweetId, tweetId));
  return c.json({ tweet: row, costUsd: out.costUsd });
});

// Backfill: oldest-saved first, only tweets never extracted. Sequential on
// purpose — ≤50 × $0.005 = $0.25 worst case per call, human-triggered.
voiceExtract.post('/voice/extract-batch', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  let limit = DEFAULT_BATCH_LIMIT;
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const l = (body as Record<string, unknown>).limit;
    if (l !== undefined && l !== null) {
      if (typeof l !== 'number' || !Number.isInteger(l) || l < 1) {
        return c.json({ error: 'invalid_limit' }, 400);
      }
      limit = Math.min(MAX_BATCH_LIMIT, l);
    }
  }

  const pending = await db
    .select()
    .from(voiceTweets)
    .where(and(isNull(voiceTweets.templateExtractedAt), eq(voiceTweets.retired, false)))
    .orderBy(voiceTweets.savedAt)
    .limit(limit);

  let extracted = 0;
  let costUsd = 0;
  const failures: Array<{ tweetId: string; error: string }> = [];
  for (const tweet of pending) {
    const out = await extractOne(tweet);
    if ('error' in out) {
      failures.push({ tweetId: tweet.tweetId, error: out.error });
      continue;
    }
    extracted++;
    costUsd += out.costUsd;
  }

  const remaining = await db.$count(
    voiceTweets,
    and(isNull(voiceTweets.templateExtractedAt), eq(voiceTweets.retired, false)),
  );

  return c.json({
    requested: pending.length,
    extracted,
    failures,
    costUsd: Math.round(costUsd * 1e5) / 1e5,
    remaining,
  });
});
