// Drains due `scheduled_posts` rows by calling `createPost` and flipping
// status. Runs every 60s in-process.
//
// Per-row transaction with `FOR UPDATE SKIP LOCKED`:
//   - keeps the row lock across the X call so a second tick (or future
//     replica) can never double-publish.
//   - one txn per row → if a single X call hangs, the others aren't blocked
//     waiting on a fat batch lock.
//
// Failures become rows with `status='failed'` + classified `error_class`. The
// PLAN's stance on idempotency is explicit: no draft-row pattern; reconcile
// will catch tweets that shipped but failed to mark posted (Phase 2).

import { and, asc, eq, lte } from 'drizzle-orm';
import { db } from '../../db/client.ts';
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

export interface TickResult {
  posted: number;
  failed: number;
}

export async function tickPublisher(opts: PublisherOptions): Promise<TickResult> {
  const result: TickResult = { posted: 0, failed: 0 };

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
    else result.failed++;
  }

  if (result.posted > 0 || result.failed > 0) {
    console.log(`publisher: posted=${result.posted} failed=${result.failed}`);
  }
  return result;
}

async function processOne(
  token: string,
  selfXUserId: string,
): Promise<'posted' | 'failed' | 'idle'> {
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
    if (!row) return 'idle';

    try {
      const out = await createPost(token, { text: row.text }, { selfXUserId });
      const now = new Date();
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
          nextPollAt: now,
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
      console.log(`publisher: ${row.id} → ${out.id}`);
      return 'posted';
    } catch (err) {
      const errorClass: ErrorClass = err instanceof XApiError ? classify(err) : 'unknown';
      const detail = describe(err).slice(0, ERROR_DETAIL_MAX);
      await tx
        .update(scheduledPosts)
        .set({
          status: 'failed',
          errorClass,
          errorDetail: detail,
          updatedAt: new Date(),
        })
        .where(eq(scheduledPosts.id, row.id));
      console.error(`publisher: ${row.id} failed (${errorClass}): ${detail}`);
      return 'failed';
    }
  });
}

export function startPublisher(opts: PublisherOptions): () => void {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  let running = false;

  const safeTick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await tickPublisher(opts);
    } catch (err) {
      console.error('publisher: tick crashed:', describe(err));
    } finally {
      running = false;
    }
  };

  const handle = setInterval(() => {
    void safeTick();
  }, intervalMs);

  return () => clearInterval(handle);
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
