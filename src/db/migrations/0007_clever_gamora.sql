CREATE TABLE `channels` (
	`slug` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`color` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`pillar` text,
	`keywords` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `radar_drafts` ADD `tags` text;--> statement-breakpoint
ALTER TABLE `voice_tweets` ADD `tags` text;