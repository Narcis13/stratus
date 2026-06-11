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
    // Threads (§8.2): segments share a thread_id; thread_position is 1-based.
    // Only position 1 carries scheduled_for/status 'pending' — the publisher
    // chains the rest as self-replies and drives their status itself.
    threadId: uuid('thread_id'),
    threadPosition: integer('thread_position'),
    // Content pillar declared by the drafter (§8.4) — feeds /x/metrics/pillars.
    pillar: text('pillar'),
    // Self-quote re-up (§8.5): when set, the publisher posts this row as a
    // quote tweet — only after verifying the quoted id is own via posts_published.
    quoteTweetId: text('quote_tweet_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('scheduled_posts_status_scheduled_idx').on(t.status, t.scheduledFor),
    index('scheduled_posts_thread_idx').on(t.threadId, t.threadPosition),
  ],
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
    // Minutes between postedAt and this snapshot (§8.4). The daily pass reads
    // tweets at anywhere from 3 to 27 hours old, so raw view counts aren't
    // comparable across tweets without this. Null on pre-8.4 rows.
    ageAtSnapshotMin: integer('age_at_snapshot_min'),
  },
  (t) => [index('metrics_snapshots_tweet_snapshot_idx').on(t.tweetId, t.snapshotAt.desc())],
);

// One row per UTC day from the dailyMetrics pass — the follower-growth KPI
// series. Counts come free on the same $0.001 getMe() owned read.
export const accountSnapshots = pgTable('account_snapshots', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  snapshotAt: timestamp('snapshot_at', { withTimezone: true }).defaultNow().notNull(),
  followersCount: integer('followers_count').notNull(),
  followingCount: integer('following_count').notNull(),
  tweetCount: integer('tweet_count').notNull(),
  listedCount: integer('listed_count').notNull(),
});

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

// Append-only follower-count series, one row per profile enrich (§7.4). The
// profile scrape used to overwrite followers_count in place; keeping every
// capture makes author momentum (followers/day) computable for the target
// roster. Still $0 — rows only exist when the user clicks "Save author".
export const voiceAuthorSnapshots = pgTable(
  'voice_author_snapshots',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    handle: text('handle')
      .notNull()
      .references(() => voiceAuthors.handle),
    followersCount: integer('followers_count').notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('voice_author_snapshots_handle_captured_idx').on(t.handle, t.capturedAt.desc())],
);

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
    // Template extraction (§8.3) — one Grok structured-output pass per tweet
    // distills the *structure* (never the content) for the Remix workflow.
    hookType: text('hook_type'),
    skeleton: text('skeleton'),
    lineBreakPattern: text('line_break_pattern'),
    templateLength: text('template_length'),
    device: text('device'),
    templateExtractedAt: timestamp('template_extracted_at', { withTimezone: true }),
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
    // All variants from the structured two-variant call ({text, angle}[]);
    // replyText holds the primary pick. Null on pre-7.1 rows.
    variants: jsonb('variants'),
    // The optional human steer sent with the generate call (often Romanian).
    idea: text('idea'),
    // Content pillar (§8.4) — reply drafts rarely declare one today; the
    // column exists so /x/metrics/pillars can aggregate both surfaces.
    pillar: text('pillar'),

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

// Mention inbox (§7.5): mentions of me, pulled incrementally (since_id = max
// stored tweet_id) by the daily pass and the on-demand refresh — owned reads,
// $0.001/result. `status` drives the panel's Inbox: rows arrive 'unanswered';
// the answered backfill flips them when one of my published replies targets
// them, or the user marks them by hand. Replying stays manual paste — see
// routes/mentions.ts for the Feb 2026 carve-out note.
export const mentions = pgTable(
  'mentions',
  {
    tweetId: text('tweet_id').primaryKey(),
    authorId: text('author_id'),
    authorUsername: text('author_username'),
    authorName: text('author_name'),
    text: text('text').notNull(),
    postedAt: timestamp('posted_at', { withTimezone: true }).notNull(),
    conversationId: text('conversation_id'),
    inReplyToTweetId: text('in_reply_to_tweet_id'),
    status: text('status').notNull().default('unanswered'), // unanswered | answered | dismissed
    answeredDraftId: uuid('answered_draft_id').references(() => replyDrafts.id),
    answeredAt: timestamp('answered_at', { withTimezone: true }),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('mentions_status_posted_idx').on(t.status, t.postedAt.desc())],
);

// $0 ingestion of the extension's DOM harvester (OVERHAUL-PLAN §6.3). One run
// per harvest click; repeated harvests of the same tweet intentionally create
// new rows — the (tweet_id, captured_at) series is the longitudinal view/
// bookmark curve the once-only API snapshot can't provide.
export const harvestRuns = pgTable('harvest_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  handle: text('handle').notNull(),
  mode: text('mode').notNull(), // 'posts' | 'replies'
  scope: text('scope').notNull(), // 'all' | 'today' | 'yesterday'
  rowCount: integer('row_count').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const harvestRows = pgTable(
  'harvest_rows',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => harvestRuns.id),
    tweetId: text('tweet_id').notNull(),
    handle: text('handle').notNull(),
    mode: text('mode').notNull(),
    text: text('text').notNull(),
    comments: integer('comments').default(0).notNull(),
    reposts: integer('reposts').default(0).notNull(),
    likes: integer('likes').default(0).notNull(),
    bookmarks: integer('bookmarks').default(0).notNull(),
    views: integer('views').default(0).notNull(),
    tweetTime: timestamp('tweet_time', { withTimezone: true }),
    capturedAt: timestamp('captured_at', { withTimezone: true }).defaultNow().notNull(),
    // Replies mode only: the tweet replied to, as paired by the harvester.
    // Capture-time metrics of the target feed the BAND calibration crosstab.
    origTweetId: text('orig_tweet_id'),
    origHandle: text('orig_handle'),
    origText: text('orig_text'),
    origTime: timestamp('orig_time', { withTimezone: true }),
    origComments: integer('orig_comments'),
    origLikes: integer('orig_likes'),
    origViews: integer('orig_views'),
    // Reconcile result against reply_drafts (replies mode only) — the second,
    // API-free outcome source for posted reply drafts.
    matchedDraftId: uuid('matched_draft_id').references(() => replyDrafts.id),
    // Content-shape columns (§9.4) so "which formats earn views" is answerable.
    // Nullable: older extension builds don't send them.
    hasPhoto: boolean('has_photo'),
    hasVideo: boolean('has_video'),
    isQuote: boolean('is_quote'),
    textLen: integer('text_len'),
    lineBreaks: integer('line_breaks'),
    // Replies mode: 1-based position of this reply inside its rendered group —
    // position 1 is the reply directly under the harvested target; deeper
    // positions mark self-threads/chains the items[k-1] pairing used to mislabel.
    groupPosition: integer('group_position'),
  },
  (t) => [
    index('harvest_rows_tweet_captured_idx').on(t.tweetId, t.capturedAt.desc()),
    index('harvest_rows_run_idx').on(t.runId),
  ],
);
