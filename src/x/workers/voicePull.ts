// Per-author refresh of `voice_tweets`. Mirrors `ownReconcile` but for tracked
// authors instead of self: paginates the author's last `max_tweets_per_pull`
// tweets (replies included), upserts into `voice_tweets`, and queues only the
// latest `max_polled_tweets` for `voiceMetricsPoll` so per-author polling cost
// stays bounded.
//
// Cost: $0.005/tweet (other-user reads). With `since_id` checkpointed to the
// newest tweet we've seen for this author, steady-state hourly passes typically
// read 0–N new tweets; the first pull reads up to `max_tweets_per_pull`.
//
// `runVoicePull` is the unit of work used by both:
//   - the hourly `startVoicePull` interval (walks all `pull_enabled` authors)
//   - the manual `POST /x/voice/pull/:username` route
//
// Polling enrolment: tweets are sorted newest-first, then the first
// `max_polled_tweets` get `next_poll_at = now` (so `voiceMetricsPoll` picks
// them up on its next tick); the rest land flat with `next_poll_at = null`.
// Existing rows keep their schedule — we only set `next_poll_at` on insert.

import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { trackedAuthors, voiceTweets } from '../db/schema.ts';
import { getUserTweets } from '../endpoints.ts';
import { getValidAccessToken } from '../token-store.ts';

export interface VoicePullDeps {
  clientId: string;
  clientSecret: string;
}

export interface VoicePullRunOptions {
  /** Ignore the latest-seen-id checkpoint and rescan from the top. */
  fullScan?: boolean;
  /** Override the author's `max_tweets_per_pull`. */
  maxResults?: number;
}

export interface VoicePullResult {
  authorXUserId: string;
  username: string;
  scanned: number;
  inserted: number;
  queuedForPolling: number;
}

export async function runVoicePull(
  deps: VoicePullDeps,
  authorXUserId: string,
  runOpts: VoicePullRunOptions = {},
): Promise<VoicePullResult> {
  const [author] = await db
    .select()
    .from(trackedAuthors)
    .where(eq(trackedAuthors.xUserId, authorXUserId));
  if (!author) throw new Error(`voicePull: author not tracked: ${authorXUserId}`);

  const result: VoicePullResult = {
    authorXUserId: author.xUserId,
    username: author.username,
    scanned: 0,
    inserted: 0,
    queuedForPolling: 0,
  };

  const token = await getValidAccessToken({
    clientId: deps.clientId,
    clientSecret: deps.clientSecret,
  });

  let sinceId: string | undefined;
  if (!runOpts.fullScan) {
    // Snowflake ids — bigint sort, not lex.
    const [latest] = await db
      .select({ tweetId: voiceTweets.tweetId })
      .from(voiceTweets)
      .where(eq(voiceTweets.authorXUserId, author.xUserId))
      .orderBy(sql`${voiceTweets.tweetId}::bigint desc`)
      .limit(1);
    sinceId = latest?.tweetId;
  }

  const maxResults = runOpts.maxResults ?? author.maxTweetsPerPull;
  const now = new Date();

  // Buffer first so we can sort newest-first before deciding which get polled.
  const tweets: Array<{
    id: string;
    text: string;
    createdAt: Date;
    isReply: boolean;
    inReplyToTweetId: string | null;
    conversationId: string | null;
  }> = [];
  for await (const tw of getUserTweets(token, author.xUserId, {
    maxResults,
    ...(sinceId ? { sinceId } : {}),
  })) {
    const repliedTo = tw.referenced_tweets?.find((r) => r.type === 'replied_to');
    tweets.push({
      id: tw.id,
      text: tw.text,
      createdAt: tw.created_at ? new Date(tw.created_at) : now,
      isReply: tw.in_reply_to_user_id != null,
      inReplyToTweetId: repliedTo?.id ?? null,
      conversationId: tw.conversation_id ?? null,
    });
  }
  result.scanned = tweets.length;

  // Newest-first so the polling-enrolment slice picks the freshest tweets.
  tweets.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const pollLimit = author.metricsPollingEnabled ? author.maxPolledTweets : 0;

  for (let i = 0; i < tweets.length; i++) {
    const tw = tweets[i];
    if (!tw) continue;
    const shouldPoll = i < pollLimit;

    // Two-step: insert-or-noop to detect freshness, then a touch-update on
    // conflict. Avoids onConflictDoUpdate-with-equal-timestamps detection which
    // is fragile across driver precision quirks. Also ensures we never disturb
    // an existing row's polling cadence or retired flag.
    const inserted = await db
      .insert(voiceTweets)
      .values({
        tweetId: tw.id,
        authorXUserId: author.xUserId,
        text: tw.text,
        createdAt: tw.createdAt,
        isReply: tw.isReply,
        inReplyToTweetId: tw.inReplyToTweetId,
        conversationId: tw.conversationId,
        source: 'tracked_pull',
        fetchedAt: now,
        lastSeenAt: now,
        nextPollAt: shouldPoll ? now : null,
      })
      .onConflictDoNothing()
      .returning({ tweetId: voiceTweets.tweetId });

    if (inserted.length > 0) {
      result.inserted++;
      if (shouldPoll) result.queuedForPolling++;
    } else {
      await db.update(voiceTweets).set({ lastSeenAt: now }).where(eq(voiceTweets.tweetId, tw.id));
    }
  }

  await db
    .update(trackedAuthors)
    .set({ lastPulledAt: now })
    .where(eq(trackedAuthors.xUserId, author.xUserId));

  if (result.scanned > 0) {
    const tail = sinceId ? ` sinceId=${sinceId}` : ' (full scan)';
    console.log(
      `voicePull: @${author.username} scanned=${result.scanned} inserted=${result.inserted} queued=${result.queuedForPolling}${tail}`,
    );
  }
  return result;
}

