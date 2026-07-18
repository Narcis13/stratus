// askOpenRouter — the one place all OpenRouter calls go through. A second LLM
// provider sitting beside src/grok/: the AI-layer dispatcher (src/llm/ask.ts)
// picks grok vs openrouter, and each provider keeps its own single entry point
// (§7.1 extended). Mirrors askGrok's discipline line-for-line in structure:
// bearer auth, retry on 429/5xx, jittered backoff honoring retry-after, and a
// fire-and-forget cost log into `cost_events` tagged platform='openrouter'.
//
// Differences from the Grok path (all because OpenRouter speaks the OpenAI
// chat-completions shape, not xAI's /v1/responses):
//   • endpoint POST https://openrouter.ai/api/v1/chat/completions
//   • body is OpenAI-shaped: `messages`, `max_tokens`, `temperature`,
//     `response_format:{type:'json_schema', json_schema:{name,strict,schema}}`
//   • structured outputs go through `response_format`, NOT xAI's `text.format`
//   • `usage:{include:true}` is ALWAYS sent so the response reports the exact
//     billed `usage.cost` (USD) — there is NO price table; cost comes straight
//     off the response, same as images.ts prefers `cost_in_usd_ticks`.
//   • `provider:{require_parameters:true}` is ALWAYS sent so OpenRouter only
//     routes to providers that honor json_schema — without it a lesser provider
//     may silently ignore the schema and hand back unconstrained text.

import { sql } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { costEvents } from '../db/shared-schema.ts';

const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1';
// Fallback default only — the dispatcher (AI.2) always passes the model chosen
// in Settings → AI (settings default is also anthropic/claude-sonnet-4.5). This
// keeps askOpenRouter usable standalone (and in tests) without a settings read.
export const DEFAULT_MODEL = 'anthropic/claude-sonnet-4.5';
// Optional attribution headers OpenRouter surfaces on its dashboard/rankings.
const APP_REFERER = 'https://stratus-narcis.duckdns.org';
const APP_TITLE = 'stratus';
// Soft daily (UTC) budget: crossing it logs a loud BUDGET WATCHDOG line, never
// blocks (one wallet, one user — /cost/today is the cap, like X_DAILY_BUDGET_USD).
const DEFAULT_DAILY_BUDGET_USD = 1.0;

export type OpenRouterRole = 'system' | 'user' | 'assistant';

export interface OpenRouterMessage {
  role: OpenRouterRole;
  content: string;
}

export type OpenRouterReasoningEffort = 'none' | 'low' | 'medium' | 'high';

// OpenRouter structured outputs use the OpenAI `response_format.json_schema`
// shape — the mirror of Grok's `text.format`. Kept as its own type so the two
// providers never leak one's request shape into the other (§7.17).
export interface OpenRouterJsonSchemaFormat {
  name: string;
  schema: Record<string, unknown>;
  /** Defaults to true — strict is what makes json_schema actually constrain. */
  strict?: boolean;
}

/** A fetch seam so the client is testable without a network (tests inject a
 *  recorder). Defaults to the global `fetch`; production never passes this. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface AskOpenRouterOptions {
  /** Defaults to `anthropic/claude-sonnet-4.5`; the dispatcher passes the
   *  Settings → AI model. Any OpenRouter model id works. */
  model?: string;
  /** Single-turn convenience — wraps as one `{role:'user'}` message. */
  prompt?: string;
  /** Optional system prompt; prepended to `messages` if both supplied. */
  system?: string;
  /** Multi-turn conversation. Either `prompt` or `messages` is required. */
  messages?: OpenRouterMessage[];
  reasoningEffort?: OpenRouterReasoningEffort;
  maxOutputTokens?: number;
  /** 0..2. Omit to use the provider default. */
  temperature?: number;
  /** Constrain the reply to a JSON schema (structured outputs). */
  jsonSchema?: OpenRouterJsonSchemaFormat;
  /** Max retry attempts on 429/5xx/network. Default 3. */
  maxAttempts?: number;
  signal?: AbortSignal;
  /** Test seam — inject a fetch. Defaults to the global `fetch`. */
  fetchImpl?: FetchLike;
}

