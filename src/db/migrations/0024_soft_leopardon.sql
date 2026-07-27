CREATE TABLE `draft_judgments` (
	`id` text PRIMARY KEY NOT NULL,
	`text_hash` text NOT NULL,
	`text` text NOT NULL,
	`surface` text DEFAULT 'post' NOT NULL,
	`verdict` text NOT NULL,
	`overall` integer NOT NULL,
	`headline` text DEFAULT '' NOT NULL,
	`confidence` text,
	`scores` text NOT NULL,
	`annotations` text NOT NULL,
	`strengths` text,
	`improvements` text,
	`model` text NOT NULL,
	`provider` text NOT NULL,
	`cost_usd` real,
	`parent_judgment_id` text,
	`judged_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `draft_judgments_text_hash_idx` ON `draft_judgments` (`text_hash`);