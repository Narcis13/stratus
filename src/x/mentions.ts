// Mention inbox pull (§7.5): incremental `GET /2/users/:id/mentions` into the
// `mentions` table — owned reads at $0.001/result, the cheapest high-leverage
// read on the platform (replying fast to people who reply to you is the 75x
// chain). Shared by the daily 03:00 UTC pass and POST /x/mentions/refresh.
//
// Cost shape vs invariant #7: there is no retire step here — the inserted rows
// ARE the checkpoint (since_id = newest stored mention id). A crash between
// the billed read and the inserts re-bills at most one pull's worth next time,
// capped by maxResults (default 50 ≈ $0.05 worst case) — bounded, daily-
// cadence, nothing like the 60s-loop failure mode the invariant guards.

import { isNotNull, sql } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { mentions, postsPublished } from './db/schema.ts';
import { getUserMentions } from './endpoints.ts';

export const DEFAULT_PULL_MAX = 50;

export interface PullMentionsResult {
  /** Mentions returned by the X pull. */
  scanned: number;
  /** New `mentions` rows inserted (re-pulls upsert-skip, never reset status). */
  inserted: number;
  /** Mentions authored by me (own thread replies) — skipped, never stored. */
  selfSkipped: number;
  /** Unanswered rows flipped to answered by the published-reply backfill. */
  answered: number;
}

export async function pullMentions(
  token: string,
  selfXUserId: string,
  opts: { maxResults?: number } = {},
): Promise<PullMentionsResult> {
  const result: PullMentionsResult = { scanned: 0, inserted: 0, selfSkipped: 0, answered: 0 };

  // tweet_id is a snowflake — cast to bigint so ids sort numerically.
  const [latest] = await db
    .select({ tweetId: mentions.tweetId })
    .from(mentions)
    .orderBy(sql`${mentions.tweetId}::bigint desc`)
    .limit(1);
  const sinceId = latest?.tweetId;

  const now = new Date();
  for await (const m of getUserMentions(token, selfXUserId, {
    maxResults: opts.maxResults ?? DEFAULT_PULL_MAX,
    ...(sinceId ? { sinceId } : {}),
  })) {
    result.scanned++;
    if (m.author_id === selfXUserId) {
      result.selfSkipped++;
      continue;
    }
    const repliedTo = m.referenced_tweets?.find((r) => r.type === 'replied_to');
    const inserted = await db
      .insert(mentions)
      .values({
        tweetId: m.id,
        authorId: m.author_id ?? null,
        authorUsername: m.authorUsername ?? null,
        authorName: m.authorName ?? null,
        text: m.text,
        postedAt: m.created_at ? new Date(m.created_at) : now,
        conversationId: m.conversation_id ?? null,
        inReplyToTweetId: repliedTo?.id ?? null,
      })
      .onConflictDoNothing()
      .returning({ tweetId: mentions.tweetId });
    if (inserted.length > 0) result.inserted++;
  }

  result.answered = await backfillAnswered();
  return result;
}

// $0 answered backfill: a mention is answered the moment one of my published
// replies targets it. posts_published carries every reply I make — pasted from
// a draft or typed in the X app (daily discovery finds those) — so the inbox
// clears itself without the user bookkeeping each reply.
export async function backfillAnswered(): Promise<number> {
  const flipped = await db
    .update(mentions)
    .set({ status: 'answered', answeredAt: new Date() })
    .where(
      sql`${mentions.status} = 'unanswered' and ${mentions.tweetId} in (
        select ${postsPublished.inReplyToTweetId} from ${postsPublished}
        where ${isNotNull(postsPublished.inReplyToTweetId)}
      )`,
    )
    .returning({ tweetId: mentions.tweetId });
  return flipped.length;
}
