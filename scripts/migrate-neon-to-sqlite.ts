// ONE-SHOT Neon (Postgres) -> local SQLite copy.
//
// Run this exactly once, the moment Neon's compute quota unlocks (the free-tier
// allowance resets at the start of the next billing month, or immediately if you
// upgrade). Until then Neon refuses every connection ("exceeded the compute time
// quota") and this script will tell you so and exit.
//
//   bun run scripts/migrate-neon-to-sqlite.ts           # dry-run: connect, count every table
//   bun run scripts/migrate-neon-to-sqlite.ts --apply   # actually copy into SQLITE_PATH
//
// Reads each table from Neon via raw SQL (DATABASE_URL) and writes to the local
// SQLite file (SQLITE_PATH, default ./stratus.db) using INSERT OR IGNORE, so it
// is idempotent — primary keys are preserved, re-running skips rows already
// copied. Importing the app's db client first ensures the SQLite schema exists
// (auto-migrate) before any insert.
//
// Type coercion is generic, driven by the JS type the pg driver returns:
//   Date (timestamptz)        -> epoch milliseconds (integer)
//   object / array (jsonb,[]) -> JSON string (matches the text/json columns)
//   boolean                   -> 0 / 1
//   numeric (returned as str) -> passthrough; SQLite REAL affinity coerces it
//   bigint id (returned str)  -> passthrough; INTEGER affinity coerces it

import { Pool, neonConfig } from '@neondatabase/serverless';
// Importing the client runs the auto-migrate, creating the SQLite schema, and
// hands us the same underlying bun:sqlite handle keyed off SQLITE_PATH.
import { sqlite } from '../src/db/client.ts';

if (typeof WebSocket !== 'undefined') {
  // biome-ignore lint/suspicious/noExplicitAny: neonConfig types target node ws
  neonConfig.webSocketConstructor = WebSocket as any;
}

const APPLY = process.argv.includes('--apply');
const PG_URL = process.env.DATABASE_URL;
if (!PG_URL) {
  console.error('DATABASE_URL (the Neon connection string) is required.');
  process.exit(1);
}

// FK-safe dependency order: a table is listed after every table it references,
// so a straight insert order never trips a foreign key (we also disable FK
// enforcement during the bulk load and verify with foreign_key_check after).
const TABLES = [
  'tokens',
  'content_pillars',
  'scheduled_posts',
  'posts_published', // -> scheduled_posts
  'metrics_snapshots', // -> posts_published
  'account_snapshots',
  'voice_authors',
  'voice_author_snapshots', // -> voice_authors
  'voice_tweets', // -> voice_authors
  'reply_drafts',
  'mentions', // -> reply_drafts
  'harvest_runs',
  'harvest_rows', // -> harvest_runs, reply_drafts
  'cost_events',
];

function coerce(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (Array.isArray(v) || typeof v === 'object') return JSON.stringify(v);
  return v as string | number | bigint;
}

function sqliteColumns(table: string): Set<string> {
  const rows = sqlite.query(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

const pool = new Pool({ connectionString: PG_URL });

try {
  await pool.query('select 1');
} catch (err) {
  console.error('\nCannot read from Neon:', err instanceof Error ? err.message : err);
  console.error(
    'If this is the compute-quota error, Neon is still locked. Wait for the free\n' +
      'monthly compute reset (or upgrade the plan), then re-run this script.',
  );
  await pool.end();
  process.exit(1);
}

console.log(`Mode: ${APPLY ? 'APPLY (writing to SQLite)' : 'DRY-RUN (counts only)'}`);
sqlite.exec('PRAGMA foreign_keys = OFF;');

let grandTotal = 0;
let grandCopied = 0;
try {
  for (const table of TABLES) {
    const { rows } = await pool.query(`SELECT * FROM ${table}`);
    grandTotal += rows.length;
    if (rows.length === 0) {
      console.log(`  ${table.padEnd(24)} neon=0`);
      continue;
    }

    const present = sqliteColumns(table);
    const cols = Object.keys(rows[0] as object).filter((c) => present.has(c));
    const skipped = Object.keys(rows[0] as object).filter((c) => !present.has(c));

    let copied = 0;
    if (APPLY) {
      const colList = cols.map((c) => `"${c}"`).join(', ');
      const placeholders = cols.map(() => '?').join(', ');
      const stmt = sqlite.prepare(
        `INSERT OR IGNORE INTO "${table}" (${colList}) VALUES (${placeholders})`,
      );
      const insertAll = sqlite.transaction((batch: Array<Record<string, unknown>>) => {
        for (const row of batch) {
          const res = stmt.run(...cols.map((c) => coerce(row[c]) as never));
          copied += res.changes;
        }
      });
      insertAll(rows as Array<Record<string, unknown>>);
      grandCopied += copied;
    }

    const total = (sqlite.query(`SELECT count(*) AS n FROM "${table}"`).get() as { n: number }).n;
    const skipNote = skipped.length ? ` (skipped cols: ${skipped.join(', ')})` : '';
    const applyNote = APPLY ? ` copied=${copied} sqlite_total=${total}` : '';
    console.log(`  ${table.padEnd(24)} neon=${rows.length}${applyNote}${skipNote}`);
  }

  if (APPLY) {
    const violations = sqlite.query('PRAGMA foreign_key_check').all();
    if (violations.length > 0) {
      console.error('\nFOREIGN KEY violations after copy:', violations);
    } else {
      console.log('\nForeign key check: OK');
    }
  }
} finally {
  sqlite.exec('PRAGMA foreign_keys = ON;');
  await pool.end();
}

console.log(
  `\n${APPLY ? `COPIED ${grandCopied} new rows` : `WOULD COPY ${grandTotal} rows`} across ${TABLES.length} tables.`,
);
if (!APPLY) console.log('Re-run with --apply to perform the copy.');
process.exit(0);
