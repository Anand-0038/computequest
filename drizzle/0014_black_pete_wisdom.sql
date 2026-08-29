CREATE TYPE "public"."sponsor_creative_type" AS ENUM('VIDEO', 'X_POST', 'IMAGE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."sponsor_inquiry_status" AS ENUM('RECEIVED', 'CONTACTED', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TABLE "sponsor_inquiries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"client_request_id" uuid NOT NULL,
	"company_name" text NOT NULL,
	"contact_name" text NOT NULL,
	"contact_email" text NOT NULL,
	"company_website" text NOT NULL,
	"creative_type" "sponsor_creative_type" NOT NULL,
	"creative_url" text NOT NULL,
	"campaign_title" text NOT NULL,
	"description" text NOT NULL,
	"status" "sponsor_inquiry_status" DEFAULT 'RECEIVED' NOT NULL,
	"review_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sponsor_inquiries" ADD CONSTRAINT "sponsor_inquiries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sponsor_inquiry_user_request_unique" ON "sponsor_inquiries" USING btree ("user_id","client_request_id");--> statement-breakpoint
CREATE INDEX "sponsor_inquiry_status_created_idx" ON "sponsor_inquiries" USING btree ("status","created_at");