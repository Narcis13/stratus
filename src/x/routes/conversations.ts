// Conversations & open loops (CIRCLES-PLAN C2) — the mention inbox rendered as
// Slack-style threads. No conversation table: GET groups posts_published +
// mentions by conversation_id on every read (pure logic in ../conversations.ts);
// conversation_meta only persists read state. Mounted under `/x` by `mountX`
// in ../index.ts — always mounted, $0: reads tables the daily pass already fills.
//
// Routes:
//   GET   /conversations                    ?limit=   ranked threads + counts
//   PATCH /conversations/:conversationId    body: { read?, snoozedUntil?, muted? }

import { desc, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { buildThreads, isActionable, threadKeyFor } from '../conversations.ts';
import { conversationMeta, mentions, people, postsPublished } from '../db/schema.ts';
import { myReplyTweetIds } from '../people/store.ts';

const CONVO_ID_RE = /^\d{1,32}$/;
// Threads are recomputed per read — bound the mention scan so the query stays
// O(recent inbox), not O(entire history). 500 mentions is months of runway.
const MENTIONS_SCAN_LIMIT = 500;
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

export const conversations = new Hono();

conversations.get('/conversations', async (c) => {
  const limitStr = c.req.query('limit');
  let limit = DEFAULT_LIST_LIMIT;
  if (limitStr !== undefined) {
    const n = Number(limitStr);
    if (!Number.isInteger(n) || n < 1) return c.json({ error: 'invalid_limit' }, 400);
    limit = Math.min(MAX_LIST_LIMIT, n);
  }

  const inbound = await db
    .select()
    .from(mentions)
    .orderBy(desc(mentions.postedAt))
    .limit(MENTIONS_SCAN_LIMIT);

  const keys = [...new Set(inbound.map(threadKeyFor))];
  const [outbound, metas, myReplyIds] = await Promise.all([
    keys.length
      ? db.select().from(postsPublished).where(inArray(postsPublished.conversationId, keys))
      : Promise.resolve([]),
    keys.length
      ? db.select().from(conversationMeta).where(inArray(conversationMeta.conversationId, keys))
      : Promise.resolve([]),
    myReplyTweetIds(inbound.flatMap((m) => (m.inReplyToTweetId ? [m.inReplyToTweetId] : []))),
  ]);

  const threads = buildThreads(inbound, outbound, metas, { now: new Date(), myReplyIds });

  // C1 person link: the counterpart's stage chip on every thread header.
  const handles = [
    ...new Set(
      threads.flatMap((t) => (t.counterpartHandle ? [t.counterpartHandle.toLowerCase()] : [])),
    ),
  ];
  const persons = handles.length
    ? await db
        .select({ handle: people.handle, stage: people.stage, displayName: people.displayName })
        .from(people)
        .where(inArray(people.handle, handles))
    : [];
  const personByHandle = new Map(persons.map((p) => [p.handle, p]));

  const actionable = threads.filter(isActionable);
  return c.json({
    counts: {
      threads: threads.length,
      openLoops: actionable.length,
      chains: actionable.filter((t) => t.chain).length,
      unread: threads.filter((t) => t.unread && !t.muted).length,
    },
    threads: threads.slice(0, limit).map((t) => ({
      ...t,
      person: t.counterpartHandle
        ? (personByHandle.get(t.counterpartHandle.toLowerCase()) ?? null)
        : null,
    })),
  });
});

conversations.patch('/conversations/:conversationId', async (c) => {
  const conversationId = c.req.param('conversationId');
  if (!CONVO_ID_RE.test(conversationId)) return c.json({ error: 'invalid_id' }, 400);

  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const body = raw as Record<string, unknown>;

  const now = new Date();
  const updates: Partial<typeof conversationMeta.$inferInsert> = {};

  if (body.read !== undefined) {
    if (body.read !== true) return c.json({ error: 'invalid_read' }, 400);
    updates.lastReadAt = now;
  }

  if (body.snoozedUntil !== undefined) {
    if (body.snoozedUntil === null) {
      updates.snoozedUntil = null;
    } else {
      if (typeof body.snoozedUntil !== 'string')
        return c.json({ error: 'invalid_snoozed_until' }, 400);
      const ts = Date.parse(body.snoozedUntil);
      if (Number.isNaN(ts)) return c.json({ error: 'invalid_snoozed_until' }, 400);
      updates.snoozedUntil = new Date(ts);
    }
  }

  if (body.muted !== undefined) {
    if (typeof body.muted !== 'boolean') return c.json({ error: 'invalid_muted' }, 400);
    updates.muted = body.muted;
  }

  if (Object.keys(updates).length === 0) return c.json({ error: 'empty_body' }, 400);

  const [row] = await db
    .insert(conversationMeta)
    .values({ conversationId, ...updates, updatedAt: now })
    .onConflictDoUpdate({
      target: conversationMeta.conversationId,
      set: { ...updates, updatedAt: now },
    })
    .returning();
  return c.json(row);
});
