import { sql } from 'drizzle-orm';
import { blob, index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { NicheDoctrine } from '../niche/defaults.ts';
import type { HumanizerConfig } from '../replyLists/engine.ts';

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
  // Owning niche (N0). Nullable; migration backfills 'builder'. Plain text (no
  // FK) — the future per-niche partition is a backfill, not a rework.
  niche: text('niche'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .default(sql`(unixepoch() * 1000)`)
    .notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .default(sql`(unixepoch() * 1000)`)
    .notNull(),
});

// Channels (CIRCLES-PLAN C8): topic rooms over everything — pillars organize
// output, channels organize input + people. A channel is tags + a saved view,
// deliberately shallow: a tag is the channel's slug stored in the `tags` JSON
// column of people/ideas/voice_tweets/radar_drafts, so deleting a channel just
// leaves harmless strings behind (no FK, no cascade). `pillar` optionally maps
// the channel to a content-pillar slug so the aggregate view can pull own-post
// performance; `keywords` feed the pure $0 auto-suggest (human always confirms).
export const channels = sqliteTable('channels', {
  slug: text('slug').primaryKey(),
  label: text('label').notNull(),
  color: text('color'),
  sortOrder: integer('sort_order').default(0).notNull(),
  active: integer('active', { mode: 'boolean' }).default(true).notNull(),
  pillar: text('pillar'),
  keywords: text('keywords', { mode: 'json' }).$type<string[]>(),
  // Owning niche (N0). Nullable; migration backfills 'builder'.
  niche: text('niche'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .default(sql`(unixepoch() * 1000)`)
    .notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .default(sql`(unixepoch() * 1000)`)
    .notNull(),
});

// Niche (N0) — the first-class identity + strategy container. Exactly ONE active
// niche at a time (v1). persona/beliefs/replyPersona are the prompt-grounding
// blocks lifted out of the byte-synced templates (post prompt §1/§5, reply
// prompt "Who I am"), so the active identity can change without a deploy — the
// §8.6 move that made pillars editable. `doctrine` (nullable JSON) holds the 5
// REPLY-GUIDE knobs; null = all defaults (resolveDoctrine merges field-by-field).
// Seeded with `builder` (active), mirroring DEFAULT_NICHE byte-for-byte — the
// DEFAULT_PILLARS seed discipline. Consumers stay inert until N0.3/N0.4/N0.5.
export const niches = sqliteTable('niches', {
  slug: text('slug').primaryKey(),
  label: text('label').notNull(),
  description: text('description'),
  persona: text('persona').notNull(),
  beliefs: text('beliefs').notNull(),
  replyPersona: text('reply_persona').notNull(),
  doctrine: text('doctrine', { mode: 'json' }).$type<Partial<NicheDoctrine>>(),
  active: integer('active', { mode: 'boolean' }).default(false).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .default(sql`(unixepoch() * 1000)`)
    .notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .default(sql`(unixepoch() * 1000)`)
    .notNull(),
});

// Studio asset library (SURFACES S4): composed PNGs and AI-generated
// backgrounds live as SQLite BLOBs — right at single-user scale (a handful of
// KB-to-MB images), no external object store, and they ride the existing DB
// backup story. `prompt` is the xAI prompt for a generated background (null for
// a hand-composed card); `used_on_tweet_id` links an asset to the post it
// shipped on. The list route returns metadata only — the blob is streamed by
// GET /x/assets/:id/png so re-opening an asset as a base layer is one fetch.
export const mediaAssets = sqliteTable('media_assets', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  kind: text('kind').notNull(),
  prompt: text('prompt'),
  png: blob('png').notNull(),
  mediaType: text('media_type').notNull().default('image/png'),
  width: integer('width'),
  height: integer('height'),
  byteLength: integer('byte_length'),
  usedOnTweetId: text('used_on_tweet_id'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
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
    // "Visual made" marker (SURFACES S3): the Studio composed an image for this
    // slot that the API cannot attach (OAuth 1.0a wall) — the post must be
    // published manually with its PNG. Purely informational: the publisher
    // ignores it (v1 keeps it untouched); Calendar/Today render an amber chip.
    mediaNote: text('media_note'),
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
    // Did the tweet carry media? (§S0.2 image-lift baseline). Nullable on
    // purpose: stamped at discovery from the attachments field and at publish
    // from the sent body, but rows written before this column existed can't be
    // backfilled (the field was never stored) — null means "unknown", NEVER
    // "no", so every aggregation buckets null separately.
    hasMedia: integer('has_media', { mode: 'boolean' }),
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
  // S0.9 pinned-post watch: the tweet currently pinned to my profile, read for
  // free on the same daily getMe() ($0.001). null on pre-S0.9 rows and whenever
  // no tweet is pinned. The pin series lets the brief warn when the profile's
  // landing page has gone stale (unchanged >21d) or been out-performed.
  pinnedTweetId: text('pinned_tweet_id'),
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
    // Channel slugs (C8) — a saved tweet can live in several topic rooms.
    tags: text('tags', { mode: 'json' }).$type<string[]>(),
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
    // All variants from the structured three-variant call ({text, angle}[]);
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

    // Draft origin (RU.2): 'reply_master' | 'radar'. Null = pre-RU legacy row.
    source: text('source'),

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
    // All 3 angle variants (RU.2) — replyText stays the primary (variants[0]),
    // so rank/rehydrate/old rows keep working. Null on pre-RU rows and CLI
    // callers that never supplied variants.
    variants: text('variants', { mode: 'json' }).$type<{ text: string; angle: string }[]>(),
    // The Grok model that drafted these (RU.2) — copied onto the confirmed
    // reply_drafts row (whose `model` is NOT NULL). Null on pre-RU rows.
    model: text('model'),
    // Soft link to the reply_drafts row this draft was confirmed into (RU.2).
    // Null until confirmed; no FK — the reply_drafts row may outlive/precede it.
    replyDraftId: text('reply_draft_id'),
    // Channel slugs (C8) — tagged from the Radar row, keyed by tweet_id.
    tags: text('tags', { mode: 'json' }).$type<string[]>(),
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
    // First surface that created the row:
    // mention | voice | reply | harvest | hover | launch | notification | manual
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
    // their_reply_to_me | hover_sighting | harvest_seen |
    // their_like | their_repost | their_follow (C10 notification harvest —
    // timeline-only, see src/x/people/stage.ts) | note | manual_dm_logged
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

// Quests & streaks (CIRCLES-PLAN C9): one row per LOCAL day (YYYY-MM-DD in the
// viewer's timezone), written by the brief route on read — idempotent per day,
// the last read of the day wins. `completed` maps quest key → hit; `allDone` is
// the streak predicate. A day the panel never opened has no row and reads as a
// break: the streak measures showing up, gently — no back-writing history.
export const streaks = sqliteTable('streaks', {
  day: text('day').primaryKey(),
  completed: text('completed', { mode: 'json' }).$type<Record<string, boolean>>().notNull(),
  allDone: integer('all_done', { mode: 'boolean' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .default(sql`(unixepoch() * 1000)`)
    .notNull(),
});

// Sunday Digest (CIRCLES-PLAN C9): the week's facts + the one Grok narration,
// cached per week so re-opening the panel on Sunday never re-spends the ~$0.01
// call. week_key = ISO date of the local Monday the week starts on; an explicit
// ?refresh=true is the only path that regenerates.
export const digests = sqliteTable('digests', {
  weekKey: text('week_key').primaryKey(),
  facts: text('facts', { mode: 'json' }).notNull(),
  narrative: text('narrative').notNull(),
  model: text('model').notNull(),
  costUsd: real('cost_usd'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .default(sql`(unixepoch() * 1000)`)
    .notNull(),
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

// Me / My Profile (M1): the DYNAMIC personal-context layer injected at the
// prompt tail (post prompt.md §1 stays static). Human-written only — Grok never
// authors these (§7.18). An empty profile renders an empty block, so with no
// rows every prompt is byte-identical to before this feature (the rollback
// story). `happened_at` null = undated, so created_at drives freshness windows.
export const meEntries = sqliteTable(
  'me_entries',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    kind: text('kind').notNull(), // fact | event | emotion | note
    text: text('text').notNull(),
    happenedAt: integer('happened_at', { mode: 'timestamp_ms' }),
    pinned: integer('pinned', { mode: 'boolean' }).default(false).notNull(),
    active: integer('active', { mode: 'boolean' }).default(true).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(unixepoch() * 1000)`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(unixepoch() * 1000)`)
      .notNull(),
  },
  (t) => [index('me_entries_kind_active_idx').on(t.kind, t.active)],
);

// Measurable goals. `followers` goals auto-track progress from the latest
// account_snapshots row ($0, daily getMe); `mrr`/`custom` take a manual
// current_value. GR.7 (D4) extends this table rather than forking a second
// goals system.
export const meGoals = sqliteTable(
  'me_goals',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    label: text('label').notNull(),
    kind: text('kind').notNull(), // followers | mrr | custom
    target: real('target').notNull(),
    unit: text('unit'),
    currentValue: real('current_value'),
    deadline: integer('deadline', { mode: 'timestamp_ms' }),
    // GR.7 (D4): where this goal started, stamped at creation. followers/mrr/
    // custom record the value at that moment; the counted kinds
    // (posted_replies/originals) start at 0 and count forward from baseline_at.
    // Both null on rows created before GR.7 — readers fall back to created_at.
    baselineValue: real('baseline_value'),
    baselineAt: integer('baseline_at', { mode: 'timestamp_ms' }),
    status: text('status').notNull().default('active'), // active | achieved | missed | dropped
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(unixepoch() * 1000)`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(unixepoch() * 1000)`)
      .notNull(),
  },
  (t) => [index('me_goals_status_idx').on(t.status)],
);

// Daily commitments (GR.7, Guardrails §C): the minimum I hold myself to each
// day. One row per key ('replies' | 'originals'); an ABSENT row means no
// commitment, and the quest targets fall back to the doctrine defaults — which
// is why there is no seed. `active_since` is stamped at creation and on a
// re-activation but deliberately NOT touched by a target edit: debt is counted
// from the day I made the promise, and raising the bar must not erase the days
// I already missed.
export const commitments = sqliteTable('commitments', {
  key: text('key').primaryKey(),
  dailyTarget: integer('daily_target').notNull(),
  active: integer('active', { mode: 'boolean' }).default(true).notNull(),
  activeSince: integer('active_since', { mode: 'timestamp_ms' })
    .default(sql`(unixepoch() * 1000)`)
    .notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .default(sql`(unixepoch() * 1000)`)
    .notNull(),
});

// Prompt overrides (AI.3) — OVERRIDE ROWS ONLY, keyed by the registry's
// PromptKey. Row absent = the shipped default in src/x/prompts/registry.ts
// applies; restore = DELETE. No seed INSERT by design (sidesteps the
// drizzle-kit dropped-seed trap, and a default improved in a later deploy
// applies automatically unless the user overrode it). Never store secrets
// here — the table is explorer/MCP-visible like everything except tokens.
export const promptOverrides = sqliteTable('prompt_overrides', {
  key: text('key').primaryKey(),
  body: text('body').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .default(sql`(unixepoch() * 1000)`)
    .notNull(),
});

// Reply lists (RL) — premade, templated, humanized canned replies for the
// moments the machinery already surfaces (Launch Room early commenters, open
// loops). The pick/render/jitter logic is pure (src/x/replyLists/engine.ts);
// these three tables are the state it runs over.
//
// `humanizer` holds the per-list override, stored NORMALIZED through
// parseHumanizerConfig (null = DEFAULT_HUMANIZER) so the /use path resolves it
// without re-validating.
export const replyLists = sqliteTable('reply_lists', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  description: text('description'),
  humanizer: text('humanizer', { mode: 'json' }).$type<HumanizerConfig>(),
  active: integer('active', { mode: 'boolean' }).default(true).notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .default(sql`(unixepoch() * 1000)`)
    .notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .default(sql`(unixepoch() * 1000)`)
    .notNull(),
});

// `last_used_at` is the anti-repeat state — server-side on purpose, so the
// shuffle survives a browser restart and stays one source of truth (Decision 1).
// The index is exactly what pickItem's recency window reads.
export const replyListItems = sqliteTable(
  'reply_list_items',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    listId: text('list_id')
      .notNull()
      .references(() => replyLists.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).default(true).notNull(),
    source: text('source').notNull().default('manual'), // manual | ai
    lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
    useCount: integer('use_count').default(0).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(unixepoch() * 1000)`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(unixepoch() * 1000)`)
      .notNull(),
  },
  (t) => [index('reply_list_items_list_used_idx').on(t.listId, t.lastUsedAt)],
);

// The use log: audit trail AND the measurement hook — the Playbook's `canned`
// bucket matches a published reply against `rendered_text` (typos and all, so
// the paste-exact match holds). Deliberately NOT FK'd to the list/item: the
// history must outlive an edited-away item or a deleted list, or the attribution
// silently loses rows.
export const replyListUses = sqliteTable(
  'reply_list_uses',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    listId: text('list_id').notNull(),
    itemId: text('item_id').notNull(),
    renderedText: text('rendered_text').notNull(),
    targetTweetId: text('target_tweet_id'),
    targetHandle: text('target_handle'),
    usedAt: integer('used_at', { mode: 'timestamp_ms' })
      .default(sql`(unixepoch() * 1000)`)
      .notNull(),
  },
  (t) => [index('reply_list_uses_used_at_idx').on(t.usedAt)],
);

