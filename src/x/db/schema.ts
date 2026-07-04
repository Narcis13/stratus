import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Migrated from Postgres (Neon) to local SQLite (bun:sqlite). Type mapping:
//   timestamptz   -> integer({ mode: 'timestamp_ms' })  (epoch ms; app sees Date)
//   jsonb         -> text({ mode: 'json' })
//   text[]        -> text({ mode: 'json' }) holding string[]
//   boolean       -> integer({ mode: 'boolean' })
//   uuid (pk)     -> text().$defaultFn(crypto.randomUUID)
//   bigserial     -> integer().primaryKey({ autoIncrement: true })
//   numeric       -> real  (cost_events lives in shared-schema.ts)
// `.defaultNow()` becomes `.default(sql\`(unixepoch() * 1000)\`)`.

export const tokens = sqliteTable('tokens', {
  id: text('id').primaryKey(),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  scope: text('scope'),
  xUserId: text('x_user_id'),
  xUsername: text('x_username'),
  connectedAt: integer('connected_at', { mode: 'timestamp_ms' }),
  lastRefreshAt: integer('last_refresh_at', { mode: 'timestamp_ms' }),
});

// Editable content pillars (Authoring 2.0 follow-up). Seeded with the original
// three (ai-craft / builder-51 / unsexy-problems) but now first-class rows: the
// post drafter renders the active set into its prompt and builds the
// structured-output enum from these slugs, so an edit here changes how Grok
// drafts. `scheduled_posts.pillar` / `reply_drafts.pillar` reference the slug as
// plain text (no FK) — `aggregatePillars` groups by arbitrary string, so
// deleting/renaming a pillar never orphans historical metrics.
export const contentPillars = sqliteTable('content_pillars', {
  slug: text('slug').primaryKey(),
  label: text('label').notNull(),
  body: text('body').notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
  active: integer('active', { mode: 'boolean' }).default(true).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .default(sql`(unixepoch() * 1000)`)
    .notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .default(sql`(unixepoch() * 1000)`)
    .notNull(),
});

export const scheduledPosts = sqliteTable(
  'scheduled_posts',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    text: text('text').notNull(),
    mediaIds: text('media_ids', { mode: 'json' }).$type<string[]>(),
    scheduledFor: integer('scheduled_for', { mode: 'timestamp_ms' }),
    status: text('status').notNull(),
    postedTweetId: text('posted_tweet_id'),
    errorClass: text('error_class'),
    errorDetail: text('error_detail'),
    source: text('source').notNull().default('api'),
    // Threads (§8.2): segments share a thread_id; thread_position is 1-based.
    // Only position 1 carries scheduled_for/status 'pending' — the publisher
    // chains the rest as self-replies and drives their status itself.
    threadId: text('thread_id'),
    threadPosition: integer('thread_position'),
    // Content pillar declared by the drafter (§8.4) — feeds /x/metrics/pillars.
    pillar: text('pillar'),
    // Register declared by the drafter (C4: plain | spicy | reflective) — feeds
    // the Playbook's pillar × register scorecard. Null on hand-written posts.
    register: text('register'),
    // Self-quote re-up (§8.5): when set, the publisher posts this row as a
    // quote tweet — only after verifying the quoted id is own via posts_published.
    quoteTweetId: text('quote_tweet_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(unixepoch() * 1000)`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(unixepoch() * 1000)`)
      .notNull(),
  },
  (t) => [
    index('scheduled_posts_status_scheduled_idx').on(t.status, t.scheduledFor),
    index('scheduled_posts_thread_idx').on(t.threadId, t.threadPosition),
  ],
);

export const postsPublished = sqliteTable(
  'posts_published',
  {
    tweetId: text('tweet_id').primaryKey(),
    scheduledPostId: text('scheduled_post_id').references(() => scheduledPosts.id),
    text: text('text').notNull(),
    postedAt: integer('posted_at', { mode: 'timestamp_ms' }).notNull(),
    isReply: integer('is_reply', { mode: 'boolean' }).default(false).notNull(),
    inReplyToTweetId: text('in_reply_to_tweet_id'),
    conversationId: text('conversation_id'),
    source: text('source').notNull(),
    nextPollAt: integer('next_poll_at', { mode: 'timestamp_ms' }),
    pollCount: integer('poll_count').default(0).notNull(),
    retired: integer('retired', { mode: 'boolean' }).default(false).notNull(),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('posts_published_next_poll_idx').on(t.nextPollAt).where(sql`retired = 0`)],
);

