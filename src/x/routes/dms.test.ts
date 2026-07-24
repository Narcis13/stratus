// DM routes over the real (in-memory) DB (A3.9). POST /dms/draft is tested only
// on its $0 refusal ladder (400 → 404 → 422 → 503) — the paid Grok path is
// live-only, the icebreaker-route convention. The pure-SQL list/patch routes are
// tested directly by seeding dm_drafts rows (no LLM), including the sent-logging
// that writes the manual_dm_logged person event exactly once (§7.8/§7.10).

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { dmDrafts, people, personEvents } from '../db/schema.ts';
import { dmsRouter } from './dms.ts';
import { peopleRouter } from './people.ts';

const app = new Hono();
app.route('/x', peopleRouter);
app.route('/x', dmsRouter);

const NOBODY = 'a39_dm_nobody';
const BARE = 'a39_dm_bare';
const GROUND = 'a39_dm_ground';
const PATCHY = 'a39_dm_patch';
const HANDLES = [BARE, GROUND, PATCHY];

let savedKey: string | undefined;
let savedOrKey: string | undefined;

async function post(
  path: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    body: (await res.json().catch(() => ({}))) as Record<string, unknown>,
  };
}

async function patch(
  path: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app.request(path, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    body: (await res.json().catch(() => ({}))) as Record<string, unknown>,
  };
}

async function seedDraft(handle: string, text: string, status = 'draft'): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(dmDrafts).values({ id, handle, text, status });
  return id;
}

