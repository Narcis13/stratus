// askLLM — the provider dispatcher (AI.2). §7.1 extended: this is the ONE place
// that picks grok vs openrouter; each provider keeps its own single entry point
// (askGrok / askOpenRouter, unchanged). The resolution + merge precedence live
// HERE and are never re-implemented per route:
//
//   route-body opts  >  DB AI settings  >  call-site house defaults
//
// A resolved provider whose env key is missing throws LlmNotConfiguredError —
// NEVER a silent fallback to the other provider. The user chose the provider;
// silently running the other one would lie about which model produced a draft.

import { type AskGrokResult, GrokApiError, askGrok } from '../grok/index.ts';
import {
  type AskOpenRouterResult,
  type FetchLike,
  OpenRouterApiError,
  askOpenRouter,
} from '../openrouter/index.ts';
import {
  type AiSettings,
  type LlmProvider,
  type LlmReasoningEffort,
  getAiSettings,
} from './settings.ts';

export type { LlmProvider, LlmReasoningEffort } from './settings.ts';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// Structurally identical to both GrokJsonSchemaFormat and
// OpenRouterJsonSchemaFormat — the dispatcher hands the same shape to whichever
// provider runs, and each client maps it to its own request field (§7.17).
export interface LlmJsonSchemaFormat {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
}

export interface AskLlmOptions {
  /** Explicit provider override (highest precedence); else the stored setting. */
  provider?: LlmProvider;
  model?: string;
  prompt?: string;
  system?: string;
  messages?: LlmMessage[];
  reasoningEffort?: LlmReasoningEffort;
  maxOutputTokens?: number;
  temperature?: number;
  jsonSchema?: LlmJsonSchemaFormat;
  /** Grok-only prompt-prefix cache key; ignored on the OpenRouter path. */
  promptCacheKey?: string;
  maxAttempts?: number;
  signal?: AbortSignal;
  /** OpenRouter test seam (defaults to global fetch); ignored on the Grok path. */
  fetchImpl?: FetchLike;
}

/** Call-site house defaults — the LOWEST precedence tier (opts > settings > these). */
export interface LlmDefaults {
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  reasoningEffort?: LlmReasoningEffort;
}

export interface AskLlmResult {
  /** Which provider actually ran (after resolution) — informational for callers. */
  provider: LlmProvider;
  text: string;
  model: string;
  usage: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  costUsd: number;
  durationMs: number;
  requestId: string | null;
}

export class LlmNotConfiguredError extends Error {
  constructor(public provider: LlmProvider) {
    super(
      provider === 'openrouter'
        ? 'OPENROUTER_API_KEY is not set — set it or pick the grok provider'
        : 'XAI_API_KEY is not set — set it or pick the openrouter provider',
    );
    this.name = 'LlmNotConfiguredError';
  }
}

/** HTTP mapping for the three typed askLLM failures, shared by every route
 *  call site (AI.5) so the error contract can't drift per route: missing key →
 *  503, provider upstream error → 429/502 with the provider-tagged shape the
 *  panel already knows from the Grok-only days. Returns null for anything else
 *  — the route keeps its own generic branch (route-specific error key + log). */
export interface LlmErrorPayload {
  status: 429 | 502 | 503;
  body: Record<string, unknown>;
}

export function llmErrorPayload(err: unknown): LlmErrorPayload | null {
  if (err instanceof LlmNotConfiguredError) {
    return {
      status: 503,
      body: { error: 'llm_not_configured', provider: err.provider, message: err.message },
    };
  }
  if (err instanceof GrokApiError || err instanceof OpenRouterApiError) {
    return {
      status: err.status === 429 ? 429 : 502,
      body: {
        error: err instanceof GrokApiError ? 'grok_upstream_error' : 'openrouter_upstream_error',
        status: err.status,
        type: err.type,
        code: err.code,
        message: err.message,
        requestId: err.requestId,
      },
    };
  }
  return null;
}

/** True if EITHER provider's env key is present. This is the AI-layer runtime
 *  gate: the §7.22 mount/503 checks flip from XAI-only to this once call sites
 *  route through askLLM. */
export function llmConfigured(): boolean {
  return Boolean(process.env.XAI_API_KEY || process.env.OPENROUTER_API_KEY);
}

export function llmProviderReady(provider: LlmProvider): boolean {
  return provider === 'openrouter'
    ? Boolean(process.env.OPENROUTER_API_KEY)
    : Boolean(process.env.XAI_API_KEY);
}

/** Pure — the resolved provider (explicit opts win, else the stored setting). */
export function resolveProvider(opts: AskLlmOptions, settings: AiSettings): LlmProvider {
  return opts.provider ?? settings.provider;
}

export async function askLLM(
  opts: AskLlmOptions,
  cfg: { defaults?: LlmDefaults } = {},
): Promise<AskLlmResult> {
  const settings = getAiSettings();
  const provider = resolveProvider(opts, settings);
  if (!llmProviderReady(provider)) throw new LlmNotConfiguredError(provider);

  const defaults = cfg.defaults ?? {};
  const temperature = opts.temperature ?? settings.temperature ?? defaults.temperature ?? undefined;
  const maxOutputTokens =
    opts.maxOutputTokens ?? settings.maxOutputTokens ?? defaults.maxOutputTokens ?? undefined;
  // null (the "unset" settings value) can never survive the ?? chain, so the
  // resolved effort is E | undefined; each client applies its own 'none' rule.
  const reasoningEffort: LlmReasoningEffort | undefined =
    opts.reasoningEffort ?? settings.reasoningEffort ?? defaults.reasoningEffort ?? undefined;

  if (provider === 'openrouter') {
    // openrouterModel is always a non-empty string, so defaults.model is only a
    // theoretical last resort here (Decision 10 keeps the grok default separate).
    const model = opts.model ?? settings.openrouterModel ?? defaults.model;
    const res: AskOpenRouterResult = await askOpenRouter({
      ...(model !== undefined ? { model } : {}),
      ...(opts.prompt !== undefined ? { prompt: opts.prompt } : {}),
      ...(opts.system !== undefined ? { system: opts.system } : {}),
      ...(opts.messages !== undefined ? { messages: opts.messages } : {}),
      ...(opts.jsonSchema !== undefined ? { jsonSchema: opts.jsonSchema } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
      ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
      ...(opts.maxAttempts !== undefined ? { maxAttempts: opts.maxAttempts } : {}),
      ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
      ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
    });
    return { provider, ...toResult(res) };
  }

  // Grok path: undefined model lets askGrok fall back to its own grok-4.3
  // default (Decision 10 — settings.openrouterModel never applies here).
  const model = opts.model ?? defaults.model;
  const res: AskGrokResult = await askGrok({
    ...(model !== undefined ? { model } : {}),
    ...(opts.prompt !== undefined ? { prompt: opts.prompt } : {}),
    ...(opts.system !== undefined ? { system: opts.system } : {}),
    ...(opts.messages !== undefined ? { messages: opts.messages } : {}),
    ...(opts.jsonSchema !== undefined ? { jsonSchema: opts.jsonSchema } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
    ...(opts.promptCacheKey !== undefined ? { promptCacheKey: opts.promptCacheKey } : {}),
    ...(opts.maxAttempts !== undefined ? { maxAttempts: opts.maxAttempts } : {}),
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
  });
  return { provider, ...toResult(res) };
}

function toResult(res: AskGrokResult | AskOpenRouterResult): Omit<AskLlmResult, 'provider'> {
  return {
    text: res.text,
    model: res.model,
    usage: res.usage,
    costUsd: res.costUsd,
    durationMs: res.durationMs,
    requestId: res.requestId,
  };
}
