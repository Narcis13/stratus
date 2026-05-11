// Grok-drafted manual-assist reply drafts over `reply_drafts`.
// Mounted under `/x` by `mountX` in ../index.ts.
//
// Routes:
//   POST   /replies/generate   body: { context, systemPromptOverride?, model?, reasoningEffort? }
//   GET    /replies            ?status=&sourceAuthor=&limit=&since=
//   GET    /replies/:id
//   PATCH  /replies/:id        body: { replyTextEdited?, status?, postedTweetId? }
//   DELETE /replies/:id
//
// Cost: askGrok already writes a `cost_events` row tagged platform='grok'.
// The denormalized `costUsd` column on `reply_drafts` is a UI convenience —
// do NOT double-log here.

import { type SQL, and, desc, eq, gte } from 'drizzle-orm';
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
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUSES = ['generated', 'copied', 'posted', 'discarded'] as const;
type Status = (typeof STATUSES)[number];

// Status transitions: see REPLY-MASTER-PLAN.md §"PATCH /x/replies/:id".
// `discarded` is terminal; `posted` only re-opens to `discarded` (drop a
// recorded reply from the history).
const ALLOWED_TRANSITIONS: Record<Status, readonly Status[]> = {
  generated: ['copied', 'posted', 'discarded'],
  copied: ['posted', 'discarded'],
  posted: ['discarded'],
  discarded: [],
};

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

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

// ---------------------------------------------------------------- list/get

replies.get('/replies', async (c) => {
  const statusStr = c.req.query('status');
  const sourceAuthorStr = c.req.query('sourceAuthor')?.trim().replace(/^@/, '');
  const limitStr = c.req.query('limit');
  const sinceStr = c.req.query('since');

  const filters: SQL[] = [];

  if (statusStr !== undefined) {
    if (!isStatus(statusStr)) return c.json({ error: 'invalid_status' }, 400);
    filters.push(eq(replyDrafts.status, statusStr));
  }
  if (sourceAuthorStr !== undefined && sourceAuthorStr !== '') {
    if (!USERNAME_RE.test(sourceAuthorStr)) {
      return c.json({ error: 'invalid_source_author' }, 400);
    }
    filters.push(eq(replyDrafts.sourceAuthorUsername, sourceAuthorStr));
  }
  if (sinceStr !== undefined) {
    const since = new Date(sinceStr);
    if (Number.isNaN(since.getTime())) return c.json({ error: 'invalid_since' }, 400);
    filters.push(gte(replyDrafts.createdAt, since));
  }

  let limit = DEFAULT_LIST_LIMIT;
  if (limitStr !== undefined) {
    const n = Number(limitStr);
    if (!Number.isInteger(n) || n < 1) return c.json({ error: 'invalid_limit' }, 400);
    limit = Math.min(MAX_LIST_LIMIT, n);
  }

  const rows = await db
    .select()
    .from(replyDrafts)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(replyDrafts.createdAt))
    .limit(limit);

  return c.json(rows);
});

replies.get('/replies/:id', async (c) => {
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) return c.json({ error: 'invalid_id' }, 400);

  const [row] = await db.select().from(replyDrafts).where(eq(replyDrafts.id, id));
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json(row);
});

// ----------------------------------------------------------------- update

replies.patch('/replies/:id', async (c) => {
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) return c.json({ error: 'invalid_id' }, 400);

  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const body = raw as Record<string, unknown>;

  const [existing] = await db.select().from(replyDrafts).where(eq(replyDrafts.id, id));
  if (!existing) return c.json({ error: 'not_found' }, 404);

  const updates: Partial<typeof replyDrafts.$inferInsert> = {};

  if (body.replyTextEdited !== undefined) {
    if (body.replyTextEdited === null) {
      updates.replyTextEdited = null;
    } else if (typeof body.replyTextEdited !== 'string') {
      return c.json({ error: 'invalid_reply_text_edited' }, 400);
    } else {
      updates.replyTextEdited = body.replyTextEdited;
    }
  }

  let nextStatus: Status | undefined;
  if (body.status !== undefined) {
    if (!isStatus(body.status)) return c.json({ error: 'invalid_status' }, 400);
    nextStatus = body.status;
    if (nextStatus !== existing.status) {
      const allowed = ALLOWED_TRANSITIONS[existing.status as Status] ?? [];
      if (!allowed.includes(nextStatus)) {
        return c.json(
          { error: 'invalid_status_transition', from: existing.status, to: nextStatus },
          409,
        );
      }
      updates.status = nextStatus;
    }
  }

  if (body.postedTweetId !== undefined) {
    if (body.postedTweetId === null) {
      updates.postedTweetId = null;
    } else if (typeof body.postedTweetId !== 'string' || !TWEET_ID_RE.test(body.postedTweetId)) {
      return c.json({ error: 'invalid_posted_tweet_id' }, 400);
    } else {
      // Only meaningful when the row is/becomes `posted`.
      const finalStatus = nextStatus ?? (existing.status as Status);
      if (finalStatus !== 'posted') {
        return c.json({ error: 'posted_tweet_id_requires_posted_status' }, 400);
      }
      updates.postedTweetId = body.postedTweetId;
    }
  }

  if (Object.keys(updates).length === 0) return c.json(existing);

  updates.updatedAt = new Date();
  const [row] = await db.update(replyDrafts).set(updates).where(eq(replyDrafts.id, id)).returning();

  return c.json(row);
});

// ----------------------------------------------------------------- delete

replies.delete('/replies/:id', async (c) => {
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) return c.json({ error: 'invalid_id' }, 400);

  const result = await db
    .delete(replyDrafts)
    .where(eq(replyDrafts.id, id))
    .returning({ id: replyDrafts.id });
  if (result.length === 0) return c.json({ error: 'not_found' }, 404);
  return c.body(null, 204);
});

// --------------------------------------------------------------- validation

function isStatus(v: unknown): v is Status {
  return typeof v === 'string' && (STATUSES as readonly string[]).includes(v);
}

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
