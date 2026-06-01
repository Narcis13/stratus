DROP TABLE "voice_metrics_snapshots" CASCADE;
--> statement-breakpoint
DROP TABLE "voice_tweets" CASCADE;
--> statement-breakpoint
DROP TABLE "tracked_authors" CASCADE;
--> statement-breakpoint
CREATE TABLE "voice_authors" (
	"handle" text PRIMARY KEY NOT NULL,
	"x_user_id" text,
	"display_name" text,
	"bio" text,
	"followers_count" integer,
	"following_count" integer,
	"pinned_tweet_id" text,
	"pinned_tweet_text" text,
	"profile_summary" text,
	"profile_url" text,
	"source" text DEFAULT 'extension_scrape' NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"enriched_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voice_tweets" (
	"tweet_id" text PRIMARY KEY NOT NULL,
	"author_handle" text NOT NULL,
	"text" text NOT NULL,
	"scraped_html" text,
	"created_at" timestamp with time zone NOT NULL,
	"url" text,
	"source" text DEFAULT 'extension_scrape' NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"retired" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "voice_tweets" ADD CONSTRAINT "voice_tweets_author_handle_voice_authors_handle_fk" FOREIGN KEY ("author_handle") REFERENCES "public"."voice_authors"("handle") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "voice_tweets_author_created_idx" ON "voice_tweets" USING btree ("author_handle","created_at" DESC NULLS LAST);
