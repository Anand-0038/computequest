CREATE TYPE "public"."credit_entry_type" AS ENUM('INITIAL_GRANT', 'QUEST_GRANT', 'TASK_SPEND', 'JOB_REFUND');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('FUNDED', 'PROCESSING', 'COMPLETED', 'FAILED', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."quest_state" AS ENUM('CREATED', 'ACTIVE', 'PAUSED', 'VERIFYING', 'AUTHORIZED', 'SETTLING', 'SETTLED', 'CREDITED', 'EXPIRED', 'REJECTED', 'ALREADY_CLAIMED', 'SETTLEMENT_FAILED');--> statement-breakpoint
CREATE TYPE "public"."settlement_status" AS ENUM('AUTHORIZED', 'SUBMITTED', 'CONFIRMED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('CREATED', 'AWAITING_CREDITS', 'FUNDED', 'PROCESSING', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"onchain_campaign_id" bigint,
	"reward" integer NOT NULL,
	"required_active_seconds" integer NOT NULL,
	"remaining_budget" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_onchain_campaign_id_unique" UNIQUE("onchain_campaign_id")
);
--> statement-breakpoint
CREATE TABLE "credit_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"type" "credit_entry_type" NOT NULL,
	"reference_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"status" "job_status" DEFAULT 'FUNDED' NOT NULL,
	"provider" text NOT NULL,
	"provider_request_id" text,
	"structured_result" jsonb,
	"failure_reason" text,
	"refunded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quest_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"campaign_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"nonce" text NOT NULL,
	"server_started_at" timestamp with time zone NOT NULL,
	"accumulated_active_ms" bigint DEFAULT 0 NOT NULL,
	"last_heartbeat_at" timestamp with time zone,
	"last_heartbeat_sequence" integer DEFAULT 0 NOT NULL,
	"state" "quest_state" DEFAULT 'CREATED' NOT NULL,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"quest_session_id" uuid NOT NULL,
	"session_hash" text NOT NULL,
	"transaction_hash" text,
	"chain_id" integer NOT NULL,
	"status" "settlement_status" DEFAULT 'AUTHORIZED' NOT NULL,
	"block_number" bigint,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"prompt" text NOT NULL,
	"task_type" text DEFAULT 'PITCH_DECK' NOT NULL,
	"estimated_cost" integer NOT NULL,
	"status" "task_status" DEFAULT 'CREATED' NOT NULL,
	"result" jsonb,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"wallet_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_wallet_address_unique" UNIQUE("wallet_address")
);
--> statement-breakpoint
ALTER TABLE "credit_entries" ADD CONSTRAINT "credit_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quest_sessions" ADD CONSTRAINT "quest_sessions_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quest_sessions" ADD CONSTRAINT "quest_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quest_sessions" ADD CONSTRAINT "quest_sessions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_quest_session_id_quest_sessions_id_fk" FOREIGN KEY ("quest_session_id") REFERENCES "public"."quest_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_idempotency_unique" ON "credit_entries" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "credit_user_idx" ON "credit_entries" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_task_unique" ON "jobs" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quest_nonce_unique" ON "quest_sessions" USING btree ("nonce");--> statement-breakpoint
CREATE UNIQUE INDEX "quest_campaign_user_unique" ON "quest_sessions" USING btree ("campaign_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_quest_unique" ON "settlements" USING btree ("quest_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_session_hash_unique" ON "settlements" USING btree ("session_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_transaction_hash_unique" ON "settlements" USING btree ("transaction_hash");--> statement-breakpoint
CREATE INDEX "tasks_user_idx" ON "tasks" USING btree ("user_id");