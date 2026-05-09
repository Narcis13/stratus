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
  (t) => [
    index('posts_published_next_poll_idx').on(t.nextPollAt).where(sql`retired = false`),
  ],
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

export const trackedAuthors = pgTable('tracked_authors', {
  xUserId: text('x_user_id').primaryKey(),
  username: text('username').notNull(),
  addedAt: timestamp('added_at', { withTimezone: true }).defaultNow().notNull(),
  lastPulledAt: timestamp('last_pulled_at', { withTimezone: true }),
  source: text('source').notNull().default('manual'),
  pullEnabled: boolean('pull_enabled').default(true).notNull(),
  maxTweetsPerPull: integer('max_tweets_per_pull').default(50).notNull(),
  metricsPollingEnabled: boolean('metrics_polling_enabled').default(true).notNull(),
  maxPolledTweets: integer('max_polled_tweets').default(20).notNull(),
});

export const voiceTweets = pgTable(
  'voice_tweets',
  {
    tweetId: text('tweet_id').primaryKey(),
    authorXUserId: text('author_x_user_id')
      .notNull()
      .references(() => trackedAuthors.xUserId),
    text: text('text').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    isReply: boolean('is_reply').default(false).notNull(),
    inReplyToTweetId: text('in_reply_to_tweet_id'),
    conversationId: text('conversation_id'),
    source: text('source').notNull(),
    scrapedHtml: text('scraped_html'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    nextPollAt: timestamp('next_poll_at', { withTimezone: true }),
    pollCount: integer('poll_count').default(0).notNull(),
    retired: boolean('retired').default(false).notNull(),
  },
  (t) => [
    index('voice_tweets_author_created_idx').on(t.authorXUserId, t.createdAt.desc()),
    index('voice_tweets_next_poll_idx').on(t.nextPollAt).where(sql`retired = false`),
  ],
);

export const voiceMetricsSnapshots = pgTable(
  'voice_metrics_snapshots',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    tweetId: text('tweet_id')
      .notNull()
      .references(() => voiceTweets.tweetId),
    snapshotAt: timestamp('snapshot_at', { withTimezone: true }).defaultNow().notNull(),
    publicMetrics: jsonb('public_metrics'),
  },
  (t) => [index('voice_metrics_snapshots_tweet_snapshot_idx').on(t.tweetId, t.snapshotAt.desc())],
);
