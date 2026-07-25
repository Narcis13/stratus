// Articles (Authoring 3.0 / the Writer, A3.11) — CRUD over long-form Markdown
// originals drafted in the standalone /writer page. Mounted under `/x` by
// `mountX` in ../index.ts — always mounted, every route is $0 (pure SQL; nothing
// here touches X or Grok — the Grok assist route is A3.12, and articles never
// publish through the API, so the URL surcharge (invariant #1) does not apply:
// posting is a manual "Copy for X", and `publishedUrl` just records where it went).
//
// Routes:
//   GET    /articles       ?status=draft|published|discarded|all (default all), limit=
//                          — list WITHOUT body_md; carries bodyChars = length(body_md)
//   POST   /articles       body: { title?, pillar?, bodyMd? }  (title defaults 'Untitled')
//   GET    /articles/:id   full row (includes body_md + outline)
//   PATCH  /articles/:id   autosave path: { title?, subtitle?, bodyMd?, pillar?, outline?,
//                          status?, publishedUrl? } — accepts partials, bumps updatedAt.
//                          status:'published' stamps publishedAt on entry; published→draft
//                          re-opens; a discarded row is frozen except status back to draft.
//   DELETE /articles/:id   hard delete

import { type SQL, desc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { type AskLlmResult, askLLM, llmConfigured, llmErrorPayload } from '../../llm/index.ts';
import {
  ASSIST_SCHEMAS,
  type ArticleAssistContext,
  type OutlineProposal,
  buildArticleAssistInput,
  isArticleAssistMode,
  parseAssist,
} from '../articles/prompt.ts';
import { articles } from '../db/schema.ts';
import { parsePillar } from '../posts/pillars.ts';
import { loadPromptSafe } from '../prompts/registry.ts';
import { topWinners } from './drafter.ts';
import { getActivePillars } from './pillars.ts';
import { loadPostGuidanceSafe } from './playbook.ts';

const STATUSES = ['draft', 'published', 'discarded'] as const;
type ArticleStatus = (typeof STATUSES)[number];

const DEFAULT_TITLE = 'Untitled';
const MAX_TITLE_LEN = 300;
const MAX_SUBTITLE_LEN = 500;
// Articles are long-form; a generous ceiling that still fences runaway bodies.
const MAX_BODY_LEN = 200_000;
const MAX_PUBLISHED_URL_LEN = 400;
const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 500;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Assist (A3.12): per-field input ceilings + the Grok call house defaults. A
// full draft gets more room than a section/polish/outline; effort stays low —
// the model is grounded, not reasoning from scratch. askLLM merges DB AI
// settings over these (opts > settings > these).
const MAX_ASSIST_IDEA_LEN = 4000;
const MAX_ASSIST_HEADING_LEN = 500;
const MAX_ASSIST_SELECTION_LEN = 40_000;
const ASSIST_MAX_OUTPUT_TOKENS = 1200;
const ASSIST_MAX_OUTPUT_TOKENS_FULL = 3000;
const ASSIST_TEMPERATURE = 0.7;
const ASSIST_REASONING = 'low' as const;

// Explicit list columns — everything EXCEPT body_md, plus a cheap char count so
// the writer rail can show length without shipping every article's full text.
const LIST_COLUMNS = {
  id: articles.id,
  title: articles.title,
  subtitle: articles.subtitle,
  pillar: articles.pillar,
  status: articles.status,
  outline: articles.outline,
  publishedUrl: articles.publishedUrl,
  publishedAt: articles.publishedAt,
  createdAt: articles.createdAt,
  updatedAt: articles.updatedAt,
  bodyChars: sql<number>`length(${articles.bodyMd})`,
} as const;

export const articlesRouter = new Hono();

articlesRouter.get('/articles', async (c) => {
  const statusStr = c.req.query('status');
  if (statusStr !== undefined && statusStr !== 'all' && !isStatus(statusStr)) {
    return c.json({ error: 'invalid_status' }, 400);
  }

  const limitStr = c.req.query('limit');
  let limit = DEFAULT_LIST_LIMIT;
  if (limitStr !== undefined) {
    const n = Number(limitStr);
    if (!Number.isInteger(n) || n < 1) return c.json({ error: 'invalid_limit' }, 400);
    limit = Math.min(MAX_LIST_LIMIT, n);
  }

  const filter: SQL | undefined =
    statusStr !== undefined && statusStr !== 'all' ? eq(articles.status, statusStr) : undefined;

  const rows = await db
    .select(LIST_COLUMNS)
    .from(articles)
    .where(filter)
    .orderBy(desc(articles.updatedAt))
    .limit(limit);

  return c.json({ count: rows.length, articles: rows });
});

articlesRouter.post('/articles', async (c) => {
  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const body = raw as Record<string, unknown>;

  // title defaults 'Untitled'; a supplied one is trimmed and length-checked.
  let title = DEFAULT_TITLE;
  if (body.title !== undefined && body.title !== null) {
    if (typeof body.title !== 'string') return c.json({ error: 'invalid_title' }, 400);
    const trimmed = body.title.trim();
    if (trimmed.length > MAX_TITLE_LEN) return c.json({ error: 'invalid_title' }, 400);
    if (trimmed !== '') title = trimmed;
  }

  const bodyMd = parseBody(body.bodyMd);
  if (bodyMd === 'invalid') return c.json({ error: 'invalid_body_md' }, 400);

  const pillar = await parsePillarField(body.pillar);
  if (pillar === 'invalid') return c.json({ error: 'invalid_pillar' }, 400);

  const [row] = await db
    .insert(articles)
    .values({ title, bodyMd: bodyMd ?? '', pillar })
    .returning();
  return c.json(row, 201);
});

articlesRouter.get('/articles/:id', async (c) => {
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) return c.json({ error: 'invalid_id' }, 400);

  const [row] = await db.select().from(articles).where(eq(articles.id, id)).limit(1);
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json(row);
});

