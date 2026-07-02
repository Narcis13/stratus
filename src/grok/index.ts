// Public surface of the Grok slice. Cross-vertical helper, not a social
// platform — sits next to `src/x/` rather than inside it. `app.ts` is the only
// outside caller; nothing else should import from inside `src/grok/`.

import type { Hono } from 'hono';
import { ask } from './routes/ask.ts';

export function mountGrok(app: Hono): void {
  if (!process.env.XAI_API_KEY) {
    console.log('grok: XAI_API_KEY not set — /grok/ask not mounted');
    return;
  }
  app.route('/', ask);
}

export { askGrok, GrokApiError } from './client.ts';
export type {
  AskGrokOptions,
  AskGrokResult,
  GrokJsonSchemaFormat,
  GrokMessage,
  ReasoningEffort,
} from './client.ts';
