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
// The PLAN's stance on idempotency is explicit: no draft-row pattern; reconcile
// catches tweets that shipped but failed to mark posted.

import { and, asc, eq, lt, lte, sql } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { beat } from '../../heartbeats.ts';
import { postsPublished, scheduledPosts } from '../db/schema.ts';
import { createPost } from '../endpoints.ts';
import { type ErrorClass, XApiError, classify } from '../errors.ts';
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
        `publisher: row ${row.id} stuck in 'publishing' since ${row.updatedAt.toISOString()} — ` +
          'X outcome unknown; check posts_published / X app, then PATCH status to pending or failed.',
      );
    }
  } catch (err) {
    console.error('publisher: stuck-row check failed:', describe(err));
  }
}

async function claimOne(): Promise<typeof scheduledPosts.$inferSelect | null> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(scheduledPosts)
      .where(
        and(eq(scheduledPosts.status, 'pending'), lte(scheduledPosts.scheduledFor, new Date())),
      )
      .orderBy(asc(scheduledPosts.scheduledFor))
      .limit(1)
      .for('update', { skipLocked: true });

    const row = rows[0];
    if (!row) return null;

    await tx
      .update(scheduledPosts)
      .set({ status: 'publishing', updatedAt: new Date() })
      .where(eq(scheduledPosts.id, row.id));
    return row;
  });
}

async function processOne(
  token: string,
  selfXUserId: string,
): Promise<'posted' | 'failed' | 'stuck' | 'idle'> {
  const row = await claimOne();
  if (!row) return 'idle';

  let out: { id: string; text: string };
  try {
    out = await createPost(token, { text: row.text }, { selfXUserId });
  } catch (err) {
    const detail = describe(err).slice(0, ERROR_DETAIL_MAX);
    // Only a definite X rejection (4xx problem details) proves nothing was
    // created. Exhausted 5xx retries or a network error are ambiguous — the
    // tweet may exist — so the row stays 'publishing' (never auto-retried).
    if (err instanceof XApiError && err.status < 500) {
      const errorClass: ErrorClass = classify(err);
      await db
        .update(scheduledPosts)
        .set({ status: 'failed', errorClass, errorDetail: detail, updatedAt: new Date() })
        .where(eq(scheduledPosts.id, row.id));
      console.error(`publisher: ${row.id} failed (${errorClass}): ${detail}`);
      return 'failed';
    }
    await db
      .update(scheduledPosts)
      .set({ errorClass: 'unknown', errorDetail: detail, updatedAt: new Date() })
      .where(eq(scheduledPosts.id, row.id));
    console.error(`publisher: ${row.id} outcome UNKNOWN, left in 'publishing': ${detail}`);
    return 'stuck';
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    // onConflictDoNothing guards against a tight race where the reconciler
    // inserted this tweet first (saw it on X before our txn committed). The
    // existing row stays as-is — possibly mislabeled `'manual'` — but the
    // scheduled_posts row still flips to 'posted' below, which is correct.
    await tx
      .insert(postsPublished)
      .values({
        tweetId: out.id,
        scheduledPostId: row.id,
        text: out.text,
        postedAt: now,
        source: 'scheduled',
        // Informational only — the daily 03:00 UTC pass snapshots every
        // non-retired row regardless of age. See workers/dailyMetrics.ts.
        nextPollAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      })
      .onConflictDoNothing();
    await tx
      .update(scheduledPosts)
      .set({
        status: 'posted',
        postedTweetId: out.id,
        errorClass: null,
        errorDetail: null,
        updatedAt: now,
      })
      .where(eq(scheduledPosts.id, row.id));
  });
  console.log(`publisher: ${row.id} → ${out.id}`);
  return 'posted';
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
