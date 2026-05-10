// POST /grok/ask — generally-available LLM endpoint for any vertical (X today,
// LinkedIn next, etc.). Body is forwarded to `askGrok`; errors from xAI become
// 502 with the upstream message preserved. Bearer-guarded by `app.ts`.

import { Hono } from 'hono';
import { type AskGrokOptions, GrokApiError, askGrok } from '../client.ts';

export const ask = new Hono();

interface RawBody {
  prompt?: unknown;
  system?: unknown;
  messages?: unknown;
  model?: unknown;
  reasoningEffort?: unknown;
  maxOutputTokens?: unknown;
  temperature?: unknown;
}

ask.post('/grok/ask', async (c) => {
  const raw = (await c.req.json().catch(() => null)) as RawBody | null;
  if (!raw) return c.json({ error: 'expected JSON body' }, 400);

  const parsed = parseBody(raw);
  if ('error' in parsed) return c.json({ error: parsed.error }, 400);

  try {
    const result = await askGrok(parsed);
    return c.json(result);
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
        // Surface auth/rate-limit transparently; everything else is 502.
        err.status === 401 || err.status === 403 ? 502 : err.status === 429 ? 429 : 502,
      );
    }
    const detail = err instanceof Error ? err.message : String(err);
    console.error('ask /grok/ask failed:', detail);
    return c.json({ error: 'grok_request_failed', detail }, 502);
  }
});

type ParseResult = AskGrokOptions | { error: string };

function parseBody(raw: RawBody): ParseResult {
  const out: AskGrokOptions = {};

  if (raw.prompt !== undefined) {
    if (typeof raw.prompt !== 'string') return { error: '`prompt` must be a string' };
    out.prompt = raw.prompt;
  }
  if (raw.system !== undefined) {
    if (typeof raw.system !== 'string') return { error: '`system` must be a string' };
    out.system = raw.system;
  }
  if (raw.messages !== undefined) {
    if (!Array.isArray(raw.messages)) return { error: '`messages` must be an array' };
    const msgs: AskGrokOptions['messages'] = [];
    for (const m of raw.messages) {
      if (!m || typeof m !== 'object') return { error: 'each message must be an object' };
      const mm = m as { role?: unknown; content?: unknown };
      if (mm.role !== 'system' && mm.role !== 'user' && mm.role !== 'assistant') {
        return { error: "message.role must be 'system', 'user', or 'assistant'" };
      }
      if (typeof mm.content !== 'string') return { error: 'message.content must be a string' };
      msgs.push({ role: mm.role, content: mm.content });
    }
    out.messages = msgs;
  }
  if (out.prompt === undefined && (out.messages === undefined || out.messages.length === 0)) {
    return { error: 'pass `prompt` or non-empty `messages`' };
  }

  if (raw.model !== undefined) {
    if (typeof raw.model !== 'string') return { error: '`model` must be a string' };
    out.model = raw.model;
  }
  if (raw.reasoningEffort !== undefined) {
    const r = raw.reasoningEffort;
    if (r !== 'none' && r !== 'low' && r !== 'medium' && r !== 'high') {
      return { error: '`reasoningEffort` must be one of: none, low, medium, high' };
    }
    out.reasoningEffort = r;
  }
  if (raw.maxOutputTokens !== undefined) {
    if (typeof raw.maxOutputTokens !== 'number' || !Number.isInteger(raw.maxOutputTokens)) {
      return { error: '`maxOutputTokens` must be an integer' };
    }
    out.maxOutputTokens = raw.maxOutputTokens;
  }
  if (raw.temperature !== undefined) {
    if (typeof raw.temperature !== 'number') return { error: '`temperature` must be a number' };
    out.temperature = raw.temperature;
  }

  return out;
}
