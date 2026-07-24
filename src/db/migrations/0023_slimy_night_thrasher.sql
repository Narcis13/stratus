CREATE TABLE `articles` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`subtitle` text,
	`body_md` text DEFAULT '' NOT NULL,
	`pillar` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`outline` text,
	`published_url` text,
	`published_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `articles_status_updated_idx` ON `articles` (`status`,`updated_at`);