CREATE TABLE `post_templates` (
	`tweet_id` text PRIMARY KEY NOT NULL,
	`hook_type` text NOT NULL,
	`skeleton` text NOT NULL,
	`line_break_pattern` text NOT NULL,
	`template_length` text NOT NULL,
	`device` text NOT NULL,
	`extracted_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`tweet_id`) REFERENCES `posts_published`(`tweet_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `scheduled_posts` ADD `register` text;