// $0 helpers over the local `mentions` table.
//
// The billed side of this file is GONE: `pullMentions` (incremental
// `GET /2/users/:id/mentions`, $0.001/result) was deleted 2026-08-12 along with
// the daily pass and `POST /x/mentions/refresh`, when the service dropped every
// billed X read and kept only `createPost` (CLAUDE.md invariant #8). Nothing in
// here can reach xFetch. The `mentions` rows that exist are historical; the
// inbox no longer refills itself.

import { isNotNull, sql } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { mentions, postsPublished } from './db/schema.ts';

// $0 answered backfill: a mention is answered the moment one of my published
// replies targets it. posts_published now carries only replies the publisher
// itself sent (discovery of hand-typed ones died with the daily pass), so this
// clears less of the inbox than it used to — still free, still worth running.
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
