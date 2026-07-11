// CRUD over `scheduled_posts`. Mounted under `/x` by `mountX` in ../index.ts.
//
// Status lifecycle:
//   draft       no scheduled_for; not eligible for the publisher worker
//   pending     scheduled_for set; publisher will pick it up at that minute
//   segment     thread tail row (§8.2, thread_position ≥ 2) — never claimed
//               directly; the publisher drives it after the thread head posts.
//               Text is editable until then; schedule/status ride with the head.
//   publishing  claimed by the publisher, X call in flight (or outcome unknown
//               after a 5xx/network error) — locked here; resolve manually via
//               SQL or wait for reconcile if it's stuck
//   posted      publisher succeeded — locked from edits/deletes here
//   failed      publisher hit X — keep the row so user can edit & retry
//   cancelled   user explicitly soft-cancelled (PATCH); hard DELETE removes the row entirely
//
// `posted` rows are write-locked: the API has no business unpublishing tweets.
// `publishing` rows are locked too: editing a row whose X outcome is unresolved
// risks a double post.
//
// URL guard: a `pending` row whose text matches the URL regex would be billed
// at $0.20 instead of $0.015 — createPost refuses it, so the row would just die
// at its scheduled minute (a silently lost posting slot). Reject at schedule
// time instead. Drafts may hold URLs; promoting one to pending re-checks.
// Thread tail segments are the deliberate exception: a link in a self-reply is
// the documented cheap pattern (link-in-first-reply, $0.015 vs $0.20 — §8.2).

import { randomUUID } from 'node:crypto';
import { type SQL, and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { ideas, scheduledPosts } from '../db/schema.ts';
import { containsUrl } from '../endpoints.ts';
import { parsePillar } from '../posts/pillars.ts';
import { getActivePillars } from './pillars.ts';

const STATUSES = [
  'draft',
  'pending',
  'segment',
  'publishing',
  'posted',
  'failed',
  'cancelled',
] as const;
type Status = (typeof STATUSES)[number];
// States a client may write. `publishing`/`posted` are worker-owned;
// `segment` rows are created only by POST /posts/threads.
const WRITABLE_STATUSES = ['draft', 'pending', 'failed', 'cancelled'] as const;

const MAX_THREAD_SEGMENTS = 25;

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
  if (status === 'pending' && containsUrl(text)) {
    return c.json(
      {
        error: 'url_in_text',
        hint: 'A URL in the post text is billed at $0.20 (13x). Move the link to a reply, or save as a draft.',
      },
      400,
    );
  }

  // Optional content pillar — validated against the live active slugs (same
  // check as the drafter). Only touches the DB when a pillar is actually given.
  let pillar: string | null = null;
  if (body.pillar !== undefined && body.pillar !== null && body.pillar !== '') {
    const slugs = (await getActivePillars()).map((p) => p.slug);
    const resolved = parsePillar(body.pillar, slugs);
    if (resolved === 'invalid') return c.json({ error: 'invalid_pillar' }, 400);
    pillar = resolved ?? null;
  }

  const [row] = await db
    .insert(scheduledPosts)
    .values({
      text,
      scheduledFor: scheduledFor ?? null,
      mediaIds: mediaIds ?? null,
      status,
      pillar,
    })
    .returning();

  return c.json(row, 201);
});

