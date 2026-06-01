import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const tokens = pgTable('tokens', {
  id: text('id').primaryKey(),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  scope: text('scope'),
  xUserId: text('x_user_id'),
  xUsername: text('x_username'),
  connectedAt: timestamp('connected_at', { withTimezone: true }),
  lastRefreshAt: timestamp('last_refresh_at', { withTimezone: true }),
});

export const scheduledPosts = pgTable(
  'scheduled_posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    text: text('text').notNull(),
    mediaIds: text('media_ids').array(),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
    status: text('status').notNull(),
    postedTweetId: text('posted_tweet_id'),
    errorClass: text('error_class'),
    errorDetail: text('error_detail'),
    source: text('source').notNull().default('api'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('scheduled_posts_status_scheduled_idx').on(t.status, t.scheduledFor)],
);

export const postsPublished = pgTable(
  'posts_published',
  {
    tweetId: text('tweet_id').primaryKey(),
    scheduledPostId: uuid('scheduled_post_id').references(() => scheduledPosts.id),
    text: text('text').notNull(),
    postedAt: timestamp('posted_at', { withTimezone: true }).notNull(),
    isReply: boolean('is_reply').default(false).notNull(),
    inReplyToTweetId: text('in_reply_to_tweet_id'),
    conversationId: text('conversation_id'),
    source: text('source').notNull(),
    nextPollAt: timestamp('next_poll_at', { withTimezone: true }),
    pollCount: integer('poll_count').default(0).notNull(),
    retired: boolean('retired').default(false).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  },
  (t) => [index('posts_published_next_poll_idx').on(t.nextPollAt).where(sql`retired = false`)],
);

export const metricsSnapshots = pgTable(
  'metrics_snapshots',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    tweetId: text('tweet_id')
      .notNull()
      .references(() => postsPublished.tweetId),
    snapshotAt: timestamp('snapshot_at', { withTimezone: true }).defaultNow().notNull(),
    publicMetrics: jsonb('public_metrics'),
    nonPublicMetrics: jsonb('non_public_metrics'),
    organicMetrics: jsonb('organic_metrics'),
  },
  (t) => [index('metrics_snapshots_tweet_snapshot_idx').on(t.tweetId, t.snapshotAt.desc())],
);

// Swipe file of other people's tweets, kept for style/format reference. Pure
// DOM-scrape capture from the extension — no X API, no metrics polling. Authors
// are identified by their lowercased @handle (the only stable id we can scrape
// without the API); the numeric x_user_id is stored opportunistically.
export const voiceAuthors = pgTable('voice_authors', {
  handle: text('handle').primaryKey(),
  xUserId: text('x_user_id'),
  displayName: text('display_name'),
  bio: text('bio'),
  followersCount: integer('followers_count'),
  followingCount: integer('following_count'),
  pinnedTweetId: text('pinned_tweet_id'),
  pinnedTweetText: text('pinned_tweet_text'),
  profileSummary: text('profile_summary'),
  profileUrl: text('profile_url'),
  source: text('source').notNull().default('extension_scrape'),
  addedAt: timestamp('added_at', { withTimezone: true }).defaultNow().notNull(),
  // Set when the full profile header was scraped via the "Save author" button;
  // null means we've only seen this author from a tweet's hover card.
  enrichedAt: timestamp('enriched_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  retired: boolean('retired').default(false).notNull(),
});

export const voiceTweets = pgTable(
  'voice_tweets',
  {
    tweetId: text('tweet_id').primaryKey(),
    authorHandle: text('author_handle')
      .notNull()
      .references(() => voiceAuthors.handle),
    text: text('text').notNull(),
    // innerHTML of X's [data-testid="tweetText"] — emoji <img>, line breaks and
    // links exactly as rendered, so a saved tweet can be reused as a format template.
    scrapedHtml: text('scraped_html'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    url: text('url'),
    source: text('source').notNull().default('extension_scrape'),
    savedAt: timestamp('saved_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
    retired: boolean('retired').default(false).notNull(),
  },
  (t) => [index('voice_tweets_author_created_idx').on(t.authorHandle, t.createdAt.desc())],
);

export const replyDrafts = pgTable(
  'reply_drafts',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    sourceTweetId: text('source_tweet_id').notNull(),
    sourceAuthorUsername: text('source_author_username').notNull(),
    sourceAuthorDisplayName: text('source_author_display_name'),
    sourceText: text('source_text').notNull(),
    sourceUrl: text('source_url').notNull(),
    sourcePostedAt: timestamp('source_posted_at', { withTimezone: true }),

    contextSnapshot: jsonb('context_snapshot').notNull(),

    replyText: text('reply_text').notNull(),
    replyTextEdited: text('reply_text_edited'),

    model: text('model').notNull(),
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),
    costUsd: text('cost_usd'),
    grokRequestId: text('grok_request_id'),

    systemPromptOverride: text('system_prompt_override'),

    status: text('status').notNull().default('generated'),
    postedTweetId: text('posted_tweet_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('reply_drafts_source_created_idx').on(t.sourceTweetId, t.createdAt.desc()),
    index('reply_drafts_status_created_idx').on(t.status, t.createdAt.desc()),
  ],
);
