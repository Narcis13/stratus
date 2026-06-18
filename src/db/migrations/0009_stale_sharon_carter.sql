CREATE TABLE "content_pillars" (
	"slug" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"body" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "content_pillars" ("slug", "label", "body", "sort_order", "active") VALUES
	('ai-craft', 'AI-native craft — the WHAT', 'Daily lab journal: AI agents, Claude Code, skills, judgment encoded in code. Why only me: 30 years of code + active AI power-user who actually writes skills for agents. Dominant register: plain; spicy when taking a stance against a popular pattern. Avoid tutorial-speak — state the pattern/judgment, show I live with it. Concrete commit/skill/workflow > generic advice.', 1, true),
	('builder-51', 'The 51-year-old builder — the WHO / WHY', 'Atypical solopreneur journal; the reverse of the 22-year-old-SF-founder template. Rarity = memorability; I lived the 386→2026 arc, juniors can''t fabricate it. Dominant register: reflective. Flashback → reframe → punchy landing. A specific tech reference (Turbo Pascal, DOS 3.1, 386) beats "back in my day." Don''t overdo nostalgia. Real constraints (08–15 hospital job, Romania, building post-50) → forced creativity.', 2, true),
	('unsexy-problems', 'Unsexy problems — the WHERE / WHAT-FOR', 'Real SMB and public-system problems, far from the VC echo chamber — where leverage actually lives. Why only me: two real laboratories (the hospital, the ~20 SMB accounting clients). Dominant register: spicy. Specific observation > generic critique. Name the unsexy thing: an ANAF report, an Excel reconciliation, a hospital procurement form. Abstraction kills the angle.', 3, true)
ON CONFLICT ("slug") DO NOTHING;
