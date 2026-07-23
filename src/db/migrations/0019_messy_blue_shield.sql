CREATE TABLE `following` (
	`handle` text PRIMARY KEY NOT NULL,
	`display_name` text,
	`follows_back` integer DEFAULT false NOT NULL,
	`list_position` integer,
	`first_seen_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_run_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`keep` integer DEFAULT false NOT NULL,
	`unfollow_marked_at` integer,
	FOREIGN KEY (`last_run_id`) REFERENCES `following_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `following_status_seen_idx` ON `following` (`status`,`first_seen_at`);--> statement-breakpoint
CREATE TABLE `following_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`started_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`completed_at` integer,
	`rows_seen` integer DEFAULT 0 NOT NULL,
	`complete` integer DEFAULT false NOT NULL
);
