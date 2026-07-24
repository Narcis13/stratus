// Single daily pass (03:00 UTC) that replaces the old 60s `metricsPoll` + 24h
// `ownReconcile` workers. One run does two things:
//
//   A. Discover — incremental own-timeline pull (since_id checkpoint) to catch
//      tweets posted manually from the X app. Scheduler-posted tweets are
//      already in posts_published via the publisher, so steady-state discovery
//      reads only the handful of new manual tweets. The since_id checkpoint is
//      discovery's OWN high-water mark (persisted in app_settings), NOT
//      max(posts_published.id):
//      the publisher inserts scheduled posts in real time with high snowflake
//      ids, so deriving since_id from the table max could park it ABOVE a manual
//      tweet posted earlier the same day — permanently hiding it (that gap lost
//      a 1.7M-impression post once). Keying off discovery's own high-water means
//      the publisher's live inserts never advance the checkpoint.
//
//      THE PULL *IS* THE SNAPSHOT. The timeline pull already bills $0.001 per
//      tweet it returns, and it can carry the private metric fields (X prices
//      fields at zero — only results are billed). So discovery requests
//      `ownedPrivate` and writes the metrics_snapshots row + retires the row in
//      the same transaction. Before this, discovery pulled cheap fields and the
//      snapshot pass immediately re-read the very same ids minutes later — every
//      own tweet was billed TWICE per day. At ~90 tweets/day that second read
//      was ~$0.09/day of pure duplication (audit, 2026-07-23).
//   B. Snapshot — the leftovers only: non-retired rows the pull did NOT cover
//      (anything below the checkpoint — a publisher insert the pull missed, or a
//      batch a previous run failed on). Batched id lookup (`GET /2/tweets?ids=`,
//      ≤100 ids/call), one metrics_snapshots row each, then retire. In steady
//      state this reads NOTHING and costs $0; it stays as the correctness
//      backstop, not the main path.
//
// ONCE AND ONLY ONCE, on both paths. In B the batch is retired in one committed
// txn the instant the read returns, BEFORE any snapshot insert — so a retired
// row is never selected again and we never pay to read a tweet twice, even
// across a crash. The trade-off is at-most-once snapshots: a crash between the
// retire commit and the inserts loses that batch's snapshots (a metrics gap),
// never a double charge. In A the retire and the snapshot are the SAME txn (the
// read is already paid for by then, so there is nothing to protect but repeat
// writes) and the whole step is keyed off the existing row — see
// ingestPulledTweet. Re-pulling a retired tweet is a no-op.
//
// Why this shape (and not the old two workers): the 60s poller logged a steady
// stream of X reads independent of any user action, which polluted cost_events
// and — via a pricing gap — misreported them. One scheduled pass keeps reads in
// a predictable daily window at owned-read prices ($0.001/result), and a missed
// run simply leaves rows for the next pass (still read exactly once each).

import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { appSettings } from '../../db/shared-schema.ts';
import { beat } from '../../heartbeats.ts';
import {
  accountSnapshots,
  metricsSnapshots,
  postsPublished,
  scheduledPosts,
} from '../db/schema.ts';
import type { XTweet } from '../endpoints.ts';
import { getMe, getTweetsByIds, getUserTweets } from '../endpoints.ts';
import { pullMentions } from '../mentions.ts';
import { matchManualRows } from '../posts/manualReconcile.ts';
import { getSetting } from '../settings/registry.ts';
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
  /** UI.4 winner re-read bounds. Omitted → read from the settings store at the
   *  start of the run (`x.workers.winnerRereadMinViews` / `…Cap`), so a change
   *  lands on the next daily pass without a restart. Explicit values are for
   *  tests and one-off manual runs. */
  winnerRereadMinViews?: number;
  winnerRereadCap?: number;
}

export interface RunResult {
  /** Tweets returned by the discovery timeline pull. */
  scanned: number;
  /** New posts_published rows inserted by discovery. */
  discovered: number;
  /** metrics_snapshots rows written this run (pull + leftover snapshot pass). */
  snapshotted: number;
  /** Of `snapshotted`, the rows written straight from the discovery pull — i.e.
   *  reads the old two-phase design would have paid for a second time. In steady
   *  state this equals `snapshotted` and the snapshot pass buys nothing. */
  pullSnapshotted: number;
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
  /** Manual scheduled rows linked to their pasted tweet this run (A3.6). $0 —
   *  pure SQL over already-billed rows. */
  manualLinked: number;
}

