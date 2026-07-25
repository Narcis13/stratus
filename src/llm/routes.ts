// /llm/* routes (AI.2) — mounted always (bearer-guarded at the app level), so
// the Settings → AI panel can read/write the provider config regardless of which
// (if any) LLM key is set. Only /llm/models needs a live key (503 without it).
//
//   GET   /llm/settings                 → the typed AI settings + provider flags
//   PATCH /llm/settings   {…}           → validated partial (400 per field);
//                                         picking openrouter without its key → 409
//   GET   /llm/models                   → OpenRouter's free model list, cached 1h

import { Hono } from 'hono';
import { llmProviderReady } from './ask.ts';
import { getAiSettings, parseAiPatch, saveAiSettings } from './settings.ts';

export const llm = new Hono();

function providerFlags(): { grok: boolean; openrouter: boolean } {
  return { grok: llmProviderReady('grok'), openrouter: llmProviderReady('openrouter') };
}

llm.get('/llm/settings', (c) => {
  return c.json({ ...getAiSettings(), providers: providerFlags() });
});

llm.patch('/llm/settings', async (c) => {
  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const parsed = parseAiPatch(raw as Record<string, unknown>);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  // Selecting openrouter without its key would strand every draft on a provider
  // that can't run — refuse before persisting the choice.
  if (parsed.patch.provider === 'openrouter' && !llmProviderReady('openrouter')) {
    return c.json({ error: 'provider_not_configured' }, 409);
  }
  const next = saveAiSettings(parsed.patch);
  return c.json({ ...next, providers: providerFlags() });
});

// OpenRouter's models endpoint is free ($0) and needs no auth, but we send the
// key anyway (some models are key-gated). Cached in-memory 1h — the list changes
// rarely and the Settings picker reads it on every open.
interface ModelRow {
  id: string;
  name: string;
  promptPrice: string | null;
  completionPrice: string | null;
}

const MODELS_TTL_MS = 60 * 60 * 1000;
let modelsCache: { fetchedAt: number; models: ModelRow[] } | null = null;

llm.get('/llm/models', async (c) => {
  if (!llmProviderReady('openrouter')) {
    return c.json({ error: 'openrouter_not_configured' }, 503);
  }
  const now = Date.now();
  if (modelsCache && now - modelsCache.fetchedAt < MODELS_TTL_MS) {
    return c.json({ models: modelsCache.models });
  }
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: {
        authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        accept: 'application/json',
      },
    });
    if (!res.ok) {
      // Serve a stale cache over a hard failure if we have one.
      if (modelsCache) return c.json({ models: modelsCache.models });
      return c.json({ error: 'models_fetch_failed', status: res.status }, 502);
    }
    const data = (await res.json()) as {
      data?: Array<{
        id?: string;
        name?: string;
        pricing?: { prompt?: string; completion?: string };
      }>;
    };
    const models: ModelRow[] = [];
    for (const m of data.data ?? []) {
      if (typeof m.id !== 'string') continue;
      models.push({
        id: m.id,
        name: typeof m.name === 'string' ? m.name : m.id,
        promptPrice: m.pricing?.prompt ?? null,
        completionPrice: m.pricing?.completion ?? null,
      });
    }
    modelsCache = { fetchedAt: now, models };
    return c.json({ models });
  } catch (err) {
    if (modelsCache) return c.json({ models: modelsCache.models });
    return c.json(
      { error: 'models_fetch_failed', message: err instanceof Error ? err.message : String(err) },
      502,
    );
  }
});