export const metricsSnapshots = sqliteTable(
  'metrics_snapshots',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tweetId: text('tweet_id')
      .notNull()
      .references(() => postsPublished.tweetId),
    snapshotAt: integer('snapshot_at', { mode: 'timestamp_ms' })
      .default(sql`(unixepoch() * 1000)`)
      .notNull(),
    publicMetrics: text('public_metrics', { mode: 'json' }),
    nonPublicMetrics: text('non_public_metrics', { mode: 'json' }),
    organicMetrics: text('organic_metrics', { mode: 'json' }),
    // Minutes between postedAt and this snapshot (§8.4). The daily pass reads
    // tweets at anywhere from 3 to 27 hours old, so raw view counts aren't
    // comparable across tweets without this. Null on pre-8.4 rows.
    ageAtSnapshotMin: integer('age_at_snapshot_min'),
  },
  (t) => [index('metrics_snapshots_tweet_snapshot_idx').on(t.tweetId, t.snapshotAt)],
);

// Structure templates extracted from MY OWN published winners (CIRCLES-PLAN
// C4) — the §8.3 voiceExtract pipeline pointed at posts_published top rows.
// One-time Grok pass per tweet (~$0.005, bounded ≤20/call); feeds the
// Playbook's skeleton/hook effectiveness stat and topStructures() guidance.
export const postTemplates = sqliteTable('post_templates', {
  tweetId: text('tweet_id')
    .primaryKey()
    .references(() => postsPublished.tweetId),
  hookType: text('hook_type').notNull(),
  skeleton: text('skeleton').notNull(),
  lineBreakPattern: text('line_break_pattern').notNull(),
  templateLength: text('template_length').notNull(),
  device: text('device').notNull(),
  extractedAt: integer('extracted_at', { mode: 'timestamp_ms' })
    .default(sql`(unixepoch() * 1000)`)
    .notNull(),
});

// One row per UTC day from the dailyMetrics pass — the follower-growth KPI
// series. Counts come free on the same $0.001 getMe() owned read.
export const accountSnapshots = sqliteTable('account_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  snapshotAt: integer('snapshot_at', { mode: 'timestamp_ms' })
    .default(sql`(unixepoch() * 1000)`)
    .notNull(),
  followersCount: integer('followers_count').notNull(),
  followingCount: integer('following_count').notNull(),
  tweetCount: integer('tweet_count').notNull(),
  listedCount: integer('listed_count').notNull(),
});

// Swipe file of other people's tweets, kept for style/format reference. Pure
// DOM-scrape capture from the extension — no X API, no metrics polling. Authors
// are identified by their lowercased @handle (the only stable id we can scrape
// without the API); the numeric x_user_id is stored opportunistically.
export const voiceAuthors = sqliteTable('voice_authors', {
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
  addedAt: integer('added_at', { mode: 'timestamp_ms' })
    .default(sql`(unixepoch() * 1000)`)
    .notNull(),
  // Set when the full profile header was scraped via the "Save author" button;
  // null means we've only seen this author from a tweet's hover card.
  enrichedAt: integer('enriched_at', { mode: 'timestamp_ms' }),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .default(sql`(unixepoch() * 1000)`)
    .notNull(),
  retired: integer('retired', { mode: 'boolean' }).default(false).notNull(),
});

// Append-only follower-count series, one row per profile enrich (§7.4). The
// profile scrape used to overwrite followers_count in place; keeping every
// capture makes author momentum (followers/day) computable for the target
// roster. Still $0 — rows only exist when the user clicks "Save author".
export const voiceAuthorSnapshots = sqliteTable(
  'voice_author_snapshots',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    handle: text('handle')
      .notNull()
      .references(() => voiceAuthors.handle),
    followersCount: integer('followers_count').notNull(),
    capturedAt: integer('captured_at', { mode: 'timestamp_ms' })
      .default(sql`(unixepoch() * 1000)`)
      .notNull(),
  },
  (t) => [index('voice_author_snapshots_handle_captured_idx').on(t.handle, t.capturedAt)],
);

