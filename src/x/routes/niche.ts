// Niche CRUD + activation ratchet (N0.2). A niche is the first-class identity +
// strategy container (persona/beliefs/replyPersona grounding + the 5 doctrine
// knobs); pillars/channels are owned by it. Mounted under `/x` by `mountX` —
// always, $0 (no X/Grok). Static paths + a `:slug` param that shadows nothing.
// The CRUD shape, validation style, and last-active 409 guard mirror pillars.ts.
//
//   GET    /niche            active niche + resolved doctrine (DEFAULT_NICHE fallback)
//   GET    /niches           all niches, active first
//   POST   /niches           { slug, label, persona, beliefs, replyPersona, description?, doctrine? }
//                            created INACTIVE. 409 slug_exists
//   PATCH  /niches/:slug      partial edit; active:true → atomic swap (sync txn);
//                            active:false on the only active → 409 last_active_niche
//   DELETE /niches/:slug      409 niche_active if active; else delete (pillars/channels
//                            keep their stamp — orphan-tolerant)

import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { niches } from '../db/schema.ts';
import { type NicheDoctrine, isValidNicheSlug, resolveDoctrine } from '../niche/defaults.ts';
import { loadActiveNicheSafe } from '../niche/store.ts';

const LABEL_MAX = 120;
const TEXT_MAX = 10000;
const DOCTRINE_KEYS: (keyof NicheDoctrine)[] = [
  'replyTargetMin',
  'replyTargetMax',
  'weekReplyTargetPct',
  'targetBandMinX',
  'targetBandMaxX',
];

// Validate a supplied doctrine blob: null clears to defaults; an object must have
// every PRESENT known key be a finite positive number (resolveDoctrine's own
// acceptance rule). Unlike the stored-row path we reject rather than silently
// coerce — lenient merge is only for what's already persisted (plan Decision 6).
function readDoctrine(
  value: unknown,
): { ok: true; value: Partial<NicheDoctrine> | null } | { ok: false } {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== 'object' || Array.isArray(value)) return { ok: false };
  const src = value as Record<string, unknown>;
  const out: Partial<NicheDoctrine> = {};
  for (const key of DOCTRINE_KEYS) {
    const v = src[key];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return { ok: false };
    out[key] = v;
  }
  return { ok: true, value: Object.keys(out).length > 0 ? out : null };
}

export const nicheRouter = new Hono();

nicheRouter.get('/niche', (c) => {
  const active = loadActiveNicheSafe();
  return c.json({ niche: active, doctrine: resolveDoctrine(active.doctrine) });
});

nicheRouter.get('/niches', (c) => {
  const rows = db.select().from(niches).orderBy(desc(niches.active), desc(niches.updatedAt)).all();
  return c.json(rows);
});

nicheRouter.post('/niches', async (c) => {
  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return c.json({ error: 'invalid_body' }, 400);
  const b = raw as Record<string, unknown>;

  const slug = typeof b.slug === 'string' ? b.slug.trim().toLowerCase() : '';
  if (!isValidNicheSlug(slug)) return c.json({ error: 'invalid_slug' }, 400);

  const label = typeof b.label === 'string' ? b.label.trim() : '';
  if (label === '' || label.length > LABEL_MAX) return c.json({ error: 'invalid_label' }, 400);

  const persona = typeof b.persona === 'string' ? b.persona.trim() : '';
  const beliefs = typeof b.beliefs === 'string' ? b.beliefs.trim() : '';
  const replyPersona = typeof b.replyPersona === 'string' ? b.replyPersona.trim() : '';
  if (persona === '' || persona.length > TEXT_MAX) return c.json({ error: 'invalid_persona' }, 400);
  if (beliefs === '' || beliefs.length > TEXT_MAX) return c.json({ error: 'invalid_beliefs' }, 400);
  if (replyPersona === '' || replyPersona.length > TEXT_MAX)
    return c.json({ error: 'invalid_reply_persona' }, 400);

  let description: string | null = null;
  if (b.description !== undefined && b.description !== null) {
    if (typeof b.description !== 'string' || b.description.length > TEXT_MAX)
      return c.json({ error: 'invalid_description' }, 400);
    description = b.description.trim();
  }

  let doctrine: Partial<NicheDoctrine> | null = null;
  if (b.doctrine !== undefined) {
    const d = readDoctrine(b.doctrine);
    if (!d.ok) return c.json({ error: 'invalid_doctrine' }, 400);
    doctrine = d.value;
  }

  const existing = db.select({ slug: niches.slug }).from(niches).where(eq(niches.slug, slug)).get();
  if (existing) return c.json({ error: 'slug_exists' }, 409);

  // Created inactive — activation is an explicit PATCH { active: true }.
  const [row] = db
    .insert(niches)
    .values({ slug, label, description, persona, beliefs, replyPersona, doctrine, active: false })
    .returning()
    .all();
  return c.json(row, 201);
});