articlesRouter.patch('/articles/:id', async (c) => {
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) return c.json({ error: 'invalid_id' }, 400);

  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const body = raw as Record<string, unknown>;

  const [existing] = await db.select().from(articles).where(eq(articles.id, id)).limit(1);
  if (!existing) return c.json({ error: 'not_found' }, 404);

  // Validate the status transition up front — it gates the discarded freeze.
  let statusChange: ArticleStatus | undefined;
  if (body.status !== undefined) {
    if (!isStatus(body.status)) return c.json({ error: 'invalid_status' }, 400);
    statusChange = body.status;
  }

  // A discarded row is frozen: the only accepted edit is un-discarding it back to
  // draft, and only when no content field rides along (§ decision-style guard,
  // dm_drafts terminal-status precedent — 409, not 400).
  if (existing.status === 'discarded') {
    const reviving = statusChange === 'draft';
    const touchesContent =
      body.title !== undefined ||
      body.subtitle !== undefined ||
      body.bodyMd !== undefined ||
      body.pillar !== undefined ||
      body.outline !== undefined ||
      body.publishedUrl !== undefined;
    if (!reviving || touchesContent) return c.json({ error: 'discarded_locked' }, 409);
  }

  const updates: Partial<typeof articles.$inferInsert> = {};

  if (body.title !== undefined) {
    if (typeof body.title !== 'string') return c.json({ error: 'invalid_title' }, 400);
    const trimmed = body.title.trim();
    if (trimmed === '' || trimmed.length > MAX_TITLE_LEN) {
      return c.json({ error: 'invalid_title' }, 400);
    }
    updates.title = trimmed;
  }

  if (body.subtitle !== undefined) {
    const subtitle = parseNullableText(body.subtitle, MAX_SUBTITLE_LEN);
    if (subtitle === 'invalid') return c.json({ error: 'invalid_subtitle' }, 400);
    updates.subtitle = subtitle;
  }

  if (body.bodyMd !== undefined) {
    const bodyMd = parseBody(body.bodyMd);
    if (bodyMd === 'invalid') return c.json({ error: 'invalid_body_md' }, 400);
    updates.bodyMd = bodyMd ?? '';
  }

  if (body.pillar !== undefined) {
    const pillar = await parsePillarField(body.pillar);
    if (pillar === 'invalid') return c.json({ error: 'invalid_pillar' }, 400);
    updates.pillar = pillar;
  }

  if (body.outline !== undefined) {
    if (body.outline !== null && (typeof body.outline !== 'object' || body.outline === null)) {
      return c.json({ error: 'invalid_outline' }, 400);
    }
    updates.outline = body.outline;
  }

  if (body.publishedUrl !== undefined) {
    const url = parseNullableText(body.publishedUrl, MAX_PUBLISHED_URL_LEN);
    if (url === 'invalid') return c.json({ error: 'invalid_published_url' }, 400);
    updates.publishedUrl = url;
  }

  if (statusChange !== undefined) {
    updates.status = statusChange;
    // Stamp publishedAt only on the transition INTO published — re-editing a
    // published article (published → draft) keeps the original stamp as history,
    // and a re-publish (draft → published) re-stamps to the new publish time.
    if (statusChange === 'published' && existing.status !== 'published') {
      updates.publishedAt = new Date();
    }
  }

  if (Object.keys(updates).length === 0) return c.json({ error: 'empty_patch' }, 400);

  updates.updatedAt = new Date();
  const [row] = await db.update(articles).set(updates).where(eq(articles.id, id)).returning();
  return c.json(row);
});

