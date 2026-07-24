CREATE TABLE `audience_activity` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`captured_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`metric` text NOT NULL,
	`tz_offset_min` integer NOT NULL,
	`cols` integer NOT NULL,
	`rows` integer NOT NULL,
	`grid` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audience_activity_captured_idx` ON `audience_activity` (`captured_at`);