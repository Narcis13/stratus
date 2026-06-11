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

import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { beat } from '../../heartbeats.ts';
import { accountSnapshots, metricsSnapshots, postsPublished } from '../db/schema.ts';
import { getMe, getTweetsByIds, getUserTweets } from '../endpoints.ts';
import { pullMentions } from '../mentions.ts';
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
  /** Whether this run wrote the daily account_snapshots row (false = already
   *  written today, or the getMe read failed). */
  accountSnapshotted: boolean;
  /** Mentions returned by the inbox pull (§7.5). */
  mentionsScanned: number;
  /** New `mentions` rows this run. */
  mentionsNew: number;
  /** Mentions auto-flipped to answered by the published-reply backfill. */
  mentionsAnswered: number;
  /** Day-7 winner re-reads this run (§8.4, capped at 5/day). */
  rereadWinners: number;
}

export const DAILY_METRICS_HEARTBEAT = 'x.dailyMetrics';

const DEFAULT_MAX_RESULTS = 500;
const SNAPSHOT_BATCH = 100; // GET /2/tweets?ids= accepts ≤100 ids
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_HOUR_UTC = 3;
// Bounded winner re-read (§8.4): tweets whose first snapshot cleared this view
// count get ONE extra read at day 7+ — which content compounds is worth
// exactly ≤ 5 × $0.001/day, no more.
const WINNER_REREAD_MIN_VIEWS = Number(process.env.WINNER_REREAD_MIN_VIEWS ?? '500');
const WINNER_REREAD_CAP = 5;
const WINNER_REREAD_MIN_AGE_MS = 7 * DAY_MS;
// X nulls non_public/organic on owned posts after 30 days and can return them
// unstorable past that. Now that we snapshot regardless of age, only request the
// private fields for tweets still inside the window (2-day margin). This is the
// only thing age still affects — it does not gate *whether* a tweet is read.
const PRIVATE_FIELDS_MAX_AGE_MS = 28 * DAY_MS;

export async function runDailyMetrics(
  deps: DailyMetricsDeps,
  runOpts: RunOptions = {},
): Promise<RunResult> {
  const result: RunResult = {
    scanned: 0,
    discovered: 0,
    snapshotted: 0,
    retired: 0,
    failed: 0,
    accountSnapshotted: false,
    mentionsScanned: 0,
    mentionsNew: 0,
    mentionsAnswered: 0,
    rereadWinners: 0,
  };

  const token = await getValidAccessToken({
    clientId: deps.clientId,
    clientSecret: deps.clientSecret,
  });

  // Account KPI first so a timeline-pull failure can't cost us the day's
  // followers_count data point.
  await snapshotAccount(token, result);

  // Discover before the snapshot pass so any tweet found this run is in the
  // table before snapshotDue reads every non-retired row regardless of age.
  await discover(token, deps.selfXUserId, runOpts, result);
  await snapshotDue(token, result);
  await rereadWinners(token, result);

  // Mention inbox pull (§7.5) — after discover so the answered backfill sees
  // replies I made from the X app that discovery just found. A failed pull is
  // a stale inbox until tomorrow (or a manual refresh), never a crashed run.
  try {
    const pulled = await pullMentions(token, deps.selfXUserId);
    result.mentionsScanned = pulled.scanned;
    result.mentionsNew = pulled.inserted;
    result.mentionsAnswered = pulled.answered;
  } catch (err) {
    console.error(`dailyMetrics: mentions pull failed: ${describe(err)}`);
  }

  console.log(
    `dailyMetrics: scanned=${result.scanned} discovered=${result.discovered} ` +
      `snapshotted=${result.snapshotted} retired=${result.retired} failed=${result.failed} ` +
      `account=${result.accountSnapshotted} mentions=${result.mentionsNew}/${result.mentionsScanned} ` +
      `mentionsAnswered=${result.mentionsAnswered} rereadWinners=${result.rereadWinners}`,
  );
  return result;
}

// One getMe() per UTC day ($0.001) for the follower-growth series. The
// same-UTC-day guard keeps the boot catch-up run (fires on every restart and
// deploy) from writing extra rows or spending extra reads — exactly one
// account_snapshots row per day, normally stamped at the 03:00 UTC pass.
async function snapshotAccount(token: string, result: RunResult): Promise<void> {
  const utcDayStart = new Date();
  utcDayStart.setUTCHours(0, 0, 0, 0);
  const [existing] = await db
    .select({ id: accountSnapshots.id })
    .from(accountSnapshots)
    .where(gte(accountSnapshots.snapshotAt, utcDayStart))
    .limit(1);
  if (existing) return;

  try {
    const me = await getMe(token);
    const pm = me.public_metrics;
    if (!pm) {
      console.error('dailyMetrics: getMe returned no public_metrics — account snapshot skipped');
      return;
    }
    await db.insert(accountSnapshots).values({
      followersCount: pm.followers_count,
      followingCount: pm.following_count,
      tweetCount: pm.tweet_count,
      listedCount: pm.listed_count,
    });
    result.accountSnapshotted = true;
  } catch (err) {
    // Next boot catch-up or tomorrow's pass retries; one missed day is a gap
    // in the series, never a crash of the whole metrics run.
    console.error(`dailyMetrics: account snapshot failed: ${describe(err)}`);
  }
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
  const postedAtById = new Map(rows.map((r) => [r.tweetId, r.postedAt]));

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
            ageAtSnapshotMin: ageMinutes(postedAtById.get(tweet.id), now),
          });
          result.snapshotted++;
        } catch (err) {
          console.error(`dailyMetrics: snapshot insert failed ${tweet.id}: ${describe(err)}`);
        }
      }
    }
  }
}

