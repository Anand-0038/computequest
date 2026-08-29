ALTER TABLE "campaigns" RENAME COLUMN "reward" TO "credit_reward";--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "onchain_reward_wei" bigint NOT NULL;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "receipt" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "signature" text NOT NULL;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "authorized_at" timestamp with time zone NOT NULL;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "confirmed_at" timestamp with time zone;