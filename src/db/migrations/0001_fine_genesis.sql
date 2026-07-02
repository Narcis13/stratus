CREATE TABLE `radar_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`tweet_id` text NOT NULL,
	`url` text,
	`handle` text NOT NULL,
	`author` text,
	`snippet` text NOT NULL,
	`band` text,
	`signals` text,
	`reply_text` text NOT NULL,
	`angle` text NOT NULL,
	`status` text DEFAULT 'ready' NOT NULL,
	`drafted_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `radar_drafts_status_drafted_idx` ON `radar_drafts` (`status`,`drafted_at`);--> statement-breakpoint
CREATE INDEX `radar_drafts_tweet_idx` ON `radar_drafts` (`tweet_id`);