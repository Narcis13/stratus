CREATE TABLE `dm_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`handle` text NOT NULL,
	`text` text NOT NULL,
	`purpose` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`grounding` text,
	`cost_usd` real,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`sent_at` integer,
	FOREIGN KEY (`handle`) REFERENCES `people`(`handle`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `dm_drafts_handle_created_idx` ON `dm_drafts` (`handle`,`created_at`);