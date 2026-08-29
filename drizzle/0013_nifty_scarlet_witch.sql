ALTER TABLE "campaigns" ADD COLUMN "sponsor_name" text DEFAULT 'Monad' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "campaign_label" text DEFAULT 'ECOSYSTEM CAMPAIGN' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "creative_url" text DEFAULT '/media/monad-parallel-execution.mp4' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "creative_description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "destination_url" text DEFAULT 'https://docs.monad.xyz' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "disclosure" text DEFAULT 'Independent educational creative. Settlement runs on Monad Testnet.' NOT NULL;
