DROP INDEX "quest_campaign_user_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "quest_task_unique" ON "quest_sessions" USING btree ("task_id");