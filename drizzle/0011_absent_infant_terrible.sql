CREATE TYPE "public"."provider_attempt_status" AS ENUM('STARTED', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TABLE "provider_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"status" "provider_attempt_status" DEFAULT 'STARTED' NOT NULL,
	"provider" text NOT NULL,
	"requested_model" text NOT NULL,
	"response_model_version" text,
	"service_tier" text,
	"provider_request_id" text,
	"prompt_token_count" integer,
	"cached_content_token_count" integer,
	"candidates_token_count" integer,
	"tool_use_prompt_token_count" integer,
	"thoughts_token_count" integer,
	"total_token_count" integer,
	"pricing_snapshot_id" text,
	"pricing_status" text,
	"pricing_reason" text,
	"published_cost_usd_micros" bigint,
	"actual_billed_cost_usd_micros" bigint,
	"canonical" boolean DEFAULT false NOT NULL,
	"failure_reason" text,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_pricing_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"requested_model" text NOT NULL,
	"service_tier" text NOT NULL,
	"currency" text NOT NULL,
	"input_micros_per_million_tokens" bigint NOT NULL,
	"output_micros_per_million_tokens" bigint NOT NULL,
	"source_url" text NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "reserved_budget" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "campaigns"
SET "reserved_budget" = reserved."amount"
FROM (
	SELECT claims."campaign_id", count(*)::integer * campaigns."credit_reward" AS "amount"
	FROM "campaign_reward_claims" claims
	INNER JOIN "campaigns" campaigns ON campaigns."id" = claims."campaign_id"
	WHERE claims."status" = 'RESERVED'
	GROUP BY claims."campaign_id", campaigns."credit_reward"
) reserved
WHERE "campaigns"."id" = reserved."campaign_id";--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "campaigns" WHERE "reserved_budget" > "remaining_budget") THEN
		RAISE EXCEPTION 'existing campaign reservations exceed remaining CE budget';
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "provider_attempts" ADD CONSTRAINT "provider_attempts_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_attempts" ADD CONSTRAINT "provider_attempts_pricing_snapshot_id_provider_pricing_snapshots_id_fk" FOREIGN KEY ("pricing_snapshot_id") REFERENCES "public"."provider_pricing_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_attempt_job_number_unique" ON "provider_attempts" USING btree ("job_id","attempt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_attempt_request_unique" ON "provider_attempts" USING btree ("provider_request_id");--> statement-breakpoint
CREATE INDEX "provider_attempt_job_idx" ON "provider_attempts" USING btree ("job_id");
