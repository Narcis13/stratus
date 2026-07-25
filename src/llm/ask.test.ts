// askLLM dispatcher — provider resolution, the opts>settings>defaults merge
// precedence, the no-silent-fallback LlmNotConfiguredError, and the runtime
// gates. The OpenRouter path is exercised end-to-end via an injected fetch
// (askGrok has no fetch seam, so the Grok branch is proved "by shape": the
// resolver routes to it and its readiness gate throws for the right provider).
// Cleans up the 'ai' settings row + any openrouter cost rows (shared DB).

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { appSettings, costEvents } from '../db/shared-schema.ts';
import {
  LlmNotConfiguredError,
  askLLM,
  llmConfigured,
  llmProviderReady,
  resolveProvider,
} from './ask.ts';
import { DEFAULT_AI_SETTINGS, saveAiSettings } from './settings.ts';

const savedXai = process.env.XAI_API_KEY;
const savedOr = process.env.OPENROUTER_API_KEY;
const savedBudget = process.env.OPENROUTER_DAILY_BUDGET_USD;

beforeEach(() => {
  // Keep the mocked openrouter spends from ever tripping the watchdog.
  process.env.OPENROUTER_DAILY_BUDGET_USD = '1000';
});

afterEach(() => {
  restore('XAI_API_KEY', savedXai);
  restore('OPENROUTER_API_KEY', savedOr);
  restore('OPENROUTER_DAILY_BUDGET_USD', savedBudget);
  db.delete(appSettings).where(eq(appSettings.key, 'ai')).run();
  db.delete(costEvents).where(eq(costEvents.platform, 'openrouter')).run();
});

function restore(key: string, val: string | undefined): void {
  // Empty string, not delete: falsy so the readiness checks read it as unset,
  // and biome's noDelete stays happy (the AI.1 client.test.ts pattern).
  process.env[key] = val ?? '';
}

interface CapturedCall {
  url: string;
  body: Record<string, unknown>;
}

function recordingFetch(): {
  fetchImpl: (url: string, init: RequestInit) => Promise<Response>;
  calls: CapturedCall[];
} {
  const calls: CapturedCall[] = [];
  const fetchImpl = async (url: string, init: RequestInit): Promise<Response> => {
    const raw = typeof init.body === 'string' ? init.body : '';
    calls.push({ url, body: (raw ? JSON.parse(raw) : {}) as Record<string, unknown> });
    return new Response(
      JSON.stringify({
        id: 'gen-1',
        model: 'echo/model',
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5, cost: 0.0001 },
      }),
      { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'r1' } },
    );
  };
  return { fetchImpl, calls };
}

describe('runtime gates', () => {
  test('llmConfigured is true when either key is present', () => {
    process.env.XAI_API_KEY = '';
    process.env.OPENROUTER_API_KEY = '';
    expect(llmConfigured()).toBe(false);
    process.env.XAI_API_KEY = 'x';
    expect(llmConfigured()).toBe(true);
    process.env.XAI_API_KEY = '';
    process.env.OPENROUTER_API_KEY = 'o';
    expect(llmConfigured()).toBe(true);
  });

  test('llmProviderReady checks the per-provider key', () => {
    process.env.XAI_API_KEY = 'x';
    process.env.OPENROUTER_API_KEY = '';
    expect(llmProviderReady('grok')).toBe(true);
    expect(llmProviderReady('openrouter')).toBe(false);
  });
});

describe('resolveProvider precedence', () => {
  test('explicit opts.provider wins over the stored setting', () => {
    expect(resolveProvider({ provider: 'openrouter' }, { ...DEFAULT_AI_SETTINGS })).toBe(
      'openrouter',
    );
  });
  test('falls back to the stored setting when opts omit it', () => {
    expect(resolveProvider({}, { ...DEFAULT_AI_SETTINGS, provider: 'openrouter' })).toBe(
      'openrouter',
    );
  });
});

describe('no silent fallback', () => {
  test('resolved openrouter without OPENROUTER_API_KEY throws LlmNotConfiguredError', async () => {
    process.env.OPENROUTER_API_KEY = '';
    process.env.XAI_API_KEY = 'x'; // the other key is set — must NOT be used
    let caught: unknown;
    try {
      await askLLM({ provider: 'openrouter', prompt: 'hi' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(LlmNotConfiguredError);
    expect((caught as LlmNotConfiguredError).provider).toBe('openrouter');
  });

  test('resolved grok without XAI_API_KEY throws LlmNotConfiguredError (routes to grok, not openrouter)', async () => {
    process.env.XAI_API_KEY = '';
    process.env.OPENROUTER_API_KEY = 'o'; // present but must NOT be used
    let caught: unknown;
    try {
      await askLLM({ provider: 'grok', prompt: 'hi' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(LlmNotConfiguredError);
    expect((caught as LlmNotConfiguredError).provider).toBe('grok');
  });
});

describe('openrouter dispatch + merge precedence', () => {
  test('dispatches to the openrouter endpoint; settings model + params fill in when opts omit them', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    saveAiSettings({
      provider: 'openrouter',
      openrouterModel: 'settings/model',
      temperature: 0.9,
      maxOutputTokens: 500,
      reasoningEffort: 'low',
    });
    const { fetchImpl, calls } = recordingFetch();
    const r = await askLLM(
      { prompt: 'hi', jsonSchema: { name: 's', schema: { type: 'object' } }, fetchImpl },
      { defaults: { temperature: 0.1, maxOutputTokens: 100, model: 'default/model' } },
    );

    expect(r.provider).toBe('openrouter');
    expect(r.text).toBe('ok');
    expect(r.model).toBe('echo/model');
    const call = calls[0];
    if (!call) throw new Error('no openrouter call captured');
    expect(call.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    // settings > call-site defaults
    expect(call.body.model).toBe('settings/model');
    expect(call.body.temperature).toBe(0.9);
    expect(call.body.max_tokens).toBe(500);
    expect(call.body.reasoning).toEqual({ effort: 'low' });
    // jsonSchema mapped to the OpenAI response_format (never xAI's text.format)
    expect(call.body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 's', strict: true, schema: { type: 'object' } },
    });
    expect('text' in call.body).toBe(false);
  });

  test('route-body opts beat DB settings for model, temperature, and effort', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    saveAiSettings({
      provider: 'openrouter',
      openrouterModel: 'settings/model',
      temperature: 0.9,
      reasoningEffort: 'low',
    });
    const { fetchImpl, calls } = recordingFetch();
    await askLLM({
      prompt: 'hi',
      model: 'opts/model',
      temperature: 0.2,
      reasoningEffort: 'high',
      fetchImpl,
    });
    const call = calls[0];
    if (!call) throw new Error('no openrouter call captured');
    expect(call.body.model).toBe('opts/model');
    expect(call.body.temperature).toBe(0.2);
    expect(call.body.reasoning).toEqual({ effort: 'high' });
  });

  test('effort resolving to none omits the reasoning field', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    saveAiSettings({ provider: 'openrouter', reasoningEffort: 'none' });
    const { fetchImpl, calls } = recordingFetch();
    await askLLM({ prompt: 'hi', fetchImpl });
    const call = calls[0];
    if (!call) throw new Error('no openrouter call captured');
    expect('reasoning' in call.body).toBe(false);
    // opts omit the model → settings default (sonnet) flows through
    expect(call.body.model).toBe('anthropic/claude-sonnet-4.5');
  });
});
