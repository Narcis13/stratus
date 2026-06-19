// askGrok — the one place all xAI Grok calls go through. Mirrors the role
// `xFetch` plays for X: bearer auth, error parsing, retry on 429/5xx, fire-and-
// forget cost log into `cost_events` tagged platform='grok'.
//
// Hits the Responses API at https://api.x.ai/v1/responses (NOT the legacy
// /chat/completions). Field is `input` (array of {role, content}) and the
// flattened reply is `output_text`. See `Grok-API-docs.md` and
// https://docs.x.ai/developers/quickstart for the canonical shapes.
//
// Cost is computed from `usage` tokens returned by xAI, not from a per-call
// flat rate — that's why we don't go through `src/middleware/costTracker.ts`
// (which is endpoint-priced for X). The `cost_events` row schema is shared,
// so /cost/today picks up Grok spend without changes.

import { db } from '../db/client.ts';
import { costEvents } from '../db/shared-schema.ts';
import { type TokenUsage, isKnownModel, priceFor } from './pricing.ts';

const GROK_API_BASE = 'https://api.x.ai/v1';
const DEFAULT_MODEL = 'grok-4.3';

export type GrokRole = 'system' | 'user' | 'assistant';

export interface GrokMessage {
  role: GrokRole;
  content: string;
}

export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high';

// Structured outputs on /v1/responses go through `text.format`, NOT the
// chat-completions `response_format` (the API rejects that with a 400 telling
// you so). The constrained JSON still arrives in output[].content[] as
// `output_text`, so the normal text-extraction path applies.
export interface GrokJsonSchemaFormat {
  name: string;
  schema: Record<string, unknown>;
  /** Defaults to true — xAI guarantees schema conformance only when strict. */
  strict?: boolean;
}

export interface AskGrokOptions {
  /** Defaults to `grok-4.3`. Aliases `grok-4.3-latest` / `grok-latest` also priced. */
  model?: string;
  /** Single-turn convenience — wraps as one `{role:'user'}` message. */
  prompt?: string;
  /** Optional system prompt; prepended to `messages` if both supplied. */
  system?: string;
  /** Multi-turn conversation. Either `prompt` or `messages` is required. */
  messages?: GrokMessage[];
  reasoningEffort?: ReasoningEffort;
  maxOutputTokens?: number;
  /** 0..2; xAI default ≈ 1. Omit to use server default. */
  temperature?: number;
  /** Constrain the reply to a JSON schema (structured outputs). */
  jsonSchema?: GrokJsonSchemaFormat;
  /** Routes repeat calls to the same server so the prompt-prefix cache hits. */
  promptCacheKey?: string;
  /** Max retry attempts on 429/5xx/network. Default 3. */
  maxAttempts?: number;
  signal?: AbortSignal;
}

export interface AskGrokResult {
  text: string;
  model: string;
  usage: TokenUsage & { totalTokens: number };
  costUsd: number;
  durationMs: number;
  requestId: string | null;
}

interface GrokResponse {
  id?: string;
  model?: string;
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
  };
  error?: { message?: string; type?: string; code?: string };
}

export class GrokApiError extends Error {
  constructor(
    public status: number,
    public type: string | null,
    public code: string | null,
    message: string,
    public requestId: string | null,
  ) {
    super(message);
    this.name = 'GrokApiError';
  }
}

