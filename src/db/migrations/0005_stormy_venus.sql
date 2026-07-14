CREATE TABLE `followup_snoozes` (
	`item_key` text PRIMARY KEY NOT NULL,
	`snoozed_until` integer NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
