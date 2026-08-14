ALTER TABLE `harvest_runs` ADD `root_tweet_id` text;--> statement-breakpoint
CREATE INDEX `harvest_runs_root_idx` ON `harvest_runs` (`root_tweet_id`,`created_at`);