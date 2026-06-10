CREATE TABLE "account_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"snapshot_at" timestamp with time zone DEFAULT now() NOT NULL,
	"followers_count" integer NOT NULL,
	"following_count" integer NOT NULL,
	"tweet_count" integer NOT NULL,
	"listed_count" integer NOT NULL
);
