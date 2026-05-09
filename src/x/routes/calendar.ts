// CRUD over `scheduled_posts`. Mounted under `/x` by `mountX` in ../index.ts.
//
// Status lifecycle:
//   draft       no scheduled_for; not eligible for the publisher worker
//   pending     scheduled_for set; publisher will pick it up at that minute
//   posted      publisher succeeded — locked from edits/deletes here
//   failed      publisher hit X — keep the row so user can edit & retry
//   cancelled   user explicitly soft-cancelled (PATCH); hard DELETE removes the row entirely
//
// `posted` rows are write-locked: the API has no business unpublishing tweets.

import { type SQL, and, eq, gte, lt, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { scheduledPosts } from '../db/schema.ts';

const STATUSES = ['draft', 'pending', 'posted', 'failed', 'cancelled'] as const;
type Status = (typeof STATUSES)[number];

export const calendar = new Hono();

calendar.post('/posts/scheduled', async (c) => {
  const body = await readJson(c.req.raw);
  if (!body) return c.json({ error: 'invalid_body' }, 400);

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return c.json({ error: 'text_required' }, 400);

  const scheduledFor = parseDate(body.scheduledFor);
  if (scheduledFor === 'invalid') return c.json({ error: 'invalid_scheduled_for' }, 400);

  const mediaIds = parseMediaIds(body.mediaIds);
  if (mediaIds === 'invalid') return c.json({ error: 'invalid_media_ids' }, 400);

  let status: Status;
  if (body.status === undefined || body.status === null) {
    status = scheduledFor ? 'pending' : 'draft';
  } else if (body.status === 'draft' || body.status === 'pending') {
    status = body.status;
  } else {
    return c.json({ error: 'create_status_must_be_draft_or_pending' }, 400);
  }

  if (status === 'pending' && !scheduledFor) {
    return c.json({ error: 'scheduled_for_required_when_pending' }, 400);
  }

  const [row] = await db
    .insert(scheduledPosts)
    .values({
      text,
      scheduledFor: scheduledFor ?? null,
      mediaIds: mediaIds ?? null,
      status,
    })
    .returning();

  return c.json(row, 201);
});

calendar.get('/posts/scheduled', async (c) => {
  const fromStr = c.req.query('from');
  const toStr = c.req.query('to');
  const statusStr = c.req.query('status');

  const filters: SQL[] = [];

  if (fromStr) {
    const from = new Date(fromStr);
    if (Number.isNaN(from.getTime())) return c.json({ error: 'invalid_from' }, 400);
    filters.push(gte(scheduledPosts.scheduledFor, from));
  }
  if (toStr) {
    const to = new Date(toStr);
    if (Number.isNaN(to.getTime())) return c.json({ error: 'invalid_to' }, 400);
    filters.push(lt(scheduledPosts.scheduledFor, to));
  }
  if (statusStr) {
    if (!isStatus(statusStr)) return c.json({ error: 'invalid_status' }, 400);
    filters.push(eq(scheduledPosts.status, statusStr));
  }

  const rows = await db
    .select()
    .from(scheduledPosts)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(
      sql`${scheduledPosts.scheduledFor} asc nulls last`,
      sql`${scheduledPosts.createdAt} desc`,
    );

  return c.json(rows);
});

calendar.patch('/posts/scheduled/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);

  const body = await readJson(c.req.raw);
  if (!body) return c.json({ error: 'invalid_body' }, 400);

  const [existing] = await db.select().from(scheduledPosts).where(eq(scheduledPosts.id, id));
  if (!existing) return c.json({ error: 'not_found' }, 404);
  if (existing.status === 'posted') return c.json({ error: 'cannot_edit_posted' }, 409);

  const updates: Partial<typeof scheduledPosts.$inferInsert> = {};

  if (body.text !== undefined) {
    if (typeof body.text !== 'string') return c.json({ error: 'invalid_text' }, 400);
    const text = body.text.trim();
    if (!text) return c.json({ error: 'text_required' }, 400);
    updates.text = text;
  }
  if (body.scheduledFor !== undefined) {
    const sf = parseDate(body.scheduledFor);
    if (sf === 'invalid') return c.json({ error: 'invalid_scheduled_for' }, 400);
    updates.scheduledFor = sf;
  }
  if (body.mediaIds !== undefined) {
    const m = parseMediaIds(body.mediaIds);
    if (m === 'invalid') return c.json({ error: 'invalid_media_ids' }, 400);
    updates.mediaIds = m;
  }
  if (body.status !== undefined) {
    if (!isStatus(body.status)) return c.json({ error: 'invalid_status' }, 400);
    if (body.status === 'posted') return c.json({ error: 'cannot_set_posted_via_patch' }, 400);
    updates.status = body.status;
  }

  const finalStatus = updates.status ?? existing.status;
  const finalScheduledFor =
    updates.scheduledFor !== undefined ? updates.scheduledFor : existing.scheduledFor;
  if (finalStatus === 'pending' && !finalScheduledFor) {
    return c.json({ error: 'scheduled_for_required_when_pending' }, 400);
  }

  if (Object.keys(updates).length === 0) return c.json(existing);

  updates.updatedAt = new Date();
  const [row] = await db
    .update(scheduledPosts)
    .set(updates)
    .where(eq(scheduledPosts.id, id))
    .returning();

  return c.json(row);
});

calendar.delete('/posts/scheduled/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);

  const [existing] = await db.select().from(scheduledPosts).where(eq(scheduledPosts.id, id));
  if (!existing) return c.json({ error: 'not_found' }, 404);
  if (existing.status === 'posted') return c.json({ error: 'cannot_delete_posted' }, 409);

  await db.delete(scheduledPosts).where(eq(scheduledPosts.id, id));
  return c.body(null, 204);
});

interface Body {
  text?: unknown;
  scheduledFor?: unknown;
  mediaIds?: unknown;
  status?: unknown;
}

async function readJson(req: Request): Promise<Body | null> {
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Body;
  } catch {
    return null;
  }
}

function parseDate(value: unknown): Date | null | 'invalid' {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return 'invalid';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'invalid';
  return d;
}

function parseMediaIds(value: unknown): string[] | null | 'invalid' {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) return 'invalid';
  if (!value.every((v) => typeof v === 'string' && v.length > 0)) return 'invalid';
  return value as string[];
}

function isStatus(v: unknown): v is Status {
  return typeof v === 'string' && (STATUSES as readonly string[]).includes(v);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v: string): boolean {
  return UUID_RE.test(v);
}