// Re-exported so the route layer can disable polling on existing rows when
// the user untracks an author (stop the metrics worker from spending on them).
export async function retireAuthorVoiceTweets(authorXUserId: string): Promise<number> {
  const updated = await db
    .update(voiceTweets)
    .set({ retired: true, nextPollAt: null })
    .where(and(eq(voiceTweets.authorXUserId, authorXUserId), eq(voiceTweets.retired, false)))
    .returning({ tweetId: voiceTweets.tweetId });
  return updated.length;
}

// ------------------------------------------------------- hourly tick

export interface VoicePullTickResult {
  authors: number;
  scanned: number;
  inserted: number;
  queuedForPolling: number;
  failed: number;
}

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;

/**
 * One pass over every `pull_enabled` author, least-recently-pulled first so
 * authors rotate fairly even if the tick gets interrupted. Per-author errors
 * are isolated — one suspended account or 401 doesn't stall the rest.
 */
export async function tickVoicePull(deps: VoicePullDeps): Promise<VoicePullTickResult> {
  const result: VoicePullTickResult = {
    authors: 0,
    scanned: 0,
    inserted: 0,
    queuedForPolling: 0,
    failed: 0,
  };

  const authors = await db
    .select({ xUserId: trackedAuthors.xUserId, username: trackedAuthors.username })
    .from(trackedAuthors)
    .where(eq(trackedAuthors.pullEnabled, true))
    // never-pulled (NULL) goes first, then oldest-pulled — fair rotation under
    // longer ticks or interrupted runs.
    .orderBy(sql`${trackedAuthors.lastPulledAt} asc nulls first`);

  for (const author of authors) {
    result.authors++;
    try {
      const r = await runVoicePull(deps, author.xUserId);
      result.scanned += r.scanned;
      result.inserted += r.inserted;
      result.queuedForPolling += r.queuedForPolling;
    } catch (err) {
      result.failed++;
      console.error(`voicePull: @${author.username} failed:`, describe(err));
    }
  }

  if (result.authors > 0) {
    console.log(
      `voicePull tick: authors=${result.authors} scanned=${result.scanned} inserted=${result.inserted} queued=${result.queuedForPolling} failed=${result.failed}`,
    );
  }
  return result;
}

export interface VoicePullOptions extends VoicePullDeps {
  intervalMs?: number;
}

export function startVoicePull(opts: VoicePullOptions): () => void {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const deps: VoicePullDeps = { clientId: opts.clientId, clientSecret: opts.clientSecret };
  let running = false;

  const safeTick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await tickVoicePull(deps);
    } catch (err) {
      console.error('voicePull: tick crashed:', describe(err));
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
