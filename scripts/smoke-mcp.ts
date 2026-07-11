// One-shot smoke test for SURFACES-PLAN S2 (the MCP server). Runs the REAL
// composed app in-process against an ephemeral :memory: DB (no port, no
// workers, no X/Grok) and drives the /mcp JSON-RPC surface exactly as an MCP
// client would: initialize → tools/list → tools/call across one tool per tier,
// plus the write-tier draft-forced guard, the tokens guard, the 401 (no bearer)
// and 405 (GET) edges. $0, writes only to the throwaway in-memory DB.
//
// Run: bun run scripts/smoke-mcp.ts

export {}; // make this a module so top-level await is allowed

// Force an ephemeral DB BEFORE app.ts (and its db client) is imported. ESM
// imports are hoisted, so app.ts must be a DYNAMIC import below this line.
process.env.SQLITE_PATH = ':memory:';
process.env.DAILY_METRICS_ENABLED = 'false';

const { app } = await import('../src/app.ts');

const TOKEN = process.env.API_TOKEN;
if (!TOKEN) fail('API_TOKEN not set (needed to authenticate MCP calls)');
const BEARER = `Bearer ${TOKEN}`;

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

let nextId = 1;

interface JsonRpcResponse {
  jsonrpc: string;
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

// Read a Streamable-HTTP reply: JSON (enableJsonResponse) or, defensively, SSE.
async function readEnvelope(res: Response): Promise<JsonRpcResponse> {
  const text = await res.text();
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('text/event-stream')) {
    const line = text.split('\n').find((l) => l.startsWith('data:'));
    if (!line) fail(`SSE reply had no data line: ${text.slice(0, 200)}`);
    return JSON.parse(line.slice('data:'.length).trim()) as JsonRpcResponse;
  }
  return JSON.parse(text) as JsonRpcResponse;
}

async function rpc(
  method: string,
  params: unknown,
  opts: { bearer?: boolean } = {},
): Promise<{ status: number; env: JsonRpcResponse | null }> {
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
  const env = res.ok || res.status === 400 ? await readEnvelope(res).catch(() => null) : null;
  return { status: res.status, env };
}

interface ToolCallResult {
  content?: { type: string; text: string }[];
  isError?: boolean;
}

function toolText(env: JsonRpcResponse | null): { parsed: unknown; isError: boolean } {
  if (!env) fail('no JSON-RPC envelope');
  if (env.error) fail(`tools/call returned a JSON-RPC error: ${JSON.stringify(env.error)}`);
  const result = env.result as ToolCallResult;
  const text = result.content?.[0]?.text ?? '';
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep raw */
  }
  return { parsed, isError: result.isError === true };
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
): Promise<JsonRpcResponse | null> {
  const { env } = await rpc('tools/call', { name, arguments: args });
  return env;
}

// ------------------------------------------------------------------ 1. auth

{
  const res = await app.request('/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'tools/list', params: {} }),
  });
  if (res.status !== 401) fail(`no bearer should be 401, got ${res.status}`);
  console.log('401 without bearer OK');
}

// GET /mcp → 405 JSON-RPC method-not-allowed.
{
  const res = await app.request('/mcp', { method: 'GET', headers: { authorization: BEARER } });
  if (res.status !== 405) fail(`GET /mcp should be 405, got ${res.status}`);
  const body = (await res.json()) as JsonRpcResponse;
  if (!body.error || body.error.code !== -32000) fail('GET /mcp should return a JSON-RPC error');
  console.log('GET /mcp → 405 JSON-RPC error OK');
}

// --------------------------------------------------------------- 2. handshake

{
  const { status, env } = await rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'smoke-mcp', version: '0.0.0' },
  });
  if (status !== 200) fail(`initialize → ${status}`);
  const result = env?.result as
    | { serverInfo?: { name?: string }; protocolVersion?: string }
    | undefined;
  if (result?.serverInfo?.name !== 'stratus')
    fail(`initialize serverInfo wrong: ${JSON.stringify(result)}`);
  console.log(
    `initialize OK (protocol ${result?.protocolVersion}, server ${result?.serverInfo?.name})`,
  );
}

// ---------------------------------------------------------------- 3. tools/list

{
  const { status, env } = await rpc('tools/list', {});
  if (status !== 200) fail(`tools/list → ${status}`);
  const tools = (env?.result as { tools?: { name: string }[] } | undefined)?.tools ?? [];
  const names = new Set(tools.map((t) => t.name));
  const expected = [
    'x_list_tables',
    'x_describe_table',
    'x_query',
    'x_brief',
    'x_playbook',
    'x_person',
    'x_followups',
    'x_conversations',
    'x_metrics_account',
    'x_best_times',
    'x_cost',
    'x_search_voice',
    'x_digest',
    'x_add_idea',
    'x_add_person_note',
    'x_draft_post',
  ];
  for (const name of expected) if (!names.has(name)) fail(`tools/list missing ${name}`);
  console.log(`tools/list OK (${tools.length} tools, all ${expected.length} expected present)`);
}

