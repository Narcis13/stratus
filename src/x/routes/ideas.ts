// Idea Inbox (CIRCLES-PLAN C6) — captured seeds for posts and replies, with an
// explicit consume lifecycle instead of the old delete-after-one-use behavior
// of `replyMaster:idea`. Mounted under `/x` by `mountX` in ../index.ts — always
// mounted, every route is $0 (pure SQL; nothing here touches X or Grok).
//
// Routes:
//   GET    /ideas       ?status=open|consumed|discarded|all (default open), q=, limit=
//   POST   /ideas       body: { text, sourceUrl?, tags? }
//   PATCH  /ideas/:id   body: { text?, sourceUrl?, tags?, status?, consumedByTable?, consumedById? }
//   DELETE /ideas/:id
//
// Consumption normally happens server-side on the paying path: /replies/generate
// and /posts/draft accept `ideaId` and call consumeIdeaSafe after their insert,
// stamping status + the backlink that powers the calendar's "seeded by" line.
// Re-opening (PATCH status 'open') clears the backlink — re-use is one click.

import { type SQL, and, desc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { ideas } from '../db/schema.ts';

const STATUSES = ['open', 'consumed', 'discarded'] as const;
type IdeaStatus = (typeof STATUSES)[number];

const MAX_TEXT_LEN = 2000;
const MAX_SOURCE_URL_LEN = 1000;
const MAX_TAGS = 25;
const MAX_TAG_LEN = 40;
const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 500;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Tables an idea may backlink to — the two draft surfaces that consume ideas.
const CONSUMER_TABLES = ['reply_drafts', 'scheduled_posts'] as const;

/** Flip an open idea to consumed with its backlink. Only advances `open` rows
 *  (a re-consumed or discarded idea keeps its first provenance), and never
 *  throws — consumption is bookkeeping on a paying path that already spent the
 *  Grok money (same discipline as persistRadarDrafts). */
export async function consumeIdeaSafe(
  ideaId: string,
  consumedByTable: (typeof CONSUMER_TABLES)[number],
  consumedById: string,
): Promise<void> {
  try {
    await db
      .update(ideas)
      .set({ status: 'consumed', consumedByTable, consumedById, updatedAt: new Date() })
      .where(and(eq(ideas.id, ideaId), eq(ideas.status, 'open')));
  } catch (err) {
    console.error(
      'ideas: consume failed (draft unaffected):',
      err instanceof Error ? err.message : err,
    );
  }
}

export const ideasRouter = new Hono();

ideasRouter.get('/ideas', async (c) => {
  const statusStr = c.req.query('status') ?? 'open';
  if (statusStr !== 'all' && !isStatus(statusStr)) return c.json({ error: 'invalid_status' }, 400);

  const q = c.req.query('q')?.trim();
  const limitStr = c.req.query('limit');
  let limit = DEFAULT_LIST_LIMIT;
  if (limitStr !== undefined) {
    const n = Number(limitStr);
    if (!Number.isInteger(n) || n < 1) return c.json({ error: 'invalid_limit' }, 400);
    limit = Math.min(MAX_LIST_LIMIT, n);
  }

  const filters: SQL[] = [];
  if (statusStr !== 'all') filters.push(eq(ideas.status, statusStr));
  if (q) {
    const pattern = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    filters.push(sql`${ideas.text} like ${pattern} escape '\\'`);
  }

  const rows = await db
    .select()
    .from(ideas)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(ideas.createdAt))
    .limit(limit);

  return c.json({ count: rows.length, ideas: rows });
});

ideasRouter.post('/ideas', async (c) => {
  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const body = raw as Record<string, unknown>;

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (text === '' || text.length > MAX_TEXT_LEN) return c.json({ error: 'invalid_text' }, 400);

  const sourceUrl = parseSourceUrl(body.sourceUrl);
  if (sourceUrl === 'invalid') return c.json({ error: 'invalid_source_url' }, 400);

  const tags = parseTags(body.tags);
  if (tags === 'invalid') return c.json({ error: 'invalid_tags' }, 400);

  const [row] = await db.insert(ideas).values({ text, sourceUrl, tags }).returning();
  return c.json(row, 201);
});

ideasRouter.patch('/ideas/:id', async (c) => {
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) return c.json({ error: 'invalid_id' }, 400);

  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const body = raw as Record<string, unknown>;

  const updates: Partial<typeof ideas.$inferInsert> = {};

  if (body.text !== undefined) {
    if (typeof body.text !== 'string') return c.json({ error: 'invalid_text' }, 400);
    const text = body.text.trim();
    if (text === '' || text.length > MAX_TEXT_LEN) return c.json({ error: 'invalid_text' }, 400);
    updates.text = text;
  }

  if (body.sourceUrl !== undefined) {
    const sourceUrl = parseSourceUrl(body.sourceUrl);
    if (sourceUrl === 'invalid') return c.json({ error: 'invalid_source_url' }, 400);
    updates.sourceUrl = sourceUrl;
  }

  if (body.tags !== undefined) {
    const tags = parseTags(body.tags);
    if (tags === 'invalid') return c.json({ error: 'invalid_tags' }, 400);
    updates.tags = tags;
  }

  if (body.status !== undefined) {
    if (!isStatus(body.status)) return c.json({ error: 'invalid_status' }, 400);
    updates.status = body.status;
    if (body.status === 'open') {
      // Re-opening clears provenance — the idea is a fresh seed again.
      updates.consumedByTable = null;
      updates.consumedById = null;
    } else if (body.status === 'consumed') {
      const table = body.consumedByTable;
      const refId = body.consumedById;
      if (table !== undefined || refId !== undefined) {
        if (
          typeof table !== 'string' ||
          !(CONSUMER_TABLES as readonly string[]).includes(table) ||
          typeof refId !== 'string' ||
          refId.trim() === ''
        ) {
          return c.json({ error: 'invalid_consumed_by' }, 400);
        }
        updates.consumedByTable = table;
        updates.consumedById = refId;
      }
    }
  } else if (body.consumedByTable !== undefined || body.consumedById !== undefined) {
    return c.json({ error: 'consumed_by_requires_status_consumed' }, 400);
  }

  if (Object.keys(updates).length === 0) return c.json({ error: 'empty_patch' }, 400);

  updates.updatedAt = new Date();
  const [row] = await db.update(ideas).set(updates).where(eq(ideas.id, id)).returning();
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json(row);
});

ideasRouter.delete('/ideas/:id', async (c) => {
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) return c.json({ error: 'invalid_id' }, 400);

  const result = await db.delete(ideas).where(eq(ideas.id, id)).returning({ id: ideas.id });
  if (result.length === 0) return c.json({ error: 'not_found' }, 404);
  return c.body(null, 204);
});

// ---------------------------------------------------------------- helpers

function isStatus(v: unknown): v is IdeaStatus {
  return typeof v === 'string' && (STATUSES as readonly string[]).includes(v);
}

function parseSourceUrl(value: unknown): string | null | 'invalid' {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return 'invalid';
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.length > MAX_SOURCE_URL_LEN) return 'invalid';
  return trimmed;
}

function parseTags(value: unknown): string[] | null | 'invalid' {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length > MAX_TAGS) return 'invalid';
  const tags: string[] = [];
  for (const t of value) {
    if (typeof t !== 'string') return 'invalid';
    const trimmed = t.trim();
    if (trimmed === '' || trimmed.length > MAX_TAG_LEN) return 'invalid';
    if (!tags.includes(trimmed)) tags.push(trimmed);
  }
  return tags;
}
