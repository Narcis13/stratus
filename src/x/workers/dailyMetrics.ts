// Single daily pass (03:00 UTC) that replaces the old 60s `metricsPoll` + 24h
// `ownReconcile` workers. One run does two things:
//
//   A. Discover — incremental own-timeline pull (since_id checkpoint) to catch
//      tweets posted manually from the X app. Scheduler-posted tweets are
//      already in posts_published via the publisher, so steady-state discovery
//      reads only the handful of new manual tweets. New rows seed
//      nextPollAt = postedAt + 24h.
//   B. Snapshot — read every *due* row (retired=false AND nextPollAt<=now) by
//      batched id lookup (`GET /2/tweets?ids=`, ≤100 ids/call), write ONE
//      metrics_snapshots row each, then retire. "Single day-after snapshot":
//      each tweet is measured once, ~24h after posting — the day-after number,
//      not the intraday curve.
//
// Why this shape (and not the old two workers): the 60s poller logged a steady
// stream of X reads independent of any user action, which polluted cost_events
// and — via a pricing gap — misreported them. One scheduled pass keeps reads in
// a predictable daily window. Cost is owned reads at $0.001/result: discovery
// reads only new tweets; the snapshot batch reads exactly the due set, so there
// are no wasted reads and a missed daily run simply leaves due rows for the
// next run to pick up (no time-window guesswork).

import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
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

export async function runDailyMetrics(
  deps: DailyMetricsDeps,
  runOpts: RunOptions = {},
): Promise<RunResult> {
  const result: RunResult = { scanned: 0, discovered: 0, snapshotted: 0, retired: 0, failed: 0 };

  const token = await getValidAccessToken({
    clientId: deps.clientId,
    clientSecret: deps.clientSecret,
  });

  // Discover first so any tweet already past 24h when found is due immediately
  // and gets snapshotted in the same run's snapshot pass.
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

  // Discovery doesn't request the private metric fields: new tweets are <24h
  // old and won't be snapshotted yet — the snapshot pass does the authoritative
  // owned-private read once they cross 24h.
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
  // Pull the whole due set up front. A snapshot retires the row, so there's no
  // re-pick risk within the run — single process, single daily pass, no need
  // for FOR UPDATE SKIP LOCKED here.
  const due = await db
    .select({ tweetId: postsPublished.tweetId })
    .from(postsPublished)
    .where(and(eq(postsPublished.retired, false), lte(postsPublished.nextPollAt, new Date())))
    .orderBy(asc(postsPublished.nextPollAt));

  for (let i = 0; i < due.length; i += SNAPSHOT_BATCH) {
    const ids = due.slice(i, i + SNAPSHOT_BATCH).map((r) => r.tweetId);

    let found: Awaited<ReturnType<typeof getTweetsByIds>>['found'];
    let missing: string[];
    try {
      ({ found, missing } = await getTweetsByIds(token, ids, { ownedPrivate: true }));
    } catch (err) {
      // Transient (network/5xx/429) — leave these rows due; next run retries.
      result.failed++;
      console.error(`dailyMetrics: snapshot batch failed: ${describe(err)}`);
      continue;
    }

    const now = new Date();
    for (const tweet of found) {
      await db.insert(metricsSnapshots).values({
        tweetId: tweet.id,
        publicMetrics: tweet.public_metrics ?? null,
        nonPublicMetrics: tweet.non_public_metrics ?? null,
        organicMetrics: tweet.organic_metrics ?? null,
      });
      await db
        .update(postsPublished)
        .set({
          pollCount: sql`${postsPublished.pollCount} + 1`,
          lastSeenAt: now,
          nextPollAt: null,
          retired: true,
        })
        .where(eq(postsPublished.tweetId, tweet.id));
      result.snapshotted++;
      result.retired++;
    }

    // Ids X didn't return (deleted, suspended author) — retire without a
    // snapshot so we stop trying to read them.
    if (missing.length > 0) {
      await db
        .update(postsPublished)
        .set({ retired: true, lastSeenAt: now })
        .where(inArray(postsPublished.tweetId, missing));
      result.retired += missing.length;
      console.log(`dailyMetrics: retired ${missing.length} unreadable tweet(s)`);
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