// Minutes between postedAt and the snapshot (§8.4) — what makes view counts
// comparable across tweets the daily pass read at different ages.
function ageMinutes(postedAt: Date | undefined, at: Date): number | null {
  if (!postedAt) return null;
  return Math.max(0, Math.round((at.getTime() - postedAt.getTime()) / 60_000));
}

// Bounded winner re-read (§8.4): tweets whose one-and-only snapshot cleared
// WINNER_REREAD_MIN_VIEWS get exactly one more read at day 7+ — the
// "which content compounds" series. Same money discipline as snapshotDue, but
// claim-BEFORE-read: candidates require poll_count = 1, so bumping the count
// in a committed txn before the billed call removes them from the candidate
// set forever. A crash between claim and read loses one re-read (≤ $0.005),
// never repeats one.
async function rereadWinners(token: string, result: RunResult): Promise<void> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - WINNER_REREAD_MIN_AGE_MS);

  let candidates: Array<{ tweetId: string; postedAt: Date }>;
  try {
    candidates = await db
      .select({ tweetId: postsPublished.tweetId, postedAt: postsPublished.postedAt })
      .from(postsPublished)
      .innerJoin(metricsSnapshots, eq(metricsSnapshots.tweetId, postsPublished.tweetId))
      .where(
        and(
          eq(postsPublished.retired, true),
          eq(postsPublished.pollCount, 1),
          lte(postsPublished.postedAt, cutoff),
          // Stay inside the 30-day private-fields window; a candidate older
          // than that missed its re-read on purpose (bounded by design).
          gte(postsPublished.postedAt, new Date(now.getTime() - PRIVATE_FIELDS_MAX_AGE_MS)),
          sql`(${metricsSnapshots.publicMetrics}->>'impression_count')::int >= ${WINNER_REREAD_MIN_VIEWS}`,
        ),
      )
      .orderBy(sql`(${metricsSnapshots.publicMetrics}->>'impression_count')::int desc`)
      .limit(WINNER_REREAD_CAP);
  } catch (err) {
    console.error(`dailyMetrics: winner re-read candidate query failed: ${describe(err)}`);
    return;
  }
  if (candidates.length === 0) return;

  // Claim before the billed call: poll_count 1 → 2 drops them out of the
  // candidate predicate permanently.
  const ids = candidates.map((c) => c.tweetId);
  await db
    .update(postsPublished)
    .set({ pollCount: 2, lastSeenAt: now })
    .where(inArray(postsPublished.tweetId, ids));

  let found: Awaited<ReturnType<typeof getTweetsByIds>>['found'];
  try {
    ({ found } = await getTweetsByIds(token, ids, { ownedPrivate: true }));
  } catch (err) {
    console.error(`dailyMetrics: winner re-read failed: ${describe(err)}`);
    return;
  }

  const postedAtById = new Map(candidates.map((c) => [c.tweetId, c.postedAt]));
  for (const tweet of found) {
    try {
      await db.insert(metricsSnapshots).values({
        tweetId: tweet.id,
        publicMetrics: tweet.public_metrics ?? null,
        nonPublicMetrics: tweet.non_public_metrics ?? null,
        organicMetrics: tweet.organic_metrics ?? null,
        ageAtSnapshotMin: ageMinutes(postedAtById.get(tweet.id), now),
      });
      result.rereadWinners++;
    } catch (err) {
      console.error(`dailyMetrics: winner re-read insert failed ${tweet.id}: ${describe(err)}`);
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

export function startDailyMetrics(opts: DailyMetricsOptions): () => Promise<void> {
  const deps: DailyMetricsDeps = {
    selfXUserId: opts.selfXUserId,
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
  };
  const hourUtc = opts.hourUtc ?? DEFAULT_HOUR_UTC;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let current: Promise<void> | null = null;
  let stopped = false;

  const safeRun = async (): Promise<void> => {
    try {
      await runDailyMetrics(deps);
    } catch (err) {
      console.error('dailyMetrics: run crashed:', describe(err));
    } finally {
      beat(DAILY_METRICS_HEARTBEAT);
      current = null;
    }
  };

  const runOnce = (): Promise<void> => {
    if (!current) current = safeRun();
    return current;
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
      void runOnce().finally(arm);
    }, delay);
  };

  // Catch-up on boot: snapshot rows that came due while the process was down and
  // discover manual tweets since the checkpoint. Idempotent — retired rows are
  // never re-snapshotted and since_id keeps discovery cheap, so frequent
  // restarts don't multiply cost.
  void runOnce();
  arm();

  // Stop = clear the timer AND drain the in-flight run, so a deploy restart
  // can't kill the process between a billed batch read and its retire commit.
  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    await (current ?? Promise.resolve());
  };
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
