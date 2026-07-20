// Radar drafts (CIRCLES-PLAN C0) — server-side persistence for the replies
// POST /x/replies/generate-batch produces. The extension's session ring buffer
// stays the live queue (unchanged UX); these rows are the copy that survives a
// browser restart, fetched by the panel to rehydrate. Mounted under `/x` by
// `mountX` in ../index.ts — always mounted: reads and status flips are $0 and
// don't need the Grok key (only the insert path, in routes/replies.ts, does).
//
// Routes:
//   GET   /radar/drafts                 ?status=ready|clicked|expired (default ready)
//   PATCH /radar/drafts                 body: { tweetIds: string[], status: 'clicked'|'expired' }
//   PATCH /radar/drafts/:tweetId/tags   body: { tags: string[] | null } — channel tags (C8),
//                                       applied to every draft row of that tweet
//
// Expiry is a lazy status flip (never a delete), applied on every GET: a radar
// reply to a post that's been dead for 48h is worthless anyway.

import { type SQL, and, desc, eq, inArray, lt, ne } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import type { TweetSignals } from '../../shared/replyBand.ts';
import { radarDrafts, replyDrafts } from '../db/schema.ts';
import type { BatchTweet, PostContext, PostSignals } from '../replies/prompt.ts';
import { parseChannelTags } from './channels.ts';

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
  // All 3 angle variants (RU.2); null until Task 3 supplies them in the batch
  // response. replyText/angle stay the primary (variants[0]).
  variants: { text: string; angle: string }[] | null;
  // The Grok model that drafted these; copied onto the confirmed reply_drafts
  // row later. Null when the batch didn't report one.
  model: string | null;
}

// The batch reply shape persistRadarDrafts/buildRadarDraftRows consume: the
// primary text/angle (variants[0]) plus the full angle set. `variants` is
// optional — the batch route always supplies all 3, but a CLI/smoke caller may
// pass only the primary, in which case the column stays null (RU.2 "unknown"
// semantics; the confirm endpoint reconstructs `[{text: replyText, angle}]`).
interface BatchReplyRow {
  tweetId: string;
  text: string;
  angle: string;
  variants?: { text: string; angle: string }[];
}

// Pure — exported for unit tests. Pair each returned reply with the tweet it
// was drafted for; replies whose id we never asked about are dropped (the
// route already filters those, this is belt-and-suspenders).
export function buildRadarDraftRows(
  tweets: RadarBatchTweet[],
  replies: BatchReplyRow[],
  model: string | null,
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
      // Full 3-variant set from the batch (RU.3); replyText/angle stay the
      // primary. Null when the caller supplied only the primary.
      variants: r.variants && r.variants.length > 0 ? r.variants : null,
      model,
    });
  }
  return rows;
}

