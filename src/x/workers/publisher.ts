// Drains due `scheduled_posts` rows by calling `createPost` and flipping
// status. Runs every 60s in-process.
//
// Double-post hardening (same family as retire-before-snapshot): the billed
// side-effect (createPost) must never sit upstream of repeatability. Each row
// is CLAIMED in its own committed txn — `pending` → `publishing` — BEFORE the
// X call, so a crash mid-call can never leave the row selectable again:
//
//   txn 1: SELECT … FOR UPDATE SKIP LOCKED, flip to 'publishing', COMMIT
//   (no txn): createPost — the billed, unrepeatable call
//   txn 2: insert posts_published + flip to 'posted' / 'failed'
//
// Outcome mapping after the X call:
//   - success            → 'posted'
//   - XApiError 4xx      → 'failed' (X rejected it; nothing was created; user
//                          can edit & retry)
//   - 5xx/network/other  → stays 'publishing' — AMBIGUOUS: some retry attempt
//                          may have created the tweet, so re-queueing risks a
//                          double post. The daily reconcile discovers it if it
//                          shipped; tickPublisher logs stuck rows loudly.
//
// Threads (§8.2): claiming a thread head (thread_position 1) posts the whole
// chain in one go — head first, then each 'segment' row as a self-reply to the
// previous segment's returned id (~500ms apart). Every segment is flipped to
// 'publishing' in its own committed write BEFORE its X call (same claim rule).
// One failed/ambiguous segment freezes the REST of the thread as 'failed' —
// never a half-posted thread re-posted from the top; the already-posted prefix
// stays posted.
//
// Self-quote re-up (§8.5): a row with quote_tweet_id posts as a quote tweet —
// only after this worker re-verifies the quoted id exists in posts_published
// (i.e. it's MY tweet; quoting others is blocked on self-serve, Feb 2026).
//
// The PLAN's stance on idempotency is explicit: no draft-row pattern; reconcile
// catches tweets that shipped but failed to mark posted.

import { and, asc, eq, lt, lte, sql } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { beat } from '../../heartbeats.ts';
import { postsPublished, scheduledPosts } from '../db/schema.ts';
import { type CreatePostInput, containsUrl, createPost } from '../endpoints.ts';
import { XApiError, classify } from '../errors.ts';
import { getValidAccessToken } from '../token-store.ts';

export interface PublisherDeps {
  selfXUserId: string;
  clientId: string;
  clientSecret: string;
}

export interface PublisherOptions extends PublisherDeps {
  intervalMs?: number;
  batchSize?: number;
}

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_BATCH_SIZE = 10;
const ERROR_DETAIL_MAX = 2000;
const STUCK_PUBLISHING_MS = 5 * 60_000;
// Pause between thread segments (X plan §6.3.4) — fast enough to read as one
// thread, slow enough not to trip write rate limits.
const SEGMENT_DELAY_MS = 500;

export const PUBLISHER_HEARTBEAT = 'x.publisher';

export interface TickResult {
  posted: number;
  failed: number;
  /** Rows left in 'publishing' because the X outcome is unknown (5xx/network). */
  stuck: number;
}

export async function tickPublisher(opts: PublisherOptions): Promise<TickResult> {
  const result: TickResult = { posted: 0, failed: 0, stuck: 0 };

  await warnStuckPublishing();

  let token: string;
  try {
    token = await getValidAccessToken({
      clientId: opts.clientId,
      clientSecret: opts.clientSecret,
    });
  } catch (err) {
    console.error('publisher: token fetch failed:', describe(err));
    return result;
  }

  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
  for (let i = 0; i < batchSize; i++) {
    const outcome = await processOne(token, opts.selfXUserId);
    if (outcome === 'idle') break;
    if (outcome === 'posted') result.posted++;
    else if (outcome === 'failed') result.failed++;
    else result.stuck++;
  }

  if (result.posted > 0 || result.failed > 0 || result.stuck > 0) {
    console.log(`publisher: posted=${result.posted} failed=${result.failed} stuck=${result.stuck}`);
  }
  return result;
}