export const DAILY_METRICS_HEARTBEAT = 'x.dailyMetrics';

const DEFAULT_MAX_RESULTS = 500;
const SNAPSHOT_BATCH = 100; // GET /2/tweets?ids= accepts ≤100 ids
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_HOUR_UTC = 3;
// Bounded winner re-read (§8.4): tweets whose first snapshot cleared a view
// floor get ONE extra read at day 7+ — which content compounds is worth exactly
// ≤ cap × $0.001/day, no more. UI.4: the floor and the cap are settings
// (`x.workers.winnerRereadMinViews` / `…Cap`, the floor defaulting from
// WINNER_REREAD_MIN_VIEWS), read at the start of each run. The 7-day age is not
// a knob — it's what makes the series comparable across posts.
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
    pullSnapshotted: 0,
    retired: 0,
    failed: 0,
    accountSnapshotted: false,
    mentionsScanned: 0,
    mentionsNew: 0,
    mentionsAnswered: 0,
    rereadWinners: 0,
    manualLinked: 0,
  };

  const token = await getValidAccessToken({
    clientId: deps.clientId,
    clientSecret: deps.clientSecret,
  });

  // Account KPI first so a timeline-pull failure can't cost us the day's
  // followers_count data point.
  await snapshotAccount(token, result);

  // Discover first: it now snapshots and retires everything its pull returns, so
  // running it before snapshotDue is what keeps those rows OUT of the leftover
  // read. Reversing this order would restore the old double-billing.
  // A discovery failure must not take the rest of the run with it. It used to:
  // an uncaught throw here skipped the snapshot pass, the winner re-read AND the
  // mention pull. Now the run degrades to exactly the old two-phase shape —
  // whatever discovery already ingested stays un-retired and snapshotDue reads
  // it — instead of losing the whole day. A 4xx isn't billed, so the fallback
  // costs nothing beyond the reads it was always going to make.
  try {
    await discover(token, deps.selfXUserId, runOpts, result);
  } catch (err) {
    console.error(`dailyMetrics: discovery failed: ${describe(err)}`);
  }

  // Link manually-pasted tweets back to their calendar rows now that discovery
  // has ingested them (A3.6). $0 — pure SQL over rows the pull already paid for.
  // A reconcile failure must never take the run down (the pullMentions
  // discipline below): a missed link is retried on the next pass at no cost.
  try {
    await reconcileManualPosts(result);
  } catch (err) {
    console.error(`dailyMetrics: manual reconcile failed: ${describe(err)}`);
  }

  await snapshotDue(token, result);
  await rereadWinners(token, result, {
    minViews: runOpts.winnerRereadMinViews ?? getSetting<number>('x.workers.winnerRereadMinViews'),
    cap: runOpts.winnerRereadCap ?? getSetting<number>('x.workers.winnerRereadCap'),
  });

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
      `snapshotted=${result.snapshotted} (fromPull=${result.pullSnapshotted}) ` +
      `retired=${result.retired} failed=${result.failed} ` +
      `account=${result.accountSnapshotted} mentions=${result.mentionsNew}/${result.mentionsScanned} ` +
      `mentionsAnswered=${result.mentionsAnswered} rereadWinners=${result.rereadWinners} ` +
      `manualLinked=${result.manualLinked}`,
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
      // S0.9: rides free on the same read. null when nothing is pinned.
      pinnedTweetId: me.pinned_tweet_id ?? null,
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
  const stored = await loadDiscoveryCheckpoint();
  let sinceId: string | undefined;
  if (!runOpts.fullScan) {
    // Discovery's own high-water mark. On first run (no stored checkpoint) seed
    // it from the current table max — matching the old behavior for that one
    // run — but from then on the checkpoint advances ONLY here, never from the
    // publisher's live inserts (see the header note on the since_id gap).
    sinceId = stored ?? (await currentTableMaxId());
  }

  const maxResults = runOpts.maxResults ?? DEFAULT_MAX_RESULTS;
  const now = new Date();
  // Track the newest id we actually pulled, so the persisted checkpoint is the
  // timeline's high-water at THIS pass — not whatever the publisher inserted.
  let maxSeen = sinceId;

  // The pull carries the private metric fields so it doubles as the snapshot
  // read (see header A). fullScan is the one exception: it deliberately walks
  // back over old tweets, and X nulls (and can refuse to store) private fields
  // past 30 days — that path keeps the cheap pull and leaves the age-split
  // reads to snapshotDue, exactly as before.
  const ownedPrivate = !runOpts.fullScan;

  for await (const tweet of getUserTweets(token, selfXUserId, {
    maxResults,
    ...(sinceId ? { sinceId } : {}),
    ...(ownedPrivate ? { ownedPrivate: true } : {}),
  })) {
    result.scanned++;
    maxSeen = maxTweetId(maxSeen, tweet.id);

    if (!ownedPrivate) {
      // fullScan: seed the row only and let snapshotDue do the age-split read.
      // A tweet rediscovered this way may well be inside the 30-day window, and
      // one $0.001 read with the private fields beats a permanent snapshot that
      // is missing them.
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
          hasMedia: (tweet.attachments?.media_keys?.length ?? 0) > 0,
          nextPollAt: new Date(postedAt.getTime() + DAY_MS),
        })
        .onConflictDoNothing()
        .returning({ tweetId: postsPublished.tweetId });
      if (inserted.length > 0) result.discovered++;
      continue;
    }

    const outcome = ingestPulledTweet(tweet, now);

    if (outcome === 'already-retired') continue;
    if (outcome === 'discovered') result.discovered++;
    result.pullSnapshotted++;
    result.snapshotted++;
    result.retired++;
  }

  // Persist the high-water. maxTweetId against `stored` guarantees the checkpoint
  // never regresses (e.g. a fullScan that returns only older tweets), and an
  // empty pull re-persists the same value so bootstrap freezes the checkpoint
  // below any tweet posted after this pass.
  const next = maxTweetId(stored, maxSeen);
  if (next) await saveDiscoveryCheckpoint(next);
}

