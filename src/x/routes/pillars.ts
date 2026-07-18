// Editable content pillars (§8.6). CRUD over `content_pillars` plus a Grok-
// backed draft/tweak helper. Mounted under `/x` by `mountX` — always, because
// the Composer dropdown and the post drafter both read the live set even when
// XAI_API_KEY is absent (only /pillars/draft needs Grok; it checks at runtime).
//
//   GET    /pillars?active=true|false   list (sortOrder asc); omit → all
//   POST   /pillars                     { slug, label, body, sortOrder?, active? }
//   PATCH  /pillars/:slug               partial { label?, body?, sortOrder?, active? }
//   DELETE /pillars/:slug               409 if it's the last active pillar
//   POST   /pillars/draft               { mode:'new'|'tweak', idea?, slug?, instruction? }
//                                       → { proposal:{slug,label,body} } (not persisted)

import { asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { GrokApiError, askGrok } from '../../grok/index.ts';
import { contentPillars } from '../db/schema.ts';
import { loadActiveNicheSafe } from '../niche/store.ts';
import {
  PILLAR_DRAFT_SCHEMA,
  buildPillarDraftInput,
  parsePillarProposal,
} from '../posts/pillarDraft.ts';
import { DEFAULT_PILLARS, type PillarDef, isValidPillarSlug } from '../posts/pillars.ts';

const PILLAR_DRAFT_CACHE_KEY = 'stratus-pillar-draft';

export const pillars = new Hono();

// Active pillars (sortOrder asc) for the drafter / reply prompt. Falls back to
// the seed set when the table is empty (fresh DB / pre-migration) so a draft is
// never pillar-less.
export async function getActivePillars(): Promise<PillarDef[]> {
  const rows = await db
    .select({ slug: contentPillars.slug, label: contentPillars.label, body: contentPillars.body })
    .from(contentPillars)
    .where(eq(contentPillars.active, true))
    .orderBy(asc(contentPillars.sortOrder), asc(contentPillars.slug));
  return rows.length > 0 ? rows : DEFAULT_PILLARS;
}

pillars.get('/pillars', async (c) => {
  const activeParam = c.req.query('active');
  const order = [asc(contentPillars.sortOrder), asc(contentPillars.slug)] as const;
  const rows =
    activeParam === undefined
      ? await db
          .select()
          .from(contentPillars)
          .orderBy(...order)
      : await db
          .select()
          .from(contentPillars)
          .where(eq(contentPillars.active, activeParam === 'true'))
          .orderBy(...order);
  return c.json(rows);
});

pillars.post('/pillars', async (c) => {
  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return c.json({ error: 'invalid_body' }, 400);
  const b = raw as Record<string, unknown>;

  const slug = typeof b.slug === 'string' ? b.slug.trim().toLowerCase() : '';
  if (!isValidPillarSlug(slug)) return c.json({ error: 'invalid_slug' }, 400);
  const label = typeof b.label === 'string' ? b.label.trim() : '';
  const body = typeof b.body === 'string' ? b.body.trim() : '';
  if (label === '' || body === '') return c.json({ error: 'invalid_label_or_body' }, 400);
  const sortOrder =
    typeof b.sortOrder === 'number' && Number.isInteger(b.sortOrder) ? b.sortOrder : 0;
  const active = typeof b.active === 'boolean' ? b.active : true;

  const existing = await db
    .select({ slug: contentPillars.slug })
    .from(contentPillars)
    .where(eq(contentPillars.slug, slug));
  if (existing.length > 0) return c.json({ error: 'slug_exists' }, 409);

  const [row] = await db
    .insert(contentPillars)
    .values({ slug, label, body, sortOrder, active })
    .returning();
  return c.json(row, 201);
});

pillars.patch('/pillars/:slug', async (c) => {
  const slug = c.req.param('slug');
  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return c.json({ error: 'invalid_body' }, 400);
  const b = raw as Record<string, unknown>;

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (b.label !== undefined) {
    if (typeof b.label !== 'string' || b.label.trim() === '')
      return c.json({ error: 'invalid_label' }, 400);
    patch.label = b.label.trim();
  }
  if (b.body !== undefined) {
    if (typeof b.body !== 'string' || b.body.trim() === '')
      return c.json({ error: 'invalid_body_field' }, 400);
    patch.body = b.body.trim();
  }
  if (b.sortOrder !== undefined) {
    if (typeof b.sortOrder !== 'number' || !Number.isInteger(b.sortOrder))
      return c.json({ error: 'invalid_sort_order' }, 400);
    patch.sortOrder = b.sortOrder;
  }
  if (b.active !== undefined) {
    if (typeof b.active !== 'boolean') return c.json({ error: 'invalid_active' }, 400);
    patch.active = b.active;
  }

  // Deactivating the last active pillar would leave the drafter enum empty.
  if (patch.active === false) {
    const activeRows = await db
      .select({ slug: contentPillars.slug })
      .from(contentPillars)
      .where(eq(contentPillars.active, true));
    if (activeRows.length <= 1 && activeRows.some((r) => r.slug === slug)) {
      return c.json({ error: 'last_active_pillar' }, 409);
    }
  }

  const [row] = await db
    .update(contentPillars)
    .set(patch)
    .where(eq(contentPillars.slug, slug))
    .returning();
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json(row);
});

pillars.delete('/pillars/:slug', async (c) => {
  const slug = c.req.param('slug');
  const [existing] = await db
    .select({ slug: contentPillars.slug, active: contentPillars.active })
    .from(contentPillars)
    .where(eq(contentPillars.slug, slug));
  if (!existing) return c.json({ error: 'not_found' }, 404);

  if (existing.active) {
    const activeRows = await db
      .select({ slug: contentPillars.slug })
      .from(contentPillars)
      .where(eq(contentPillars.active, true));
    if (activeRows.length <= 1) return c.json({ error: 'last_active_pillar' }, 409);
  }

  await db.delete(contentPillars).where(eq(contentPillars.slug, slug));
  return c.json({ ok: true });
});

pillars.post('/pillars/draft', async (c) => {
  if (!process.env.XAI_API_KEY) return c.json({ error: 'grok_not_configured' }, 503);

  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return c.json({ error: 'invalid_body' }, 400);
  const b = raw as Record<string, unknown>;

  const mode = b.mode === 'tweak' ? 'tweak' : b.mode === 'new' ? 'new' : null;
  if (mode === null) return c.json({ error: 'invalid_mode' }, 400);

  let idea: string | undefined;
  if (b.idea !== undefined && b.idea !== null) {
    if (typeof b.idea !== 'string' || b.idea.length > 2000)
      return c.json({ error: 'invalid_idea' }, 400);
    if (b.idea.trim() !== '') idea = b.idea.trim();
  }
  let instruction: string | undefined;
  if (b.instruction !== undefined && b.instruction !== null) {
    if (typeof b.instruction !== 'string' || b.instruction.length > 2000)
      return c.json({ error: 'invalid_instruction' }, 400);
    if (b.instruction.trim() !== '') instruction = b.instruction.trim();
  }

  const existing = await getActivePillars();

  let target: PillarDef | undefined;
  if (mode === 'tweak') {
    const slug = typeof b.slug === 'string' ? b.slug.trim().toLowerCase() : '';
    if (!isValidPillarSlug(slug)) return c.json({ error: 'invalid_slug' }, 400);
    const [row] = await db
      .select({ slug: contentPillars.slug, label: contentPillars.label, body: contentPillars.body })
      .from(contentPillars)
      .where(eq(contentPillars.slug, slug));
    target = row ?? existing.find((p) => p.slug === slug);
    if (!target) return c.json({ error: 'pillar_not_found' }, 404);
  }

  // N0.3: persona grounding from the active niche; the prose description (when
  // present) rides along so a new pillar can fit the wider self-description.
  const niche = loadActiveNicheSafe();
  const persona = niche.description ? `${niche.persona}\n\n${niche.description}` : niche.persona;

  const messages = buildPillarDraftInput({
    mode,
    existing,
    persona,
    ...(idea !== undefined ? { idea } : {}),
    ...(target !== undefined ? { target } : {}),
    ...(instruction !== undefined ? { instruction } : {}),
  });

  let result: Awaited<ReturnType<typeof askGrok>>;
  try {
    result = await askGrok({
      messages,
      reasoningEffort: 'low',
      maxOutputTokens: 700,
      temperature: 0.7,
      jsonSchema: { name: 'pillar', schema: PILLAR_DRAFT_SCHEMA },
      // Niche-suffixed: the persona sits at the top of this prompt, so a niche
      // edit changes the prefix — bust the cache bucket with it.
      promptCacheKey: `${PILLAR_DRAFT_CACHE_KEY}:${niche.slug}:${niche.updatedAt?.getTime() ?? 0}`,
    });
  } catch (err) {
    if (err instanceof GrokApiError) {
      return c.json(
        {
          error: 'grok_upstream_error',
          status: err.status,
          message: err.message,
          requestId: err.requestId,
        },
        err.status === 429 ? 429 : 502,
      );
    }
    const detail = err instanceof Error ? err.message : String(err);
    console.error('/x/pillars/draft failed:', detail);
    return c.json({ error: 'draft_failed', detail }, 502);
  }

  const proposal = parsePillarProposal(result.text, target?.slug);
  if (!proposal) return c.json({ error: 'grok_parse_error', requestId: result.requestId }, 502);

  return c.json({
    proposal,
    model: result.model,
    costUsd: result.costUsd,
    requestId: result.requestId,
  });
});
