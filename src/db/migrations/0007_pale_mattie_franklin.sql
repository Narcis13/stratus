CREATE TABLE "mentions" (
	"tweet_id" text PRIMARY KEY NOT NULL,
	"author_id" text,
	"author_username" text,
	"author_name" text,
	"text" text NOT NULL,
	"posted_at" timestamp with time zone NOT NULL,
	"conversation_id" text,
	"in_reply_to_tweet_id" text,
	"status" text DEFAULT 'unanswered' NOT NULL,
	"answered_draft_id" uuid,
	"answered_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_answered_draft_id_reply_drafts_id_fk" FOREIGN KEY ("answered_draft_id") REFERENCES "public"."reply_drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mentions_status_posted_idx" ON "mentions" USING btree ("status","posted_at" DESC NULLS LAST);