export interface OpenRouterUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface AskOpenRouterResult {
  text: string;
  model: string;
  usage: OpenRouterUsage;
  costUsd: number;
  durationMs: number;
  requestId: string | null;
}

interface OpenRouterResponse {
  id?: string;
  model?: string;
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    /** USD — present when `usage.include` was requested. This IS the bill. */
    cost?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
  error?: { message?: string; type?: string; code?: string | number };
}

export class OpenRouterApiError extends Error {
  constructor(
    public status: number,
    public type: string | null,
    public code: string | null,
    message: string,
    public requestId: string | null,
  ) {
    super(message);
    this.name = 'OpenRouterApiError';
  }
}

export async function askOpenRouter(opts: AskOpenRouterOptions): Promise<AskOpenRouterResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is required');

  const model = opts.model ?? DEFAULT_MODEL;
  const messages = buildInput(opts);
  if (messages.length === 0) {
    throw new Error('askOpenRouter: pass `prompt` or `messages` (at least one user message)');
  }

  const body: Record<string, unknown> = {
    model,
    messages,
    // Always request usage accounting (so `usage.cost` comes back) and restrict
    // routing to providers that honor structured outputs. Both are load-bearing.
    usage: { include: true },
    provider: { require_parameters: true },
  };
  if (opts.maxOutputTokens !== undefined) body.max_tokens = opts.maxOutputTokens;
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.jsonSchema) {
    body.response_format = {
      type: 'json_schema',
      json_schema: {
        name: opts.jsonSchema.name,
        strict: opts.jsonSchema.strict ?? true,
        schema: opts.jsonSchema.schema,
      },
    };
  }
  // 'none' means "no extended reasoning" — omit the field entirely rather than
  // send effort:'none', which some providers reject.
  if (opts.reasoningEffort && opts.reasoningEffort !== 'none') {
    body.reasoning = { effort: opts.reasoningEffort };
  }

  const doFetch = opts.fetchImpl ?? fetch;
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
          'HTTP-Referer': APP_REFERER,
          'X-Title': APP_TITLE,
        },
        body: JSON.stringify(body),
      };
      if (opts.signal) init.signal = opts.signal;
      const res = await doFetch(`${OPENROUTER_API_BASE}/chat/completions`, init);

      const requestId = res.headers.get('x-request-id');

      if (res.ok) {
        const data = (await res.json()) as OpenRouterResponse;
        const durationMs = performance.now() - start;
        const text = data.choices?.[0]?.message?.content ?? '';
        const usage = readUsage(data);
        // Cost comes straight off the response (OpenRouter credits are USD). A
        // 2xx with tokens but no usage.cost means accounting was dropped — log
        // $0 and shout, don't guess (§9.1 pricing truthfulness).
        const reportedCost = readCost(data.usage?.cost);
        const costUsd = reportedCost ?? 0;
        if (reportedCost === null && usage.totalTokens > 0) {
          console.warn(
            `openrouter: model '${model}' returned ${usage.totalTokens} tokens but no usage.cost — this call logged $0. OpenRouter reports cost when usage.include is set; check the provider.`,
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
        // Soft watchdog runs after the row lands, so today's sum includes it.
        checkBudget();

        return {
          text,
          model: data.model ?? model,
          usage,
          costUsd,
          durationMs,
          requestId,
        };
      }

      // Error path. Parse `{error:{message,code}}`, fall back to status text.
      // Retry 429/5xx; throw otherwise.
      const errBody = await res.text();
      const parsed = safeParseError(errBody);
      const apiErr = new OpenRouterApiError(
        res.status,
        parsed?.type ?? null,
        parsed?.code != null ? String(parsed.code) : null,
        parsed?.message ?? `OpenRouter ${res.status} ${res.statusText}`,
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
      if (err instanceof OpenRouterApiError) throw err;
      // Network/abort errors. Don't retry aborts.
      if (err instanceof Error && err.name === 'AbortError') throw err;
      if (attempt < maxAttempts) {
        await sleep(retryDelay(null, attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error('askOpenRouter: exhausted attempts');
}

function buildInput(opts: AskOpenRouterOptions): OpenRouterMessage[] {
  const out: OpenRouterMessage[] = [];
  if (opts.system) out.push({ role: 'system', content: opts.system });
  if (opts.messages) out.push(...opts.messages);
  if (opts.prompt) out.push({ role: 'user', content: opts.prompt });
  return out;
}

function readUsage(data: OpenRouterResponse): OpenRouterUsage {
  const u = data.usage ?? {};
  const inputTokens = u.prompt_tokens ?? 0;
  const cachedInputTokens = u.prompt_tokens_details?.cached_tokens ?? 0;
  const outputTokens = u.completion_tokens ?? 0;
  const totalTokens = u.total_tokens ?? inputTokens + outputTokens;
  return { inputTokens, cachedInputTokens, outputTokens, totalTokens };
}

function readCost(cost: number | undefined): number | null {
  if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0) return null;
  return cost;
}

function safeParseError(
  body: string,
): { message?: string; type?: string; code?: string | number } | null {
  try {
    const j = JSON.parse(body) as {
      error?: { message?: string; type?: string; code?: string | number };
    };
    return j.error ?? null;
  } catch {
    return null;
  }
}

function shouldRetry(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 504);
}

function retryDelay(res: Response | null, attempt: number): number {
  // Honor `retry-after` (seconds) when OpenRouter sends it.
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

function dailyBudgetUsd(): number {
  const raw = process.env.OPENROUTER_DAILY_BUDGET_USD;
  if (raw == null || raw === '') return DEFAULT_DAILY_BUDGET_USD;
  const n = Number.parseFloat(raw);
  // A non-positive / unparseable value disables the watchdog rather than
  // silently reverting to the default (lets an operator turn it off with 0).
  return Number.isFinite(n) ? n : DEFAULT_DAILY_BUDGET_USD;
}

function checkBudget(): void {
  const budget = dailyBudgetUsd();
  if (budget <= 0) return;
  try {
    const from = new Date();
    from.setUTCHours(0, 0, 0, 0);
    const row = db
      .select({ total: sql<string>`coalesce(sum(${costEvents.costUsd}), 0)` })
      .from(costEvents)
      .where(sql`${costEvents.platform} = 'openrouter' and ${costEvents.ts} >= ${from.getTime()}`)
      .get();
    const total = Number(row?.total ?? 0);
    if (total >= budget) {
      console.error(
        `BUDGET WATCHDOG: 'openrouter' spend today is $${total.toFixed(5)} — over the $${budget.toFixed(2)}/day soft budget (OPENROUTER_DAILY_BUDGET_USD). See GET /cost/today for the breakdown.`,
      );
    }
  } catch (err) {
    console.error('openrouter: budget check failed:', err instanceof Error ? err.message : err);
  }
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
  // Fire-and-forget — same guarantee as askGrok's logCost and costTracker: a
  // failed insert must never break the caller of askOpenRouter.
  try {
    db.insert(costEvents)
      .values({
        platform: 'openrouter',
        endpoint: '/v1/chat/completions',
        status: info.status,
        items: info.totalTokens || null,
        costUsd: Number(info.costUsd.toFixed(5)),
        durationMs: Math.round(info.durationMs),
        attempts: info.attempts,
        requestId: info.requestId,
      })
      .run();
  } catch (err) {
    console.error('openrouter cost log failed:', err instanceof Error ? err.message : err);
  }
}
