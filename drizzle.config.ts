import type { Config } from 'drizzle-kit';

export default {
  schema: ['./src/db/shared-schema.ts', './src/x/db/schema.ts'],
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  strict: true,
  verbose: true,
} satisfies Config;
