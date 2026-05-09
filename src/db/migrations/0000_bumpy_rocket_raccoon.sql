CREATE TABLE "cost_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"platform" text NOT NULL,
	"endpoint" text,
	"status" integer,
	"items" integer,
	"cost_usd" numeric(10, 5),
	"duration_ms" integer,
	"attempts" integer,
	"request_id" text
);
--> statement-breakpoint
CREATE TABLE "metrics_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tweet_id" text NOT NULL,
	"snapshot_at" timestamp with time zone DEFAULT now() NOT NULL,
	"public_metrics" jsonb,
	"non_public_metrics" jsonb,
	"organic_metrics" jsonb
);
--> statement-breakpoint
CREATE TABLE "posts_published" (
	"tweet_id" text PRIMARY KEY NOT NULL,
	"scheduled_post_id" uuid,
	"text" text NOT NULL,
	"posted_at" timestamp with time zone NOT NULL,
	"is_reply" boolean DEFAULT false NOT NULL,
	"in_reply_to_tweet_id" text,
	"conversation_id" text,
	"source" text NOT NULL,
	"next_poll_at" timestamp with time zone,
	"poll_count" integer DEFAULT 0 NOT NULL,
	"retired" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "scheduled_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"text" text NOT NULL,
	"media_ids" text[],
	"scheduled_for" timestamp with time zone,
	"status" text NOT NULL,
	"posted_tweet_id" text,
	"error_class" text,
	"error_detail" text,
	"source" text DEFAULT 'api' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"scope" text,
	"x_user_id" text,
	"x_username" text,
	"connected_at" timestamp with time zone,
	"last_refresh_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tracked_authors" (
	"x_user_id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_pulled_at" timestamp with time zone,
	"source" text DEFAULT 'manual' NOT NULL,
	"pull_enabled" boolean DEFAULT true NOT NULL,
	"max_tweets_per_pull" integer DEFAULT 50 NOT NULL,
	"metrics_polling_enabled" boolean DEFAULT true NOT NULL,
	"max_polled_tweets" integer DEFAULT 20 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voice_metrics_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tweet_id" text NOT NULL,
	"snapshot_at" timestamp with time zone DEFAULT now() NOT NULL,
	"public_metrics" jsonb
);
--> statement-breakpoint
CREATE TABLE "voice_tweets" (
	"tweet_id" text PRIMARY KEY NOT NULL,
	"author_x_user_id" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"is_reply" boolean DEFAULT false NOT NULL,
	"in_reply_to_tweet_id" text,
	"conversation_id" text,
	"source" text NOT NULL,
	"scraped_html" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"next_poll_at" timestamp with time zone,
	"poll_count" integer DEFAULT 0 NOT NULL,
	"retired" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "metrics_snapshots" ADD CONSTRAINT "metrics_snapshots_tweet_id_posts_published_tweet_id_fk" FOREIGN KEY ("tweet_id") REFERENCES "public"."posts_published"("tweet_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts_published" ADD CONSTRAINT "posts_published_scheduled_post_id_scheduled_posts_id_fk" FOREIGN KEY ("scheduled_post_id") REFERENCES "public"."scheduled_posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_metrics_snapshots" ADD CONSTRAINT "voice_metrics_snapshots_tweet_id_voice_tweets_tweet_id_fk" FOREIGN KEY ("tweet_id") REFERENCES "public"."voice_tweets"("tweet_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_tweets" ADD CONSTRAINT "voice_tweets_author_x_user_id_tracked_authors_x_user_id_fk" FOREIGN KEY ("author_x_user_id") REFERENCES "public"."tracked_authors"("x_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cost_events_ts_idx" ON "cost_events" USING btree ("ts" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "cost_events_platform_ts_idx" ON "cost_events" USING btree ("platform","ts" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "metrics_snapshots_tweet_snapshot_idx" ON "metrics_snapshots" USING btree ("tweet_id","snapshot_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "posts_published_next_poll_idx" ON "posts_published" USING btree ("next_poll_at") WHERE retired = false;--> statement-breakpoint
CREATE INDEX "scheduled_posts_status_scheduled_idx" ON "scheduled_posts" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "voice_metrics_snapshots_tweet_snapshot_idx" ON "voice_metrics_snapshots" USING btree ("tweet_id","snapshot_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "voice_tweets_author_created_idx" ON "voice_tweets" USING btree ("author_x_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "voice_tweets_next_poll_idx" ON "voice_tweets" USING btree ("next_poll_at") WHERE retired = false;