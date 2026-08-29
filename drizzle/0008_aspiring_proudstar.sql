CREATE TYPE "public"."relay_attempt_status" AS ENUM('SUBMITTING', 'SUBMITTED', 'CONFIRMED', 'REVERTED', 'FAILED');--> statement-breakpoint
CREATE TABLE "settlement_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"settlement_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"transaction_hash" text,
	"status" "relay_attempt_status" DEFAULT 'SUBMITTING' NOT NULL,
	"failure_reason" text,
	"block_number" bigint,
	"submitted_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "settlement_attempts" ADD CONSTRAINT "settlement_attempts_settlement_id_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_attempt_number_unique" ON "settlement_attempts" USING btree ("settlement_id","attempt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_attempt_transaction_hash_unique" ON "settlement_attempts" USING btree ("transaction_hash");--> statement-breakpoint
CREATE INDEX "settlement_attempt_settlement_idx" ON "settlement_attempts" USING btree ("settlement_id");