export async function askGrok(opts: AskGrokOptions): Promise<AskGrokResult> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new Error('XAI_API_KEY is required');

  const model = opts.model ?? DEFAULT_MODEL;
  const input = buildInput(opts);
  if (input.length === 0) {
    throw new Error('askGrok: pass `prompt` or `messages` (at least one user message)');
  }

  const body: Record<string, unknown> = { model, input };
  if (opts.reasoningEffort) body.reasoning = { effort: opts.reasoningEffort };
  if (opts.maxOutputTokens !== undefined) body.max_output_tokens = opts.maxOutputTokens;
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.jsonSchema) {
    body.text = {
      format: {
        type: 'json_schema',
        name: opts.jsonSchema.name,
        schema: opts.jsonSchema.schema,
        strict: opts.jsonSchema.strict ?? true,
      },
    };
  }
  if (opts.promptCacheKey) body.prompt_cache_key = opts.promptCacheKey;

  const maxAttempts = opts.maxAttempts ?? 3;
  const start = performance.now();
  let attempt = 0;
  let lastErr: unknown;

  while (attempt < maxAttempts) {
    attempt++;
    try {
      const init: RequestInit = {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(body),
      };
      if (opts.signal) init.signal = opts.signal;
      const res = await fetch(`${GROK_API_BASE}/responses`, init);

      const requestId = res.headers.get('x-request-id');

      if (res.ok) {
        const data = (await res.json()) as GrokResponse;
        const durationMs = performance.now() - start;
        const text = data.output_text ?? extractText(data) ?? '';
        const usage = readUsage(data);
        const costUsd = priceFor(model, usage);
        // §9.1 pricing truthfulness: an unmapped model silently bills $0 —
        // shout so the price table gets a row before the spend dashboard lies.
        if (!isKnownModel(model) && usage.totalTokens > 0) {
          console.warn(
            `grok: model '${model}' has no price-table entry — this call logged $0. Add it to src/grok/pricing.ts.`,
          );
        }

        logCost({
          status: res.status,
          totalTokens: usage.totalTokens,
          costUsd,
          durationMs,
          attempts: attempt,
          requestId,
        });

        return {
          text,
          model: data.model ?? model,
          usage,
          costUsd,
          durationMs,
          requestId,
        };
      }

      // Error path. Try to parse the body for an `error` object; fall back to
      // raw text. Retry on 429/5xx; throw otherwise.
      const errBody = await res.text();
      const parsed = safeParseError(errBody);
      const apiErr = new GrokApiError(
        res.status,
        parsed?.type ?? null,
        parsed?.code ?? null,
        parsed?.message ?? `xAI ${res.status} ${res.statusText}`,
        requestId,
      );

      if (shouldRetry(res.status) && attempt < maxAttempts) {
        await sleep(retryDelay(res, attempt));
        continue;
      }

      logCost({
        status: res.status,
        totalTokens: 0,
        costUsd: 0,
        durationMs: performance.now() - start,
        attempts: attempt,
        requestId,
      });
      throw apiErr;
    } catch (err) {
      lastErr = err;
      if (err instanceof GrokApiError) throw err;
      // Network/abort errors. Don't retry aborts.
      if (err instanceof Error && err.name === 'AbortError') throw err;
      if (attempt < maxAttempts) {
        await sleep(retryDelay(null, attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error('askGrok: exhausted attempts');
}

function buildInput(opts: AskGrokOptions): GrokMessage[] {
  const out: GrokMessage[] = [];
  if (opts.system) out.push({ role: 'system', content: opts.system });
  if (opts.messages) out.push(...opts.messages);
  if (opts.prompt) out.push({ role: 'user', content: opts.prompt });
  return out;
}

function extractText(data: GrokResponse): string | null {
  if (!data.output) return null;
  const parts: string[] = [];
  for (const item of data.output) {
    for (const c of item.content ?? []) {
      if (c.type === 'output_text' && c.text) parts.push(c.text);
    }
  }
  return parts.length > 0 ? parts.join('') : null;
}

function readUsage(data: GrokResponse): TokenUsage & { totalTokens: number } {
  const u = data.usage ?? {};
  const inputTokens = u.input_tokens ?? 0;
  const cachedInputTokens = u.input_tokens_details?.cached_tokens ?? 0;
  const outputTokens = u.output_tokens ?? 0;
  const totalTokens = u.total_tokens ?? inputTokens + outputTokens;
  return { inputTokens, cachedInputTokens, outputTokens, totalTokens };
}

function safeParseError(body: string): { message?: string; type?: string; code?: string } | null {
  try {
    const j = JSON.parse(body) as { error?: { message?: string; type?: string; code?: string } };
    return j.error ?? null;
  } catch {
    return null;
  }
}

function shouldRetry(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 504);
}

function retryDelay(res: Response | null, attempt: number): number {
  // Honor `retry-after` (seconds) when xAI sends it.
  const ra = res?.headers.get('retry-after');
  if (ra) {
    const sec = Number.parseFloat(ra);
    if (!Number.isNaN(sec)) return Math.min(60_000, sec * 1000) + jitter();
  }
  return Math.min(16_000, 1000 * 2 ** (attempt - 1)) + jitter();
}

function jitter(): number {
  return Math.floor(Math.random() * 500);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface LogCost {
  status: number;
  totalTokens: number;
  costUsd: number;
  durationMs: number;
  attempts: number;
  requestId: string | null;
}

function logCost(info: LogCost): void {
  // Fire-and-forget — same guarantees as src/middleware/costTracker.ts: a
  // failed insert must never break the caller of askGrok.
  try {
    db.insert(costEvents)
      .values({
        platform: 'grok',
        endpoint: '/v1/responses',
        status: info.status,
        items: info.totalTokens || null,
        costUsd: Number(info.costUsd.toFixed(5)),
        durationMs: Math.round(info.durationMs),
        attempts: info.attempts,
        requestId: info.requestId,
      })
      .run();
  } catch (err) {
    console.error('grok cost log failed:', err instanceof Error ? err.message : err);
  }
}
