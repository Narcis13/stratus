CREATE TABLE `commitments` (
	`key` text PRIMARY KEY NOT NULL,
	`daily_target` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`active_since` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `me_goals` ADD `baseline_value` real;--> statement-breakpoint
ALTER TABLE `me_goals` ADD `baseline_at` integer;