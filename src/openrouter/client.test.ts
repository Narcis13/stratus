// askOpenRouter — pure parts only, no real network (an injected `fetchImpl`
// records the request and hands back a canned Response). Covers the OpenAI-shape
// request mapping, cost extraction off `usage.cost`, retry classification, error
// parsing, and the soft budget watchdog. Cleans up the `cost_events` rows the
// mocked calls insert (shared in-memory DB — other suites sum spend).

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { costEvents } from '../db/shared-schema.ts';
import { OpenRouterApiError, askOpenRouter } from './client.ts';

const savedKey = process.env.OPENROUTER_API_KEY;
const savedBudget = process.env.OPENROUTER_DAILY_BUDGET_USD;

beforeEach(() => {
  // A key must be present or askOpenRouter throws before ever calling fetch.
  process.env.OPENROUTER_API_KEY = 'test-key-not-used-fetch-is-mocked';
  // Default budget high enough that the tiny mocked spends never trip the
  // watchdog (the watchdog test sets its own low budget).
  process.env.OPENROUTER_DAILY_BUDGET_USD = '1000';
});

afterEach(() => {
  process.env.OPENROUTER_API_KEY = savedKey ?? '';
  process.env.OPENROUTER_DAILY_BUDGET_USD = savedBudget ?? '';
});

afterAll(() => {
  // Don't leak spend into the shared in-memory DB's other suites.
  db.delete(costEvents).where(eq(costEvents.platform, 'openrouter')).run();
});

const OK_BODY = {
  id: 'gen-test',
  model: 'anthropic/claude-sonnet-4.5',
  choices: [{ message: { content: 'hello there' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17, cost: 0.0012 },
};

interface CapturedCall {
  url: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      'content-type': 'application/json',
      'x-request-id': 'req-test',
      ...(init.headers ?? {}),
    },
  });
}

// A fetch that records each call and returns whatever `responder(callNo)` gives.
function recordingFetch(responder: (callNo: number) => Response): {
  fetchImpl: (url: string, reqInit: RequestInit) => Promise<Response>;
  calls: CapturedCall[];
} {
  const calls: CapturedCall[] = [];
  const fetchImpl = async (url: string, reqInit: RequestInit): Promise<Response> => {
    const raw = typeof reqInit.body === 'string' ? reqInit.body : '';
    calls.push({
      url,
      body: (raw ? JSON.parse(raw) : {}) as Record<string, unknown>,
      headers: (reqInit.headers ?? {}) as Record<string, string>,
    });
    return responder(calls.length);
  };
  return { fetchImpl, calls };
}

async function captureConsole(
  method: 'warn' | 'error',
  fn: () => Promise<void>,
): Promise<string[]> {
  const orig = console[method];
  const out: string[] = [];
  console[method] = (...args: unknown[]) => {
    out.push(args.map((a) => String(a)).join(' '));
  };
  try {
    await fn();
  } finally {
    console[method] = orig;
  }
  return out;
}

describe('askOpenRouter — request mapping', () => {
  test('maps to the OpenAI chat-completions shape (schema, usage, provider, messages)', async () => {
    const { fetchImpl, calls } = recordingFetch(() => jsonResponse(OK_BODY));
    const r = await askOpenRouter({
      prompt: 'hi',
      system: 'be terse',
      jsonSchema: { name: 'reply', schema: { type: 'object', properties: {} } },
      reasoningEffort: 'none',
      temperature: 0.7,
      maxOutputTokens: 200,
      fetchImpl,
    });

    expect(r.text).toBe('hello there');
    expect(r.model).toBe('anthropic/claude-sonnet-4.5');
    expect(r.usage).toEqual({
      inputTokens: 12,
      cachedInputTokens: 0,
      outputTokens: 5,
      totalTokens: 17,
    });

    const call = calls[0];
    if (!call) throw new Error('no fetch call captured');
    expect(call.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    const b = call.body;
    expect(b.model).toBe('anthropic/claude-sonnet-4.5'); // fallback default
    expect(b.messages).toEqual([
      { role: 'system', content: 'be terse' },
      { role: 'user', content: 'hi' },
    ]);
    expect(b.max_tokens).toBe(200);
    expect(b.temperature).toBe(0.7);
    // structured outputs via response_format, NOT xAI's text.format
    expect(b.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'reply', strict: true, schema: { type: 'object', properties: {} } },
    });
    // always on
    expect(b.usage).toEqual({ include: true });
    expect(b.provider).toEqual({ require_parameters: true });
    // 'none' effort omits the reasoning field entirely
    expect('reasoning' in b).toBe(false);
    // attribution headers present
    expect(call.headers['HTTP-Referer']).toBe('https://stratus-narcis.duckdns.org');
    expect(call.headers['X-Title']).toBe('stratus');
  });

  test('reasoningEffort in {low,medium,high} sends reasoning.effort', async () => {
    const { fetchImpl, calls } = recordingFetch(() => jsonResponse(OK_BODY));
    await askOpenRouter({ prompt: 'hi', reasoningEffort: 'medium', fetchImpl });
    const call = calls[0];
    if (!call) throw new Error('no fetch call captured');
    expect(call.body.reasoning).toEqual({ effort: 'medium' });
  });

  test('no jsonSchema → no response_format; usage.include still always on', async () => {
    const { fetchImpl, calls } = recordingFetch(() => jsonResponse(OK_BODY));
    await askOpenRouter({ prompt: 'hi', fetchImpl });
    const call = calls[0];
    if (!call) throw new Error('no fetch call captured');
    expect('response_format' in call.body).toBe(false);
    expect(call.body.usage).toEqual({ include: true });
    expect(call.body.provider).toEqual({ require_parameters: true });
  });
});

