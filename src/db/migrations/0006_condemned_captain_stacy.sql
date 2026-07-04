CREATE TABLE `ideas` (
	`id` text PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	`source_url` text,
	`tags` text,
	`status` text DEFAULT 'open' NOT NULL,
	`consumed_by_table` text,
	`consumed_by_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ideas_status_created_idx` ON `ideas` (`status`,`created_at`);