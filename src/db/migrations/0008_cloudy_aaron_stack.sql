CREATE TABLE `digests` (
	`week_key` text PRIMARY KEY NOT NULL,
	`facts` text NOT NULL,
	`narrative` text NOT NULL,
	`model` text NOT NULL,
	`cost_usd` real,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `streaks` (
	`day` text PRIMARY KEY NOT NULL,
	`completed` text NOT NULL,
	`all_done` integer NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
