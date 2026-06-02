// Drains due `posts_published` rows by snapshotting metrics from X. Runs every
// 60s in-process, but acts on each row only once: a single snapshot at ~24h of
// post age, then retire. We want the day-after number ("how did yesterday's
// posts do"), not the intraday engagement curve — and at 50+ replies/day, one
// read per tweet keeps the cost flat at $0.001/tweet.
//
// `nextPollAt` is seeded to postedAt + 24h by both the publisher and
// ownReconcile, so the lone snapshot lands at 24h age regardless of when the
// row was discovered (a manual reply found 30h late is snapshotted immediately
// and retired). 24h is well inside X's 30-day window, so the owned read still
// carries `non_public_metrics` (incl. `user_profile_clicks` — "profile visits")
// and `organic_metrics` for free (X plan §6.9).
//
// Per-row transaction with `FOR UPDATE SKIP LOCKED` (same shape as publisher):
// the X call happens inside the lock so a second tick can't double-snapshot
// or race past the next_poll_at update. pollCount is bumped only on a real
// snapshot — transient errors push next_poll_at forward without crediting it.

import { and, asc, eq, lte, sql } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { metricsSnapshots, postsPublished } from '../db/schema.ts';
import { getTweet } from '../endpoints.ts';
import { XApiError } from '../errors.ts';
import { getValidAccessToken } from '../token-store.ts';

export interface MetricsPollDeps {
  clientId: string;
  clientSecret: string;
}

export interface MetricsPollOptions extends MetricsPollDeps {
  intervalMs?: number;
  batchSize?: number;
}

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_BATCH_SIZE = 10;
// Defer transient failures past the 60s tick so we don't hot-loop on the same
// row inside a single tick's batch. Tuned to the first cadence step.
const TRANSIENT_RETRY_DELAY_MS = 5 * 60_000;

const MIN = 60_000;
const HOUR = 60 * MIN;

// Single snapshot at 24h of post age, then retire. `nextPollAt` is seeded to
// postedAt + 24h upstream, so a due row is normally already ≥24h old and gets
// exactly one snapshot. The positive-delay branch only fires defensively for a
// row that somehow becomes due early (e.g. a stale row from the old cadence) —
// we reschedule it to 24h rather than snapshot it immature.
const SNAPSHOT_AT_MS = 24 * HOUR;

/**
 * Returns the delay (ms) until the next metrics poll for a tweet of the given
 * age, or `null` if the tweet should be retired (no further polling).
 *
 * Pure function — no I/O — so it's covered by unit tests in src/test.test.ts.
 */
export function nextPollDelay(ageMs: number): number | null {
  if (ageMs < SNAPSHOT_AT_MS) return SNAPSHOT_AT_MS - ageMs;
  return null;
}

export interface TickResult {
  polled: number;
  retired: number;
  failed: number;
}

export async function tickMetricsPoll(opts: MetricsPollOptions): Promise<TickResult> {
  const result: TickResult = { polled: 0, retired: 0, failed: 0 };

  let token: string;
  try {
    token = await getValidAccessToken({
      clientId: opts.clientId,
      clientSecret: opts.clientSecret,
    });
  } catch (err) {
    console.error('metricsPoll: token fetch failed:', describe(err));
    return result;
  }

  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
  for (let i = 0; i < batchSize; i++) {
    const outcome = await processOne(token);
    if (outcome === 'idle') break;
    if (outcome === 'polled') result.polled++;
    else if (outcome === 'retired') result.retired++;
    else result.failed++;
  }

  if (result.polled > 0 || result.retired > 0 || result.failed > 0) {
    console.log(
      `metricsPoll: polled=${result.polled} retired=${result.retired} failed=${result.failed}`,
    );
  }
  return result;
}

async function processOne(token: string): Promise<'polled' | 'retired' | 'failed' | 'idle'> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(postsPublished)
      .where(and(eq(postsPublished.retired, false), lte(postsPublished.nextPollAt, new Date())))
      .orderBy(asc(postsPublished.nextPollAt))
      .limit(1)
      .for('update', { skipLocked: true });

    const row = rows[0];
    if (!row) return 'idle';

    const now = new Date();
    const ageMs = now.getTime() - row.postedAt.getTime();
    // Always request privates: every checkpoint is inside X's 30-day window,
    // and `non_public_metrics` carries `user_profile_clicks` ("profile visits")
    // at no extra cost on this same owned read.
    const ownedPrivate = true;

    let tweet: Awaited<ReturnType<typeof getTweet>>;
    try {
      tweet = await getTweet(token, row.tweetId, { ownedPrivate });
    } catch (err) {
      if (err instanceof XApiError && (err.status === 404 || err.status === 403)) {
        // Deleted, suspended, or auth revoked for this resource — retire so we
        // stop racking up failed reads.
        await tx
          .update(postsPublished)
          .set({ retired: true, lastSeenAt: now })
          .where(eq(postsPublished.tweetId, row.tweetId));
        console.log(`metricsPoll: ${row.tweetId} retired (${err.status})`);
        return 'retired';
      }
      await tx
        .update(postsPublished)
        .set({ nextPollAt: new Date(now.getTime() + TRANSIENT_RETRY_DELAY_MS) })
        .where(eq(postsPublished.tweetId, row.tweetId));
      console.error(`metricsPoll: ${row.tweetId} failed: ${describe(err)}`);
      return 'failed';
    }

    await tx.insert(metricsSnapshots).values({
      tweetId: row.tweetId,
      publicMetrics: tweet.public_metrics ?? null,
      nonPublicMetrics: tweet.non_public_metrics ?? null,
      organicMetrics: tweet.organic_metrics ?? null,
    });

    const delay = nextPollDelay(ageMs);
    const nextPollAt = delay === null ? null : new Date(now.getTime() + delay);
    const retired = delay === null;

    await tx
      .update(postsPublished)
      .set({
        pollCount: sql`${postsPublished.pollCount} + 1`,
        lastSeenAt: now,
        nextPollAt,
        retired,
      })
      .where(eq(postsPublished.tweetId, row.tweetId));

    return retired ? 'retired' : 'polled';
  });
}

export function startMetricsPoll(opts: MetricsPollOptions): () => void {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  let running = false;

  const safeTick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await tickMetricsPoll(opts);
    } catch (err) {
      console.error('metricsPoll: tick crashed:', describe(err));
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
