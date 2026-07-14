# S1 — Data core + Explorer

> **Surface:** raw, read-only window into the production SQLite state — in a browser and as a shared code core.
> **Status:** shipped 2026-07-11. **Cost:** $0. **Plan:** `SURFACES-PLAN.md` §2.

---

## What it is

S1 gives stratus a way to **see exactly what is in the production database** with zero ceremony: open a URL, paste your bearer token once, and every table is browsable, sortable, searchable, and query-able from a single web page.

It has two deliberate halves:

1. **A read-only data core** (`src/x/data/inspect.ts`) — the introspection + query logic, written **once** so the S2 MCP server reuses it verbatim. There is exactly one place that knows how to safely read the DB.
2. **The Explorer UI** (`public/explorer.html`) — a single self-contained HTML page served at `GET /explorer`, talking to three bearer-guarded routes.

The whole surface is **read-only by construction**, not by policy. That distinction is the heart of the design and is explained below.

---

## Why it exists

Before S1, the data had exactly one consumer: the extension side panel. Every question that wasn't already a route ("what's actually in `reply_drafts`?", "did that migration land?", "why is this person stuck at `noticed`?") meant SSH + `sqlite3` + hand-typed SQL against a live file the workers are writing to.

S1 replaces that with a microscope you can point at any table. It is deliberately **not** an analytics surface — the Playbook is where analysis lives. S1 is for looking at rows.

---

## Architecture

```
                    ┌─────────────────────────────────────────┐
   GET /explorer ──▶│  public/explorer.html (vanilla JS, dark) │
   (no bearer)      │  token in localStorage → Bearer header   │
                    └───────────────┬─────────────────────────┘
                                    │ fetch (Authorization: Bearer …)
                    ┌───────────────▼─────────────────────────┐
   bearer-guarded   │  src/x/routes/data.ts                    │
   /x/data/*        │  GET /x/data/tables                      │
                    │  GET /x/data/:table                      │
                    │  POST /x/data/query { sql }              │
                    └───────────────┬─────────────────────────┘
                                    │
                    ┌───────────────▼─────────────────────────┐
   THE CORE         │  src/x/data/inspect.ts                   │
   (reused by S2)   │  listTables / describeTable / readTable  │
                    │  / runSelect                             │
                    │                                          │
                    │  second bun:sqlite connection,           │
                    │  opened { readonly: true }               │
                    └───────────────┬─────────────────────────┘
                                    │ (real file only)
                              stratus.db  ◀── workers write here through
                                              the PRIMARY connection
```

The Explorer and the MCP server (S2) are two front ends over the same core. Any hardening added to `inspect.ts` protects both at once.

---

## The read-only core — `src/x/data/inspect.ts`

### The security boundary is the connection, not the guards

The core opens **a second `bun:sqlite` connection to the same database file, with `{ readonly: true }`**. This is the actual safety guarantee: a readonly SQLite handle *physically cannot* write, cannot deadlock the primary writer's transaction, and cannot advance anything billing-adjacent. Even a `WITH x AS (...) DELETE …` that slips past every textual guard throws when SQLite tries to execute it against a readonly handle.

The string-level guards (single-statement, `SELECT`/`WITH` only, `tokens` rejected by name) are **UX and secret-hygiene** — they return a clean error code instead of a raw exception. The connection is what makes the surface safe.

```ts
// simplified
const path = process.env.SQLITE_PATH ?? './stratus.db';
cachedConn = new Database(path, { readonly: true });
```

**`:memory:` fallback.** When `SQLITE_PATH` is `:memory:` (tests), a *second* connection would be an independent, empty database — so the core falls back to the primary connection instead. The readonly *structural* guarantee only matters against the real file; the string guards never let a write through regardless of which handle is used, and the "readonly handle throws on write" property is proven directly in the test suite via the exported `openReadonly(path)` helper.

### `tokens` is absent, not masked

