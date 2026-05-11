// Grok-drafted manual-assist reply drafts over `reply_drafts`.
// Mounted under `/x` by `mountX` in ../index.ts.
//
// Routes (Phase 6 step 2 — generate only; CRUD lands in step 3):
//   POST /replies/generate   body: { context, systemPromptOverride?, model?, reasoningEffort? }
//
// Cost: askGrok already writes a `cost_events` row tagged platform='grok'.
// The denormalized `costUsd` column on `reply_drafts` is a UI convenience —
// do NOT double-log here.

import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { GrokApiError, askGrok } from '../../grok/index.ts';
import type { ReasoningEffort } from '../../grok/index.ts';
import { replyDrafts } from '../db/schema.ts';
import { type PostContext, buildGrokInput } from '../replies/prompt.ts';

// Reply length cap + a little slack for tokenization noise.
const MAX_OUTPUT_TOKENS = 280;
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_REASONING: ReasoningEffort = 'low';

const TWEET_ID_RE = /^\d{1,32}$/;
const USERNAME_RE = /^[A-Za-z0-9_]{1,15}$/;

interface RawBody {
  context?: unknown;
  systemPromptOverride?: unknown;
  model?: unknown;
  reasoningEffort?: unknown;
}

export const replies = new Hono();

replies.post('/replies/generate', async (c) => {
  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const body = raw as RawBody;

  const ctxOrErr = parseContext(body.context);
  if ('error' in ctxOrErr) return c.json({ error: ctxOrErr.error }, 400);
  const ctx = ctxOrErr;

  let systemOverride: string | undefined;
  if (body.systemPromptOverride !== undefined && body.systemPromptOverride !== null) {
    if (typeof body.systemPromptOverride !== 'string') {
      return c.json({ error: 'invalid_system_prompt_override' }, 400);
    }
    systemOverride = body.systemPromptOverride;
  }

  let model: string | undefined;
  if (body.model !== undefined && body.model !== null) {
    if (typeof body.model !== 'string' || body.model.trim() === '') {
      return c.json({ error: 'invalid_model' }, 400);
    }
    model = body.model;
  }

  let reasoningEffort: ReasoningEffort = DEFAULT_REASONING;
  if (body.reasoningEffort !== undefined && body.reasoningEffort !== null) {
    const r = body.reasoningEffort;
    if (r !== 'none' && r !== 'low' && r !== 'medium' && r !== 'high') {
      return c.json({ error: 'invalid_reasoning_effort' }, 400);
    }
    reasoningEffort = r;
  }

  const messages = buildGrokInput(ctx, systemOverride);

  let result: Awaited<ReturnType<typeof askGrok>>;
  try {
    result = await askGrok({
      ...(model !== undefined ? { model } : {}),
      messages,
      reasoningEffort,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      temperature: DEFAULT_TEMPERATURE,
    });
  } catch (err) {
    if (err instanceof GrokApiError) {
      return c.json(
        {
          error: 'grok_upstream_error',
          status: err.status,
          type: err.type,
          code: err.code,
          message: err.message,
          requestId: err.requestId,
        },
        err.status === 429 ? 429 : 502,
      );
    }
    const detail = err instanceof Error ? err.message : String(err);
    console.error('/x/replies/generate failed:', detail);
    return c.json({ error: 'generate_failed', detail }, 502);
  }

  const [row] = await db
    .insert(replyDrafts)
    .values({
      sourceTweetId: ctx.tweetId,
      sourceAuthorUsername: ctx.handle,
      sourceAuthorDisplayName: ctx.author,
      sourceText: ctx.text,
      sourceUrl: ctx.url,
      sourcePostedAt: new Date(ctx.postedAt),
      contextSnapshot: ctx,
      replyText: result.text.trim(),
      model: result.model,
      promptTokens: result.usage.inputTokens,
      completionTokens: result.usage.outputTokens,
      costUsd: result.costUsd.toFixed(5),
      grokRequestId: result.requestId,
      systemPromptOverride: systemOverride ?? null,
      status: 'generated',
    })
    .returning();

  return c.json(row, 201);
});

// --------------------------------------------------------------- validation

function parseContext(value: unknown): PostContext | { error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'context_required' };
  }
  const v = value as Record<string, unknown>;

  const tweetId = typeof v.tweetId === 'string' ? v.tweetId.trim() : '';
  if (!TWEET_ID_RE.test(tweetId)) return { error: 'invalid_context_tweet_id' };

  const handleRaw = typeof v.handle === 'string' ? v.handle.trim().replace(/^@/, '') : '';
  if (!USERNAME_RE.test(handleRaw)) return { error: 'invalid_context_handle' };

  if (typeof v.author !== 'string' || v.author.trim() === '') {
    return { error: 'invalid_context_author' };
  }
  if (typeof v.text !== 'string') return { error: 'invalid_context_text' };
  if (typeof v.url !== 'string' || v.url.trim() === '') {
    return { error: 'invalid_context_url' };
  }
  if (typeof v.postedAt !== 'string' || Number.isNaN(new Date(v.postedAt).getTime())) {
    return { error: 'invalid_context_posted_at' };
  }

  if (!v.metrics || typeof v.metrics !== 'object' || Array.isArray(v.metrics)) {
    return { error: 'invalid_context_metrics' };
  }
  const mRaw = v.metrics as Record<string, unknown>;
  const metrics: PostContext['metrics'] = { views: 0, replies: 0, reposts: 0, likes: 0 };
  for (const k of ['views', 'replies', 'reposts', 'likes'] as const) {
    const n = mRaw[k];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
      return { error: `invalid_context_metrics_${k}` };
    }
    metrics[k] = Math.floor(n);
  }

  if (!Array.isArray(v.topComments)) return { error: 'invalid_context_top_comments' };
  const topComments: PostContext['topComments'] = [];
  for (let i = 0; i < v.topComments.length; i++) {
    const cc = v.topComments[i];
    if (!cc || typeof cc !== 'object' || Array.isArray(cc)) {
      return { error: `invalid_top_comment_${i}` };
    }
    const r = cc as Record<string, unknown>;
    if (
      typeof r.author !== 'string' ||
      typeof r.handle !== 'string' ||
      typeof r.text !== 'string'
    ) {
      return { error: `invalid_top_comment_${i}` };
    }
    topComments.push({ author: r.author, handle: r.handle, text: r.text });
  }

  return {
    tweetId,
    handle: handleRaw,
    author: v.author,
    text: v.text,
    url: v.url,
    postedAt: v.postedAt,
    metrics,
    topComments,
  };
}