// Rows parked in 'publishing' past the claim window need a human (or the daily
// reconcile) — they will never be retried automatically. Shout every tick so a
// lost posting slot is loud, not silent.
async function warnStuckPublishing(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - STUCK_PUBLISHING_MS);
    const rows = await db
      .select({ id: scheduledPosts.id, updatedAt: scheduledPosts.updatedAt })
      .from(scheduledPosts)
      .where(and(eq(scheduledPosts.status, 'publishing'), lt(scheduledPosts.updatedAt, cutoff)));
    for (const row of rows) {
      console.error(
        `publisher: row ${row.id} stuck in 'publishing' since ${row.updatedAt.toISOString()} — X outcome unknown; check posts_published / X app, then PATCH status to pending or failed.`,
      );
    }
  } catch (err) {
    console.error('publisher: stuck-row check failed:', describe(err));
  }
}

// Synchronous claim transaction (SQLite is a single writer, so there's no
// concurrent claimer to race — `FOR UPDATE SKIP LOCKED` is gone). The claim
// still commits BEFORE the X call: a crash mid-call can never re-select the row.
function claimOne(): typeof scheduledPosts.$inferSelect | null {
  return db.transaction((tx) => {
    const rows = tx
      .select()
      .from(scheduledPosts)
      .where(
        and(eq(scheduledPosts.status, 'pending'), lte(scheduledPosts.scheduledFor, new Date())),
      )
      .orderBy(asc(scheduledPosts.scheduledFor))
      .limit(1)
      .all();

    const row = rows[0];
    if (!row) return null;

    tx.update(scheduledPosts)
      .set({ status: 'publishing', updatedAt: new Date() })
      .where(eq(scheduledPosts.id, row.id))
      .run();
    return row;
  });
}

async function processOne(
  token: string,
  selfXUserId: string,
): Promise<'posted' | 'failed' | 'stuck' | 'idle'> {
  const row = await claimOne();
  if (!row) return 'idle';

  if (row.threadId && row.threadPosition === 1) {
    return processThread(token, selfXUserId, row);
  }

  // A frozen tail segment re-armed by hand (PATCH failed → pending) must
  // resume the chain, never post standalone — without the reply link it would
  // land as a context-free orphan on the timeline.
  if (row.threadId && row.threadPosition != null && row.threadPosition > 1) {
    return resumeThreadFrom(token, selfXUserId, row);
  }

  const out = await postOne(token, selfXUserId, row, null);
  return out.kind;
}

// Manual thread retry: post this re-armed segment as a reply to the nearest
// posted segment above it, then continue the remaining 'segment'/'failed'
// rows below in position order (claiming each before its call).
async function resumeThreadFrom(
  token: string,
  selfXUserId: string,
  row: ScheduledRow,
): Promise<'posted' | 'failed' | 'stuck'> {
  const threadId = row.threadId;
  if (!threadId || row.threadPosition == null) return 'failed'; // unreachable
  const siblings = await db
    .select()
    .from(scheduledPosts)
    .where(eq(scheduledPosts.threadId, threadId))
    .orderBy(asc(scheduledPosts.threadPosition));

  const head = siblings.find((s) => s.threadPosition === 1);
  const prev = [...siblings]
    .filter(
      (s) =>
        s.status === 'posted' &&
        s.postedTweetId &&
        s.threadPosition != null &&
        s.threadPosition < (row.threadPosition as number),
    )
    .sort((a, b) => (b.threadPosition ?? 0) - (a.threadPosition ?? 0))[0];

  if (!prev?.postedTweetId) {
    const detail =
      'cannot resume thread: no posted segment above this one — retry the head (or earlier segment) first';
    await db
      .update(scheduledPosts)
      .set({
        status: 'failed',
        errorClass: 'thread_frozen',
        errorDetail: detail,
        updatedAt: new Date(),
      })
      .where(eq(scheduledPosts.id, row.id));
    console.error(`publisher: ${row.id} failed: ${detail}`);
    return 'failed';
  }

  const conversationId = head?.postedTweetId ?? prev.postedTweetId;
  let out = await postOne(token, selfXUserId, row, {
    tweetId: prev.postedTweetId,
    conversationId,
  });
  if (out.kind !== 'posted') return out.kind;

  // Continue the rest of the chain below the resumed segment.
  let prevId = out.tweetId;
  const rest = siblings.filter(
    (s) =>
      (s.status === 'segment' || s.status === 'failed') &&
      s.threadPosition != null &&
      s.threadPosition > (row.threadPosition as number),
  );
  for (const seg of rest) {
    await db
      .update(scheduledPosts)
      .set({ status: 'publishing', updatedAt: new Date() })
      .where(eq(scheduledPosts.id, seg.id));
    await sleep(SEGMENT_DELAY_MS);
    out = await postOne(token, selfXUserId, seg, { tweetId: prevId, conversationId });
    if (out.kind !== 'posted') return out.kind;
    prevId = out.tweetId;
  }
  return 'posted';
}

