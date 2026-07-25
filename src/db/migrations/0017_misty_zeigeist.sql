CREATE TABLE `prompt_overrides` (
	`key` text PRIMARY KEY NOT NULL,
	`body` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
