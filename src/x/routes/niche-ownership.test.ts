// N0.6 — pillars + channels owned and filtered by the active niche, plus the
// drafter's refuse-before-spend guard when a custom niche has zero pillars.
// Over the real (in-memory, auto-migrated) SQLite DB; bun run test uses
// SQLITE_PATH=:memory:. Routers mount on a bare Hono (channels.test/niche.test
// pattern — the shared /x bearer middleware is covered by app.test/mcp.test).
// afterAll restores the single active `builder` row and deletes every row this
// file created, so the shared DB stays clean for other files (same discipline
// as niche.test.ts — a stray active non-builder niche would skew their reads).

import { afterAll, describe, expect, test } from 'bun:test';
import { count, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { costEvents } from '../../db/shared-schema.ts';
import { channels, contentPillars, niches, scheduledPosts } from '../db/schema.ts';
import { DEFAULT_NICHE } from '../niche/defaults.ts';
import { calendar } from './calendar.ts';
import { channelsRouter } from './channels.ts';
import { drafter } from './drafter.ts';
import { nicheRouter } from './niche.ts';
import { pillars } from './pillars.ts';

const app = new Hono();
app.route('/x', nicheRouter);
app.route('/x', pillars);
app.route('/x', channelsRouter);
app.route('/x', drafter);
app.route('/x', calendar);

const NICHE = 'nutrition-test-n6';
const NPILLAR = 'nutri-pillar-n6';
const BCHAN = 'builder-chan-n6';
const NCHAN = 'nutri-chan-n6';
const CAL_TEXT = 'n6 pillar validation post';

// The seed builder pillars — stay hidden while a custom niche is active.
const BUILDER_PILLARS = ['ai-craft', 'builder-51', 'unsexy-problems'];

const NICHE_BODY = {
  slug: NICHE,
  label: 'Nutrition N6',
  persona: 'A registered dietitian who ships evidence-based meal plans.',
  beliefs: 'Whole foods > supplements. Adherence beats optimality.',
  replyPersona: 'I am a dietitian. I build in public.',
  description: 'Nutrition niche for the N0.6 ownership suite.',
};

async function send<T>(
  path: string,
  method: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const res = await app.request(path, {
    method,
    ...(body !== undefined
      ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
  const parsed = res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  return { status: res.status, body: parsed };
}

afterAll(() => {
  db.delete(contentPillars).where(eq(contentPillars.slug, NPILLAR)).run();
  db.delete(channels)
    .where(inArray(channels.slug, [BCHAN, NCHAN]))
    .run();
  db.delete(scheduledPosts).where(eq(scheduledPosts.text, CAL_TEXT)).run();
  db.delete(niches).where(eq(niches.slug, NICHE)).run();
  db.update(niches).set({ active: false }).run();
  const b = db.select({ slug: niches.slug }).from(niches).where(eq(niches.slug, 'builder')).get();
  if (b) {
    db.update(niches).set({ active: true }).where(eq(niches.slug, 'builder')).run();
  } else {
    db.insert(niches)
      .values({
        slug: DEFAULT_NICHE.slug,
        label: DEFAULT_NICHE.label,
        description: DEFAULT_NICHE.description,
        persona: DEFAULT_NICHE.persona,
        beliefs: DEFAULT_NICHE.beliefs,
        replyPersona: DEFAULT_NICHE.replyPersona,
        active: true,
      })
      .run();
  }
});

interface Pillar {
  slug: string;
  niche: string | null;
  active: boolean;
}
interface Channel {
  slug: string;
  niche: string | null;
}

describe('niche ownership: pillars + channels + drafter refusal', () => {
  test('setup: builder active, POST channel is stamped builder and is visible', async () => {
    // Deterministic starting point regardless of which niche file ran before.
    await send(`/x/niches/${DEFAULT_NICHE.slug}`, 'PATCH', { active: true });

    const chan = await send<Channel>('/x/channels', 'POST', {
      slug: BCHAN,
      label: 'Builder Chan N6',
    });
    expect(chan.status).toBe(201);
    expect(chan.body.niche).toBe('builder');

    const list = await send<Channel[]>('/x/channels', 'GET');
    expect(list.body.map((r) => r.slug)).toContain(BCHAN);
  });

  test('create + activate the nutrition niche', async () => {
    const create = await send<{ slug: string; active: boolean }>('/x/niches', 'POST', NICHE_BODY);
    expect(create.status).toBe(201);
    expect(create.body.active).toBe(false);

    const act = await send<{ active: boolean }>(`/x/niches/${NICHE}`, 'PATCH', { active: true });
    expect(act.status).toBe(200);
    expect(act.body.active).toBe(true);

    const g = await send<{ niche: { slug: string } }>('/x/niche', 'GET');
    expect(g.body.niche.slug).toBe(NICHE);
  });

  test('custom niche reads empty pillar/channel sets — zero builder leakage', async () => {
    const pAll = await send<Pillar[]>('/x/pillars', 'GET');
    for (const s of BUILDER_PILLARS) expect(pAll.body.map((p) => p.slug)).not.toContain(s);

    const pActive = await send<Pillar[]>('/x/pillars?active=true', 'GET');
    for (const s of BUILDER_PILLARS) expect(pActive.body.map((p) => p.slug)).not.toContain(s);

    const chans = await send<Channel[]>('/x/channels', 'GET');
    // BCHAN belongs to `builder` — invisible while nutrition is active.
    expect(chans.body.map((c) => c.slug)).not.toContain(BCHAN);
  });

  test('drafter refuses no_pillars_for_niche BEFORE any Grok spend', async () => {
    const before = db.select({ n: count() }).from(costEvents).get()?.n ?? 0;

    const res = await send<{ error: string; niche: string }>('/x/posts/draft', 'POST', {});
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('no_pillars_for_niche');
    expect(res.body.niche).toBe(NICHE);

    // Refuse-before-spend: no billed call, so no cost_events row was written.
    const after = db.select({ n: count() }).from(costEvents).get()?.n ?? 0;
    expect(after).toBe(before);
  });

  test('a builder channel room 404s while a different niche is active', async () => {
    const room = await send<{ error: string }>(`/x/channels/${BCHAN}`, 'GET');
    expect(room.status).toBe(404);
    expect(room.body.error).toBe('not_found');
  });

  test('POST pillar/channel under nutrition stamps niche=nutrition', async () => {
    const p = await send<Pillar>('/x/pillars', 'POST', {
      slug: NPILLAR,
      label: 'Meal plans',
      body: 'Evidence-based meal planning, one concrete swap per post.',
    });
    expect(p.status).toBe(201);
    expect(p.body.niche).toBe(NICHE);

    const ch = await send<Channel>('/x/channels', 'POST', { slug: NCHAN, label: 'Macros' });
    expect(ch.status).toBe(201);
    expect(ch.body.niche).toBe(NICHE);

    // Now the nutrition sets are non-empty and builder-free.
    const pillarsNow = await send<Pillar[]>('/x/pillars?active=true', 'GET');
    const pslugs = pillarsNow.body.map((p) => p.slug);
    expect(pslugs).toContain(NPILLAR);
    for (const s of BUILDER_PILLARS) expect(pslugs).not.toContain(s);
  });

  test('last-active guard is per-niche (nutrition has 1 pillar, builder has 3 — inactive)', async () => {
    // Deactivating nutrition's only active pillar 409s even though builder (an
    // inactive niche) still has three active pillars.
    const deact = await send<{ error: string }>(`/x/pillars/${NPILLAR}`, 'PATCH', {
      active: false,
    });
    expect(deact.status).toBe(409);
    expect(deact.body.error).toBe('last_active_pillar');

    const del = await send<{ error: string }>(`/x/pillars/${NPILLAR}`, 'DELETE');
    expect(del.status).toBe(409);
    expect(del.body.error).toBe('last_active_pillar');
  });

  test('calendar pillar validation follows the active niche slug set', async () => {
    // A builder pillar slug is invalid under nutrition...
    const bad = await send<{ error: string }>('/x/posts/scheduled', 'POST', {
      text: CAL_TEXT,
      pillar: 'builder-51',
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('invalid_pillar');

    // ...but the nutrition pillar is accepted (draft, no scheduledFor).
    const ok = await send<{ pillar: string; status: string }>('/x/posts/scheduled', 'POST', {
      text: CAL_TEXT,
      pillar: NPILLAR,
    });
    expect(ok.status).toBe(201);
    expect(ok.body.pillar).toBe(NPILLAR);
  });

  test('reactivate builder → builder sets visible, nutrition sets hidden', async () => {
    await send(`/x/niches/${DEFAULT_NICHE.slug}`, 'PATCH', { active: true });

    const pActive = await send<Pillar[]>('/x/pillars?active=true', 'GET');
    const pslugs = pActive.body.map((p) => p.slug);
    for (const s of BUILDER_PILLARS) expect(pslugs).toContain(s);
    expect(pslugs).not.toContain(NPILLAR);

    const chans = await send<Channel[]>('/x/channels', 'GET');
    const cslugs = chans.body.map((c) => c.slug);
    expect(cslugs).toContain(BCHAN);
    expect(cslugs).not.toContain(NCHAN);

    // The nutrition channel room is now invisible; the builder one is back.
    const nutriRoom = await send<{ error: string }>(`/x/channels/${NCHAN}`, 'GET');
    expect(nutriRoom.status).toBe(404);
    const builderRoom = await send<{ channel: Channel }>(`/x/channels/${BCHAN}`, 'GET');
    expect(builderRoom.status).toBe(200);
    expect(builderRoom.body.channel.slug).toBe(BCHAN);
  });
});
