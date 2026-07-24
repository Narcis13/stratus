// One-shot smoke test for SURFACES-PLAN S1 (data core + explorer). Mounts the
// data router and the public explorer shell in-process (no port, no workers,
// no Grok) against the real DB: lists tables, reads one, runs an ad-hoc SELECT,
// asserts `tokens` is nowhere (absent from the whitelist AND rejected by name),
// and that GET /explorer serves the HTML shell. Read-only, $0, creates nothing.
// Run: bun run scripts/smoke-explorer.ts

import { Hono } from 'hono';
import { data, explorer } from '../src/x/routes/data.ts';

const app = new Hono();
app.route('/x', data);
app.route('/', explorer);

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

// 1. Tables list — tokens must be absent.
const tablesRes = await app.request('/x/data/tables');
if (tablesRes.status !== 200) fail(`GET /x/data/tables → ${tablesRes.status}`);
const { tables } = (await tablesRes.json()) as {
  tables: { name: string; rowCount: number; columns: unknown[] }[];
};
if (!tables.length) fail('no tables returned');
if (tables.some((t) => t.name === 'tokens')) fail('tokens leaked into the whitelist');
if (tables.some((t) => t.name === '__drizzle_migrations')) fail('migration table leaked');
const total = tables.reduce((n, t) => n + t.rowCount, 0);
console.log(`tables: ${tables.length} (${total} rows total), tokens absent OK`);

// 2. Read one table.
const first = tables[0]?.name;
if (!first) fail('no table name to read');
const readRes = await app.request(`/x/data/${first}?limit=3`);
if (readRes.status !== 200) fail(`GET /x/data/${first} → ${readRes.status}`);
const read = (await readRes.json()) as { table: string; rows: unknown[]; total: number };
if (read.table !== first) fail('readTable echoed the wrong name');
console.log(`read ${first}: ${read.rows.length} of ${read.total} rows OK`);

// 3. Ad-hoc SELECT round-trips.
const q = await app.request('/x/data/query', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ sql: 'SELECT 1 AS one, 2 AS two' }),
});
if (q.status !== 200) fail(`POST /x/data/query → ${q.status}`);
const qb = (await q.json()) as { rows: Record<string, number>[] };
if (qb.rows[0]?.one !== 1 || qb.rows[0]?.two !== 2) fail('SELECT round-trip wrong');
console.log('ad-hoc SELECT round-trip OK');

// 4. tokens rejected by name in the power tool.
const tok = await app.request('/x/data/query', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ sql: 'SELECT * FROM tokens' }),
});
if (tok.status !== 400) fail(`SELECT FROM tokens should be 400, got ${tok.status}`);
if (((await tok.json()) as { error: string }).error !== 'tokens_forbidden') {
  fail('tokens select not rejected by name');
}
console.log('runSelect rejects tokens by name OK');

// 5. A write attempt is refused (structural readonly + guard).
const w = await app.request('/x/data/query', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ sql: 'DELETE FROM people' }),
});
if (w.status !== 400) fail(`DELETE should be 400, got ${w.status}`);
console.log('runSelect refuses writes OK');

// 6. The explorer shell is served (public, HTML).
const shell = await app.request('/explorer');
if (shell.status !== 200) fail(`GET /explorer → ${shell.status}`);
const html = await shell.text();
if (!/stratus.*explorer/i.test(html) || !html.includes('/x/data/tables')) {
  fail('explorer.html did not render the expected shell');
}
console.log('GET /explorer serves the shell OK');

// 7. The writer shell (A3.13) hangs off the same public root router.
const writer = await app.request('/writer');
if (writer.status !== 200) fail(`GET /writer → ${writer.status}`);
const writerHtml = await writer.text();
if (!/stratus.*writer/i.test(writerHtml) || !writerHtml.includes('/x/articles')) {
  fail('writer.html did not render the expected shell');
}
console.log('GET /writer serves the shell OK');

console.log('SMOKE PASS');
process.exit(0);
