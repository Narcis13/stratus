// Mention inbox routes (§7.5). Mounted under `/x` by `mountX` in ../index.ts.
//
// Routes:
//   GET   /mentions          ?status=&limit=   inbox list, newest first, my
//                            parent post joined for thread context
//   PATCH /mentions/:tweetId body: { status?, draftId? }
//
// $0 — every route here is SQL over the local `mentions` table. There is no
// longer any way to FILL that table: `POST /mentions/refresh` and the daily
// pull were deleted 2026-08-12 when the service dropped every billed X read
// (CLAUDE.md invariant #8). The rows that exist are historical; new inbound
// mentions arrive through the extension's $0 DOM surfaces or not at all.
//
// POSTING STAYS MANUAL PASTE. The Feb 2026 programmatic-reply policy has
// exactly one carve-out — replying to a tweet that @-mentions you — which
// would allow API-posting these specific replies. That is deliberately NOT
// wired: MENTION_API_REPLIES in .env.example documents the verify-then-enable
// plan (a live test on one mention must confirm self-serve eligibility first),
// and even then every send stays behind a human click. No auto-replies, ever.

import { type SQL, and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { mentions, postsPublished, replyDrafts } from '../db/schema.ts';

const TWEET_ID_RE = /^\d{1,32}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUSES = ['unanswered', 'answered', 'dismissed'] as const;
type MentionStatus = (typeof STATUSES)[number];

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

export function createMentionsRouter(): Hono {
  const r = new Hono();

  r.get('/mentions', async (c) => {
    const statusStr = c.req.query('status');
    const limitStr = c.req.query('limit');

    const filters: SQL[] = [];
    if (statusStr !== undefined) {
      if (!isStatus(statusStr)) return c.json({ error: 'invalid_status' }, 400);
      filters.push(eq(mentions.status, statusStr));
    }

    let limit = DEFAULT_LIST_LIMIT;
    if (limitStr !== undefined) {
      const n = Number(limitStr);
      if (!Number.isInteger(n) || n < 1) return c.json({ error: 'invalid_limit' }, 400);
      limit = Math.min(MAX_LIST_LIMIT, n);
    }

    // parentText = my published post the mention replies to (when it's one of
    // mine) — the thread context the Grok draft gets for free.
    const rows = await db
      .select({
        tweetId: mentions.tweetId,
        authorId: mentions.authorId,
        authorUsername: mentions.authorUsername,
        authorName: mentions.authorName,
        text: mentions.text,
        postedAt: mentions.postedAt,
        conversationId: mentions.conversationId,
        inReplyToTweetId: mentions.inReplyToTweetId,
        status: mentions.status,
        answeredDraftId: mentions.answeredDraftId,
        answeredAt: mentions.answeredAt,
        fetchedAt: mentions.fetchedAt,
        parentText: postsPublished.text,
      })
      .from(mentions)
      .leftJoin(postsPublished, eq(mentions.inReplyToTweetId, postsPublished.tweetId))
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(mentions.postedAt))
      .limit(limit);

    const unanswered = await db.$count(mentions, eq(mentions.status, 'unanswered'));

    return c.json({ counts: { unanswered }, mentions: rows });
  });

  r.patch('/mentions/:tweetId', async (c) => {
    const tweetId = c.req.param('tweetId');
    if (!TWEET_ID_RE.test(tweetId)) return c.json({ error: 'invalid_id' }, 400);

    const raw = await c.req.json().catch(() => null);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return c.json({ error: 'invalid_body' }, 400);
    }
    const body = raw as Record<string, unknown>;

    const [existing] = await db.select().from(mentions).where(eq(mentions.tweetId, tweetId));
    if (!existing) return c.json({ error: 'not_found' }, 404);

    const updates: Partial<typeof mentions.$inferInsert> = {};

    if (body.status !== undefined) {
      if (!isStatus(body.status)) return c.json({ error: 'invalid_status' }, 400);
      if (body.status !== existing.status) {
        updates.status = body.status;
        updates.answeredAt = body.status === 'answered' ? new Date() : null;
      }
    }

    if (body.draftId !== undefined) {
      if (body.draftId === null) {
        updates.answeredDraftId = null;
      } else if (typeof body.draftId !== 'string' || !UUID_RE.test(body.draftId)) {
        return c.json({ error: 'invalid_draft_id' }, 400);
      } else {
        const [draft] = await db
          .select({ id: replyDrafts.id })
          .from(replyDrafts)
          .where(eq(replyDrafts.id, body.draftId));
        if (!draft) return c.json({ error: 'draft_not_found' }, 404);
        updates.answeredDraftId = body.draftId;
      }
    }

    if (Object.keys(updates).length === 0) return c.json(existing);

    const [row] = await db
      .update(mentions)
      .set(updates)
      .where(eq(mentions.tweetId, tweetId))
      .returning();
    return c.json(row);
  });

  return r;
}

function isStatus(v: unknown): v is MentionStatus {
  return typeof v === 'string' && (STATUSES as readonly string[]).includes(v);
}
