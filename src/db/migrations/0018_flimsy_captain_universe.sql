CREATE TABLE `reply_list_items` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`text` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`last_used_at` integer,
	`use_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `reply_lists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reply_list_items_list_used_idx` ON `reply_list_items` (`list_id`,`last_used_at`);--> statement-breakpoint
CREATE TABLE `reply_list_uses` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`item_id` text NOT NULL,
	`rendered_text` text NOT NULL,
	`target_tweet_id` text,
	`target_handle` text,
	`used_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `reply_list_uses_used_at_idx` ON `reply_list_uses` (`used_at`);--> statement-breakpoint
CREATE TABLE `reply_lists` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`humanizer` text,
	`active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