export const voiceTweets = sqliteTable(
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
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    url: text('url'),
    source: text('source').notNull().default('extension_scrape'),
    savedAt: integer('saved_at', { mode: 'timestamp_ms' })
      .default(sql`(unixepoch() * 1000)`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
    retired: integer('retired', { mode: 'boolean' }).default(false).notNull(),
    // Template extraction (§8.3) — one Grok structured-output pass per tweet
    // distills the *structure* (never the content) for the Remix workflow.
    hookType: text('hook_type'),
    skeleton: text('skeleton'),
    lineBreakPattern: text('line_break_pattern'),
    templateLength: text('template_length'),
    device: text('device'),
    templateExtractedAt: integer('template_extracted_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('voice_tweets_author_created_idx').on(t.authorHandle, t.createdAt)],
);

export const replyDrafts = sqliteTable(
  'reply_drafts',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    sourceTweetId: text('source_tweet_id').notNull(),
    sourceAuthorUsername: text('source_author_username').notNull(),
    sourceAuthorDisplayName: text('source_author_display_name'),
    sourceText: text('source_text').notNull(),
    sourceUrl: text('source_url').notNull(),
    sourcePostedAt: integer('source_posted_at', { mode: 'timestamp_ms' }),

    contextSnapshot: text('context_snapshot', { mode: 'json' }).notNull(),

    replyText: text('reply_text').notNull(),
    replyTextEdited: text('reply_text_edited'),
    // All variants from the structured two-variant call ({text, angle}[]);
    // replyText holds the primary pick. Null on pre-7.1 rows.
    variants: text('variants', { mode: 'json' }),
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

    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(unixepoch() * 1000)`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(unixepoch() * 1000)`)
      .notNull(),
  },
  (t) => [
    index('reply_drafts_source_created_idx').on(t.sourceTweetId, t.createdAt),
    index('reply_drafts_status_created_idx').on(t.status, t.createdAt),
  ],
);

