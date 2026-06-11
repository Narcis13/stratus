// $0 ingestion for the extension's DOM harvester (OVERHAUL-PLAN §6.3).
// Mounted under `/x` by `mountX` in ../index.ts. No X API is touched anywhere
// in this file — rows arrive pre-scraped from the content script.
//
// Routes:
//   POST /harvest/runs   { handle, mode, scope }      create a run, returns the row
//   POST /harvest/rows   { runId, rows: [...] }       batched insert (≤500/call)
//   GET  /harvest/runs   ?limit=                      recent runs, newest first
//
// Repeated harvests of the same tweet create new rows on purpose — that is the
// longitudinal curve. Replies-mode batches also reconcile against reply_drafts:
// a row whose tweetId equals a draft's postedTweetId links immediately; rows
// without a link fall back to a text+time match against posted-but-unlinked
// drafts and, on a unique match, backfill the draft's missing postedTweetId —
// the systematic fix for drafts whose PATCH-after-paste never happened.

import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { harvestRows, harvestRuns, replyDrafts } from '../db/schema.ts';

const TWEET_ID_RE = /^\d{1,32}$/;
const USERNAME_RE = /^[A-Za-z0-9_]{1,15}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MODES = ['posts', 'replies'] as const;
const SCOPES = ['all', 'today', 'yesterday', 'since-last'] as const;
type Mode = (typeof MODES)[number];
type Scope = (typeof SCOPES)[number];

const MAX_ROWS_PER_BATCH = 500;
const DEFAULT_RUNS_LIMIT = 20;
const MAX_RUNS_LIMIT = 100;

// Fallback-match sanity window: the harvested reply must have been posted
// after its draft was generated (small slack for clock skew) and within a week
// of it — older pairs are too stale to claim on text equality alone.
const MATCH_BEFORE_SLACK_MS = 10 * 60 * 1000;
const MATCH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export const harvest = new Hono();

harvest.post('/harvest/runs', async (c) => {
  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const body = raw as Record<string, unknown>;

  const handle = normalizeHandle(body.handle);
  if (!handle) return c.json({ error: 'invalid_handle' }, 400);
  if (!isMode(body.mode)) return c.json({ error: 'invalid_mode' }, 400);
  if (!isScope(body.scope)) return c.json({ error: 'invalid_scope' }, 400);

  const [run] = await db
    .insert(harvestRuns)
    .values({ handle, mode: body.mode, scope: body.scope })
    .returning();

  return c.json(run, 201);
});

harvest.post('/harvest/rows', async (c) => {
  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const body = raw as Record<string, unknown>;

  const runId = typeof body.runId === 'string' && UUID_RE.test(body.runId) ? body.runId : null;
  if (!runId) return c.json({ error: 'invalid_run_id' }, 400);

  if (!Array.isArray(body.rows) || body.rows.length === 0) {
    return c.json({ error: 'rows_required' }, 400);
  }
  if (body.rows.length > MAX_ROWS_PER_BATCH) {
    return c.json({ error: 'too_many_rows', max: MAX_ROWS_PER_BATCH }, 400);
  }

  const rows: IngestRow[] = [];
  for (let i = 0; i < body.rows.length; i++) {
    const parsed = parseIngestRow(body.rows[i]);
    if ('error' in parsed) return c.json({ error: parsed.error, index: i }, 400);
    rows.push(parsed);
  }

  const [run] = await db.select().from(harvestRuns).where(eq(harvestRuns.id, runId));
  if (!run) return c.json({ error: 'run_not_found' }, 404);

  // Replies-mode reconcile. Exact: tweetId already linked on a draft. Fallback:
  // text+time match against posted-but-unlinked drafts (backfills the draft).
  const matchedDraftByTweet = new Map<string, string>();
  const backfills: Array<{ draftId: string; tweetId: string }> = [];

  if (run.mode === 'replies') {
    const ids = rows.map((r) => r.tweetId);

    const exact = await db
      .select({ id: replyDrafts.id, postedTweetId: replyDrafts.postedTweetId })
      .from(replyDrafts)
      .where(inArray(replyDrafts.postedTweetId, ids));
    for (const d of exact) {
      if (d.postedTweetId) matchedDraftByTweet.set(d.postedTweetId, d.id);
    }

    const unmatched = rows.filter((r) => !matchedDraftByTweet.has(r.tweetId));
    if (unmatched.length > 0) {
      const pool: UnlinkedDraft[] = await db
        .select({
          id: replyDrafts.id,
          sourceTweetId: replyDrafts.sourceTweetId,
          replyText: replyDrafts.replyText,
          replyTextEdited: replyDrafts.replyTextEdited,
          createdAt: replyDrafts.createdAt,
        })
        .from(replyDrafts)
        .where(and(eq(replyDrafts.status, 'posted'), isNull(replyDrafts.postedTweetId)));

      for (const row of unmatched) {
        const match = matchUnlinkedDraft(row, pool);
        if (!match) continue;
        matchedDraftByTweet.set(row.tweetId, match.id);
        backfills.push({ draftId: match.id, tweetId: row.tweetId });
        pool.splice(pool.indexOf(match), 1); // one draft, one reply
      }
    }
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.insert(harvestRows).values(
      rows.map((r) => ({
        runId,
        tweetId: r.tweetId,
        handle: r.handle,
        mode: run.mode,
        text: r.text,
        comments: r.comments,
        reposts: r.reposts,
        likes: r.likes,
        bookmarks: r.bookmarks,
        views: r.views,
        tweetTime: r.tweetTime,
        capturedAt: now,
        origTweetId: r.orig?.tweetId ?? null,
        origHandle: r.orig?.handle ?? null,
        origText: r.orig?.text ?? null,
        origTime: r.orig?.time ?? null,
        origComments: r.orig?.comments ?? null,
        origLikes: r.orig?.likes ?? null,
        origViews: r.orig?.views ?? null,
        matchedDraftId: matchedDraftByTweet.get(r.tweetId) ?? null,
        hasPhoto: r.hasPhoto,
        hasVideo: r.hasVideo,
        isQuote: r.isQuote,
        textLen: r.textLen,
        lineBreaks: r.lineBreaks,
        groupPosition: r.groupPosition,
      })),
    );
    for (const b of backfills) {
      await tx
        .update(replyDrafts)
        .set({ postedTweetId: b.tweetId, updatedAt: now })
        .where(eq(replyDrafts.id, b.draftId));
    }
    await tx
      .update(harvestRuns)
      .set({ rowCount: run.rowCount + rows.length })
      .where(eq(harvestRuns.id, runId));
  });

  return c.json(
    {
      inserted: rows.length,
      matched: matchedDraftByTweet.size,
      backfilled: backfills.length,
    },
    201,
  );
});

