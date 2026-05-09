// Daily pass over the authenticated user's recent tweets to discover anything
// not yet in `posts_published` — most commonly tweets posted manually from the
// X app, but also catches publisher-shipped rows whose txn rolled back after X
// committed (the PLAN's accepted "no idempotency draft-row" trade-off).
//
// Cost: $0.001/tweet (owned read). With `since_id` checkpointed to the newest
// tweet we've seen, steady-state daily passes typically read 0–5 tweets. The
// first run / `fullScan` does up to `maxResults` (default 500) at $0.001 each.

import { sql } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { postsPublished } from '../db/schema.ts';
import { getUserTweets } from '../endpoints.ts';
import { getValidAccessToken } from '../token-store.ts';

export interface OwnReconcileDeps {
  selfXUserId: string;
  clientId: string;
  clientSecret: string;
}

export interface OwnReconcileOptions extends OwnReconcileDeps {
  intervalMs?: number;
  /** Max tweets per pass. Default 500 — the cap from PLAN.md. */
  maxResults?: number;
}

export interface ReconcileRunOptions {
  /** Ignore the latest-seen-id checkpoint and rescan from the top. */
  fullScan?: boolean;
  /** Max tweets to fetch this pass. Default 500. */
  maxResults?: number;
}

export interface ReconcileResult {
  scanned: number;
  inserted: number;
}

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_RESULTS = 500;

export async function runOwnReconcile(
  deps: OwnReconcileDeps,
  runOpts: ReconcileRunOptions = {},
): Promise<ReconcileResult> {
  const result: ReconcileResult = { scanned: 0, inserted: 0 };

  const token = await getValidAccessToken({
    clientId: deps.clientId,
    clientSecret: deps.clientSecret,
  });

  let sinceId: string | undefined;
  if (!runOpts.fullScan) {
    // tweet_id is a snowflake — cast to bigint so length-mismatched legacy ids
    // (if any ever appear) sort numerically rather than lexicographically.
    const [latest] = await db
      .select({ tweetId: postsPublished.tweetId })
      .from(postsPublished)
      .orderBy(sql`${postsPublished.tweetId}::bigint desc`)
      .limit(1);
    sinceId = latest?.tweetId;
  }

  const maxResults = runOpts.maxResults ?? DEFAULT_MAX_RESULTS;
  const now = new Date();

  for await (const tweet of getUserTweets(token, deps.selfXUserId, {
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
        nextPollAt: now,
      })
      .onConflictDoNothing()
      .returning({ tweetId: postsPublished.tweetId });

    if (inserted.length > 0) result.inserted++;
  }

  if (result.scanned > 0) {
    console.log(
      `ownReconcile: scanned=${result.scanned} inserted=${result.inserted}` +
        (sinceId ? ` sinceId=${sinceId}` : ' (full scan)'),
    );
  }
  return result;
}

export function startOwnReconcile(opts: OwnReconcileOptions): () => void {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const deps: OwnReconcileDeps = {
    selfXUserId: opts.selfXUserId,
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
  };
  const runOpts: ReconcileRunOptions =
    opts.maxResults !== undefined ? { maxResults: opts.maxResults } : {};
  let running = false;

  const safeTick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await runOwnReconcile(deps, runOpts);
    } catch (err) {
      console.error('ownReconcile: tick crashed:', describe(err));
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