/** What `ingestPulledTweet` did with one tweet from the discovery pull. */
export type PullIngestOutcome = 'discovered' | 'snapshotted' | 'already-retired';

/**
 * Write one tweet from the discovery pull as row + snapshot + retirement, in ONE
 * sync txn. The read is ALREADY BILLED by the time we get here (invariant #7),
 * so the only thing left to protect is repeat *writes*: the txn keys off what's
 * already in the table, which makes the step idempotent. A crash before
 * `saveDiscoveryCheckpoint` re-pulls these tweets on the next run, and every
 * already-retired row then writes nothing and double-counts nothing.
 *
 * Three cases:
 *   - no row      → insert it retired, pollCount 1, plus its snapshot
 *                   ('discovered')
 *   - row, un-retired → a publisher-inserted scheduled post, or one a previous
 *                   run left due. The pull just paid for its metrics, so retire
 *                   it here and snapshot — otherwise snapshotDue buys the very
 *                   same read again ('snapshotted')
 *   - row, retired → nothing at all ('already-retired')
 *
 * Exported for the unit tests, which drive it against the in-memory DB (the
 * timeline pull itself is network and stays untested by convention).
 */
export function ingestPulledTweet(tweet: XTweet, now: Date): PullIngestOutcome {
  const repliedTo = tweet.referenced_tweets?.find((r) => r.type === 'replied_to');
  const postedAt = tweet.created_at ? new Date(tweet.created_at) : now;

  return db.transaction((tx): PullIngestOutcome => {
    const [existing] = tx
      .select({ retired: postsPublished.retired })
      .from(postsPublished)
      .where(eq(postsPublished.tweetId, tweet.id))
      .all();

    if (existing?.retired) return 'already-retired';

    if (existing) {
      tx.update(postsPublished)
        .set({
          pollCount: sql`${postsPublished.pollCount} + 1`,
          lastSeenAt: now,
          nextPollAt: null,
          retired: true,
        })
        .where(eq(postsPublished.tweetId, tweet.id))
        .run();
    } else {
      tx.insert(postsPublished)
        .values({
          tweetId: tweet.id,
          text: tweet.text,
          postedAt,
          isReply: tweet.in_reply_to_user_id != null,
          inReplyToTweetId: repliedTo?.id ?? null,
          conversationId: tweet.conversation_id ?? null,
          source: 'manual',
          // §S0.2: the discovery read requests `attachments` for free —
          // media_keys presence is the text-only-vs-media baseline. Absent on a
          // read tweet means no media (false), never unknown.
          hasMedia: (tweet.attachments?.media_keys?.length ?? 0) > 0,
          pollCount: 1,
          lastSeenAt: now,
          nextPollAt: null,
          retired: true,
        })
        .run();
    }

    tx.insert(metricsSnapshots)
      .values({
        tweetId: tweet.id,
        publicMetrics: tweet.public_metrics ?? null,
        nonPublicMetrics: tweet.non_public_metrics ?? null,
        organicMetrics: tweet.organic_metrics ?? null,
        ageAtSnapshotMin: ageMinutes(postedAt, now),
      })
      .run();

    return existing ? 'snapshotted' : 'discovered';
  });
}

