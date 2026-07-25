// Public surface of the OpenRouter slice — a second LLM provider sibling to
// src/grok/. The AI-layer dispatcher (src/llm/ask.ts, AI.2) is the only intended
// caller; nothing else should import from inside src/openrouter/. No route/mount
// here: the /llm/* routes live in src/llm/ (AI.2), not in this vertical.

export { askOpenRouter, OpenRouterApiError, DEFAULT_MODEL } from './client.ts';
export type {
  AskOpenRouterOptions,
  AskOpenRouterResult,
  FetchLike,
  OpenRouterJsonSchemaFormat,
  OpenRouterMessage,
  OpenRouterReasoningEffort,
  OpenRouterUsage,
} from './client.ts';
