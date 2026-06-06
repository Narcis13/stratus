// Single daily pass (03:00 UTC) that replaces the old 60s `metricsPoll` + 24h
// `ownReconcile` workers. One run does two things:
//
//   A. Discover — incremental own-timeline pull (since_id checkpoint) to catch
//      tweets posted manually from the X app. Scheduler-posted tweets are
//      already in posts_published via the publisher, so steady-state discovery
//      reads only the handful of new manual tweets. New rows seed
//      nextPollAt = postedAt + 24h.
//   B. Snapshot — read EVERY non-retired row (regardless of age) by batched id
//      lookup (`GET /2/tweets?ids=`, ≤100 ids/call), write ONE metrics_snapshots
//      row each, then retire. Whatever a tweet's metrics are at the next ~03:00
//      UTC pass is the single number we keep — age no longer gates this.
//
// ONCE AND ONLY ONCE: each batch is retired in one committed txn the instant the
// read returns, BEFORE any snapshot insert — so a retired row is never selected
// again and we never pay to read a tweet twice, even across a crash. The
// trade-off is at-most-once snapshots: a crash between the retire commit and the
// inserts loses that batch's snapshots (a metrics gap), never a double charge.
//
// Why this shape (and not the old two workers): the 60s poller logged a steady
// stream of X reads independent of any user action, which polluted cost_events
// and — via a pricing gap — misreported them. One scheduled pass keeps reads in
// a predictable daily window at owned-read prices ($0.001/result), and a missed
// run simply leaves rows for the next pass (still read exactly once each).

import { asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { metricsSnapshots, postsPublished } from '../db/schema.ts';
import { getTweetsByIds, getUserTweets } from '../endpoints.ts';
import { getValidAccessToken } from '../token-store.ts';

export interface DailyMetricsDeps {
  selfXUserId: string;
  clientId: string;
  clientSecret: string;
}

export interface DailyMetricsOptions extends DailyMetricsDeps {
  /** UTC hour to fire each day. Default 3 (03:00 UTC). */
  hourUtc?: number;
}

export interface RunOptions {
  /** Ignore the since_id checkpoint and rescan the recent timeline. */
  fullScan?: boolean;
  /** Max tweets to discover this pass. Default 500 (X timeline cap is 3,200). */
  maxResults?: number;
}

export interface RunResult {
  /** Tweets returned by the discovery timeline pull. */
  scanned: number;
  /** New posts_published rows inserted by discovery. */
  discovered: number;
  /** metrics_snapshots rows written this run. */
  snapshotted: number;
  /** Rows marked retired this run (snapshotted, or gone from X). */
  retired: number;
  /** Snapshot batches that errored (rows left due for the next run). */
  failed: number;
}

const DEFAULT_MAX_RESULTS = 500;
const SNAPSHOT_BATCH = 100; // GET /2/tweets?ids= accepts ≤100 ids
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_HOUR_UTC = 3;
// X nulls non_public/organic on owned posts after 30 days and can return them
// unstorable past that. Now that we snapshot regardless of age, only request the
// private fields for tweets still inside the window (2-day margin). This is the
// only thing age still affects — it does not gate *whether* a tweet is read.
const PRIVATE_FIELDS_MAX_AGE_MS = 28 * DAY_MS;

export async function runDailyMetrics(
  deps: DailyMetricsDeps,
  runOpts: RunOptions = {},
): Promise<RunResult> {
  const result: RunResult = { scanned: 0, discovered: 0, snapshotted: 0, retired: 0, failed: 0 };

  const token = await getValidAccessToken({
    clientId: deps.clientId,
    clientSecret: deps.clientSecret,
  });

  // Discover first so any tweet found this run is in the table before the
  // snapshot pass, which reads every non-retired row regardless of age.
  await discover(token, deps.selfXUserId, runOpts, result);
  await snapshotDue(token, result);

  console.log(
    `dailyMetrics: scanned=${result.scanned} discovered=${result.discovered} ` +
      `snapshotted=${result.snapshotted} retired=${result.retired} failed=${result.failed}`,
  );
  return result;
}

async function discover(
  token: string,
  selfXUserId: string,
  runOpts: RunOptions,
  result: RunResult,
): Promise<void> {
  let sinceId: string | undefined;
  if (!runOpts.fullScan) {
    // tweet_id is a snowflake — cast to bigint so ids sort numerically.
    const [latest] = await db
      .select({ tweetId: postsPublished.tweetId })
      .from(postsPublished)
      .orderBy(sql`${postsPublished.tweetId}::bigint desc`)
      .limit(1);
    sinceId = latest?.tweetId;
  }

  const maxResults = runOpts.maxResults ?? DEFAULT_MAX_RESULTS;
  const now = new Date();

  // Discovery doesn't request the private metric fields — it only needs to seed
  // rows. The snapshot pass does the authoritative owned read (with private
  // fields where the tweet is still inside the 30-day window).
  for await (const tweet of getUserTweets(token, selfXUserId, {
    maxResults,
    ...(sinceId ? { sinceId } : {}),
  })) {
    result.scanned++;

    const repliedTo = tweet.referenced_tweets?.find((r) => r.type === 'replied_to');
    const postedAt = tweet.created_at ? new Date(tweet.created_at) : now;

    const inserted = await db
      .insert(postsPublished)
      .values({
        tweetId: tweet.id,
        text: tweet.text,
        postedAt,
        isReply: tweet.in_reply_to_user_id != null,
        inReplyToTweetId: repliedTo?.id ?? null,
        conversationId: tweet.conversation_id ?? null,
        source: 'manual',
        nextPollAt: new Date(postedAt.getTime() + DAY_MS),
      })
      .onConflictDoNothing()
      .returning({ tweetId: postsPublished.tweetId });

    if (inserted.length > 0) result.discovered++;
  }
}

async function snapshotDue(token: string, result: RunResult): Promise<void> {
  // EVERY non-retired tweet, regardless of age. Retired rows are never selected
  // again, so each tweet is read (and billed) once and only once. Oldest first
  // so a backlog drains in posting order across passes.
  const rows = await db
    .select({ tweetId: postsPublished.tweetId, postedAt: postsPublished.postedAt })
    .from(postsPublished)
    .where(eq(postsPublished.retired, false))
    .orderBy(asc(postsPublished.postedAt));

  // Age only decides which fields are safe to request — not whether to read.
  const nowMs = Date.now();
  const fresh = rows.filter((r) => nowMs - r.postedAt.getTime() < PRIVATE_FIELDS_MAX_AGE_MS);
  const stale = rows.filter((r) => nowMs - r.postedAt.getTime() >= PRIVATE_FIELDS_MAX_AGE_MS);

  for (const [group, ownedPrivate] of [
    [fresh, true],
    [stale, false],
  ] as const) {
    for (let i = 0; i < group.length; i += SNAPSHOT_BATCH) {
      const ids = group.slice(i, i + SNAPSHOT_BATCH).map((r) => r.tweetId);

      let found: Awaited<ReturnType<typeof getTweetsByIds>>['found'];
      let missing: string[];
      try {
        ({ found, missing } = await getTweetsByIds(token, ids, { ownedPrivate }));
      } catch (err) {
        // Transient (network/5xx/429), not billed — leave these rows un-retired;
        // next run retries them at no cost.
        result.failed++;
        console.error(`dailyMetrics: snapshot batch failed: ${describe(err)}`);
        continue;
      }

      // The read is already BILLED. Retire the whole batch in one committed txn
      // BEFORE inserting any snapshot, so a crash can never cause a re-read
      // (once and only once). Found ids get a pollCount credit; ids X couldn't
      // serve (deleted/suspended) retire without one.
      const now = new Date();
      const foundIds = found.map((t) => t.id);
      const foundSet = new Set(foundIds);
      const unserved = ids.filter((id) => !foundSet.has(id));
      await db.transaction(async (tx) => {
        if (foundIds.length > 0) {
          await tx
            .update(postsPublished)
            .set({
              pollCount: sql`${postsPublished.pollCount} + 1`,
              lastSeenAt: now,
              nextPollAt: null,
              retired: true,
            })
            .where(inArray(postsPublished.tweetId, foundIds));
        }
        if (unserved.length > 0) {
          await tx
            .update(postsPublished)
            .set({ retired: true, lastSeenAt: now })
            .where(inArray(postsPublished.tweetId, unserved));
        }
      });
      result.retired += ids.length;
      if (unserved.length > 0) {
        console.log(`dailyMetrics: retired ${unserved.length} unreadable tweet(s)`);
      }

      // Snapshots insert autonomously after the retire commit — a failed insert
      // is a metrics gap for that tweet, never a re-read.
      for (const tweet of found) {
        try {
          await db.insert(metricsSnapshots).values({
            tweetId: tweet.id,
            publicMetrics: tweet.public_metrics ?? null,
            nonPublicMetrics: tweet.non_public_metrics ?? null,
            organicMetrics: tweet.organic_metrics ?? null,
          });
          result.snapshotted++;
        } catch (err) {
          console.error(`dailyMetrics: snapshot insert failed ${tweet.id}: ${describe(err)}`);
        }
      }
    }
  }
}

/**
 * Milliseconds from `now` until the next `hourUtc`:00:00.000 UTC. If it's
 * already exactly that instant, rolls to the following day. Pure — unit-tested
 * in src/test.test.ts.
 */
export function msUntilNextUtcHour(now: Date, hourUtc: number): number {
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc, 0, 0, 0),
  );
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

export function startDailyMetrics(opts: DailyMetricsOptions): () => void {
  const deps: DailyMetricsDeps = {
    selfXUserId: opts.selfXUserId,
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
  };
  const hourUtc = opts.hourUtc ?? DEFAULT_HOUR_UTC;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let stopped = false;

  const safeRun = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await runDailyMetrics(deps);
    } catch (err) {
      console.error('dailyMetrics: run crashed:', describe(err));
    } finally {
      running = false;
    }
  };

  // Re-arm a setTimeout to the next fire time each run, rather than a fixed 24h
  // setInterval — self-correcting against timer drift and any clock changes.
  const arm = (): void => {
    if (stopped) return;
    const delay = msUntilNextUtcHour(new Date(), hourUtc);
    console.log(
      `dailyMetrics: next run in ${Math.round(delay / 60_000)} min ` +
        `(~${String(hourUtc).padStart(2, '0')}:00 UTC)`,
    );
    timer = setTimeout(() => {
      void safeRun().finally(arm);
    }, delay);
  };

  // Catch-up on boot: snapshot rows that came due while the process was down and
  // discover manual tweets since the checkpoint. Idempotent — retired rows are
  // never re-snapshotted and since_id keeps discovery cheap, so frequent
  // restarts don't multiply cost.
  void safeRun();
  arm();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