describe('dms routes (A3.9)', () => {
  beforeAll(async () => {
    savedKey = process.env.XAI_API_KEY;
    savedOrKey = process.env.OPENROUTER_API_KEY;
    // Force BOTH providers off so a grounded person hits the $0 503 refusal
    // instead of a paid call (the icebreaker-route discipline).
    process.env.XAI_API_KEY = '';
    process.env.OPENROUTER_API_KEY = '';
    await db.insert(people).values({ handle: BARE, source: 'test' }).onConflictDoNothing();
    await db
      .insert(people)
      .values({ handle: GROUND, source: 'test', notes: 'we swapped notes on drizzle migrations' })
      .onConflictDoNothing();
    await db.insert(people).values({ handle: PATCHY, source: 'test' }).onConflictDoNothing();
  });

  afterAll(async () => {
    process.env.XAI_API_KEY = savedKey ?? '';
    process.env.OPENROUTER_API_KEY = savedOrKey ?? '';
    for (const h of HANDLES) {
      await db.delete(personEvents).where(eq(personEvents.handle, h));
      await db.delete(dmDrafts).where(eq(dmDrafts.handle, h));
      await db.delete(people).where(eq(people.handle, h));
    }
  });

  afterEach(async () => {
    // PATCH/list tests own their own rows; clear between tests so list filters
    // and event counts stay deterministic.
    for (const h of HANDLES) {
      await db.delete(personEvents).where(eq(personEvents.handle, h));
      await db.delete(dmDrafts).where(eq(dmDrafts.handle, h));
    }
  });

  // ------------------------------------------------ refusal ladder ($0)

  test('invalid body / invalid handle → 400 before any lookup', async () => {
    expect((await post('/x/dms/draft', 'not-an-object')).status).toBe(400);
    const bad = await post('/x/dms/draft', { handle: 'not a handle' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('invalid_handle');
  });

  test('unknown person → 404, decided before any Grok concern', async () => {
    const { status, body } = await post('/x/dms/draft', { handle: NOBODY });
    expect(status).toBe(404);
    expect(body.error).toBe('unknown_person');
  });

  test('no shared context → 422, before the key check', async () => {
    const { status, body } = await post('/x/dms/draft', { handle: BARE });
    expect(status).toBe(422);
    expect(body.error).toBe('no_shared_context');
  });

  test('grounded person, no LLM provider → 503 (never a silent fabrication)', async () => {
    const { status, body } = await post('/x/dms/draft', { handle: GROUND, idea: 'reconnect' });
    expect(status).toBe(503);
    expect(body.error).toBe('grok_not_configured');
  });

  test('over-length idea → 400 invalid_idea, still $0', async () => {
    const { status, body } = await post('/x/dms/draft', {
      handle: GROUND,
      idea: 'x'.repeat(2001),
    });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_idea');
  });

  // ------------------------------------------------------------ GET /dms

  test('list filters by handle and status, newest first', async () => {
    await seedDraft(PATCHY, 'draft one');
    await seedDraft(PATCHY, 'sent one', 'sent');
    await seedDraft(BARE, 'other person');

    const all = await app.request('/x/dms');
    expect(((await all.json()) as { count: number }).count).toBeGreaterThanOrEqual(3);

    const byHandle = await app.request(`/x/dms?handle=${PATCHY}`);
    const hbody = (await byHandle.json()) as { count: number; dms: Array<{ handle: string }> };
    expect(hbody.count).toBe(2);
    expect(hbody.dms.every((d) => d.handle === PATCHY)).toBe(true);

    const byStatus = await app.request(`/x/dms?handle=${PATCHY}&status=sent`);
    const sbody = (await byStatus.json()) as { count: number; dms: Array<{ text: string }> };
    expect(sbody.count).toBe(1);
    expect(sbody.dms[0]?.text).toBe('sent one');
  });

  test('invalid status / limit → 400', async () => {
    expect((await app.request('/x/dms?status=weird')).status).toBe(400);
    expect((await app.request('/x/dms?limit=0')).status).toBe(400);
  });

  // ---------------------------------------------------------- PATCH /dms/:id

  test('invalid id → 400, unknown id → 404', async () => {
    expect((await patch('/x/dms/not-a-uuid', { text: 'x' })).status).toBe(400);
    expect((await patch('/x/dms/00000000-0000-0000-0000-000000000000', { text: 'x' })).status).toBe(
      404,
    );
  });

  test('text editable while draft', async () => {
    const id = await seedDraft(PATCHY, 'original');
    const { status, body } = await patch(`/x/dms/${id}`, { text: '  edited draft  ' });
    expect(status).toBe(200);
    expect(body.text).toBe('edited draft');
  });

  test('empty text / empty patch → 400', async () => {
    const id = await seedDraft(PATCHY, 'original');
    expect((await patch(`/x/dms/${id}`, { text: '   ' })).status).toBe(400);
    expect((await patch(`/x/dms/${id}`, {})).status).toBe(400);
  });

  test('mark sent stamps sentAt and logs exactly one manual_dm_logged; idempotent', async () => {
    const id = await seedDraft(PATCHY, 'the message I sent');
    const first = await patch(`/x/dms/${id}`, { status: 'sent' });
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('sent');
    expect(first.body.sentAt).not.toBeNull();

    const eventId = `manual_dm_logged:dm_drafts:${id}`;
    const events1 = await db
      .select()
      .from(personEvents)
      .where(and(eq(personEvents.handle, PATCHY), eq(personEvents.type, 'manual_dm_logged')));
    expect(events1.length).toBe(1);
    expect(events1[0]?.id).toBe(eventId);

    // Marking sent again is a no-op (the ratchet) and never doubles the event.
    const second = await patch(`/x/dms/${id}`, { status: 'sent' });
    expect(second.status).toBe(200);
    const events2 = await db
      .select()
      .from(personEvents)
      .where(and(eq(personEvents.handle, PATCHY), eq(personEvents.type, 'manual_dm_logged')));
    expect(events2.length).toBe(1);
  });

  test('a sent draft is text-locked and status-locked (nothing regresses)', async () => {
    const id = await seedDraft(PATCHY, 'sent body', 'sent');
    expect((await patch(`/x/dms/${id}`, { text: 'nope' })).status).toBe(409);
    const back = await patch(`/x/dms/${id}`, { status: 'discarded' });
    expect(back.status).toBe(409);
    expect(back.body.error).toBe('status_locked');
  });

  test('draft can be discarded, then is locked', async () => {
    const id = await seedDraft(PATCHY, 'to discard');
    expect((await patch(`/x/dms/${id}`, { status: 'discarded' })).status).toBe(200);
    expect((await patch(`/x/dms/${id}`, { status: 'sent' })).status).toBe(409);
  });
});
