CREATE TABLE "reply_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_tweet_id" text NOT NULL,
	"source_author_username" text NOT NULL,
	"source_author_display_name" text,
	"source_text" text NOT NULL,
	"source_url" text NOT NULL,
	"source_posted_at" timestamp with time zone,
	"context_snapshot" jsonb NOT NULL,
	"reply_text" text NOT NULL,
	"reply_text_edited" text,
	"model" text NOT NULL,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"cost_usd" text,
	"grok_request_id" text,
	"system_prompt_override" text,
	"status" text DEFAULT 'generated' NOT NULL,
	"posted_tweet_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "reply_drafts_source_created_idx" ON "reply_drafts" USING btree ("source_tweet_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reply_drafts_status_created_idx" ON "reply_drafts" USING btree ("status","created_at" DESC NULLS LAST);