harvest.get('/harvest/runs', async (c) => {
  const limitStr = c.req.query('limit');
  let limit = DEFAULT_RUNS_LIMIT;
  if (limitStr !== undefined) {
    const n = Number(limitStr);
    if (!Number.isInteger(n) || n < 1) return c.json({ error: 'invalid_limit' }, 400);
    limit = Math.min(MAX_RUNS_LIMIT, n);
  }

  const runs = await db
    .select()
    .from(harvestRuns)
    .orderBy(desc(harvestRuns.createdAt))
    .limit(limit);

  return c.json(runs);
});

// --------------------------------------------------------------- validation

export interface IngestOrig {
  tweetId: string | null;
  handle: string | null;
  text: string | null;
  time: Date | null;
  comments: number | null;
  likes: number | null;
  views: number | null;
}

export interface IngestRow {
  tweetId: string;
  handle: string;
  text: string;
  comments: number;
  reposts: number;
  likes: number;
  bookmarks: number;
  views: number;
  tweetTime: Date | null;
  // Content-shape columns (§9.4) — null from pre-9.4 extension builds.
  hasPhoto: boolean | null;
  hasVideo: boolean | null;
  isQuote: boolean | null;
  textLen: number | null;
  lineBreaks: number | null;
  groupPosition: number | null;
  orig: IngestOrig | null;
}