const DISCOVERY_CHECKPOINT_KEY = 'x.discovery.since_id';

async function loadDiscoveryCheckpoint(): Promise<string | undefined> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, DISCOVERY_CHECKPOINT_KEY))
    .limit(1);
  const v = row?.value;
  return typeof v === 'string' && /^\d+$/.test(v) ? v : undefined;
}

async function saveDiscoveryCheckpoint(id: string): Promise<void> {
  const now = new Date();
  await db
    .insert(appSettings)
    .values({ key: DISCOVERY_CHECKPOINT_KEY, value: id, updatedAt: now })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: id, updatedAt: now } });
}

async function currentTableMaxId(): Promise<string | undefined> {
  // tweet_id is a snowflake — cast to integer so ids sort numerically.
  const [latest] = await db
    .select({ tweetId: postsPublished.tweetId })
    .from(postsPublished)
    .orderBy(sql`CAST(${postsPublished.tweetId} AS INTEGER) desc`)
    .limit(1);
  return latest?.tweetId;
}

/**
 * The larger of two numeric tweet-id strings (snowflakes exceed Number's safe
 * range — compare as BigInt). Either may be undefined. Pure — unit-tested in
 * src/test.test.ts.
 */
export function maxTweetId(a: string | undefined, b: string | undefined): string | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return BigInt(a) >= BigInt(b) ? a : b;
}

