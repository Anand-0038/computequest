CREATE TYPE "public"."campaign_reward_claim_status" AS ENUM('RESERVED', 'CONFIRMED');--> statement-breakpoint
CREATE TABLE "campaign_reward_claims" (
	"id" uuid PRIMARY KEY NOT NULL,
	"campaign_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"quest_session_id" uuid NOT NULL,
	"settlement_id" uuid,
	"status" "campaign_reward_claim_status" DEFAULT 'RESERVED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_reward_claims" ADD CONSTRAINT "campaign_reward_claims_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_reward_claims" ADD CONSTRAINT "campaign_reward_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_reward_claims" ADD CONSTRAINT "campaign_reward_claims_quest_session_id_quest_sessions_id_fk" FOREIGN KEY ("quest_session_id") REFERENCES "public"."quest_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_reward_claims" ADD CONSTRAINT "campaign_reward_claims_settlement_id_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_reward_claim_campaign_user_unique" ON "campaign_reward_claims" USING btree ("campaign_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_reward_claim_quest_unique" ON "campaign_reward_claims" USING btree ("quest_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_reward_claim_settlement_unique" ON "campaign_reward_claims" USING btree ("settlement_id");