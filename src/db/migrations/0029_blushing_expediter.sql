CREATE TABLE `radar_sightings` (
	`tweet_id` text PRIMARY KEY NOT NULL,
	`url` text,
	`handle` text NOT NULL,
	`author` text,
	`text` text NOT NULL,
	`band` text NOT NULL,
	`views` integer NOT NULL,
	`replies` integer NOT NULL,
	`likes` integer,
	`bait` integer NOT NULL,
	`verified` integer,
	`posted_at` integer,
	`source_path` text,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`seen_count` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `radar_sightings_last_seen_idx` ON `radar_sightings` (`last_seen_at`);--> statement-breakpoint
CREATE INDEX `radar_sightings_handle_idx` ON `radar_sightings` (`handle`,`last_seen_at`);