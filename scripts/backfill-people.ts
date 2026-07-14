// One-shot backfill for the people layer (CIRCLES-PLAN C1): seed `people` +
// `person_events` from every table that already knows about humans, then let
// the stage engine rank each relationship. Pure SQL over existing rows — $0,
// no X API, no Grok.
//
// IDEMPOTENT: event ids are deterministic (`type:ref_table:ref_id`, INSERT OR
// IGNORE) and person upserts are fill-only, so re-running after new activity
// just tops up. Run: bun run scripts/backfill-people.ts
//
// Sources:
//   voice_authors            → person (voice) + saved_author event
//   voice_tweets             → saved_tweet events on authorHandle
//   reply_drafts (posted)    → my_reply events on sourceAuthorUsername
//   mentions                 → their_mention / their_reply_to_me (chain when the
//                              mention replies to one of my published replies)
//   harvest_rows (replies)   → harvest_seen events on origHandle
//
// contextSnapshot.comments (C0 onward) are deliberately NOT ingested — the
// plan marks them optional "hover_sighting-grade" and commenters on someone
// else's post aren't interactions with me; C6's passive capture is the real
// path for ambient sightings.

import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { db } from '../src/db/client.ts';
import {
  harvestRows,
  mentions,
  people,
  replyDrafts,
  voiceAuthors,
  voiceTweets,
} from '../src/x/db/schema.ts';
import {
  type PersonEventInput,
  logPersonEvents,
  myReplyTweetIds,
  normalizePersonHandle,
  snippet,
  upsertPerson,
} from '../src/x/people/store.ts';

const counts = { people: 0, events: 0, skippedHandles: 0 };

async function log(events: PersonEventInput[], source: string): Promise<void> {
  if (events.length === 0) return;
  await logPersonEvents(events, { source });
  counts.events += events.length;
}

// ---------------------------------------------------------------- voice

const authors = await db.select().from(voiceAuthors);
for (const a of authors) {
  await upsertPerson(a.handle, {
    source: 'voice',
    fields: {
      xUserId: a.xUserId,
      displayName: a.displayName,
      bio: a.bio,
      followersCount: a.followersCount,
      followingCount: a.followingCount,
    },
  });
}
await log(
  authors.map((a) => ({
    handle: a.handle,
    type: 'saved_author' as const,
    refTable: 'voice_authors',
    refId: a.handle,
    summary: 'saved their profile to the voice library',
    at: a.enrichedAt ?? a.addedAt,
  })),
  'voice',
);
console.log(`voice_authors: ${authors.length} people`);

const tweets = await db
  .select({
    tweetId: voiceTweets.tweetId,
    authorHandle: voiceTweets.authorHandle,
    text: voiceTweets.text,
    savedAt: voiceTweets.savedAt,
  })
  .from(voiceTweets);
await log(
  tweets.map((t) => ({
    handle: t.authorHandle,
    type: 'saved_tweet' as const,
    refTable: 'voice_tweets',
    refId: t.tweetId,
    summary: `saved their tweet: "${snippet(t.text)}"`,
    at: t.savedAt,
  })),
  'voice',
);
console.log(`voice_tweets: ${tweets.length} saved_tweet events`);

// --------------------------------------------------------------- replies

const posted = await db
  .select({
    id: replyDrafts.id,
    sourceAuthorUsername: replyDrafts.sourceAuthorUsername,
    sourceAuthorDisplayName: replyDrafts.sourceAuthorDisplayName,
    sourceText: replyDrafts.sourceText,
    updatedAt: replyDrafts.updatedAt,
  })
  .from(replyDrafts)
  .where(eq(replyDrafts.status, 'posted'));

const replyEvents: PersonEventInput[] = [];
for (const d of posted) {
  const handle = normalizePersonHandle(d.sourceAuthorUsername);
  if (!handle) {
    counts.skippedHandles++;
    continue;
  }
  await upsertPerson(handle, {
    source: 'reply',
    fields: { displayName: d.sourceAuthorDisplayName },
  });
  replyEvents.push({
    handle,
    type: 'my_reply',
    refTable: 'reply_drafts',
    refId: d.id,
    summary: `replied to: "${snippet(d.sourceText)}"`,
    // updatedAt of the posted flip is in effect paste time (brief.ts reading).
    at: d.updatedAt,
  });
}
await log(replyEvents, 'reply');
console.log(`reply_drafts: ${replyEvents.length} my_reply events`);

// -------------------------------------------------------------- mentions

const mentionRows = await db.select().from(mentions).where(isNotNull(mentions.authorUsername));
const chainIds = await myReplyTweetIds(
  mentionRows.flatMap((m) => (m.inReplyToTweetId ? [m.inReplyToTweetId] : [])),
);
const mentionEvents: PersonEventInput[] = [];
for (const m of mentionRows) {
  const handle = normalizePersonHandle(m.authorUsername);
  if (!handle) {
    counts.skippedHandles++;
    continue;
  }
  await upsertPerson(handle, {
    source: 'mention',
    fields: { xUserId: m.authorId, displayName: m.authorName },
  });
  const chain = m.inReplyToTweetId !== null && chainIds.has(m.inReplyToTweetId);
  mentionEvents.push({
    handle,
    type: chain ? 'their_reply_to_me' : 'their_mention',
    refTable: 'mentions',
    refId: m.tweetId,
    summary: `${chain ? 'replied to my reply' : 'mentioned me'}: "${snippet(m.text)}"`,
    at: m.postedAt,
  });
}
await log(mentionEvents, 'mention');
console.log(`mentions: ${mentionEvents.length} inbound events (${chainIds.size} chain targets)`);

// --------------------------------------------------------------- harvest

const harvested = await db
  .select({
    id: harvestRows.id,
    origHandle: harvestRows.origHandle,
    origText: harvestRows.origText,
    capturedAt: harvestRows.capturedAt,
  })
  .from(harvestRows)
  .where(and(eq(harvestRows.mode, 'replies'), isNotNull(harvestRows.origHandle)));

const harvestEvents: PersonEventInput[] = [];
for (const r of harvested) {
  const handle = normalizePersonHandle(r.origHandle);
  if (!handle) {
    counts.skippedHandles++;
    continue;
  }
  harvestEvents.push({
    handle,
    type: 'harvest_seen',
    refTable: 'harvest_rows',
    refId: String(r.id),
    summary: r.origText
      ? `harvest saw my reply to their post: "${snippet(r.origText, 80)}"`
      : 'harvest saw my reply to them',
    at: r.capturedAt,
  });
}
await log(harvestEvents, 'harvest');
console.log(`harvest_rows: ${harvestEvents.length} harvest_seen events`);

// ---------------------------------------------------------------- report

const [total] = await db.select({ n: sql<number>`count(*)` }).from(people);
const stages = await db
  .select({ stage: people.stage, n: sql<number>`count(*)` })
  .from(people)
  .groupBy(people.stage);
console.log(`\npeople: ${total?.n ?? 0} rows`);
for (const s of stages) console.log(`  ${s.stage}: ${s.n}`);
if (counts.skippedHandles > 0) {
  console.log(`skipped ${counts.skippedHandles} rows with unparseable handles`);
}
console.log('backfill done (idempotent — safe to re-run)');
process.exit(0);
