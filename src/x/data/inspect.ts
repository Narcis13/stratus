// Read-only introspection + query core for the SQLite state (SURFACES-PLAN S1).
// Built ONCE here so both surfaces reuse it: the /x/data/* routes (2.2, the
// Explorer's backend) and the S2 MCP server. Every path in this file is read-
// only by construction — a second bun:sqlite connection opened { readonly: true }
// physically cannot write, deadlock the primary writer's transaction, or advance
// anything billing-adjacent. The guards below (single-statement, SELECT/WITH
// only, `tokens` rejected by name) are UX + secret-hygiene; the readonly
// connection is the actual security boundary.

import { Database, type Statement } from 'bun:sqlite';
import { getTableName, is } from 'drizzle-orm';
import { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { sqlite } from '../../db/client.ts';
import * as sharedSchema from '../../db/shared-schema.ts';
import * as xSchema from '../db/schema.ts';

// `tokens` holds the rotating X OAuth refresh token — losing/leaking it locks
// the account out (invariant #3). It is EXCLUDED from the whitelist entirely
// (not masked, absent) and rejected by name in runSelect.
const EXCLUDED_TABLES = new Set(['tokens']);

const READ_TABLE_MAX_LIMIT = 200;
const READ_TABLE_DEFAULT_LIMIT = 50;
const RUN_SELECT_ROW_CAP = 500;

export class InspectError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'InspectError';
  }
}

export interface ColumnInfo {
  name: string;
  type: string;
  notnull: boolean;
  pk: boolean;
}

export interface TableInfo {
  name: string;
  rowCount: number;
  columns: ColumnInfo[];
}

export interface ReadTableOpts {
  limit?: number;
  offset?: number;
  sort?: string;
  dir?: 'asc' | 'desc';
  q?: string;
}

export interface ReadTableResult {
  table: string;
  columns: ColumnInfo[];
  rows: Record<string, unknown>[];
  total: number;
  limit: number;
  offset: number;
}

export interface RunSelectResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
}

// The whitelist derives from the Drizzle schema EXPORTS, never from PRAGMA
// table_list — so migration scaffolding (__drizzle_migrations) can never leak,
// and a table only exists to this tool if the app declares it. Sorted for a
// stable rail order.
function schemaTableNames(): string[] {
  const names = new Set<string>();
  for (const mod of [sharedSchema, xSchema] as Record<string, unknown>[]) {
    for (const value of Object.values(mod)) {
      if (is(value, SQLiteTable)) {
        const name = getTableName(value);
        if (!EXCLUDED_TABLES.has(name)) names.add(name);
      }
    }
  }
  return [...names].sort();
}

let cachedWhitelist: Set<string> | null = null;
function whitelist(): Set<string> {
  if (!cachedWhitelist) cachedWhitelist = new Set(schemaTableNames());
  return cachedWhitelist;
}

// A separate readonly handle to the SAME database file. For :memory: (tests) a
// second connection would be an independent EMPTY database, so we fall back to
// the primary connection — the readonly *structural* guarantee only matters
// against the real file, and it's proven directly in the test suite. The guards
// in runSelect/readTable never let a write through regardless of the handle.
let cachedConn: Database | null = null;
function conn(): Database {
  if (cachedConn) return cachedConn;
  const path = process.env.SQLITE_PATH ?? './stratus.db';
  if (path === ':memory:' || path === '' || path.startsWith('file::memory:')) {
    // Reuse the primary connection so the inspector sees in-memory data.
    cachedConn = sqlite;
  } else {
    cachedConn = new Database(path, { readonly: true });
  }
  return cachedConn;
}

// Exported for the readonly-write-attempt test (proves { readonly: true } throws
// on write against a real file, independent of the :memory: fallback above).
export function openReadonly(path: string): Database {
  return new Database(path, { readonly: true });
}

function columnsFor(name: string): ColumnInfo[] {
  // `name` is always a whitelisted constant here (callers validate first); a
  // PRAGMA cannot be parameterized, so the quoted interpolation is the only way.
  const rows = conn().query(`PRAGMA table_info("${name}")`).all() as {
    name: string;
    type: string;
    notnull: number;
    pk: number;
  }[];
  return rows.map((r) => ({
    name: r.name,
    type: r.type,
    notnull: r.notnull !== 0,
    pk: r.pk !== 0,
  }));
}

export function listTables(): TableInfo[] {
  const out: TableInfo[] = [];
  for (const name of [...whitelist()].sort()) {
    const columns = columnsFor(name);
    if (columns.length === 0) continue; // declared but not yet migrated — skip
    const row = conn().query(`SELECT count(*) AS n FROM "${name}"`).get() as { n: number };
    out.push({ name, rowCount: row.n, columns });
  }
  return out;
}

