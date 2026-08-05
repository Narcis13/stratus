CREATE TABLE `cannon_targets` (
	`handle` text PRIMARY KEY NOT NULL,
	`display_name` text,
	`language` text,
	`score` real,
	`median_views` real,
	`median_comments` real,
	`sample_n` integer DEFAULT 0 NOT NULL,
	`scored_at` integer,
	`active` integer DEFAULT true NOT NULL,
	`notes` text,
	`added_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cannon_targets_active_score_idx` ON `cannon_targets` (`active`,`score`);