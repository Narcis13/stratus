CREATE TABLE `conversation_meta` (
	`conversation_id` text PRIMARY KEY NOT NULL,
	`snoozed_until` integer,
	`last_read_at` integer,
	`muted` integer DEFAULT false NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
