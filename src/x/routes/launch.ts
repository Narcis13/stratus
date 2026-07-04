// Launch Room ingestion (CIRCLES-PLAN C7): the first 30 minutes after a
// scheduled post fires, the extension streams the early repliers it sees in
// the DOM ($0 — no X API read). Each one is prime CRM material: they engaged
// first. We upsert the person and log an inbound timeline event so
// launch-window engagers accumulate stage from the very first exchange.
//
// Idempotency trick: the event id is `their_mention:mentions:<tweetId>` — the
// SAME id the daily mention pull's hook (mentions.ts::logMentionPeople) will
// use when it later ingests this reply as a mention row, so the two paths
// INSERT OR IGNORE into one id space and the reply never double-logs. (Edge:
// a nested reply-to-my-reply would be classified their_reply_to_me by the
// pull and get a second event under that type — rare, and both are inbound,
// so the stage math barely moves.)
//
// Deliberately NOT touched: the `mentions` table. pullMentions checkpoints on
// the max stored tweet_id, so inserting a DOM-scraped id here would advance
// the since_id cursor past mentions the API hasn't returned yet — silently
// losing inbox entries to save one $0.001 read. People + events only.

import { Hono } from 'hono';
import {
  type PersonEventInput,
  logPersonEvents,
  normalizePersonHandle,
  snippet,
  upsertPerson,
} from '../people/store.ts';

export const MAX_LAUNCH_REPLIES_PER_BATCH = 50;

const TWEET_ID_RE = /^\d{1,25}$/;

export interface LaunchReplyInput {
  tweetId: string;
  handle: string;
  author: string | null;
  text: string;
  postedAt: Date | null;
}

export const launch = new Hono();

launch.post('/launch/replies', async (c) => {
  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const body = raw as Record<string, unknown>;

  if (!Array.isArray(body.replies) || body.replies.length === 0) {
    return c.json({ error: 'invalid_replies' }, 400);
  }
  if (body.replies.length > MAX_LAUNCH_REPLIES_PER_BATCH) {
    return c.json({ error: 'too_many_replies', max: MAX_LAUNCH_REPLIES_PER_BATCH }, 400);
  }

  const inputs: LaunchReplyInput[] = [];
  let skipped = 0;
  for (let i = 0; i < body.replies.length; i++) {
    const r = body.replies[i];
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      return c.json({ error: `invalid_reply_${i}` }, 400);
    }
    const row = r as Record<string, unknown>;
    if (typeof row.tweetId !== 'string' || !TWEET_ID_RE.test(row.tweetId)) {
      return c.json({ error: `invalid_reply_tweet_id_${i}` }, 400);
    }
    if (typeof row.text !== 'string') {
      return c.json({ error: `invalid_reply_text_${i}` }, 400);
    }
    const handle = normalizePersonHandle(row.handle);
    if (!handle) {
      // A malformed handle is a scrape artifact, not a client bug — skip the
      // row instead of failing the batch the other 19 rows rode in on.
      skipped++;
      continue;
    }
    const postedAt =
      typeof row.postedAt === 'string' && !Number.isNaN(Date.parse(row.postedAt))
        ? new Date(row.postedAt)
        : null;
    inputs.push({
      tweetId: row.tweetId,
      handle,
      author: typeof row.author === 'string' && row.author.trim() ? row.author.trim() : null,
      text: row.text,
      postedAt,
    });
  }

  // Dedupe by tweetId within a batch (re-renders repeat rows): first wins,
  // a later dupe only backfills a missing author.
  const byTweetId = new Map<string, LaunchReplyInput>();
  for (const r of inputs) {
    const prev = byTweetId.get(r.tweetId);
    if (!prev) byTweetId.set(r.tweetId, r);
    else if (prev.author === null && r.author !== null) prev.author = r.author;
  }

  const now = new Date();
  const events: PersonEventInput[] = [];
  for (const r of byTweetId.values()) {
    await upsertPerson(r.handle, {
      source: 'launch',
      fields: { displayName: r.author },
      now: r.postedAt ?? now,
    });
    events.push({
      handle: r.handle,
      type: 'their_mention',
      refTable: 'mentions',
      refId: r.tweetId,
      summary: `replied to my post: "${snippet(r.text)}"`,
      at: r.postedAt ?? now,
    });
  }
  await logPersonEvents(events, { source: 'launch', now });

  return c.json({ received: body.replies.length, processed: byTweetId.size, skipped });
});