// Threads (§8.2): one schedulable unit, N rows. The head (position 1) is a
// normal draft/pending row carrying scheduled_for; tails are status='segment'
// and the publisher chains them as self-replies after the head posts. The URL
// guard applies to the head only — a link in a tail segment is the documented
// link-in-first-reply pattern ($0.015, not $0.20).
calendar.post('/posts/threads', async (c) => {
  const body = await readJson(c.req.raw);
  if (!body) return c.json({ error: 'invalid_body' }, 400);

  if (!Array.isArray(body.segments)) return c.json({ error: 'segments_required' }, 400);
  const segments: string[] = [];
  for (const s of body.segments) {
    const text = typeof s === 'string' ? s.trim() : '';
    if (!text) return c.json({ error: 'invalid_segment_text' }, 400);
    segments.push(text);
  }
  if (segments.length < 2) return c.json({ error: 'thread_needs_two_segments' }, 400);
  if (segments.length > MAX_THREAD_SEGMENTS) {
    return c.json({ error: 'too_many_segments', max: MAX_THREAD_SEGMENTS }, 400);
  }

  const scheduledFor = parseDate(body.scheduledFor);
  if (scheduledFor === 'invalid') return c.json({ error: 'invalid_scheduled_for' }, 400);

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
  if (status === 'pending' && containsUrl(segments[0])) {
    return c.json(
      {
        error: 'url_in_text',
        hint: 'A URL in tweet 1 is billed at $0.20 (13x). Move the link to a later segment — the first reply is the documented spot.',
      },
      400,
    );
  }

  const pillar = typeof body.pillar === 'string' && body.pillar.trim() ? body.pillar.trim() : null;

  const threadId = randomUUID();
  const rows = await db
    .insert(scheduledPosts)
    .values(
      segments.map((text, i) => ({
        text,
        threadId,
        threadPosition: i + 1,
        pillar,
        scheduledFor: i === 0 ? (scheduledFor ?? null) : null,
        status: i === 0 ? status : 'segment',
      })),
    )
    .returning();

  return c.json({ threadId, segments: rows }, 201);
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

// Single-row fetch (§9.5) — the Composer edits one row; list+find was the
// workaround. A thread member also carries its siblings so the editor can
// render the whole chain in one call.
calendar.get('/posts/scheduled/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);

  const [row] = await db.select().from(scheduledPosts).where(eq(scheduledPosts.id, id));
  if (!row) return c.json({ error: 'not_found' }, 404);

  // C6 provenance: the Idea Inbox idea whose consume backlinks this row —
  // "seeded by" in the detail view, content archaeology for free.
  const [seed] = await db
    .select({ id: ideas.id, text: ideas.text, status: ideas.status })
    .from(ideas)
    .where(and(eq(ideas.consumedByTable, 'scheduled_posts'), eq(ideas.consumedById, id)));
  const seededBy = seed ?? null;

  if (!row.threadId) return c.json({ ...row, seededBy });

  const thread = await db
    .select()
    .from(scheduledPosts)
    .where(eq(scheduledPosts.threadId, row.threadId))
    .orderBy(asc(scheduledPosts.threadPosition));
  return c.json({ ...row, thread, seededBy });
});

calendar.patch('/posts/scheduled/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid_id' }, 400);

  const body = await readJson(c.req.raw);
  if (!body) return c.json({ error: 'invalid_body' }, 400);

  const [existing] = await db.select().from(scheduledPosts).where(eq(scheduledPosts.id, id));
  if (!existing) return c.json({ error: 'not_found' }, 404);
  if (existing.status === 'posted') return c.json({ error: 'cannot_edit_posted' }, 409);
  if (existing.status === 'publishing') return c.json({ error: 'cannot_edit_publishing' }, 409);

  // Thread tails: text stays editable until the head posts; schedule and
  // status ride with the head (PATCH the position-1 row for those).
  if (existing.status === 'segment') {
    if (body.scheduledFor !== undefined || body.status !== undefined) {
      return c.json({ error: 'segment_schedule_rides_with_head' }, 409);
    }
  }

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
    if (!(WRITABLE_STATUSES as readonly string[]).includes(body.status)) {
      return c.json({ error: 'status_not_settable_via_patch' }, 400);
    }
    updates.status = body.status;
  }

  const finalStatus = updates.status ?? existing.status;
  const finalScheduledFor =
    updates.scheduledFor !== undefined ? updates.scheduledFor : existing.scheduledFor;
  if (finalStatus === 'pending' && !finalScheduledFor) {
    return c.json({ error: 'scheduled_for_required_when_pending' }, 400);
  }
  const finalText = updates.text ?? existing.text;
  if (finalStatus === 'pending' && containsUrl(finalText)) {
    return c.json(
      {
        error: 'url_in_text',
        hint: 'A URL in the post text is billed at $0.20 (13x). Move the link to a reply, or save as a draft.',
      },
      400,
    );
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
  if (existing.status === 'publishing') return c.json({ error: 'cannot_delete_publishing' }, 409);

  // Threads delete as a unit via the head — removing a middle segment would
  // silently break the chain the publisher walks by position.
  if (existing.threadId) {
    if (existing.threadPosition !== 1) {
      return c.json({ error: 'delete_thread_via_head' }, 409);
    }
    const siblings = await db
      .select({ id: scheduledPosts.id, status: scheduledPosts.status })
      .from(scheduledPosts)
      .where(eq(scheduledPosts.threadId, existing.threadId));
    const locked = siblings.filter((s) => s.status === 'posted' || s.status === 'publishing');
    if (locked.length > 0) {
      return c.json({ error: 'thread_has_locked_segments', locked: locked.length }, 409);
    }
    await db.delete(scheduledPosts).where(
      inArray(
        scheduledPosts.id,
        siblings.map((s) => s.id),
      ),
    );
    return c.body(null, 204);
  }

  await db.delete(scheduledPosts).where(eq(scheduledPosts.id, id));
  return c.body(null, 204);
});

interface Body {
  text?: unknown;
  scheduledFor?: unknown;
  mediaIds?: unknown;
  status?: unknown;
  segments?: unknown;
  pillar?: unknown;
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
