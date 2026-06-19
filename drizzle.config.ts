import type { Config } from 'drizzle-kit';

export default {
  schema: ['./src/db/shared-schema.ts', './src/x/db/schema.ts'],
  out: './src/db/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.SQLITE_PATH ?? './stratus.db',
  },
  strict: true,
  verbose: true,
} satisfies Config;
