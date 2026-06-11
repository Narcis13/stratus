CREATE TABLE "voice_author_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"followers_count" integer NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "voice_author_snapshots" ADD CONSTRAINT "voice_author_snapshots_handle_voice_authors_handle_fk" FOREIGN KEY ("handle") REFERENCES "public"."voice_authors"("handle") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "voice_author_snapshots_handle_captured_idx" ON "voice_author_snapshots" USING btree ("handle","captured_at" DESC NULLS LAST);--> statement-breakpoint
INSERT INTO "voice_author_snapshots" ("handle", "followers_count", "captured_at")
SELECT "handle", "followers_count", coalesce("enriched_at", "updated_at")
FROM "voice_authors"
WHERE "followers_count" IS NOT NULL;