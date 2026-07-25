// Editable content pillars (§8.6). CRUD over `content_pillars` plus a Grok-
// backed draft/tweak helper. Mounted under `/x` by `mountX` — always, because
// the Composer dropdown and the post drafter both read the live set even when
// XAI_API_KEY is absent (only /pillars/draft needs Grok; it checks at runtime).
//
//   GET    /pillars?active=true|false   list (sortOrder asc); omit → all
//   POST   /pillars                     { slug, label, body, sortOrder?, active? }
//   PATCH  /pillars/:slug               partial { label?, body?, sortOrder?, active? }
//   DELETE /pillars/:slug               409 if it's the last active pillar
//   POST   /pillars/draft               { mode:'new'|'tweak', idea?, slug?, instruction?, provider? }
//                                       → { proposal:{slug,label,body} } (not persisted)

import { type SQL, and, asc, eq, isNull, or } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import {
  type AskLlmResult,
  type LlmProvider,
  askLLM,
  llmConfigured,
  llmErrorPayload,
} from '../../llm/index.ts';
import { contentPillars } from '../db/schema.ts';
import { DEFAULT_NICHE } from '../niche/defaults.ts';
import { loadActiveNicheSafe } from '../niche/store.ts';
import {
  PILLAR_DRAFT_SCHEMA,
  buildPillarDraftInput,
  parsePillarProposal,
} from '../posts/pillarDraft.ts';
import { DEFAULT_PILLARS, type PillarDef, isValidPillarSlug } from '../posts/pillars.ts';
import { loadPromptSafe } from '../prompts/registry.ts';

export const pillars = new Hono();

// N0.6: a pillar is owned by the active niche when its stamp matches — or is
// NULL (rows pre-dating the niche column; legacy tolerance only). After the N0.1
// migration every row is stamped `builder`, so this is identity until a second
// niche exists.
function ownedByNiche(slug: string): SQL | undefined {
  return or(eq(contentPillars.niche, slug), isNull(contentPillars.niche));
}

// Active pillars (sortOrder asc) for the drafter / reply prompt, scoped to the
// active niche. Falls back to the seed set ONLY for the built-in `builder` niche
// (fresh DB / pre-migration) — a custom niche with zero pillars returns []
// deliberately, so the drafter refuses rather than leaking builder pillars.
export async function getActivePillars(): Promise<PillarDef[]> {
  const active = loadActiveNicheSafe();
  const rows = await db
    .select({ slug: contentPillars.slug, label: contentPillars.label, body: contentPillars.body })
    .from(contentPillars)
    .where(and(eq(contentPillars.active, true), ownedByNiche(active.slug)))
    .orderBy(asc(contentPillars.sortOrder), asc(contentPillars.slug));
  if (rows.length > 0) return rows;
  return active.slug === DEFAULT_NICHE.slug ? DEFAULT_PILLARS : [];
}

pillars.get('/pillars', async (c) => {
  const active = loadActiveNicheSafe();
  const activeParam = c.req.query('active');
  const order = [asc(contentPillars.sortOrder), asc(contentPillars.slug)] as const;
  const rows =
    activeParam === undefined
      ? await db
          .select()
          .from(contentPillars)
          .where(ownedByNiche(active.slug))
          .orderBy(...order)
      : await db
          .select()
          .from(contentPillars)
          .where(and(eq(contentPillars.active, activeParam === 'true'), ownedByNiche(active.slug)))
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

  // N0.6: stamp the owning niche so a new pillar joins the active niche's set.
  const activeNiche = loadActiveNicheSafe();
  const [row] = await db
    .insert(contentPillars)
    .values({ slug, label, body, sortOrder, active, niche: activeNiche.slug })
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

  // Deactivating the last active pillar would leave the drafter enum empty. The
  // guard is per-niche (N0.6): counts only pillars in the active niche's set, so
  // it can't false-fire on a pillar that belongs to a different, inactive niche.
  if (patch.active === false) {
    const activeNiche = loadActiveNicheSafe();
    const activeRows = await db
      .select({ slug: contentPillars.slug })
      .from(contentPillars)
      .where(and(eq(contentPillars.active, true), ownedByNiche(activeNiche.slug)));
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
    .select({
      slug: contentPillars.slug,
      active: contentPillars.active,
      niche: contentPillars.niche,
    })
    .from(contentPillars)
    .where(eq(contentPillars.slug, slug));
  if (!existing) return c.json({ error: 'not_found' }, 404);

  // Per-niche last-active guard (N0.6): only when the target belongs to the
  // active niche's set — deleting another niche's pillar can't empty the live
  // drafter enum, so it must not false-fire on the active niche's count.
  if (existing.active) {
    const activeNiche = loadActiveNicheSafe();
    if (existing.niche === activeNiche.slug || existing.niche === null) {
      const activeRows = await db
        .select({ slug: contentPillars.slug })
        .from(contentPillars)
        .where(and(eq(contentPillars.active, true), ownedByNiche(activeNiche.slug)));
      if (activeRows.length <= 1) return c.json({ error: 'last_active_pillar' }, 409);
    }
  }

  await db.delete(contentPillars).where(eq(contentPillars.slug, slug));
  return c.json({ ok: true });
});

pillars.post('/pillars/draft', async (c) => {
  // AI.6: any-provider gate (Grok or OpenRouter); askLLM enforces the resolved
  // provider's key per request. String kept stable for the extension matcher.
  if (!llmConfigured()) return c.json({ error: 'grok_not_configured' }, 503);

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

  // AI.5: per-request LLM provider override; absent → the stored AI setting
  // decides inside askLLM.
  let provider: LlmProvider | undefined;
  if (b.provider !== undefined && b.provider !== null) {
    if (b.provider !== 'grok' && b.provider !== 'openrouter') {
      return c.json({ error: 'invalid_provider' }, 400);
    }
    provider = b.provider;
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

  // Registry prompt (AI.5): DB override else the shipped default.
  const prompt = loadPromptSafe('pillar-draft');
  const messages = buildPillarDraftInput({
    mode,
    existing,
    persona,
    template: prompt.body,
    ...(idea !== undefined ? { idea } : {}),
    ...(target !== undefined ? { target } : {}),
    ...(instruction !== undefined ? { instruction } : {}),
  });

  let result: AskLlmResult;
  try {
    result = await askLLM(
      {
        messages,
        ...(provider !== undefined ? { provider } : {}),
        jsonSchema: { name: 'pillar', schema: PILLAR_DRAFT_SCHEMA },
        // Sha of the effective prompt body + niche suffix (the persona sits at
        // the top of this prompt, so a niche edit changes the prefix too).
        promptCacheKey: `${prompt.cacheKey}:${niche.slug}:${niche.updatedAt?.getTime() ?? 0}`,
      },
      { defaults: { reasoningEffort: 'low', maxOutputTokens: 700, temperature: 0.7 } },
    );
  } catch (err) {
    const mapped = llmErrorPayload(err);
    if (mapped) return c.json(mapped.body, mapped.status);
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
