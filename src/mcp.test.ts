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
    expect(names.has('x_niche')).toBe(true);
    expect(names.has('x_me')).toBe(true);
    expect(names.has('x_monitor')).toBe(true);
    expect(names.has('x_draft_post')).toBe(true);
    expect(names.has('x_add_idea')).toBe(true);
    expect(names.has('x_add_me_entry')).toBe(true);
    expect(names.has('x_goals')).toBe(true);
    expect(names.has('x_settings')).toBe(true);
    expect(names.has('x_update_setting')).toBe(true);
    // 3 schema + 15 curated (incl. x_niche, x_me, x_monitor, x_goals, x_settings)
    // + 5 write (incl. x_add_me_entry, x_update_setting). Goal WRITES stay out by
    // design (ME.6): a bad target steers every draft.
    expect(names.size).toBe(23);
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

  test('curated tier: x_niche returns the active niche + doctrine', async () => {
    const { env } = await rpc('tools/call', { name: 'x_niche', arguments: {} });
    const { data, isError } = toolPayload(env);
    expect(isError).toBe(false);
    const d = data as { niche?: { slug?: string }; doctrine?: { replyTargetMin?: number } };
    expect(typeof d.niche?.slug).toBe('string');
    expect((d.niche?.slug ?? '').length).toBeGreaterThan(0);
    expect(typeof d.doctrine?.replyTargetMin).toBe('number');
  });

  // Runs against the real composed app, so this also proves monitorRouter is
  // mounted — a curated tool is only as callable as its route.
  test('curated tier: x_monitor returns the alert envelope', async () => {
    const { env } = await rpc('tools/call', { name: 'x_monitor', arguments: {} });
    const { data, isError } = toolPayload(env);
    expect(isError).toBe(false);
    const d = data as { alerts?: unknown; worst?: unknown; checkedAt?: string };
    expect(Array.isArray(d.alerts)).toBe(true);
    expect(Number.isNaN(Date.parse(d.checkedAt ?? ''))).toBe(false);
  });

  test('curated tier: x_goals returns goals + commitments', async () => {
    const { env } = await rpc('tools/call', { name: 'x_goals', arguments: { tzOffsetMin: 0 } });
    const { data, isError } = toolPayload(env);
    expect(isError).toBe(false);
    const d = data as { goals?: unknown; commitments?: unknown; checkedAt?: string };
    expect(Array.isArray(d.goals)).toBe(true);
    expect(Array.isArray(d.commitments)).toBe(true);
    expect(Number.isNaN(Date.parse(d.checkedAt ?? ''))).toBe(false);
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

  test('write tier: x_add_me_entry journals an entry readable via x_me', async () => {
    const marker = 'mcp unit-test emotion';
    const add = await rpc('tools/call', {
      name: 'x_add_me_entry',
      arguments: { kind: 'emotion', text: marker },
    });
    const { data, isError } = toolPayload(add.env);
    expect(isError).toBe(false);
    const created = data as { id?: string; kind?: string };
    expect(created.kind).toBe('emotion');

    const list = await rpc('tools/call', { name: 'x_me', arguments: {} });
    const { data: meData, isError: meErr } = toolPayload(list.env);
    expect(meErr).toBe(false);
    const entries = (meData as { entries?: { text: string }[] }).entries ?? [];
    expect(entries.some((e) => e.text === marker)).toBe(true);

    // Clean up: the :memory: DB is ONE process across every test file, and
    // me.test.ts asserts an empty profile — leave no lingering active entry.
    if (created.id) {
      const del = await app.request(`/x/me/entries/${created.id}`, {
        method: 'DELETE',
        headers: { authorization: BEARER },
      });
      expect(del.status).toBe(200);
    }
  });

  test('write tier: x_add_me_entry rejects an invalid kind at the schema layer', async () => {
    const { env } = await rpc('tools/call', {
      name: 'x_add_me_entry',
      arguments: { kind: 'rant', text: 'not a valid kind' },
    });
    // A zod-enum failure never runs the handler — it surfaces as a JSON-RPC error
    // envelope (schema layer); a route-layer 400 would surface as an isError
    // result. Accept either so the test is robust to the SDK's rejection path.
    const rejected = env?.error !== undefined || toolPayload(env).isError;
    expect(rejected).toBe(true);
  });
});

// UI.4 — the settings pair. The registry ceilings are the guard (Decision 5):
// an agent goes through the same PATCH validation the UI does, so it can raise
// a knob inside its range and nowhere near past it.
describe.if(authed)('MCP settings tools', () => {
  test('x_settings lists groups with values and isDefault', async () => {
    const { env } = await rpc('tools/call', { name: 'x_settings', arguments: {} });
    const { data, isError } = toolPayload(env);
    expect(isError).toBe(false);
    const groups =
      (data as { groups?: { id: string; settings: { key: string; isDefault: boolean }[] }[] })
        .groups ?? [];
    const gates = groups.find((g) => g.id === 'gates');
    expect(gates?.settings.some((s) => s.key === 'x.gates.minCellN')).toBe(true);
  });

  test('x_update_setting moves a knob; an out-of-ceiling value is refused', async () => {
    try {
      const ok = await rpc('tools/call', {
        name: 'x_update_setting',
        arguments: { key: 'x.gates.minCellN', value: 12 },
      });
      const okPayload = toolPayload(ok.env);
      expect(okPayload.isError).toBe(false);
      expect((okPayload.data as { updated?: { key: string; value: unknown }[] }).updated).toEqual([
        { key: 'x.gates.minCellN', value: 12 },
      ]);

      // …and the change is visible through the read tool.
      const after = await rpc('tools/call', { name: 'x_settings', arguments: {} });
      const groups =
        (
          toolPayload(after.env).data as {
            groups?: { id: string; settings: { key: string; value: unknown }[] }[];
          }
        ).groups ?? [];
      const cell = groups
        .find((g) => g.id === 'gates')
        ?.settings.find((s) => s.key === 'x.gates.minCellN');
      expect(cell?.value).toBe(12);

      // Past the registry ceiling: the route's 400 is surfaced as an error result.
      const bad = await rpc('tools/call', {
        name: 'x_update_setting',
        arguments: { key: 'x.workers.winnerRereadCap', value: 500 },
      });
      const badPayload = toolPayload(bad.env);
      expect(badPayload.isError).toBe(true);
      expect((badPayload.data as { status?: number }).status).toBe(400);
      expect((badPayload.data as { body?: { error?: string } }).body?.error).toBe(
        'invalid_setting_value',
      );
    } finally {
      await app.request('/x/settings/reset', {
        method: 'POST',
        headers: { authorization: BEARER, 'content-type': 'application/json' },
        body: JSON.stringify({ keys: ['x.gates.minCellN'] }),
      });
    }
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
