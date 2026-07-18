// /llm/* routes over an in-memory Hono (bare-mounted, no app-level bearer — the
// channels.test.ts pattern). GET/PATCH settings incl. per-field 400s, the
// openrouter-without-key 409, and the /llm/models 503. Env is saved/unset/
// restored so the 409/503 paths never depend on the dev machine's keys and never
// touch the network. Cleans up the 'ai' row (shared DB).

import { afterEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client.ts';
import { appSettings } from '../db/shared-schema.ts';
import { llm } from './routes.ts';

const app = new Hono();
app.route('/', llm);

const savedXai = process.env.XAI_API_KEY;
const savedOr = process.env.OPENROUTER_API_KEY;

afterEach(() => {
  restore('XAI_API_KEY', savedXai);
  restore('OPENROUTER_API_KEY', savedOr);
  db.delete(appSettings).where(eq(appSettings.key, 'ai')).run();
});

function restore(key: string, val: string | undefined): void {
  // Empty string, not delete: falsy so the readiness checks read it as unset,
  // and biome's noDelete stays happy (the AI.1 client.test.ts pattern).
  process.env[key] = val ?? '';
}

async function patch(body: unknown): Promise<Response> {
  return app.request('/llm/settings', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('GET /llm/settings', () => {
  test('returns the settings plus per-provider presence flags', async () => {
    process.env.XAI_API_KEY = 'x';
    process.env.OPENROUTER_API_KEY = '';
    const res = await app.request('/llm/settings');
    expect(res.status).toBe(200);
    const j = (await res.json()) as Record<string, unknown>;
    expect(j.provider).toBe('grok');
    expect(j.openrouterModel).toBe('anthropic/claude-sonnet-4.5');
    expect(j.providers).toEqual({ grok: true, openrouter: false });
  });
});

describe('PATCH /llm/settings', () => {
  test('persists a valid patch and GET reflects it', async () => {
    const res = await patch({ temperature: 0.5, maxOutputTokens: 700 });
    expect(res.status).toBe(200);
    const j = (await res.json()) as Record<string, unknown>;
    expect(j.temperature).toBe(0.5);
    expect(j.maxOutputTokens).toBe(700);
    expect(j.providers).toBeDefined();

    const get = (await (await app.request('/llm/settings')).json()) as Record<string, unknown>;
    expect(get.temperature).toBe(0.5);
    expect(get.maxOutputTokens).toBe(700);
  });

  test('non-object body → 400 invalid_body', async () => {
    const res = await app.request('/llm/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: '[]',
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_body');
  });

  test.each([
    [{ provider: 'gemini' }, 'invalid_provider'],
    [{ temperature: 5 }, 'invalid_temperature'],
    [{ maxOutputTokens: 0 }, 'invalid_max_output_tokens'],
    [{ reasoningEffort: 'ultra' }, 'invalid_reasoning_effort'],
    [{ openrouterModel: '' }, 'invalid_openrouter_model'],
  ])('rejects %o with 400 %s', async (body, code) => {
    const res = await patch(body);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(code);
  });

  test('selecting openrouter without OPENROUTER_API_KEY → 409 provider_not_configured', async () => {
    process.env.OPENROUTER_API_KEY = '';
    const res = await patch({ provider: 'openrouter' });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe('provider_not_configured');
  });

  test('selecting openrouter WITH the key persists', async () => {
    process.env.OPENROUTER_API_KEY = 'o';
    const res = await patch({ provider: 'openrouter' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { provider: string }).provider).toBe('openrouter');
  });
});

describe('GET /llm/models', () => {
  test('503 openrouter_not_configured without the key', async () => {
    process.env.OPENROUTER_API_KEY = '';
    const res = await app.request('/llm/models');
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe('openrouter_not_configured');
  });
});
