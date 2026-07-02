// Template extraction over the voice-library swipe file (§8.3). One Grok
// structured-output pass per saved tweet distills the reusable STRUCTURE —
// hook shape, beat skeleton, line-break rhythm, length class, rhetorical
// device — into columns on `voice_tweets`. Grok-backed, so mounted under the
// XAI_API_KEY guard (same as replies/drafter); ~$0.005/tweet, one-time.
//
//   POST /voice/tweets/:tweetId/extract   (re)extract one tweet
//   POST /voice/extract-batch  { limit? }  backfill un-extracted tweets, ≤50/call
//
// ToS posture is hard law here: what's stored is structural metadata derived
// for personal analysis. Drafts that consume it (the §8.1 Remix path) must
// transform, never reproduce, scraped content.

import { and, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { GrokApiError, askGrok } from '../../grok/index.ts';
import { voiceTweets } from '../db/schema.ts';

const TWEET_ID_RE = /^\d{1,32}$/;
const DEFAULT_BATCH_LIMIT = 20;
const MAX_BATCH_LIMIT = 50;
const MAX_OUTPUT_TOKENS = 250;
const PROMPT_CACHE_KEY = 'stratus-x-template-extract';

export const TEMPLATE_LENGTHS = ['short', 'medium', 'long'] as const;
export type TemplateLength = (typeof TEMPLATE_LENGTHS)[number];

export interface ExtractedTemplate {
  hookType: string;
  skeleton: string;
  lineBreakPattern: string;
  length: TemplateLength;
  device: string;
}

export const TEMPLATE_SCHEMA = {
  type: 'object',
  properties: {
    hookType: {
      type: 'string',
      description:
        'First-line hook pattern in 2-4 words, e.g. "stat hook", "contrast hook", "story hook", "question hook", "bold claim"',
    },
    skeleton: {
      type: 'string',
      description:
        'Beat-by-beat structure in compact notation, e.g. "contrast hook -> short declarative -> list of 3 -> question close"',
    },
    lineBreakPattern: {
      type: 'string',
      description:
        'How lines and whitespace are used, e.g. "one-liner", "3 short paragraphs", "list with blank lines"',
    },
    length: { type: 'string', enum: [...TEMPLATE_LENGTHS] },
    device: {
      type: 'string',
      description:
        'Main rhetorical device, e.g. "repetition", "numbered list", "before/after", "direct address"',
    },
  },
  required: ['hookType', 'skeleton', 'lineBreakPattern', 'length', 'device'],
  additionalProperties: false,
} as const;

const EXTRACT_PROMPT_PREFIX = `Analyze the STRUCTURE of the X post below for a personal swipe file. Describe only the reusable skeleton — the shape of the writing, never its topic, claims, or specifics. Someone reading your output alone must not be able to tell what the post was about.

Return JSON: {"hookType": "…", "skeleton": "…", "lineBreakPattern": "…", "length": "…", "device": "…"}
- hookType: the first-line hook pattern in 2-4 words ("stat hook", "contrast hook", "story hook", "question hook", "bold claim", …).
- skeleton: the beat-by-beat structure in compact arrow notation ("contrast hook -> short declarative -> list of 3 -> question close").
- lineBreakPattern: how lines/whitespace carry the rhythm ("one-liner", "3 short paragraphs", "list with blank lines", "wall of text").
- length: short (under 140 chars) | medium (140-280) | long (over 280).
- device: the main rhetorical device ("repetition", "numbered list", "before/after", "direct address", "irony", …).

THE POST:

`;

// Exported for unit tests (pure).
export function parseExtractedTemplate(raw: string): ExtractedTemplate | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const v = parsed as Record<string, unknown>;
  for (const k of ['hookType', 'skeleton', 'lineBreakPattern', 'device'] as const) {
    if (typeof v[k] !== 'string' || (v[k] as string).trim() === '') return null;
  }
  const length = (TEMPLATE_LENGTHS as readonly string[]).includes(v.length as string)
    ? (v.length as TemplateLength)
    : 'medium';
  return {
    hookType: (v.hookType as string).trim(),
    skeleton: (v.skeleton as string).trim(),
    lineBreakPattern: (v.lineBreakPattern as string).trim(),
    length,
    device: (v.device as string).trim(),
  };
}

type VoiceTweetRow = typeof voiceTweets.$inferSelect;

async function extractOne(
  tweet: VoiceTweetRow,
): Promise<{ template: ExtractedTemplate; costUsd: number } | { error: string }> {
  if (!tweet.text.trim()) return { error: 'empty_text' };

  let result: Awaited<ReturnType<typeof askGrok>>;
  try {
    result = await askGrok({
      prompt: EXTRACT_PROMPT_PREFIX + tweet.text,
      reasoningEffort: 'low',
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      temperature: 0.2,
      jsonSchema: { name: 'tweet_template', schema: TEMPLATE_SCHEMA },
      promptCacheKey: PROMPT_CACHE_KEY,
    });
  } catch (err) {
    if (err instanceof GrokApiError) return { error: `grok_${err.status}` };
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
