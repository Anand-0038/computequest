ALTER TABLE "campaigns" ADD COLUMN "creative_title" text NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "completion_question" text NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "completion_answer_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "quest_sessions" ADD COLUMN "completion_answered_at" timestamp with time zone;