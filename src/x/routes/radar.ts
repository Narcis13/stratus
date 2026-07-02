// Radar drafts (CIRCLES-PLAN C0) — server-side persistence for the replies
// POST /x/replies/generate-batch produces. The extension's session ring buffer
// stays the live queue (unchanged UX); these rows are the copy that survives a
// browser restart, fetched by the panel to rehydrate. Mounted under `/x` by
// `mountX` in ../index.ts — always mounted: reads and status flips are $0 and
// don't need the Grok key (only the insert path, in routes/replies.ts, does).
//
// Routes:
//   GET   /radar/drafts   ?status=ready|clicked|expired (default ready)
//   PATCH /radar/drafts   body: { tweetIds: string[], status: 'clicked'|'expired' }
//
// Expiry is a lazy status flip (never a delete), applied on every GET: a radar
// reply to a post that's been dead for 48h is worthless anyway.

import { type SQL, and, desc, eq, inArray, lt, ne } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import type { TweetSignals } from '../../shared/replyBand.ts';
import { radarDrafts } from '../db/schema.ts';
import type { BatchTweet } from '../replies/prompt.ts';

export const RADAR_DRAFT_TTL_MS = 48 * 60 * 60 * 1000;

const STATUSES = ['ready', 'clicked', 'expired'] as const;
type RadarDraftStatus = (typeof STATUSES)[number];

const TWEET_ID_RE = /^\d{1,32}$/;
const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 200;
const MAX_PATCH_IDS = 200;

// Pure — exported for unit tests. A draft is past its useful life 48h after
// drafting; expiry flips status, it never deletes.
export function radarDraftExpired(draftedAt: Date, nowMs: number): boolean {
  return nowMs - draftedAt.getTime() >= RADAR_DRAFT_TTL_MS;
}

// The batch endpoint's tweets, optionally carrying the Radar's capture-time
// verdict (band + classifier inputs). CLI callers may omit them.
export interface RadarBatchTweet extends BatchTweet {
  band?: 'hot' | 'warm';
  signals?: TweetSignals;
}

export interface RadarDraftInsert {
  tweetId: string;
  url: string | null;
  handle: string;
  author: string | null;
  snippet: string;
  band: 'hot' | 'warm' | null;
  signals: TweetSignals | null;
  replyText: string;
  angle: string;
}

// Pure — exported for unit tests. Pair each returned reply with the tweet it
// was drafted for; replies whose id we never asked about are dropped (the
// route already filters those, this is belt-and-suspenders).
export function buildRadarDraftRows(
  tweets: RadarBatchTweet[],
  replies: { tweetId: string; text: string; angle: string }[],
): RadarDraftInsert[] {
  const byId = new Map(tweets.map((t) => [t.tweetId, t]));
  const rows: RadarDraftInsert[] = [];
  for (const r of replies) {
    const t = byId.get(r.tweetId);
    if (!t) continue;
    rows.push({
      tweetId: t.tweetId,
      url: t.url ?? null,
      handle: t.handle,
      author: t.author === t.handle ? null : t.author,
      snippet: t.text,
      band: t.band ?? null,
      signals: t.signals ?? null,
      replyText: r.text,
      angle: r.angle,
    });
  }
  return rows;
}

// Called by /replies/generate-batch after a successful Grok call. A failed
// insert must never fail the response — the Grok money is already spent and
// the session buffer still gets the replies; we just lose the restart copy.
export async function persistRadarDrafts(
  tweets: RadarBatchTweet[],
  replies: { tweetId: string; text: string; angle: string }[],
): Promise<void> {
  const rows = buildRadarDraftRows(tweets, replies);
  if (rows.length === 0) return;
  try {
    await db.insert(radarDrafts).values(rows);
  } catch (err) {
    console.error(
      'radar_drafts insert failed (replies still returned):',
      err instanceof Error ? err.message : err,
    );
  }
}

export const radar = new Hono();

radar.get('/radar/drafts', async (c) => {
  const statusStr = c.req.query('status') ?? 'ready';
  if (!isStatus(statusStr)) return c.json({ error: 'invalid_status' }, 400);

  const limitStr = c.req.query('limit');
  let limit = DEFAULT_LIST_LIMIT;
  if (limitStr !== undefined) {
    const n = Number(limitStr);
    if (!Number.isInteger(n) || n < 1) return c.json({ error: 'invalid_limit' }, 400);
    limit = Math.min(MAX_LIST_LIMIT, n);
  }

  // Lazy expiry: flip stale ready rows before serving any view of them.
  await db
    .update(radarDrafts)
    .set({ status: 'expired' })
    .where(
      and(
        eq(radarDrafts.status, 'ready'),
        lt(radarDrafts.draftedAt, new Date(Date.now() - RADAR_DRAFT_TTL_MS)),
      ),
    );

  const rows = await db
    .select()
    .from(radarDrafts)
    .where(eq(radarDrafts.status, statusStr))
    .orderBy(desc(radarDrafts.draftedAt))
    .limit(limit);

  return c.json({ count: rows.length, drafts: rows });
});

radar.patch('/radar/drafts', async (c) => {
  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const body = raw as Record<string, unknown>;

  const status = body.status;
  if (status !== 'clicked' && status !== 'expired') {
    return c.json({ error: 'invalid_status' }, 400);
  }

  if (!Array.isArray(body.tweetIds) || body.tweetIds.length === 0) {
    return c.json({ error: 'invalid_tweet_ids' }, 400);
  }
  if (body.tweetIds.length > MAX_PATCH_IDS) return c.json({ error: 'too_many_tweet_ids' }, 400);
  const tweetIds: string[] = [];
  for (const id of body.tweetIds) {
    if (typeof id !== 'string' || !TWEET_ID_RE.test(id)) {
      return c.json({ error: 'invalid_tweet_ids' }, 400);
    }
    tweetIds.push(id);
  }

  // 'clicked' only advances ready rows; 'expired' (dismiss) also closes
  // clicked ones. Nothing ever moves backwards.
  const from: SQL =
    status === 'clicked' ? eq(radarDrafts.status, 'ready') : ne(radarDrafts.status, 'expired');

  const updated = await db
    .update(radarDrafts)
    .set({ status })
    .where(and(inArray(radarDrafts.tweetId, tweetIds), from))
    .returning({ id: radarDrafts.id });

  return c.json({ updated: updated.length });
});

function isStatus(v: unknown): v is RadarDraftStatus {
  return typeof v === 'string' && (STATUSES as readonly string[]).includes(v);
}