nicheRouter.patch('/niches/:slug', async (c) => {
  const slug = c.req.param('slug');
  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return c.json({ error: 'invalid_body' }, 400);
  const b = raw as Record<string, unknown>;

  const existing = db
    .select({ slug: niches.slug, active: niches.active })
    .from(niches)
    .where(eq(niches.slug, slug))
    .get();
  if (!existing) return c.json({ error: 'not_found' }, 404);

  const patch: Record<string, unknown> = { updatedAt: new Date() };

  if (b.label !== undefined) {
    if (typeof b.label !== 'string' || b.label.trim() === '' || b.label.trim().length > LABEL_MAX)
      return c.json({ error: 'invalid_label' }, 400);
    patch.label = b.label.trim();
  }
  for (const field of ['persona', 'beliefs', 'replyPersona'] as const) {
    if (b[field] === undefined) continue;
    const v = b[field];
    if (typeof v !== 'string' || v.trim() === '' || v.trim().length > TEXT_MAX)
      return c.json(
        { error: `invalid_${field === 'replyPersona' ? 'reply_persona' : field}` },
        400,
      );
    patch[field] = v.trim();
  }
  if (b.description !== undefined) {
    if (b.description === null) {
      patch.description = null;
    } else {
      if (typeof b.description !== 'string' || b.description.length > TEXT_MAX)
        return c.json({ error: 'invalid_description' }, 400);
      patch.description = b.description.trim();
    }
  }
  if (b.doctrine !== undefined) {
    const d = readDoctrine(b.doctrine);
    if (!d.ok) return c.json({ error: 'invalid_doctrine' }, 400);
    patch.doctrine = d.value;
  }

  if (b.active !== undefined) {
    if (typeof b.active !== 'boolean') return c.json({ error: 'invalid_active' }, 400);
    if (b.active === true) {
      // Atomic swap: deactivate every active row, then activate this one, in ONE
      // sync txn (§7.13 — no await inside; .run()/.all() terminals). At most one
      // active row is ever observable.
      const row = db.transaction((tx) => {
        tx.update(niches).set({ active: false }).where(eq(niches.active, true)).run();
        const [r] = tx
          .update(niches)
          .set({ ...patch, active: true })
          .where(eq(niches.slug, slug))
          .returning()
          .all();
        return r;
      });
      return c.json(row);
    }
    // Deactivating: refuse if it's the only active niche (mirrors pillars).
    const activeRows = db
      .select({ slug: niches.slug })
      .from(niches)
      .where(eq(niches.active, true))
      .all();
    if (activeRows.length <= 1 && activeRows.some((r) => r.slug === slug))
      return c.json({ error: 'last_active_niche' }, 409);
    patch.active = false;
  }

  const [row] = db.update(niches).set(patch).where(eq(niches.slug, slug)).returning().all();
  return c.json(row);
});

nicheRouter.delete('/niches/:slug', (c) => {
  const slug = c.req.param('slug');
  const existing = db
    .select({ slug: niches.slug, active: niches.active })
    .from(niches)
    .where(eq(niches.slug, slug))
    .get();
  if (!existing) return c.json({ error: 'not_found' }, 404);
  if (existing.active) return c.json({ error: 'niche_active' }, 409);

  // Owned pillars/channels keep their `niche` stamp — orphan-tolerant, like a
  // channel delete leaving tag strings behind (a stale link degrades gracefully).
  db.delete(niches).where(eq(niches.slug, slug)).run();
  return c.json({ ok: true });
});