// Called by /replies/generate-batch after a successful Grok call. A failed
// insert must never fail the response — the Grok money is already spent and
// the session buffer still gets the replies; we just lose the restart copy.
export async function persistRadarDrafts(
  tweets: RadarBatchTweet[],
  replies: BatchReplyRow[],
  model: string | null,
): Promise<void> {
  const rows = buildRadarDraftRows(tweets, replies, model);
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
  const tweetId = c.req.query('tweetId');
  if (tweetId !== undefined && !TWEET_ID_RE.test(tweetId)) {
    return c.json({ error: 'invalid_tweet_id' }, 400);
  }

  const statusStr = c.req.query('status');
  if (statusStr !== undefined && !isStatus(statusStr)) {
    return c.json({ error: 'invalid_status' }, 400);
  }

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

  // An explicit status wins. Otherwise a tweetId query (the on-page chip
  // fallback / variants-get) wants that tweet's whole non-expired history —
  // a row confirmed to `clicked` still carries its variants; the bare list
  // keeps its ready-queue default.
  const statusCond: SQL = statusStr
    ? eq(radarDrafts.status, statusStr)
    : tweetId
      ? ne(radarDrafts.status, 'expired')
      : eq(radarDrafts.status, 'ready');
  const where = tweetId ? and(statusCond, eq(radarDrafts.tweetId, tweetId)) : statusCond;

  const rows = await db
    .select()
    .from(radarDrafts)
    .where(where)
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

// Channel tags (C8). Keyed by tweetId — the panel's queue and the session ring
// buffer identify a sighting by tweet, not by draft row; repeated drafts of the
// same tweet all get the tags so any of them rehydrates correctly.
radar.patch('/radar/drafts/:tweetId/tags', async (c) => {
  const tweetId = c.req.param('tweetId');
  if (!TWEET_ID_RE.test(tweetId)) return c.json({ error: 'invalid_tweet_id' }, 400);

  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const body = raw as Record<string, unknown>;
  if (body.tags === undefined) return c.json({ error: 'invalid_tags' }, 400);
  const tags = parseChannelTags(body.tags);
  if (tags === 'invalid') return c.json({ error: 'invalid_tags' }, 400);

  const updated = await db
    .update(radarDrafts)
    .set({ tags })
    .where(eq(radarDrafts.tweetId, tweetId))
    .returning({ id: radarDrafts.id });

  if (updated.length === 0) return c.json({ error: 'not_found' }, 404);
  return c.json({ updated: updated.length, tags });
});

// Confirm (RU.5): promote the newest live radar draft for a tweet into a real,
// measured `reply_drafts` row. Called when the user clicks a Radar row (the
// "confirmed" moment) — status `copied`; the posted flip + `my_reply` event
// stay on PATCH /x/replies/:id (never duplicated here). $0: pure DB. Idempotent
// via the soft `reply_draft_id` link. The confirmed row carries the full
// context so it flows into outcomes/angle/latency/quota like any Reply Master
// draft — the exact (no-longer-text-matched) batch-vs-single Playbook split.
radar.post('/radar/drafts/:tweetId/confirm', async (c) => {
  const tweetId = c.req.param('tweetId');
  if (!TWEET_ID_RE.test(tweetId)) return c.json({ error: 'invalid_tweet_id' }, 400);

  // Newest still-live row for this tweet. A `clicked` row counts (it's the
  // idempotent hit); only `expired` is out of scope.
  const [row] = await db
    .select()
    .from(radarDrafts)
    .where(and(eq(radarDrafts.tweetId, tweetId), ne(radarDrafts.status, 'expired')))
    .orderBy(desc(radarDrafts.draftedAt))
    .limit(1);
  if (!row) return c.json({ error: 'not_found' }, 404);

  // Idempotent: already confirmed → return the linked reply_drafts row. A
  // dangling link (the reply_drafts row was deleted) falls through to rebuild.
  if (row.replyDraftId) {
    const [existing] = await db
      .select()
      .from(replyDrafts)
      .where(eq(replyDrafts.id, row.replyDraftId));
    if (existing) return c.json(existing, 200);
  }

  // Rebuild a PostContext from what the Radar captured so buildReplyOutcomes
  // (ctx.signals / ctx.metrics) and the Playbook latency/band readers
  // (signals.ageMin) see the same shape a live Reply Master draft has. The
  // band lives in its own column; the signals JSON never carried it.
  const sig = row.signals as TweetSignals | null;
  const signals: PostSignals | undefined = sig
    ? {
        band: row.band as PostSignals['band'],
        views: sig.views,
        replies: sig.replies,
        ageMin: sig.ageMin,
        vpm: sig.vpm,
        bait: sig.bait,
      }
    : undefined;
  // postedAt derived back from draft time − age. Null-signals (CLI) rows have
  // no age → sourcePostedAt stays null and the snapshot falls back to the draft
  // time (only ever read as a last-resort age fallback).
  const sourcePostedAt = sig ? new Date(row.draftedAt.getTime() - sig.ageMin * 60000) : null;
  const url = row.url ?? `https://x.com/${row.handle}/status/${row.tweetId}`;
  const ctx: PostContext = {
    url,
    tweetId: row.tweetId,
    author: row.author ?? row.handle,
    handle: row.handle,
    text: row.snippet,
    postedAt: (sourcePostedAt ?? row.draftedAt).toISOString(),
    metrics: { views: sig?.views ?? 0, replies: sig?.replies ?? 0, reposts: 0, likes: 0 },
    topComments: [],
    ...(signals ? { signals } : {}),
  };

  // Pre-variant / CLI rows kept only the primary — reconstruct the single-entry
  // variants set so the confirmed row is well-formed.
  const variants =
    row.variants && row.variants.length > 0
      ? row.variants
      : [{ text: row.replyText, angle: row.angle }];

  // One sync txn (§7.13 — no await inside, .all()/.run() terminals): create the
  // reply_drafts row, then soft-link + ratchet the radar draft to `clicked`.
  const created = db.transaction((tx) => {
    const [draft] = tx
      .insert(replyDrafts)
      .values({
        sourceTweetId: row.tweetId,
        sourceAuthorUsername: row.handle,
        sourceAuthorDisplayName: row.author ?? null,
        sourceText: row.snippet,
        sourceUrl: url,
        sourcePostedAt,
        contextSnapshot: ctx,
        replyText: row.replyText,
        variants,
        model: row.model ?? 'radar-batch',
        costUsd: null,
        source: 'radar',
        status: 'copied',
      })
      .returning()
      .all();
    if (!draft) throw new Error('reply_drafts insert returned no row');
    tx.update(radarDrafts)
      .set({ replyDraftId: draft.id, status: 'clicked' })
      .where(eq(radarDrafts.id, row.id))
      .run();
    return draft;
  });

  return c.json(created, 201);
});

function isStatus(v: unknown): v is RadarDraftStatus {
  return typeof v === 'string' && (STATUSES as readonly string[]).includes(v);
}
