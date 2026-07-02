CREATE TABLE `people` (
	`handle` text PRIMARY KEY NOT NULL,
	`x_user_id` text,
	`display_name` text,
	`bio` text,
	`followers_count` integer,
	`following_count` integer,
	`stage` text DEFAULT 'stranger' NOT NULL,
	`stage_updated_at` integer,
	`notes` text,
	`tags` text,
	`source` text,
	`first_seen_at` integer,
	`last_seen_at` integer,
	`last_inbound_at` integer,
	`last_outbound_at` integer,
	`retired` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `people_stage_idx` ON `people` (`stage`);--> statement-breakpoint
CREATE TABLE `person_events` (
	`id` text PRIMARY KEY NOT NULL,
	`handle` text NOT NULL,
	`type` text NOT NULL,
	`ref_table` text,
	`ref_id` text,
	`summary` text,
	`at` integer NOT NULL,
	FOREIGN KEY (`handle`) REFERENCES `people`(`handle`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `person_events_handle_at_idx` ON `person_events` (`handle`,`at`);--> statement-breakpoint
CREATE TABLE `person_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`handle` text NOT NULL,
	`followers_count` integer NOT NULL,
	`captured_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`handle`) REFERENCES `people`(`handle`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `person_snapshots_handle_captured_idx` ON `person_snapshots` (`handle`,`captured_at`);