// Following ledger (Guardrails §A) — who I follow and whether they follow back,
// from ONE $0 DOM scrape of my own /following page: X renders a "Follows you"
// indicator on every row, so a single pass yields both sides. No API sync
// (~$1.00 per 500+500 pass), no `follows.write` scope — unfollowing stays a
// manual act in the X app and this table only ever nudges.
//
// One row per scrape click. `complete` is the trust flag: only a run that walked
// the whole list may conclude anything from a handle's ABSENCE, so a cancelled,
// capped or empty run never reconciles (decision 9).
export const followingRuns = sqliteTable('following_runs', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  startedAt: integer('started_at', { mode: 'timestamp_ms' })
    .default(sql`(unixepoch() * 1000)`)
    .notNull(),
  completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
  rowsSeen: integer('rows_seen').default(0).notNull(),
  complete: integer('complete', { mode: 'boolean' }).default(false).notNull(),
});

// `followed_at` deliberately does not exist: X never exposes when a follow
// happened, so `first_seen_at` is the proxy (§7.11) and the fill-only rule keeps
// it monotonic — the unfollow grace window measures from it.
//
// status ladder (§7.10, edges owned by routes/following.ts):
//   active     in my following per the latest data
//   queued     released into an unfollow batch (GR.3)
//   done       user ticked "unfollowed" — awaiting scrape confirmation
//   confirmed  a COMPLETE run no longer saw a `done` handle
//   gone       a COMPLETE run no longer saw a live handle (deleted account,
//              they blocked me, or I unfollowed outside the queue)
export const following = sqliteTable(
  'following',
  {
    handle: text('handle').primaryKey(),
    displayName: text('display_name'),
    // Not nullable: the userFollowIndicator's ABSENCE is the "no", so there is
    // no third state to record. A DOM drift that silently drops the badge would
    // read as "nobody follows me back" — that guard belongs in the queue's
    // eligibility rules (GR.3), not in a column type.
    followsBack: integer('follows_back', { mode: 'boolean' }).default(false).notNull(),
    // Render order in the latest run — X lists most-recently-followed first, so
    // this is a best-effort follow-recency tie-break, never a date.
    listPosition: integer('list_position'),
    firstSeenAt: integer('first_seen_at', { mode: 'timestamp_ms' })
      .default(sql`(unixepoch() * 1000)`)
      .notNull(),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' })
      .default(sql`(unixepoch() * 1000)`)
      .notNull(),
    lastRunId: text('last_run_id')
      .notNull()
      .references(() => followingRuns.id),
    status: text('status').notNull().default('active'),
    keep: integer('keep', { mode: 'boolean' }).default(false).notNull(),
    // When the user ticked "unfollowed". The 6h release budget and the monitor's
    // churn rule both count marks in a trailing window, so it is never cleared.
    unfollowMarkedAt: integer('unfollow_marked_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('following_status_seen_idx').on(t.status, t.firstSeenAt)],
);

// Audience "Active times" heatmap captures (Authoring 3.0, A3.2) — the $0 DOM
// scrape of X Analytics' when-is-my-audience-online grid. Append-only on
// purpose: repeated captures form a longitudinal series (the harvest_runs
// precedent), and the newest row is "current" for the Composer's slot blending.
// This is PRESENCE data, not measured outcomes — §7.19 gating happens in the
// consumers (own gated best-time cells always outrank it), never here.
export const audienceActivity = sqliteTable(
  'audience_activity',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    // Server-stamped at insert (client clocks lie); the route sets it
    // explicitly rather than leaning on the column default.
    capturedAt: integer('captured_at', { mode: 'timestamp_ms' })
      .default(sql`(unixepoch() * 1000)`)
      .notNull(),
    // The analytics dropdown at capture time ('likes', …) — free text, X owns
    // the vocabulary.
    metric: text('metric').notNull(),
    // Viewer-local tz at capture: the grid buckets are local wall-clock.
    tzOffsetMin: integer('tz_offset_min').notNull(),
    cols: integer('cols').notNull(),
    rows: integer('rows').notNull(),
    // number[cols][rows], 0..1 intensity, col 0 = Monday (ActiveTimesGrid).
    grid: text('grid', { mode: 'json' }).$type<number[][]>().notNull(),
  },
  (t) => [index('audience_activity_captured_idx').on(t.capturedAt)],
);

// DM drafts (Authoring 3.0 / CIRCLES outbound, A3.9): grounded direct-message
// drafts for a known person. Each draft is one Grok call grounded STRICTLY on
// the icebreaker grounding (decision 8 — no fabricated familiarity; a thin
// dossier refuses 422 before any spend). Sending stays manual in X; "Mark sent"
// logs the existing manual_dm_logged person event. `grounding` snapshots exactly
// what the model saw (§7.16). Lifecycle: draft → sent | discarded (sent is
// terminal — nothing regresses from it, §7.10).
export const dmDrafts = sqliteTable(
  'dm_drafts',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Lowercased people.handle (FK, like person_events/person_snapshots) — the
    // route resolves the person before inserting, so the ref always exists.
    handle: text('handle')
      .notNull()
      .references(() => people.handle),
    text: text('text').notNull(),
    // The optional steer that was used (any language in; the DM is English).
    purpose: text('purpose'),
    status: text('status').notNull().default('draft'), // draft | sent | discarded
    // JSON: exactly what grounded the draft — { block, idea } (§7.16).
    grounding: text('grounding', { mode: 'json' }).$type<{ block: string; idea: string | null }>(),
    costUsd: real('cost_usd'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(unixepoch() * 1000)`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(unixepoch() * 1000)`)
      .notNull(),
    sentAt: integer('sent_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('dm_drafts_handle_created_idx').on(t.handle, t.createdAt)],
);

// Articles (Authoring 3.0 / the Writer, A3.11): long-form originals drafted in
// the standalone /writer page. `body_md` is Markdown; there is no API article
// publish — posting is a manual "Copy for X" into X's article composer, and
// `published_url` records where it landed. `outline` is JSON persisted by the
// A3.12 outline assist (shape owned there). Lifecycle: draft → published (stamps
// published_at) | discarded; published → draft re-opens for editing (the publish
// stamp stays as the historical record); a discarded row is frozen except status
// back to draft. `pillar` is validated against the active niche slugs at write
// time (stored free-text — a niche can retire a slug after the fact).
export const articles = sqliteTable(
  'articles',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    title: text('title').notNull(),
    subtitle: text('subtitle'),
    bodyMd: text('body_md').notNull().default(''),
    pillar: text('pillar'),
    status: text('status').notNull().default('draft'), // draft | published | discarded
    // JSON structured outline (headings/beats) written by the outline assist.
    outline: text('outline', { mode: 'json' }).$type<unknown>(),
    publishedUrl: text('published_url'),
    publishedAt: integer('published_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(unixepoch() * 1000)`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(unixepoch() * 1000)`)
      .notNull(),
  },
  // List is `WHERE status ORDER BY updated_at DESC` — same shape as ideas.
  (t) => [index('articles_status_updated_idx').on(t.status, t.updatedAt)],
);
