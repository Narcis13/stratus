CREATE TABLE `media_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`prompt` text,
	`png` blob NOT NULL,
	`media_type` text DEFAULT 'image/png' NOT NULL,
	`width` integer,
	`height` integer,
	`byte_length` integer,
	`used_on_tweet_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