// SQLite column affinity for our TEXT/JSON columns is 'TEXT' (JSON is stored as
// text); untyped columns report ''. Those are the ones a substring search makes
// sense across.
function isTextColumn(type: string): boolean {
  return type === '' || /char|clob|text/i.test(type);
}

function escapeLike(q: string): string {
  // SQLite LIKE has NO default escape char (unlike Postgres ILIKE) — spell out
  // ESCAPE '\' at the call site and escape the user's %/_/\ to literals here.
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

export function readTable(name: string, opts: ReadTableOpts = {}): ReadTableResult {
  if (!whitelist().has(name)) throw new InspectError('unknown_table');
  const columns = columnsFor(name);
  const validCols = new Set(columns.map((c) => c.name));

  let limit = READ_TABLE_DEFAULT_LIMIT;
  if (opts.limit !== undefined) {
    if (!Number.isInteger(opts.limit) || opts.limit < 1) throw new InspectError('invalid_limit');
    limit = Math.min(READ_TABLE_MAX_LIMIT, opts.limit);
  }
  let offset = 0;
  if (opts.offset !== undefined) {
    if (!Number.isInteger(opts.offset) || opts.offset < 0) throw new InspectError('invalid_offset');
    offset = opts.offset;
  }
  if (opts.sort !== undefined && !validCols.has(opts.sort)) throw new InspectError('invalid_sort');
  const dir = opts.dir === 'desc' ? 'DESC' : 'ASC';

  const whereParts: string[] = [];
  const whereParams: string[] = [];
  const q = opts.q?.trim();
  if (q) {
    const textCols = columns.filter((c) => isTextColumn(c.type));
    if (textCols.length > 0) {
      const pattern = escapeLike(q);
      for (const col of textCols) {
        whereParts.push(`"${col.name}" LIKE ? ESCAPE '\\'`);
        whereParams.push(pattern);
      }
    } else {
      whereParts.push('0'); // q given but nothing searchable → match nothing
    }
  }
  const whereSql = whereParts.length ? ` WHERE ${whereParts.join(' OR ')}` : '';
  const orderSql = opts.sort ? ` ORDER BY "${opts.sort}" ${dir}` : '';

  const totalRow = conn()
    .query(`SELECT count(*) AS n FROM "${name}"${whereSql}`)
    .get(...whereParams) as { n: number };

  const rows = conn()
    .query(`SELECT * FROM "${name}"${whereSql}${orderSql} LIMIT ? OFFSET ?`)
    .all(...whereParams, limit, offset) as Record<string, unknown>[];

  return { table: name, columns, rows, total: totalRow.n, limit, offset };
}

export function runSelect(rawSql: string): RunSelectResult {
  const sql = rawSql.trim();
  if (!sql) throw new InspectError('empty_query');

  // Single statement only: at most one trailing ';'. A ';' anywhere else (even
  // inside a string literal — deliberately conservative) is rejected.
  const body = sql.replace(/;\s*$/, '');
  if (body.includes(';')) throw new InspectError('multiple_statements');

  // First keyword must open a read: SELECT, or WITH (a CTE feeding a SELECT).
  // This alone rejects PRAGMA/ATTACH/INSERT/UPDATE/DELETE/DROP/CREATE. A
  // WITH-fronted write (`WITH x AS (...) DELETE …`) would still parse here, but
  // the readonly connection throws on execution — the structural backstop.
  const first = body.match(/^([a-zA-Z]+)/)?.[1]?.toLowerCase();
  if (first !== 'select' && first !== 'with') throw new InspectError('not_a_select');

  // `tokens` is off-limits by name — never let the secret table be read.
  if (/\btokens\b/i.test(body)) throw new InspectError('tokens_forbidden');

  let stmt: Statement;
  try {
    stmt = conn().query(body);
  } catch (err) {
    throw new InspectError(`sql_error: ${err instanceof Error ? err.message : String(err)}`);
  }

  const rows: Record<string, unknown>[] = [];
  let truncated = false;
  try {
    for (const row of stmt.iterate() as IterableIterator<Record<string, unknown>>) {
      if (rows.length >= RUN_SELECT_ROW_CAP) {
        truncated = true;
        break;
      }
      rows.push(row);
    }
  } catch (err) {
    // e.g. a WITH-fronted write hitting the readonly wall, or a runtime SQL error.
    throw new InspectError(`sql_error: ${err instanceof Error ? err.message : String(err)}`);
  }

  const columns =
    (stmt.columnNames as string[] | undefined) ?? (rows[0] ? Object.keys(rows[0]) : []);
  return { columns, rows, rowCount: rows.length, truncated };
}
