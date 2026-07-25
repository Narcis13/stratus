import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import * as xSchema from '../x/db/schema.ts';
import * as sharedSchema from './shared-schema.ts';

// Local SQLite (bun:sqlite) — replaced Neon Postgres on 2026-06-19 after the
// free-tier compute quota locked the project out. SQLite is a perfect fit for a
// single-process, single-user, low-write service: no server daemon, negligible
// RAM (the file's page cache, a few MB), zero network latency. The driver is
// SYNCHRONOUS — transactions must use sync .all()/.get()/.run() callbacks (no
// async I/O inside a transaction). See token-store.ts for the one place that
// needed an in-process mutex instead of a DB row lock.
// Bare `bun test` (without the package.json script's SQLITE_PATH=:memory:)
// would open the REAL ./stratus.db and every beforeAll seed would land in
// production data — this happened, and the "flaky" brief.test.ts failures were
// stale test rows in the live DB. Bun sets NODE_ENV=test under `bun test`, so
// default test runs to :memory: instead of the production file.
export const sqlitePath =
  process.env.SQLITE_PATH ?? (process.env.NODE_ENV === 'test' ? ':memory:' : './stratus.db');

export const sqlite = new Database(sqlitePath, { create: true });
sqlite.exec('PRAGMA journal_mode = WAL;'); // readers never block the single writer
sqlite.exec('PRAGMA busy_timeout = 5000;'); // wait out a momentary write lock, don't throw
sqlite.exec('PRAGMA foreign_keys = ON;');
sqlite.exec('PRAGMA synchronous = NORMAL;'); // WAL-safe, much faster than FULL

export const db = drizzle(sqlite, { schema: { ...sharedSchema, ...xSchema } });

export type DB = typeof db;

// Auto-apply migrations at boot — idempotent and fast on SQLite, so fresh local
// DBs, in-memory test runs, and the migrate-from-neon script are all schema-
// ready without a manual step. deploy.sh still runs `drizzle-kit migrate` too.
// Set SKIP_MIGRATE=1 to opt out (e.g. when the folder isn't generated yet).
if (process.env.SKIP_MIGRATE !== '1') {
  try {
    migrate(db, { migrationsFolder: new URL('./migrations', import.meta.url).pathname });
  } catch (err) {
    console.error('db: migrate skipped/failed:', err instanceof Error ? err.message : err);
  }
}
