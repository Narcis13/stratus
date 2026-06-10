CREATE TABLE "harvest_rows" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"tweet_id" text NOT NULL,
	"handle" text NOT NULL,
	"mode" text NOT NULL,
	"text" text NOT NULL,
	"comments" integer DEFAULT 0 NOT NULL,
	"reposts" integer DEFAULT 0 NOT NULL,
	"likes" integer DEFAULT 0 NOT NULL,
	"bookmarks" integer DEFAULT 0 NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"tweet_time" timestamp with time zone,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"orig_tweet_id" text,
	"orig_handle" text,
	"orig_text" text,
	"orig_time" timestamp with time zone,
	"orig_comments" integer,
	"orig_likes" integer,
	"orig_views" integer,
	"matched_draft_id" uuid
);
--> statement-breakpoint
CREATE TABLE "harvest_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"handle" text NOT NULL,
	"mode" text NOT NULL,
	"scope" text NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "harvest_rows" ADD CONSTRAINT "harvest_rows_run_id_harvest_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."harvest_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harvest_rows" ADD CONSTRAINT "harvest_rows_matched_draft_id_reply_drafts_id_fk" FOREIGN KEY ("matched_draft_id") REFERENCES "public"."reply_drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "harvest_rows_tweet_captured_idx" ON "harvest_rows" USING btree ("tweet_id","captured_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "harvest_rows_run_idx" ON "harvest_rows" USING btree ("run_id");