The `tokens` table holds the **rotating X OAuth refresh token**. Losing or leaking it locks the account out permanently (invariant #3 in `CLAUDE.md`). The core excludes it in two independent ways:

- `EXCLUDED_TABLES = new Set(['tokens'])` — it is filtered out of the whitelist, so it is **never listed, never described, never readable via `readTable`**.
- `runSelect` rejects any query whose text matches `\btokens\b` with `InspectError('tokens_forbidden')`, before the query is even compiled.

### The whitelist comes from the Drizzle schema, not the DB

`listTables()` derives the table whitelist from the **Drizzle schema module exports** (`shared-schema.ts` + `x/db/schema.ts`), using `is(value, SQLiteTable)` + `getTableName`. It never reads `PRAGMA table_list`. Consequences:

- Migration scaffolding (`__drizzle_migrations`) can never leak — it isn't a declared table.
- A table exists to this tool only if the app declares it.
- The rail order is stable (sorted).

Declared-but-not-yet-migrated tables (no columns per `PRAGMA table_info`) are silently skipped, so a schema addition that predates its migration doesn't crash the explorer.

### Public functions

| Function | Signature | Behavior |
|---|---|---|
| `listTables()` | `→ TableInfo[]` | Every whitelisted table with `rowCount` and `columns` (name, type, notnull, pk). Skips unmigrated tables. |
| `describeTable(name)` | `(string) → TableInfo` | One table's columns + row count. `InspectError('unknown_table')` if not whitelisted or unmigrated. Used by S2's `x_describe_table`. |
| `readTable(name, opts)` | see below | Paginated, sortable, searchable read of one table. |
| `runSelect(sql)` | `(string) → RunSelectResult` | The shared power tool — a single read-only statement. |
| `openReadonly(path)` | `(string) → Database` | Test-only: proves `{ readonly: true }` throws on write against a real file. |

### `readTable(name, opts)`

```ts
interface ReadTableOpts {
  limit?: number;   // default 50, hard max 200
  offset?: number;  // default 0
  sort?: string;    // must be a real column of `name`
  dir?: 'asc' | 'desc';
  q?: string;       // substring search across text columns
}
```

- **Identifiers are validated, never interpolated from user input.** `sort` must be one of the columns introspected from `PRAGMA table_info`; otherwise `InspectError('invalid_sort')`. The table name must be whitelisted.
- **Search (`q`)** becomes a bound `"<col>" LIKE ? ESCAPE '\'` across every text column (SQLite affinity `''` or `char`/`clob`/`text`). SQLite `LIKE` has *no* default escape character (unlike Postgres `ILIKE`), so the core spells out `ESCAPE '\'` and escapes the user's `%`, `_`, and `\` to literals. A `q` with no searchable columns matches nothing (`WHERE 0`).
- **Values are always bound** — the search pattern, limit, and offset are parameters, never string-concatenated.
- Returns `{ table, columns, rows, total, limit, offset }` where `total` is the count *after* the search filter.

Error codes: `unknown_table`, `invalid_limit`, `invalid_offset`, `invalid_sort`.

### `runSelect(sql)` — the power tool

The single query path shared by the Explorer's SQL tab and S2's `x_query` tool. Guard ladder, in order:

1. Trim; empty → `empty_query`.
2. **Single statement only.** Strip one trailing `;`; a `;` anywhere else (even inside a string literal — deliberately conservative) → `multiple_statements`.
3. **Must open a read.** First keyword must be `select` or `with` (a CTE feeding a SELECT). This alone rejects `PRAGMA` / `ATTACH` / `INSERT` / `UPDATE` / `DELETE` / `DROP` / `CREATE` → `not_a_select`.
4. **`tokens` off-limits** by name → `tokens_forbidden`.
5. Compile on the readonly connection; a compile failure → `sql_error: <message>`.
6. Iterate with `.iterate()` (memory-bounded), capped at **500 rows** (`RUN_SELECT_ROW_CAP`) — `truncated: true` when the cap is hit. A `WITH`-fronted write that parses but tries to mutate throws here against the readonly wall → `sql_error`.

Returns `{ columns, rows, rowCount, truncated }`.

### Constants

| Constant | Value |
|---|---|
| `READ_TABLE_DEFAULT_LIMIT` | 50 |
| `READ_TABLE_MAX_LIMIT` | 200 |
| `RUN_SELECT_ROW_CAP` | 500 |

---

## The routes — `src/x/routes/data.ts`

Mounted under `/x` by `mountX`, so the standard **bearer guard applies to all three**. Every handler is read-only by construction (it can only reach the core).

### `GET /x/data/tables`

```json
{ "tables": [ { "name": "people", "rowCount": 218, "columns": [ … ] }, … ] }
```

### `GET /x/data/:table`

Query params map to `ReadTableOpts`: `?limit=&offset=&sort=&dir=&q=`. A malformed integer becomes `NaN`, which the core rejects (`invalid_limit` / `invalid_offset` → 400). `dir` accepts only `asc`/`desc` (anything else is ignored). `InspectError` → **404 for `unknown_table`, 400 for everything else**.

### `POST /x/data/query`

```json
// request
{ "sql": "SELECT angle, count(*) FROM reply_drafts GROUP BY angle" }
// response
{ "columns": [...], "rows": [...], "rowCount": 12, "truncated": false }
```

Body must be a JSON object with a string `sql`, else `400 invalid_body`. Any `InspectError` → 400 with `{ error: <code> }`.

### `GET /explorer` (the shell — **no bearer**)

Mounted at the **root path** by `mountX` (`app.route('/', explorer)`), so it sits *outside* the `/x/*` auth middleware. This is intentional: the HTML file contains **no data**. Every fetch it makes carries the token from `localStorage`, and a 401 re-prompts. The file is read from disk once and cached (`explorerHtml`); it never changes at runtime.

---

## The Explorer UI — `public/explorer.html`

One self-contained file (~510 lines), dark GitHub-style theme, vanilla JS, no build step. Kept out of the extension build entirely because a 320px side panel is the wrong home for a data grid — a full browser tab against the same Hono server is the right one.

**Auth.** On first load it prompts for the bearer token, stores it in `localStorage`, and stamps `Authorization: Bearer …` on every request. A 401 re-prompts.

**Two tabs:**

- **Browse** — left rail of tables with live row counts; a paginated grid with click-to-sort headers, a debounced search box (→ `q`), and column show/hide. Row-click opens a **detail drawer**: JSON columns pretty-printed; epoch-ms columns (`*_at`, `*_ms`, `_for`, `_until`, `_time`, `ts`) rendered as local datetime with the raw value shown. **Export CSV** of the current view (formula-escaped cells — same discipline as the harvester).
- **SQL** — a textarea → `POST /x/data/query`, results in the same grid (⌘/Ctrl+Enter to run). Its own CSV export.

---

## Security & cost invariants

| Guarantee | How |
|---|---|
| No write can ever reach the DB through this surface | Second connection opened `{ readonly: true }` — structural, not policy |
| The OAuth refresh token is never exposed | `tokens` excluded from the whitelist **and** rejected by name in `runSelect` |
| Migration scaffolding never leaks | Whitelist derived from Drizzle schema exports, not `PRAGMA table_list` |
| No SQL injection via identifiers | Table/column names validated against the introspected schema; values always bound |
| Memory-bounded | `runSelect` iterates and caps at 500 rows; `readTable` caps at 200 |
| $0 | Pure local SQLite reads — no X API, no Grok |

---

## Usage

**Open the Explorer:**

```
https://<your-stratus-host>/explorer
```

Paste your bearer token (the server's `API_TOKEN`) once. Browse tables, sort/search, or drop into the SQL tab for an ad-hoc `SELECT`.

**Query from the CLI / another tool:**

```bash
curl -s https://<host>/x/data/query \
  -H "Authorization: Bearer $STRATUS_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"sql":"SELECT stage, count(*) n FROM people GROUP BY stage ORDER BY n DESC"}'
```

---

## Tests

- **`src/x/data/inspect.test.ts`** — whitelist derivation, `tokens` absent from `listTables()` and rejected by `runSelect`, identifier validation, `LIKE` escaping, the SELECT guard (rejects `PRAGMA` / `ATTACH` / multi-statement / non-SELECT / `tokens`), and the **readonly-write-attempt throws** proof via `openReadonly`.
- **`src/x/routes/data.test.ts`** — route wiring over the in-memory DB (status codes, `unknown_table` → 404).
- **`scripts/smoke-explorer.ts`** — rerunnable $0 check against the **real `./stratus.db`** through the genuine readonly file connection: asserts `tokens` is absent + rejected, a `SELECT` round-trips, writes are refused, and `/explorer` serves the shell.

---

## Verified end-to-end

Confirmed in a real browser: paste the bearer once → 24 tables browsable / sortable / searchable, ad-hoc `SELECT` round-trips, `content_pillars` epoch-ms rendered as `2026-07-11 11:55:39 (1783760139000)`, and `SELECT * FROM tokens` returns an inline `tokens_forbidden`.

---

## Open questions (from the plan)

- **Explorer auth UX** — is paste-the-bearer-once acceptable, or is a signed short-lived URL from the extension Settings tab worth it? Shipped paste-first; decide later.
- **`x_query` / `runSelect` row cap of 500** — an opening guess; revisit with use.

---

## Related

- **[S2 — MCP server](./s2-mcp-server.md)** reuses this exact core as its schema tier.
- **[Playbook tab](./playbook-tab.md)** is the analysis surface; S1 is the raw microscope.