// ------------------------------------------------------- 4. schema tier round-trip

{
  const { parsed, isError } = toolText(await callTool('x_query', { sql: 'SELECT 7 AS answer' }));
  if (isError) fail(`x_query errored: ${JSON.stringify(parsed)}`);
  const rows = (parsed as { rows?: { answer: number }[] }).rows ?? [];
  if (rows[0]?.answer !== 7) fail(`x_query wrong result: ${JSON.stringify(parsed)}`);
  console.log('x_query SELECT round-trip OK');
}

{
  const { parsed, isError } = toolText(await callTool('x_query', { sql: 'SELECT * FROM tokens' }));
  if (!isError) fail('x_query on tokens should be an error result');
  if ((parsed as { error?: string }).error !== 'tokens_forbidden') {
    fail(`x_query tokens guard wrong: ${JSON.stringify(parsed)}`);
  }
  console.log('x_query tokens guard OK (tokens_forbidden)');
}

{
  const { parsed, isError } = toolText(await callTool('x_list_tables', {}));
  if (isError) fail('x_list_tables errored');
  const tables = (parsed as { tables?: { name: string }[] }).tables ?? [];
  if (tables.some((t) => t.name === 'tokens')) fail('x_list_tables leaked tokens');
  if (!tables.some((t) => t.name === 'people')) fail('x_list_tables missing people');
  console.log(`x_list_tables OK (${tables.length} tables, tokens absent)`);
}

// ------------------------------------------------------ 5. curated tier (in-process)

{
  const { parsed, isError } = toolText(await callTool('x_brief', {}));
  if (isError) fail(`x_brief errored: ${JSON.stringify(parsed)}`);
  if (typeof parsed !== 'object' || parsed === null) fail('x_brief did not return an object');
  console.log('x_brief curated round-trip OK');
}

{
  const { parsed, isError } = toolText(await callTool('x_cost', { days: 7 }));
  if (isError) fail(`x_cost errored: ${JSON.stringify(parsed)}`);
  console.log('x_cost curated round-trip OK');
}

// ---------------------------------------------------------- 6. write tier + guard

{
  const { parsed, isError } = toolText(
    await callTool('x_add_idea', { text: 'smoke idea from MCP' }),
  );
  if (isError) fail(`x_add_idea errored: ${JSON.stringify(parsed)}`);
  const idea = parsed as { id?: string; text?: string; status?: string };
  if (!idea.id || idea.status !== 'open') fail(`x_add_idea bad row: ${JSON.stringify(idea)}`);
  console.log(`x_add_idea OK (id ${idea.id}, status ${idea.status})`);
}

{
  const { parsed, isError } = toolText(
    await callTool('x_add_person_note', { handle: '@smokeuser', text: 'met via MCP smoke' }),
  );
  if (isError) fail(`x_add_person_note errored: ${JSON.stringify(parsed)}`);
  const person = (parsed as { person?: { handle?: string } }).person;
  if (person?.handle !== 'smokeuser')
    fail(`x_add_person_note bad person: ${JSON.stringify(parsed)}`);
  console.log('x_add_person_note OK (person created, note logged)');
}

// The write ceiling: x_draft_post ALWAYS lands status='draft'. Even smuggling a
// `status: 'pending'` into the arguments can't reach the publisher — the tool's
// schema has no status field, so it's stripped before the handler runs.
{
  const { parsed, isError } = toolText(
    await callTool('x_draft_post', {
      text: 'a proposed post from MCP',
      scheduledFor: new Date(Date.now() + 3600_000).toISOString(),
      status: 'pending', // smuggled — must be ignored
    }),
  );
  if (isError) fail(`x_draft_post errored: ${JSON.stringify(parsed)}`);
  const row = parsed as { id?: string; status?: string; scheduledFor?: unknown };
  if (row.status !== 'draft') fail(`x_draft_post did NOT force draft: status=${row.status}`);
  console.log(`x_draft_post OK (id ${row.id}, status forced to draft despite smuggled 'pending')`);

  // And it is really in the calendar as a draft (visible to the Composer).
  const { parsed: q } = toolText(
    await callTool('x_query', {
      sql: `SELECT status FROM scheduled_posts WHERE id = '${row.id}'`,
    }),
  );
  const back = (q as { rows?: { status: string }[] }).rows?.[0]?.status;
  if (back !== 'draft') fail(`draft not found in scheduled_posts as draft (got ${back})`);
  console.log('x_draft_post landed a draft row in scheduled_posts OK');
}

// Invalid pillar is rejected (route validation flows through the tool).
{
  const { parsed, isError } = toolText(
    await callTool('x_draft_post', { text: 'x', pillar: 'not-a-real-pillar' }),
  );
  if (!isError) fail('x_draft_post with a bogus pillar should be an error result');
  console.log('x_draft_post invalid-pillar rejected OK');
}

console.log('\nAll S2 MCP smoke checks passed ($0, ephemeral in-memory DB).');
process.exit(0);
