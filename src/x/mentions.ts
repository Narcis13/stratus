// Mention inbox pull (§7.5): incremental `GET /2/users/:id/mentions` into the
// `mentions` table — owned reads at $0.001/result, the cheapest high-leverage
// read on the platform (replying fast to people who reply to you is the 75x
// chain). Shared by the daily 03:00 UTC pass and POST /x/mentions/refresh.
//
// Cost shape vs invariant #7: there is no retire step here — the inserted rows
// ARE the checkpoint (since_id = newest stored mention id). A crash between
// the billed read and the inserts re-bills at most one pull's worth next time
// — bounded by the since_id floor and X's 800 hard cap (realistically one
// day's inbound ≈ $0.05–0.09), daily-cadence, nothing like the 60s-loop
// failure mode the invariant guards.

import { isNotNull, sql } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { mentions, postsPublished } from './db/schema.ts';
import { getUserMentions } from './endpoints.ts';
import {
  type PersonEventInput,
  myReplyTweetIds,
  normalizePersonHandle,
  safeLogPersonEvents,
  snippet,
  upsertPerson,
} from './people/store.ts';

export const DEFAULT_PULL_MAX = 50;
// X's hard pagination cap for /users/:id/mentions — the ceiling an incremental
// pull pages to (CA.1). Bounded: since_id already floors the walk, so only
// mentions that actually exist above the checkpoint are ever billed.
export const MENTIONS_HARD_CAP = 800;

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
  opts: { maxResults?: number; pullMax?: number } = {},
): Promise<PullMentionsResult> {
  const result: PullMentionsResult = { scanned: 0, inserted: 0, selfSkipped: 0, answered: 0 };

  // tweet_id is a snowflake — cast to bigint so ids sort numerically.
  const [latest] = await db
    .select({ tweetId: mentions.tweetId })
    .from(mentions)
    .orderBy(sql`CAST(${mentions.tweetId} AS INTEGER) desc`)
    .limit(1);
  const sinceId = latest?.tweetId;

  const now = new Date();
  // People layer (C1): every new mention becomes a person + inbound event.
  const newcomers: Array<{
    handle: string;
    authorId: string | null;
    authorName: string | null;
    tweetId: string;
    text: string;
    postedAt: Date;
    inReplyToTweetId: string | null;
  }> = [];

  // UI.5: `pullMax` is the CONFIGURED page size (x.mentions.pullMax) and must
  // stay a separate opt from `maxResults` — the latter is the caller-intent flag
  // that switches maxTotal off the 800 hard cap below. Passing the knob as
  // maxResults would silently re-cap every incremental pull at one page, which
  // is exactly the bug CA.1 fixed (50 mentions/day dropped in prod).
  const pageMax = opts.maxResults ?? opts.pullMax ?? DEFAULT_PULL_MAX;
  // CA.1: an incremental pull (live since_id) pages to X's 800 hard cap so a
  // >50-mention day never strands its tail below the next pull's checkpoint —
  // before this, prod dropped every mention past 50 permanently on busy days.
  // A caller-supplied maxResults stays a TOTAL cap (caller intent, invariant
  // #5), and a cold pull (no checkpoint) keeps the bounded default so the
  // first pull ever never walks the full 800-mention history.
  const maxTotal = opts.maxResults !== undefined || !sinceId ? pageMax : MENTIONS_HARD_CAP;

  for await (const m of getUserMentions(token, selfXUserId, {
    maxResults: pageMax,
    maxTotal,
    ...(sinceId ? { sinceId } : {}),
  })) {
    result.scanned++;
    if (m.author_id === selfXUserId) {
      result.selfSkipped++;
      continue;
    }
    const repliedTo = m.referenced_tweets?.find((r) => r.type === 'replied_to');
    const postedAt = m.created_at ? new Date(m.created_at) : now;
    const inserted = await db
      .insert(mentions)
      .values({
        tweetId: m.id,
        authorId: m.author_id ?? null,
        authorUsername: m.authorUsername ?? null,
        authorName: m.authorName ?? null,
        text: m.text,
        postedAt,
        conversationId: m.conversation_id ?? null,
        inReplyToTweetId: repliedTo?.id ?? null,
      })
      .onConflictDoNothing()
      .returning({ tweetId: mentions.tweetId });
    if (inserted.length > 0) {
      result.inserted++;
      const handle = normalizePersonHandle(m.authorUsername);
      if (handle) {
        newcomers.push({
          handle,
          authorId: m.author_id ?? null,
          authorName: m.authorName ?? null,
          tweetId: m.id,
          text: m.text,
          postedAt,
          inReplyToTweetId: repliedTo?.id ?? null,
        });
      }
    }
  }

  await logMentionPeople(newcomers);

  result.answered = await backfillAnswered();
  return result;
}

// C1 hook: person bookkeeping for freshly inserted mentions. A mention that
// replies to one of MY replies is their_reply_to_me — the 75x chain moment —
// otherwise a plain their_mention. Best-effort: a failure here never fails
// (or re-bills) the pull.
async function logMentionPeople(
  rows: Array<{
    handle: string;
    authorId: string | null;
    authorName: string | null;
    tweetId: string;
    text: string;
    postedAt: Date;
    inReplyToTweetId: string | null;
  }>,
): Promise<void> {
  if (rows.length === 0) return;
  try {
    const chainIds = await myReplyTweetIds(
      rows.flatMap((r) => (r.inReplyToTweetId ? [r.inReplyToTweetId] : [])),
    );
    const events: PersonEventInput[] = [];
    for (const r of rows) {
      await upsertPerson(r.handle, {
        source: 'mention',
        fields: { xUserId: r.authorId, displayName: r.authorName },
      });
      const chain = r.inReplyToTweetId !== null && chainIds.has(r.inReplyToTweetId);
      events.push({
        handle: r.handle,
        type: chain ? 'their_reply_to_me' : 'their_mention',
        refTable: 'mentions',
        refId: r.tweetId,
        summary: `${chain ? 'replied to my reply' : 'mentioned me'}: "${snippet(r.text)}"`,
        at: r.postedAt,
      });
    }
    await safeLogPersonEvents(events, { source: 'mention' });
  } catch (err) {
    console.error('people: mention hook failed:', err instanceof Error ? err.message : err);
  }
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
