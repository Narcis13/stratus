// Public surface of the LLM dispatch layer (AI.2). `app.ts` is the only outside
// caller of `mountLlm`; call sites (AI.3/5/6 onward) import `askLLM` +
// `llmConfigured`/`llmProviderReady` from here. Unlike `mountGrok`, `mountLlm`
// always mounts — the /llm/settings routes must work with no LLM key set (the
// panel configures the provider before a key even exists in some flows).

import type { Hono } from 'hono';
import { llm } from './routes.ts';

export function mountLlm(app: Hono): void {
  app.route('/', llm);
}

export {
  askLLM,
  llmConfigured,
  llmProviderReady,
  resolveProvider,
  LlmNotConfiguredError,
} from './ask.ts';
export type {
  AskLlmOptions,
  AskLlmResult,
  LlmDefaults,
  LlmJsonSchemaFormat,
  LlmMessage,
  LlmProvider,
  LlmReasoningEffort,
} from './ask.ts';
export { getAiSettings, saveAiSettings, parseAiPatch, DEFAULT_AI_SETTINGS } from './settings.ts';
export type { AiSettings } from './settings.ts';