async function snapshotDue(token: string, result: RunResult): Promise<void> {
  // The LEFTOVERS only — discovery now snapshots and retires everything its pull
  // returns (header A), so in steady state this select comes back empty and the
  // whole function costs $0. What still lands here: rows below the discovery
  // checkpoint (a publisher insert the pull didn't cover) and batches an earlier
  // run failed on. Retired rows are never selected again, so each tweet is read
  // (and billed) once and only once. Oldest first so a backlog drains in posting
  // order across passes.
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
      db.transaction((tx) => {
        if (foundIds.length > 0) {
          tx.update(postsPublished)
            .set({
              pollCount: sql`${postsPublished.pollCount} + 1`,
              lastSeenAt: now,
              nextPollAt: null,
              retired: true,
            })
            .where(inArray(postsPublished.tweetId, foundIds))
            .run();
        }
        if (unserved.length > 0) {
          tx.update(postsPublished)
            .set({ retired: true, lastSeenAt: now })
            .where(inArray(postsPublished.tweetId, unserved))
            .run();
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
// `opts.minViews` get exactly one more read at day 7+, ≤ `opts.cap` a run — the
// "which content compounds" series. Same money discipline as snapshotDue, but
// claim-BEFORE-read: candidates require poll_count = 1, so bumping the count
// in a committed txn before the billed call removes them from the candidate
// set forever. A crash between claim and read loses one re-read (≤ $0.005),
// never repeats one.
async function rereadWinners(
  token: string,
  result: RunResult,
  opts: { minViews: number; cap: number },
): Promise<void> {
  // Cap 0 disables the re-read entirely — short-circuit BEFORE the candidate
  // query and its claim write, so "off" costs nothing and claims nothing (§7.3).
  if (opts.cap <= 0) return;

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
          // Originals only. A reply's snapshot now rides free on the discovery
          // pull, but its day-7 re-read would be a genuine extra billed call —
          // and "which content compounds" is a question about posts, not about
          // the ~90 replies/day the reply habit produces (audit, 2026-07-23).
          eq(postsPublished.isReply, false),
          lte(postsPublished.postedAt, cutoff),
          // Stay inside the 30-day private-fields window; a candidate older
          // than that missed its re-read on purpose (bounded by design).
          gte(postsPublished.postedAt, new Date(now.getTime() - PRIVATE_FIELDS_MAX_AGE_MS)),
          sql`CAST(json_extract(${metricsSnapshots.publicMetrics}, '$.impression_count') AS INTEGER) >= ${opts.minViews}`,
        ),
      )
      .orderBy(
        sql`CAST(json_extract(${metricsSnapshots.publicMetrics}, '$.impression_count') AS INTEGER) desc`,
      )
      .limit(opts.cap);
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

// Both sides are bounded to the last 30 days so the scan can't grow unbounded —
// a slot older than that which never reconciled is stale and stays unlinked.
const RECONCILE_LOOKBACK_MS = 30 * DAY_MS;

// Manual-post reconcile (A3.6): link hand-pasted tweets back to their calendar
// rows so they enter the metrics pipeline exactly like API posts. $0 — pure SQL
// over rows the discovery pull already billed; no X call anywhere. mark-posted
// deliberately writes NO tweet id (the since_id checkpoint trap, decision 6), so
// the link is made here by text + time — the harvest replies-reconcile
// discipline (routes/harvest.ts::matchUnlinkedDraft). This inserts nothing into
// posts_published: it only stamps scheduled_post_id on rows discovery already
// created, so the discovery checkpoint is untouched.
async function reconcileManualPosts(result: RunResult): Promise<void> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - RECONCILE_LOOKBACK_MS);

  // Scheduled rows still awaiting a link: manual (pasted, not yet flipped) or
  // already-posted-but-unlinked, with a slot time inside the window.
  const manualRows = await db
    .select({
      id: scheduledPosts.id,
      text: scheduledPosts.text,
      scheduledFor: scheduledPosts.scheduledFor,
      status: scheduledPosts.status,
    })
    .from(scheduledPosts)
    .where(
      and(
        inArray(scheduledPosts.status, ['manual', 'posted']),
        isNull(scheduledPosts.postedTweetId),
        isNotNull(scheduledPosts.scheduledFor),
        gte(scheduledPosts.scheduledFor, cutoff),
      ),
    );
  if (manualRows.length === 0) return;

  // Recent unlinked own originals — the pool the paste could have landed in.
  const publishedRows = await db
    .select({
      tweetId: postsPublished.tweetId,
      text: postsPublished.text,
      postedAt: postsPublished.postedAt,
      isReply: postsPublished.isReply,
      scheduledPostId: postsPublished.scheduledPostId,
    })
    .from(postsPublished)
    .where(
      and(
        eq(postsPublished.isReply, false),
        isNull(postsPublished.scheduledPostId),
        gte(postsPublished.postedAt, cutoff),
      ),
    );
  if (publishedRows.length === 0) return;

  // scheduled_for is non-null by the select above; narrow for the pure matcher.
  const manualInput = manualRows.flatMap((r) =>
    r.scheduledFor
      ? [{ id: r.id, text: r.text, scheduledFor: r.scheduledFor, status: r.status }]
      : [],
  );

  for (const link of matchManualRows(manualInput, publishedRows)) {
    // One sync txn per match (§7.13): stamp both sides atomically. status is set
    // to 'posted' — a manual row flips, an already-posted row stays posted (same
    // value). The row is never re-selected once posted_tweet_id is set.
    db.transaction((tx) => {
      tx.update(scheduledPosts)
        .set({ postedTweetId: link.tweetId, status: 'posted', updatedAt: now })
        .where(eq(scheduledPosts.id, link.scheduledPostId))
        .run();
      tx.update(postsPublished)
        .set({ scheduledPostId: link.scheduledPostId })
        .where(eq(postsPublished.tweetId, link.tweetId))
        .run();
    });
    result.manualLinked++;
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