articlesRouter.delete('/articles/:id', async (c) => {
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) return c.json({ error: 'invalid_id' }, 400);

  const result = await db
    .delete(articles)
    .where(eq(articles.id, id))
    .returning({ id: articles.id });
  if (result.length === 0) return c.json({ error: 'not_found' }, 404);
  return c.body(null, 204);
});

// Grok-backed writing assist (A3.12). One LLM call per click, LLM-gated at
// runtime (askLLM + llmConfigured, D5). The refusal ladder is entirely $0 and
// decided BEFORE any spend (§7.4): validation → 404 → discarded 409 → 503 →
// loaders → Grok. Only the `outline` mode WRITES (persists the structured
// outline + fills default title/subtitle); section/polish/full return text the
// editor inserts, so the human stays in control of the body.
articlesRouter.post('/articles/:id/assist', async (c) => {
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) return c.json({ error: 'invalid_id' }, 400);

  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const body = raw as Record<string, unknown>;

  if (!isArticleAssistMode(body.mode)) return c.json({ error: 'invalid_mode' }, 400);
  const mode = body.mode;

  // idea/heading/selection are optional any-language free text (parseNullableText
  // trims, empty → null, over-length → 'invalid').
  const idea = parseNullableText(body.idea, MAX_ASSIST_IDEA_LEN);
  if (idea === 'invalid') return c.json({ error: 'invalid_idea' }, 400);
  const heading = parseNullableText(body.heading, MAX_ASSIST_HEADING_LEN);
  if (heading === 'invalid') return c.json({ error: 'invalid_heading' }, 400);
  const selection = parseNullableText(body.selection, MAX_ASSIST_SELECTION_LEN);
  if (selection === 'invalid') return c.json({ error: 'invalid_selection' }, 400);

  // Each mode needs its seed (refuse-before-spend): outline/full an idea, section
  // a heading, polish a selection.
  if ((mode === 'outline' || mode === 'full') && !idea) {
    return c.json({ error: 'idea_required' }, 400);
  }
  if (mode === 'section' && !heading) return c.json({ error: 'heading_required' }, 400);
  if (mode === 'polish' && !selection) return c.json({ error: 'selection_required' }, 400);

  const [existing] = await db.select().from(articles).where(eq(articles.id, id)).limit(1);
  if (!existing) return c.json({ error: 'not_found' }, 404);
  // A discarded article is frozen (A3.11) — revive it before assisting. Refused
  // before the key check so it never spends.
  if (existing.status === 'discarded') return c.json({ error: 'discarded_locked' }, 409);

  // The any-provider gate is the last cheap check before the paid call.
  if (!llmConfigured()) return c.json({ error: 'grok_not_configured' }, 503);

  // $0 grounding loaders — the same few-shot discipline as the post/thread
  // drafter; guidance is best-effort (never blocks a draft).
  const [pillars, winners, guidance] = await Promise.all([
    getActivePillars(),
    topWinners(),
    loadPostGuidanceSafe(),
  ]);
  const prompt = loadPromptSafe('article');

  const ctx: ArticleAssistContext = {
    pillars,
    winners,
    guidance,
    article: {
      title: existing.title,
      subtitle: existing.subtitle,
      outline: existing.outline,
      bodyMd: existing.bodyMd,
    },
    idea,
    heading,
    selection,
  };

  let result: AskLlmResult;
  try {
    result = await askLLM(
      {
        messages: buildArticleAssistInput(mode, ctx, prompt.body),
        jsonSchema: { name: `article_${mode}`, schema: ASSIST_SCHEMAS[mode] },
        promptCacheKey: prompt.cacheKey,
      },
      {
        defaults: {
          reasoningEffort: ASSIST_REASONING,
          maxOutputTokens:
            mode === 'full' ? ASSIST_MAX_OUTPUT_TOKENS_FULL : ASSIST_MAX_OUTPUT_TOKENS,
          temperature: ASSIST_TEMPERATURE,
        },
      },
    );
  } catch (err) {
    const mapped = llmErrorPayload(err);
    if (mapped) return c.json(mapped.body, mapped.status);
    const detail = err instanceof Error ? err.message : String(err);
    console.error('/x/articles/:id/assist failed:', detail);
    return c.json({ error: 'assist_failed', detail }, 502);
  }

  const proposal = parseAssist(mode, result.text);
  if (!proposal) return c.json({ error: 'assist_parse_error', requestId: result.requestId }, 502);

  let persisted = false;
  if (mode === 'outline') {
    const outline = proposal as OutlineProposal;
    const updates: Partial<typeof articles.$inferInsert> = { outline, updatedAt: new Date() };
    // Fill title/subtitle only while they're still at their defaults — never
    // clobber a title the human already set.
    if (existing.title === DEFAULT_TITLE && outline.title.trim() !== '') {
      updates.title = outline.title.trim().slice(0, MAX_TITLE_LEN);
    }
    if (
      (existing.subtitle === null || existing.subtitle === '') &&
      outline.subtitle.trim() !== ''
    ) {
      updates.subtitle = outline.subtitle.trim().slice(0, MAX_SUBTITLE_LEN);
    }
    await db.update(articles).set(updates).where(eq(articles.id, id));
    persisted = true;
  }

  return c.json({
    mode,
    proposal,
    persisted,
    costUsd: result.costUsd,
    model: result.model,
    requestId: result.requestId,
  });
});

// ---------------------------------------------------------------- helpers

function isStatus(v: unknown): v is ArticleStatus {
  return typeof v === 'string' && (STATUSES as readonly string[]).includes(v);
}

/** Body Markdown: preserved verbatim (no trim — whitespace is content), null/
 *  absent → null (caller defaults to ''), over the ceiling → 'invalid'. */
function parseBody(value: unknown): string | null | 'invalid' {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return 'invalid';
  if (value.length > MAX_BODY_LEN) return 'invalid';
  return value;
}

/** Optional short text (subtitle, publishedUrl): trimmed, empty → null. */
function parseNullableText(value: unknown, max: number): string | null | 'invalid' {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return 'invalid';
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.length > max) return 'invalid';
  return trimmed;
}

/** Pillar steer validated against the live active slugs (calendar.ts pattern) —
 *  only touches the DB when a pillar is actually supplied. */
async function parsePillarField(value: unknown): Promise<string | null | 'invalid'> {
  if (value === undefined || value === null || value === '') return null;
  const slugs = (await getActivePillars()).map((p) => p.slug);
  const resolved = parsePillar(value, slugs);
  if (resolved === 'invalid') return 'invalid';
  return resolved ?? null;
}