type ScheduledRow = typeof scheduledPosts.$inferSelect;

type PostOutcome = { kind: 'posted'; tweetId: string } | { kind: 'failed' } | { kind: 'stuck' };

// Posts one already-claimed ('publishing') row and finalizes its status.
// `replyTo` carries the previous thread segment's id + the head's id for the
// conversation column; null for standalone posts.
async function postOne(
  token: string,
  selfXUserId: string,
  row: ScheduledRow,
  replyTo: { tweetId: string; conversationId: string } | null,
): Promise<PostOutcome> {
  const body: CreatePostInput = { text: row.text };
  let verifiedSelfQuote = false;

  if (row.quoteTweetId) {
    // Verify, don't trust (§8.5/§9.2): only MY tweets live in posts_published.
    const [quoted] = await db
      .select({ tweetId: postsPublished.tweetId })
      .from(postsPublished)
      .where(eq(postsPublished.tweetId, row.quoteTweetId));
    if (!quoted) {
      const detail = `quote_tweet_id ${row.quoteTweetId} not found in posts_published — refusing non-self quote (Feb 2026 policy)`;
      await db
        .update(scheduledPosts)
        .set({
          status: 'failed',
          errorClass: 'unknown',
          errorDetail: detail,
          updatedAt: new Date(),
        })
        .where(eq(scheduledPosts.id, row.id));
      console.error(`publisher: ${row.id} failed: ${detail}`);
      return { kind: 'failed' };
    }
    body.quote_tweet_id = row.quoteTweetId;
    verifiedSelfQuote = true;
  }

  if (replyTo) {
    body.reply = { in_reply_to_tweet_id: replyTo.tweetId };
  }

  let out: { id: string; text: string };
  try {
    out = await createPost(token, body, {
      selfXUserId,
      ...(verifiedSelfQuote ? { verifiedSelfQuote } : {}),
      // Thread segments reply to the tweet this worker just created — own by
      // construction (§9.2 verified, not trusted).
      ...(replyTo ? { parentAuthorId: selfXUserId } : {}),
      // A URL in a tail segment is the link-in-first-reply pattern — billed at
      // the base $0.015 (createPost stamps the truthful costHint). The calendar
      // guard keeps URLs out of heads/standalones, so this never opts a $0.20
      // surcharge in silently.
      ...(replyTo && containsUrl(row.text) ? { allowUrlSurcharge: true } : {}),
    });
  } catch (err) {
    const detail = describe(err).slice(0, ERROR_DETAIL_MAX);
    // Only a definite X rejection (4xx problem details) proves nothing was
    // created. Exhausted 5xx retries or a network error are ambiguous — the
    // tweet may exist — so the row stays 'publishing' (never auto-retried).
    if (err instanceof XApiError && err.status < 500) {
      const errorClass = classify(err);
      await db
        .update(scheduledPosts)
        .set({ status: 'failed', errorClass, errorDetail: detail, updatedAt: new Date() })
        .where(eq(scheduledPosts.id, row.id));
      console.error(`publisher: ${row.id} failed (${errorClass}): ${detail}`);
      return { kind: 'failed' };
    }
    await db
      .update(scheduledPosts)
      .set({ errorClass: 'unknown', errorDetail: detail, updatedAt: new Date() })
      .where(eq(scheduledPosts.id, row.id));
    console.error(`publisher: ${row.id} outcome UNKNOWN, left in 'publishing': ${detail}`);
    return { kind: 'stuck' };
  }

  const now = new Date();
  db.transaction((tx) => {
    // onConflictDoNothing guards against a tight race where the reconciler
    // inserted this tweet first (saw it on X before our txn committed). The
    // existing row stays as-is — possibly mislabeled `'manual'` — but the
    // scheduled_posts row still flips to 'posted' below, which is correct.
    tx.insert(postsPublished)
      .values({
        tweetId: out.id,
        scheduledPostId: row.id,
        text: out.text,
        postedAt: now,
        isReply: replyTo != null,
        inReplyToTweetId: replyTo?.tweetId ?? null,
        conversationId: replyTo?.conversationId ?? null,
        source: 'scheduled',
        // §S0.2: we control the body, so this is a fact, not a guess — stratus
        // can't attach media via API (OAuth 1.0a), so `body.media` is never set
        // and every scheduled post is text-only. Derived (not hardcoded) so it
        // stays correct if media upload ever lands. Feeds the has_media baseline.
        hasMedia: (body.media?.media_ids?.length ?? 0) > 0,
        // Informational only — the daily 03:00 UTC pass snapshots every
        // non-retired row regardless of age. See workers/dailyMetrics.ts.
        nextPollAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      })
      .onConflictDoNothing()
      .run();
    tx.update(scheduledPosts)
      .set({
        status: 'posted',
        postedTweetId: out.id,
        errorClass: null,
        errorDetail: null,
        updatedAt: now,
      })
      .where(eq(scheduledPosts.id, row.id))
      .run();
  });
  console.log(`publisher: ${row.id} → ${out.id}`);
  return { kind: 'posted', tweetId: out.id };
}