// Exported for unit tests (pure).
export function parseIngestRow(value: unknown): IngestRow | { error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'invalid_row' };
  }
  const v = value as Record<string, unknown>;

  const tweetId = typeof v.tweetId === 'string' ? v.tweetId.trim() : '';
  if (!TWEET_ID_RE.test(tweetId)) return { error: 'invalid_row_tweet_id' };

  const handle = normalizeHandle(v.handle);
  if (!handle) return { error: 'invalid_row_handle' };

  // Text may legitimately be empty (image-only tweets); only reject non-string.
  if (typeof v.text !== 'string') return { error: 'invalid_row_text' };

  const metrics: Record<'comments' | 'reposts' | 'likes' | 'bookmarks' | 'views', number> = {
    comments: 0,
    reposts: 0,
    likes: 0,
    bookmarks: 0,
    views: 0,
  };
  for (const k of ['comments', 'reposts', 'likes', 'bookmarks', 'views'] as const) {
    const n = v[k];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
      return { error: `invalid_row_${k}` };
    }
    metrics[k] = Math.floor(n);
  }

  const tweetTime = optDate(v.time);
  if (tweetTime !== null && 'error' in tweetTime) return { error: 'invalid_row_time' };

  // Content-shape fields (§9.4) — all optional; reject only wrong types.
  const flags: Record<'hasPhoto' | 'hasVideo' | 'isQuote', boolean | null> = {
    hasPhoto: null,
    hasVideo: null,
    isQuote: null,
  };
  for (const k of ['hasPhoto', 'hasVideo', 'isQuote'] as const) {
    const b = v[k];
    if (b === undefined || b === null) continue;
    if (typeof b !== 'boolean') return { error: `invalid_row_${k}` };
    flags[k] = b;
  }
  const optInts: Record<'textLen' | 'lineBreaks' | 'groupPosition', number | null> = {
    textLen: null,
    lineBreaks: null,
    groupPosition: null,
  };
  for (const k of ['textLen', 'lineBreaks', 'groupPosition'] as const) {
    const n = v[k];
    if (n === undefined || n === null) continue;
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
      return { error: `invalid_row_${k}` };
    }
    optInts[k] = Math.floor(n);
  }

  let orig: IngestOrig | null = null;
  if (v.orig !== undefined && v.orig !== null) {
    if (typeof v.orig !== 'object' || Array.isArray(v.orig)) return { error: 'invalid_row_orig' };
    const o = v.orig as Record<string, unknown>;

    let origTweetId: string | null = null;
    if (o.tweetId !== undefined && o.tweetId !== null) {
      if (typeof o.tweetId !== 'string' || !TWEET_ID_RE.test(o.tweetId.trim())) {
        return { error: 'invalid_row_orig_tweet_id' };
      }
      origTweetId = o.tweetId.trim();
    }

    const origTime = optDate(o.time);
    if (origTime !== null && 'error' in origTime) return { error: 'invalid_row_orig_time' };

    const counts: Record<'comments' | 'likes' | 'views', number | null> = {
      comments: null,
      likes: null,
      views: null,
    };
    for (const k of ['comments', 'likes', 'views'] as const) {
      const n = o[k];
      if (n === undefined || n === null) continue;
      if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
        return { error: `invalid_row_orig_${k}` };
      }
      counts[k] = Math.floor(n);
    }

    orig = {
      tweetId: origTweetId,
      handle: normalizeHandle(o.handle),
      text: typeof o.text === 'string' && o.text !== '' ? o.text : null,
      time: origTime,
      comments: counts.comments,
      likes: counts.likes,
      views: counts.views,
    };
  }

  return { tweetId, handle, text: v.text, ...metrics, tweetTime, ...flags, ...optInts, orig };
}

// ---------------------------------------------------------------- reconcile

export interface UnlinkedDraft {
  id: string;
  sourceTweetId: string;
  replyText: string;
  replyTextEdited: string | null;
  createdAt: Date;
}

// The harvester's innerText read collapses internal newlines to spaces, while
// drafts keep theirs — collapse all whitespace on both sides before comparing.
export function normalizeHarvestText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

// Pure fallback matcher — exported for unit tests. A candidate qualifies when
// what was actually posted (the human edit when there is one) text-matches the
// harvested reply and the reply's timestamp is sane relative to the draft.
// Candidates drafted against the same source tweet win over text-only matches;
// remaining ties go to the draft created closest to the posting time.
export function matchUnlinkedDraft(
  row: { text: string; tweetTime: Date | null; orig?: { tweetId: string | null } | null },
  candidates: UnlinkedDraft[],
): UnlinkedDraft | null {
  if (!row.tweetTime) return null;
  const tweetMs = row.tweetTime.getTime();
  const textNorm = normalizeHarvestText(row.text);
  if (textNorm === '') return null;

  const pool = candidates.filter((d) => {
    const posted = normalizeHarvestText(d.replyTextEdited ?? d.replyText);
    if (posted !== textNorm) return false;
    const delta = tweetMs - d.createdAt.getTime();
    return delta >= -MATCH_BEFORE_SLACK_MS && delta <= MATCH_WINDOW_MS;
  });
  if (pool.length === 0) return null;

  const origId = row.orig?.tweetId ?? null;
  const sameSource = origId ? pool.filter((d) => d.sourceTweetId === origId) : [];
  const ranked = sameSource.length > 0 ? sameSource : pool;

  let best = ranked[0] as UnlinkedDraft;
  for (const d of ranked) {
    if (Math.abs(tweetMs - d.createdAt.getTime()) < Math.abs(tweetMs - best.createdAt.getTime())) {
      best = d;
    }
  }
  return best;
}

// ----------------------------------------------------------------- helpers

function isMode(v: unknown): v is Mode {
  return typeof v === 'string' && (MODES as readonly string[]).includes(v);
}

function isScope(v: unknown): v is Scope {
  return typeof v === 'string' && (SCOPES as readonly string[]).includes(v);
}

function normalizeHandle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const h = value.trim().replace(/^@/, '').toLowerCase();
  return USERNAME_RE.test(h) ? h : null;
}

// null/undefined/'' → null (no timestamp); invalid date string → {error}.
function optDate(value: unknown): Date | null | { error: true } {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return { error: true };
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? { error: true } : d;
}
