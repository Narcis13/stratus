// Apply SQLite migrations with the bun:sqlite migrator — the SAME driver the app
// uses at runtime. `drizzle-kit migrate` (the CLI) can't connect to bun:sqlite;
// it demands better-sqlite3/@libsql, which we don't ship. This script is the
// fail-fast pre-restart gate in deploy.sh: it THROWS on a bad migration so the
// deploy aborts before restarting the service against an un-migrated schema.
// Idempotent — already-applied migrations are skipped. The app also auto-migrates
// at boot (db/client.ts), so this is belt-and-suspenders.
//
//   SQLITE_PATH=/home/stratus/app/stratus.db bun run scripts/migrate.ts

import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';

const path = process.env.SQLITE_PATH ?? './stratus.db';
const sqlite = new Database(path, { create: true });
sqlite.exec('PRAGMA foreign_keys = ON;');
const db = drizzle(sqlite);

migrate(db, { migrationsFolder: new URL('../src/db/migrations', import.meta.url).pathname });
console.log(`migrations applied to ${path}`);
process.exit(0);