// Radar batch drafts (CIRCLES-PLAN C0): the server-side copy of replies drafted
// by POST /x/replies/generate-batch. The session ring buffer in the extension
// used to be the ONLY holder — a browser restart lost every drafted reply (Grok
// money already spent). Rows auto-expire by status flip (never delete) after
// 48h: a radar reply to a dead post is worthless anyway.
export const radarDrafts = sqliteTable(
  'radar_drafts',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tweetId: text('tweet_id').notNull(),
    url: text('url'),
    handle: text('handle').notNull(),
    author: text('author'),
    snippet: text('snippet').notNull(),
    // Band + classifier inputs as the Radar saw them at draft time. Nullable:
    // CLI callers of generate-batch may not send them (those rows can't
    // rehydrate the panel queue, which needs signals to rank/render).
    band: text('band'),
    signals: text('signals', { mode: 'json' }),
    replyText: text('reply_text').notNull(),
    angle: text('angle').notNull(),
    status: text('status').notNull().default('ready'), // ready | clicked | expired
    draftedAt: integer('drafted_at', { mode: 'timestamp_ms' })
      .default(sql`(unixepoch() * 1000)`)
      .notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(unixepoch() * 1000)`)
      .notNull(),
  },
  (t) => [
    index('radar_drafts_status_drafted_idx').on(t.status, t.draftedAt),
    index('radar_drafts_tweet_idx').on(t.tweetId),
  ],
);

// The people layer (CIRCLES-PLAN C1): one row per human the system has ever
// encountered — mention authors, reply targets, saved voice authors. NOT merged
// with voice_authors (different jobs: swipe-file vs relationship); the
// lowercased handle is the join key between the two. `stage` describes
// reciprocity only (see src/x/people/stage.ts) and only ratchets up
// automatically; a human can demote via PATCH /x/people/:handle.
export const people = sqliteTable(
  'people',
  {
    handle: text('handle').primaryKey(),
    xUserId: text('x_user_id'),
    displayName: text('display_name'),
    bio: text('bio'),
    followersCount: integer('followers_count'),
    followingCount: integer('following_count'),
    stage: text('stage').notNull().default('stranger'),
    // stranger | noticed | engaged | responded | mutual | ally
    stageUpdatedAt: integer('stage_updated_at', { mode: 'timestamp_ms' }),
    notes: text('notes'),
    tags: text('tags', { mode: 'json' }).$type<string[]>(),
    // First surface that created the row: mention | voice | reply | harvest | manual
    source: text('source'),
    firstSeenAt: integer('first_seen_at', { mode: 'timestamp_ms' }),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }),
    // Their last mention/reply to me — the reply-back signal.
    lastInboundAt: integer('last_inbound_at', { mode: 'timestamp_ms' }),
    // My last posted reply to them.
    lastOutboundAt: integer('last_outbound_at', { mode: 'timestamp_ms' }),
    retired: integer('retired', { mode: 'boolean' }).default(false).notNull(),
  },
  (t) => [index('people_stage_idx').on(t.stage)],
);

// Append-only interaction log — the timeline IS the CRM. Event ids are
// DETERMINISTIC when a ref exists (`type:ref_table:ref_id`, see
// src/x/people/store.ts) so backfill and live hooks can INSERT OR IGNORE and
// never double-log the same underlying row.
export const personEvents = sqliteTable(
  'person_events',
  {
    id: text('id').primaryKey(),
    handle: text('handle')
      .notNull()
      .references(() => people.handle),
    // saved_tweet | saved_author | my_reply | their_mention |
    // their_reply_to_me | hover_sighting | harvest_seen | note | manual_dm_logged
    type: text('type').notNull(),
    refTable: text('ref_table'),
    refId: text('ref_id'),
    summary: text('summary'),
    at: integer('at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('person_events_handle_at_idx').on(t.handle, t.at)],
);

// Follower series for non-voice people (C6 passive hover capture will feed
// this); voice authors keep their series in voice_author_snapshots — the
// dossier route joins both by handle.
export const personSnapshots = sqliteTable(
  'person_snapshots',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    handle: text('handle')
      .notNull()
      .references(() => people.handle),
    followersCount: integer('followers_count').notNull(),
    capturedAt: integer('captured_at', { mode: 'timestamp_ms' })
      .default(sql`(unixepoch() * 1000)`)
      .notNull(),
  },
  (t) => [index('person_snapshots_handle_captured_idx').on(t.handle, t.capturedAt)],
);

// Idea Inbox (CIRCLES-PLAN C6): captured post/reply seeds that survive their
// first use. `replyMaster:idea` used to be delete-after-one-use; now consuming
// is an explicit status flip with a backlink (consumed_by_table/-id points at
// the reply_drafts or scheduled_posts row the idea seeded), and a consumed
// idea can be re-opened. Rows come from the panel quick-add or the extension's
// "Send selection to stratus ideas" context menu ($0 DOM, Romanian welcome).
export const ideas = sqliteTable(
  'ideas',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    text: text('text').notNull(),
    sourceUrl: text('source_url'),
    tags: text('tags', { mode: 'json' }).$type<string[]>(),
    status: text('status').notNull().default('open'), // open | consumed | discarded
    consumedByTable: text('consumed_by_table'),
    consumedById: text('consumed_by_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(unixepoch() * 1000)`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(unixepoch() * 1000)`)
      .notNull(),
  },
  (t) => [index('ideas_status_created_idx').on(t.status, t.createdAt)],
);

// Follow-up queue snoozes (CIRCLES-PLAN C5) — conversation_meta pattern for
// the computed queue: items are recomputed on every GET /x/people/followups,
// so the only state worth persisting is "stop showing me this one until X".
// item_key is `${kind}:${handle}` (see src/x/people/followups.ts).
export const followupSnoozes = sqliteTable('followup_snoozes', {
  itemKey: text('item_key').primaryKey(),
  snoozedUntil: integer('snoozed_until', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .default(sql`(unixepoch() * 1000)`)
    .notNull(),
});

// Mention inbox (§7.5): mentions of me, pulled incrementally (since_id = max
// stored tweet_id) by the daily pass and the on-demand refresh — owned reads,
// $0.001/result. `status` drives the panel's Inbox: rows arrive 'unanswered';
// the answered backfill flips them when one of my published replies targets
// them, or the user marks them by hand. Replying stays manual paste — see
// routes/mentions.ts for the Feb 2026 carve-out note.
export const mentions = sqliteTable(
  'mentions',
  {
    tweetId: text('tweet_id').primaryKey(),
    authorId: text('author_id'),
    authorUsername: text('author_username'),
    authorName: text('author_name'),
    text: text('text').notNull(),
    postedAt: integer('posted_at', { mode: 'timestamp_ms' }).notNull(),
    conversationId: text('conversation_id'),
    inReplyToTweetId: text('in_reply_to_tweet_id'),
    status: text('status').notNull().default('unanswered'), // unanswered | answered | dismissed
    answeredDraftId: text('answered_draft_id').references(() => replyDrafts.id),
    answeredAt: integer('answered_at', { mode: 'timestamp_ms' }),
    fetchedAt: integer('fetched_at', { mode: 'timestamp_ms' })
      .default(sql`(unixepoch() * 1000)`)
      .notNull(),
  },
  (t) => [index('mentions_status_posted_idx').on(t.status, t.postedAt)],
);

// Slack-style read state for conversations (CIRCLES-PLAN C2). Threads
// themselves are NOT stored — GET /x/conversations groups posts_published +
// mentions by conversation_id on read; this table only remembers what a thread
// view can't recompute: when the user last read it, snoozed it, or muted it.
// conversation_id falls back to the mention's own tweet_id when X gave none.
export const conversationMeta = sqliteTable('conversation_meta', {
  conversationId: text('conversation_id').primaryKey(),
  snoozedUntil: integer('snoozed_until', { mode: 'timestamp_ms' }),
  lastReadAt: integer('last_read_at', { mode: 'timestamp_ms' }),
  muted: integer('muted', { mode: 'boolean' }).default(false).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .default(sql`(unixepoch() * 1000)`)
    .notNull(),
});

// $0 ingestion of the extension's DOM harvester (OVERHAUL-PLAN §6.3). One run
// per harvest click; repeated harvests of the same tweet intentionally create
// new rows — the (tweet_id, captured_at) series is the longitudinal view/
// bookmark curve the once-only API snapshot can't provide.
export const harvestRuns = sqliteTable('harvest_runs', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  handle: text('handle').notNull(),
  mode: text('mode').notNull(), // 'posts' | 'replies'
  scope: text('scope').notNull(), // 'all' | 'today' | 'yesterday'
  rowCount: integer('row_count').default(0).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .default(sql`(unixepoch() * 1000)`)
    .notNull(),
});

export const harvestRows = sqliteTable(
  'harvest_rows',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    runId: text('run_id')
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
    tweetTime: integer('tweet_time', { mode: 'timestamp_ms' }),
    capturedAt: integer('captured_at', { mode: 'timestamp_ms' })
      .default(sql`(unixepoch() * 1000)`)
      .notNull(),
    // Replies mode only: the tweet replied to, as paired by the harvester.
    // Capture-time metrics of the target feed the BAND calibration crosstab.
    origTweetId: text('orig_tweet_id'),
    origHandle: text('orig_handle'),
    origText: text('orig_text'),
    origTime: integer('orig_time', { mode: 'timestamp_ms' }),
    origComments: integer('orig_comments'),
    origLikes: integer('orig_likes'),
    origViews: integer('orig_views'),
    // Reconcile result against reply_drafts (replies mode only) — the second,
    // API-free outcome source for posted reply drafts.
    matchedDraftId: text('matched_draft_id').references(() => replyDrafts.id),
    // Content-shape columns (§9.4) so "which formats earn views" is answerable.
    // Nullable: older extension builds don't send them.
    hasPhoto: integer('has_photo', { mode: 'boolean' }),
    hasVideo: integer('has_video', { mode: 'boolean' }),
    isQuote: integer('is_quote', { mode: 'boolean' }),
    textLen: integer('text_len'),
    lineBreaks: integer('line_breaks'),
    // Replies mode: 1-based position of this reply inside its rendered group —
    // position 1 is the reply directly under the harvested target; deeper
    // positions mark self-threads/chains the items[k-1] pairing used to mislabel.
    groupPosition: integer('group_position'),
  },
  (t) => [
    index('harvest_rows_tweet_captured_idx').on(t.tweetId, t.capturedAt),
    index('harvest_rows_run_idx').on(t.runId),
  ],
);
