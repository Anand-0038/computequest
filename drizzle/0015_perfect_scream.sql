ALTER TABLE "sponsor_inquiries" ADD COLUMN "destination_url" text;--> statement-breakpoint
UPDATE "sponsor_inquiries" SET "destination_url" = "company_website" WHERE "destination_url" IS NULL;--> statement-breakpoint
ALTER TABLE "sponsor_inquiries" ALTER COLUMN "destination_url" SET NOT NULL;
