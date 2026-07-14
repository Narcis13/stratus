// C9 icebreakers route wiring over the real (in-memory) DB — the $0 refusal
// paths only. The route must decide 404/422 BEFORE the XAI key check so a
// thin dossier can never trigger Grok spend; with the key forced off, a
// grounded person hits 503 instead of a paid call.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { people } from '../db/schema.ts';
import { peopleRouter } from './people.ts';

const app = new Hono();
app.route('/x', peopleRouter);

const BARE = 'c9_ice_bare';
const GROUNDED = 'c9_ice_grounded';

let savedKey: string | undefined;

async function post(path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app.request(path, { method: 'POST' });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('icebreakers route ($0 paths)', () => {
  beforeAll(async () => {
    savedKey = process.env.XAI_API_KEY;
    // '' is falsy for the route's runtime check; assigning undefined would
    // coerce to the string "undefined" and read as configured.
    process.env.XAI_API_KEY = '';
    await db.insert(people).values({ handle: BARE, source: 'test' }).onConflictDoNothing();
    await db
      .insert(people)
      .values({ handle: GROUNDED, source: 'test', notes: 'we talked about drizzle migrations' })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    process.env.XAI_API_KEY = savedKey ?? '';
    await db.delete(people).where(eq(people.handle, BARE));
    await db.delete(people).where(eq(people.handle, GROUNDED));
  });

  test('unknown person → 404', async () => {
    const { status } = await post('/x/people/c9_ice_missing/icebreakers');
    expect(status).toBe(404);
  });

  test('no shared context → 422, decided before any Grok concern', async () => {
    const { status, body } = await post(`/x/people/${BARE}/icebreakers`);
    expect(status).toBe(422);
    expect(body.error).toBe('no_shared_context');
  });

  test('grounded person without a key → 503, never a silent fabrication', async () => {
    const { status, body } = await post(`/x/people/${GROUNDED}/icebreakers`);
    expect(status).toBe(503);
    expect(body.error).toBe('grok_not_configured');
  });

  test('invalid handle → 400', async () => {
    const { status } = await post('/x/people/not%20a%20handle/icebreakers');
    expect(status).toBe(400);
  });
});
