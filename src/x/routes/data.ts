// SURFACES-PLAN S1 — read-only data routes over the SQLite state. Every handler
// here is read-only BY CONSTRUCTION (see src/x/data/inspect.ts): the query core
// runs on a { readonly: true } connection and refuses anything but a single
// SELECT/WITH, with `tokens` absent from the whitelist and rejected by name.
// Mounted under /x by mountX, so the bearer guard applies to all three.
//
//   GET  /x/data/tables          → { tables: [{ name, rowCount, columns }] }
//   GET  /x/data/:table          → readTable (query params: limit, offset, sort, dir, q)
//   POST /x/data/query { sql }    → runSelect (the shared power tool)
//
// The explorer UI SHELL (public/explorer.html) is served separately at GET
// /explorer WITHOUT the bearer guard — it contains no data, and every fetch it
// makes carries the token. See `explorer` below, mounted at root by mountX.

import { Hono } from 'hono';
import {
  InspectError,
  type ReadTableOpts,
  listTables,
  readTable,
  runSelect,
} from '../data/inspect.ts';

export const data = new Hono();

data.get('/data/tables', (c) => {
  return c.json({ tables: listTables() });
});

// POST before the /:table GET is irrelevant (different method), but /data/tables
// is registered before /data/:table so the literal wins the match.
data.post('/data/query', async (c) => {
  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const sql = (raw as Record<string, unknown>).sql;
  if (typeof sql !== 'string') return c.json({ error: 'invalid_body' }, 400);

  try {
    return c.json(runSelect(sql));
  } catch (err) {
    if (err instanceof InspectError) return c.json({ error: err.code }, 400);
    throw err;
  }
});

data.get('/data/:table', (c) => {
  const table = c.req.param('table');
  try {
    // Build opts with only defined keys (exactOptionalPropertyTypes).
    const opts: ReadTableOpts = {};
    const limit = parseIntQuery(c.req.query('limit'));
    if (limit !== undefined) opts.limit = limit;
    const offset = parseIntQuery(c.req.query('offset'));
    if (offset !== undefined) opts.offset = offset;
    const sort = c.req.query('sort');
    if (sort !== undefined) opts.sort = sort;
    const dir = parseDir(c.req.query('dir'));
    if (dir !== undefined) opts.dir = dir;
    const q = c.req.query('q');
    if (q !== undefined) opts.q = q;
    return c.json(readTable(table, opts));
  } catch (err) {
    if (err instanceof InspectError) {
      return c.json({ error: err.code }, err.code === 'unknown_table' ? 404 : 400);
    }
    throw err;
  }
});

// A malformed integer becomes NaN, which readTable rejects with invalid_limit /
// invalid_offset (→ 400). Absent → undefined → readTable's default.
function parseIntQuery(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  return Number(v);
}

function parseDir(v: string | undefined): 'asc' | 'desc' | undefined {
  if (v === 'asc' || v === 'desc') return v;
  return undefined;
}

// Public explorer shell — served at GET /explorer with NO bearer guard (mounted
// at root, outside the /x/* auth middleware). The HTML is data-free; it prompts
// for the token, keeps it in localStorage, and attaches it to every /x/data/*
// fetch. Read once and cached — the file never changes at runtime.
const EXPLORER_HTML_URL = new URL('../../../public/explorer.html', import.meta.url);
let explorerHtml: string | null = null;

export const explorer = new Hono();

explorer.get('/explorer', async (c) => {
  if (explorerHtml === null) {
    try {
      explorerHtml = await Bun.file(EXPLORER_HTML_URL).text();
    } catch (err) {
      console.error('explorer.html read failed:', err instanceof Error ? err.message : err);
      return c.text('explorer.html not found', 500);
    }
  }
  return c.html(explorerHtml);
});
