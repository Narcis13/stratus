// SURFACES-PLAN S2 — MCP server wiring over the real composed app. Drives the
// /mcp JSON-RPC surface exactly as a client would (initialize → tools/list →
// tools/call), one tool per tier, plus the write-tier draft-forced guard and
// the no-bearer 401. Runs against the in-memory DB (bun test sets
// SQLITE_PATH=:memory:); the schema/curated/write tools it exercises are all $0
// (no X/Grok). The token-gated blocks skip when API_TOKEN is unset.

import { describe, expect, test } from 'bun:test';
import { app } from './app.ts';

const TOKEN = process.env.API_TOKEN ?? '';
const authed = TOKEN !== '';
const BEARER = `Bearer ${TOKEN}`;

let nextId = 1;

interface Envelope {
  jsonrpc: string;
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

async function rpc(
  method: string,
  params: unknown,
  opts: { bearer?: boolean } = {},
): Promise<{ status: number; env: Envelope | null }> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };
  if (opts.bearer !== false) headers.authorization = BEARER;
  const res = await app.request('/mcp', {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
  });
  let env: Envelope | null = null;
  try {
    env = (await res.json()) as Envelope;
  } catch {
    env = null;
  }
  return { status: res.status, env };
}

interface ToolCallResult {
  content?: { type: string; text: string }[];
  isError?: boolean;
}

function toolPayload(env: Envelope | null): { data: unknown; isError: boolean } {
  const result = env?.result as ToolCallResult | undefined;
  const text = result?.content?.[0]?.text ?? '';
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* keep raw */
  }
  return { data, isError: result?.isError === true };
}

describe('MCP auth', () => {
  test('POST /mcp without bearer → 401', async () => {
    const { status } = await rpc('tools/list', {}, { bearer: false });
    expect(status).toBe(401);
  });
});

describe.if(authed)('MCP transport', () => {
  test('GET /mcp → 405 JSON-RPC error', async () => {
    const res = await app.request('/mcp', { method: 'GET', headers: { authorization: BEARER } });
    expect(res.status).toBe(405);
    const body = (await res.json()) as Envelope;
    expect(body.error?.code).toBe(-32000);
  });

  test('initialize handshake returns the stratus server', async () => {
    const { status, env } = await rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'mcp-test', version: '0.0.0' },
    });
    expect(status).toBe(200);
    const result = env?.result as { serverInfo?: { name?: string } } | undefined;
    expect(result?.serverInfo?.name).toBe('stratus');
  });

  test('tools/list exposes one tool per tier', async () => {
    const { status, env } = await rpc('tools/list', {});
    expect(status).toBe(200);
    const names = new Set(
      ((env?.result as { tools?: { name: string }[] } | undefined)?.tools ?? []).map((t) => t.name),
    );
    // schema / curated / write
    expect(names.has('x_query')).toBe(true);
    expect(names.has('x_brief')).toBe(true);
    expect(names.has('x_draft_post')).toBe(true);
    expect(names.has('x_add_idea')).toBe(true);
  });
});

describe.if(authed)('MCP tool tiers', () => {
  test('schema tier: x_query runs a SELECT', async () => {
    const { env } = await rpc('tools/call', {
      name: 'x_query',
      arguments: { sql: 'SELECT 3 AS n' },
    });
    const { data, isError } = toolPayload(env);
    expect(isError).toBe(false);
    expect((data as { rows?: { n: number }[] }).rows?.[0]?.n).toBe(3);
  });

  test('schema tier: x_query cannot read tokens', async () => {
    const { env } = await rpc('tools/call', {
      name: 'x_query',
      arguments: { sql: 'SELECT * FROM tokens' },
    });
    const { data, isError } = toolPayload(env);
    expect(isError).toBe(true);
    expect((data as { error?: string }).error).toBe('tokens_forbidden');
  });

  test('curated tier: x_brief returns an object in-process', async () => {
    const { env } = await rpc('tools/call', { name: 'x_brief', arguments: {} });
    const { data, isError } = toolPayload(env);
    expect(isError).toBe(false);
    expect(typeof data).toBe('object');
  });

  test('write tier: x_add_idea creates an open idea', async () => {
    const { env } = await rpc('tools/call', {
      name: 'x_add_idea',
      arguments: { text: 'mcp unit-test idea' },
    });
    const { data, isError } = toolPayload(env);
    expect(isError).toBe(false);
    expect((data as { status?: string }).status).toBe('open');
  });
});

describe.if(authed)('MCP write-tier guard', () => {
  test('x_draft_post forces status=draft even when pending is smuggled in', async () => {
    const { env } = await rpc('tools/call', {
      name: 'x_draft_post',
      arguments: {
        text: 'proposed post via mcp',
        scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
        // Not in the tool schema — must be stripped, never reaching the publisher.
        status: 'pending',
      },
    });
    const { data, isError } = toolPayload(env);
    expect(isError).toBe(false);
    expect((data as { status?: string }).status).toBe('draft');
  });

  test('x_draft_post rejects an invalid pillar', async () => {
    const { env } = await rpc('tools/call', {
      name: 'x_draft_post',
      arguments: { text: 'x', pillar: 'not-a-real-pillar' },
    });
    const { isError } = toolPayload(env);
    expect(isError).toBe(true);
  });
});
