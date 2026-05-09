import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import * as sharedSchema from './shared-schema.ts';
import * as xSchema from '../x/db/schema.ts';

// Bun ships a global WebSocket; neon-serverless needs it set explicitly
// (its default lookup is geared to Node, where WebSocket is not global).
if (typeof WebSocket !== 'undefined') {
  // biome-ignore lint/suspicious/noExplicitAny: neonConfig types target node ws
  neonConfig.webSocketConstructor = WebSocket as any;
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');

export const pool = new Pool({ connectionString: url });

export const db = drizzle(pool, { schema: { ...sharedSchema, ...xSchema } });

export type DB = typeof db;