describe('askOpenRouter — cost extraction', () => {
  test('reads usage.cost (USD) and logs a platform=openrouter row', async () => {
    const before = countOpenrouterRows();
    const { fetchImpl } = recordingFetch(() => jsonResponse(OK_BODY));
    const r = await askOpenRouter({ prompt: 'hi', fetchImpl });
    expect(r.costUsd).toBeCloseTo(0.0012, 5);

    const rows = openrouterRows();
    expect(rows.length).toBe(before + 1);
    const last = rows[rows.length - 1];
    if (!last) throw new Error('no cost row inserted');
    expect(last.platform).toBe('openrouter');
    expect(last.endpoint).toBe('/v1/chat/completions');
    expect(last.status).toBe(200);
    expect(last.items).toBe(17); // total tokens
    expect(last.costUsd).toBeCloseTo(0.0012, 5);
  });

  test('2xx with tokens but no usage.cost → $0 + console.warn (§9.1)', async () => {
    const noCost = {
      ...OK_BODY,
      usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
    };
    const { fetchImpl } = recordingFetch(() => jsonResponse(noCost));
    const warnings = await captureConsole('warn', async () => {
      const r = await askOpenRouter({ prompt: 'hi', fetchImpl });
      expect(r.costUsd).toBe(0);
    });
    expect(warnings.some((w) => w.includes('usage.cost'))).toBe(true);
  });
});

describe('askOpenRouter — retry & error classification', () => {
  test('429 retries then succeeds', async () => {
    const { fetchImpl, calls } = recordingFetch((n) =>
      n === 1
        ? jsonResponse(
            { error: { message: 'rate limited' } },
            {
              status: 429,
              headers: { 'retry-after': '0' },
            },
          )
        : jsonResponse(OK_BODY),
    );
    const r = await askOpenRouter({ prompt: 'hi', fetchImpl });
    expect(calls.length).toBe(2);
    expect(r.text).toBe('hello there');
  });

  test('503 retries then succeeds', async () => {
    const { fetchImpl, calls } = recordingFetch((n) =>
      n === 1
        ? jsonResponse(
            { error: { message: 'overloaded' } },
            {
              status: 503,
              headers: { 'retry-after': '0' },
            },
          )
        : jsonResponse(OK_BODY),
    );
    const r = await askOpenRouter({ prompt: 'hi', fetchImpl });
    expect(calls.length).toBe(2);
    expect(r.text).toBe('hello there');
  });

  test('400 throws OpenRouterApiError without retry and parses code/message', async () => {
    const { fetchImpl, calls } = recordingFetch(() =>
      jsonResponse({ error: { message: 'bad request', code: 'invalid_body' } }, { status: 400 }),
    );
    let caught: unknown;
    try {
      await askOpenRouter({ prompt: 'hi', fetchImpl, maxAttempts: 3 });
    } catch (err) {
      caught = err;
    }
    expect(calls.length).toBe(1); // no retry on 400
    expect(caught).toBeInstanceOf(OpenRouterApiError);
    const e = caught as OpenRouterApiError;
    expect(e.status).toBe(400);
    expect(e.code).toBe('invalid_body');
    expect(e.message).toContain('bad request');
    expect(e.requestId).toBe('req-test');
  });

  test('numeric error code is coerced to a string', async () => {
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({ error: { message: 'nope', code: 402 } }, { status: 402 }),
    );
    let caught: unknown;
    try {
      await askOpenRouter({ prompt: 'hi', fetchImpl, maxAttempts: 1 });
    } catch (err) {
      caught = err;
    }
    const e = caught as OpenRouterApiError;
    expect(e).toBeInstanceOf(OpenRouterApiError);
    expect(e.code).toBe('402');
  });
});

describe('askOpenRouter — soft budget watchdog', () => {
  test('logs BUDGET WATCHDOG once today’s openrouter spend crosses the cap', async () => {
    process.env.OPENROUTER_DAILY_BUDGET_USD = '0.001';
    // Seed today's openrouter spend already over the tiny cap.
    const marker = `test-watchdog-${OK_BODY.id}`;
    db.insert(costEvents)
      .values({
        platform: 'openrouter',
        endpoint: '/v1/chat/completions',
        status: 200,
        items: 100,
        costUsd: 0.05,
        durationMs: 5,
        attempts: 1,
        requestId: marker,
      })
      .run();

    const { fetchImpl } = recordingFetch(() => jsonResponse(OK_BODY));
    const errors = await captureConsole('error', async () => {
      await askOpenRouter({ prompt: 'hi', fetchImpl });
    });
    expect(errors.some((e) => e.includes('BUDGET WATCHDOG') && e.includes('openrouter'))).toBe(
      true,
    );

    db.delete(costEvents).where(eq(costEvents.requestId, marker)).run();
  });
});

function openrouterRows(): Array<{
  platform: string;
  endpoint: string | null;
  status: number | null;
  items: number | null;
  costUsd: number | null;
}> {
  return db
    .select({
      platform: costEvents.platform,
      endpoint: costEvents.endpoint,
      status: costEvents.status,
      items: costEvents.items,
      costUsd: costEvents.costUsd,
    })
    .from(costEvents)
    .where(eq(costEvents.platform, 'openrouter'))
    .all();
}

function countOpenrouterRows(): number {
  return openrouterRows().length;
}
