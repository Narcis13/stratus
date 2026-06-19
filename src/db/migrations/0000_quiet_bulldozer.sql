CREATE TABLE `cost_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`platform` text NOT NULL,
	`endpoint` text,
	`status` integer,
	`items` integer,
	`cost_usd` real,
	`duration_ms` integer,
	`attempts` integer,
	`request_id` text
);
--> statement-breakpoint
CREATE INDEX `cost_events_ts_idx` ON `cost_events` (`ts`);--> statement-breakpoint
CREATE INDEX `cost_events_platform_ts_idx` ON `cost_events` (`platform`,`ts`);--> statement-breakpoint
CREATE TABLE `account_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`snapshot_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`followers_count` integer NOT NULL,
	`following_count` integer NOT NULL,
	`tweet_count` integer NOT NULL,
	`listed_count` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `content_pillars` (
	`slug` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`body` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `harvest_rows` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`tweet_id` text NOT NULL,
	`handle` text NOT NULL,
	`mode` text NOT NULL,
	`text` text NOT NULL,
	`comments` integer DEFAULT 0 NOT NULL,
	`reposts` integer DEFAULT 0 NOT NULL,
	`likes` integer DEFAULT 0 NOT NULL,
	`bookmarks` integer DEFAULT 0 NOT NULL,
	`views` integer DEFAULT 0 NOT NULL,
	`tweet_time` integer,
	`captured_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`orig_tweet_id` text,
	`orig_handle` text,
	`orig_text` text,
	`orig_time` integer,
	`orig_comments` integer,
	`orig_likes` integer,
	`orig_views` integer,
	`matched_draft_id` text,
	`has_photo` integer,
	`has_video` integer,
	`is_quote` integer,
	`text_len` integer,
	`line_breaks` integer,
	`group_position` integer,
	FOREIGN KEY (`run_id`) REFERENCES `harvest_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`matched_draft_id`) REFERENCES `reply_drafts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `harvest_rows_tweet_captured_idx` ON `harvest_rows` (`tweet_id`,`captured_at`);--> statement-breakpoint
CREATE INDEX `harvest_rows_run_idx` ON `harvest_rows` (`run_id`);--> statement-breakpoint
CREATE TABLE `harvest_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`handle` text NOT NULL,
	`mode` text NOT NULL,
	`scope` text NOT NULL,
	`row_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mentions` (
	`tweet_id` text PRIMARY KEY NOT NULL,
	`author_id` text,
	`author_username` text,
	`author_name` text,
	`text` text NOT NULL,
	`posted_at` integer NOT NULL,
	`conversation_id` text,
	`in_reply_to_tweet_id` text,
	`status` text DEFAULT 'unanswered' NOT NULL,
	`answered_draft_id` text,
	`answered_at` integer,
	`fetched_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`answered_draft_id`) REFERENCES `reply_drafts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `mentions_status_posted_idx` ON `mentions` (`status`,`posted_at`);--> statement-breakpoint
CREATE TABLE `metrics_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tweet_id` text NOT NULL,
	`snapshot_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`public_metrics` text,
	`non_public_metrics` text,
	`organic_metrics` text,
	`age_at_snapshot_min` integer,
	FOREIGN KEY (`tweet_id`) REFERENCES `posts_published`(`tweet_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `metrics_snapshots_tweet_snapshot_idx` ON `metrics_snapshots` (`tweet_id`,`snapshot_at`);--> statement-breakpoint
CREATE TABLE `posts_published` (
	`tweet_id` text PRIMARY KEY NOT NULL,
	`scheduled_post_id` text,
	`text` text NOT NULL,
	`posted_at` integer NOT NULL,
	`is_reply` integer DEFAULT false NOT NULL,
	`in_reply_to_tweet_id` text,
	`conversation_id` text,
	`source` text NOT NULL,
	`next_poll_at` integer,
	`poll_count` integer DEFAULT 0 NOT NULL,
	`retired` integer DEFAULT false NOT NULL,
	`last_seen_at` integer,
	FOREIGN KEY (`scheduled_post_id`) REFERENCES `scheduled_posts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `posts_published_next_poll_idx` ON `posts_published` (`next_poll_at`) WHERE retired = 0;--> statement-breakpoint
CREATE TABLE `reply_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`source_tweet_id` text NOT NULL,
	`source_author_username` text NOT NULL,
	`source_author_display_name` text,
	`source_text` text NOT NULL,
	`source_url` text NOT NULL,
	`source_posted_at` integer,
	`context_snapshot` text NOT NULL,
	`reply_text` text NOT NULL,
	`reply_text_edited` text,
	`variants` text,
	`idea` text,
	`pillar` text,
	`model` text NOT NULL,
	`prompt_tokens` integer,
	`completion_tokens` integer,
	`cost_usd` text,
	`grok_request_id` text,
	`system_prompt_override` text,
	`status` text DEFAULT 'generated' NOT NULL,
	`posted_tweet_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `reply_drafts_source_created_idx` ON `reply_drafts` (`source_tweet_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `reply_drafts_status_created_idx` ON `reply_drafts` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `scheduled_posts` (
	`id` text PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	`media_ids` text,
	`scheduled_for` integer,
	`status` text NOT NULL,
	`posted_tweet_id` text,
	`error_class` text,
	`error_detail` text,
	`source` text DEFAULT 'api' NOT NULL,
	`thread_id` text,
	`thread_position` integer,
	`pillar` text,
	`quote_tweet_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scheduled_posts_status_scheduled_idx` ON `scheduled_posts` (`status`,`scheduled_for`);--> statement-breakpoint
CREATE INDEX `scheduled_posts_thread_idx` ON `scheduled_posts` (`thread_id`,`thread_position`);--> statement-breakpoint
CREATE TABLE `tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`access_token` text NOT NULL,
	`refresh_token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`scope` text,
	`x_user_id` text,
	`x_username` text,
	`connected_at` integer,
	`last_refresh_at` integer
);
--> statement-breakpoint
CREATE TABLE `voice_author_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`handle` text NOT NULL,
	`followers_count` integer NOT NULL,
	`captured_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`handle`) REFERENCES `voice_authors`(`handle`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `voice_author_snapshots_handle_captured_idx` ON `voice_author_snapshots` (`handle`,`captured_at`);--> statement-breakpoint
CREATE TABLE `voice_authors` (
	`handle` text PRIMARY KEY NOT NULL,
	`x_user_id` text,
	`display_name` text,
	`bio` text,
	`followers_count` integer,
	`following_count` integer,
	`pinned_tweet_id` text,
	`pinned_tweet_text` text,
	`profile_summary` text,
	`profile_url` text,
	`source` text DEFAULT 'extension_scrape' NOT NULL,
	`added_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`enriched_at` integer,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`retired` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `voice_tweets` (
	`tweet_id` text PRIMARY KEY NOT NULL,
	`author_handle` text NOT NULL,
	`text` text NOT NULL,
	`scraped_html` text,
	`created_at` integer NOT NULL,
	`url` text,
	`source` text DEFAULT 'extension_scrape' NOT NULL,
	`saved_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer,
	`retired` integer DEFAULT false NOT NULL,
	`hook_type` text,
	`skeleton` text,
	`line_break_pattern` text,
	`template_length` text,
	`device` text,
	`template_extracted_at` integer,
	FOREIGN KEY (`author_handle`) REFERENCES `voice_authors`(`handle`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `voice_tweets_author_created_idx` ON `voice_tweets` (`author_handle`,`created_at`);