// Posts a whole thread: the claimed head, then each tail segment as a
// self-reply to the previous segment. A failed head freezes every segment; a
// failed/ambiguous segment freezes the segments AFTER it (the posted prefix
// stays posted — re-posting from the top is the one unforgivable outcome).
async function processThread(
  token: string,
  selfXUserId: string,
  head: ScheduledRow,
): Promise<'posted' | 'failed' | 'stuck'> {
  const threadId = head.threadId;
  if (!threadId) return 'failed'; // unreachable — caller checked
  const tail = await db
    .select()
    .from(scheduledPosts)
    .where(and(eq(scheduledPosts.threadId, threadId), eq(scheduledPosts.status, 'segment')))
    .orderBy(asc(scheduledPosts.threadPosition));

  const headOut = await postOne(token, selfXUserId, head, null);
  if (headOut.kind !== 'posted') {
    await freezeSegments(tail, 'thread head did not post — segment frozen for manual retry');
    return headOut.kind;
  }

  const conversationId = headOut.tweetId;
  let prev = headOut.tweetId;
  for (let i = 0; i < tail.length; i++) {
    const seg = tail[i] as ScheduledRow;
    // Claim the segment in a committed write BEFORE its billed X call — a
    // crash mid-call leaves it 'publishing' (loud), never re-claimable.
    await db
      .update(scheduledPosts)
      .set({ status: 'publishing', updatedAt: new Date() })
      .where(eq(scheduledPosts.id, seg.id));
    await sleep(SEGMENT_DELAY_MS);
    const out = await postOne(token, selfXUserId, seg, { tweetId: prev, conversationId });
    if (out.kind === 'posted') {
      prev = out.tweetId;
      continue;
    }
    await freezeSegments(
      tail.slice(i + 1),
      `thread frozen after position ${seg.threadPosition} — earlier segments posted, do NOT re-post from the top`,
    );
    return out.kind;
  }
  return 'posted';
}

async function freezeSegments(segments: ScheduledRow[], reason: string): Promise<void> {
  for (const seg of segments) {
    await db
      .update(scheduledPosts)
      .set({
        status: 'failed',
        errorClass: 'thread_frozen',
        errorDetail: reason,
        updatedAt: new Date(),
      })
      .where(eq(scheduledPosts.id, seg.id));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function startPublisher(opts: PublisherOptions): () => Promise<void> {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  let current: Promise<void> | null = null;

  const safeTick = async (): Promise<void> => {
    try {
      await tickPublisher(opts);
    } catch (err) {
      console.error('publisher: tick crashed:', describe(err));
    } finally {
      beat(PUBLISHER_HEARTBEAT);
      current = null;
    }
  };

  const handle = setInterval(() => {
    if (!current) current = safeTick();
  }, intervalMs);

  // Stop = clear the timer AND drain the in-flight tick, so a deploy restart
  // can't SIGKILL mid-createPost (the double-post window).
  return async () => {
    clearInterval(handle);
    await (current ?? Promise.resolve());
  };
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
