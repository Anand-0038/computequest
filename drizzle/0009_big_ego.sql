CREATE TABLE "attention_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"quest_session_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"server_timestamp" timestamp with time zone NOT NULL,
	"media_time_ms" bigint NOT NULL,
	"duration_ms" bigint NOT NULL,
	"playback_rate_milli" integer NOT NULL,
	"document_visible" boolean NOT NULL,
	"window_focused" boolean NOT NULL,
	"fullscreen" boolean NOT NULL,
	"picture_in_picture" boolean NOT NULL,
	"buffering" boolean NOT NULL,
	"media_playing" boolean NOT NULL,
	"eligible" boolean NOT NULL,
	"reason" text NOT NULL,
	"credited_ms" bigint NOT NULL,
	"event_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quest_sessions" ADD COLUMN "last_media_time_ms" bigint;--> statement-breakpoint
ALTER TABLE "quest_sessions" ADD COLUMN "last_attention_reason" text DEFAULT 'VIDEO_NOT_PLAYING' NOT NULL;--> statement-breakpoint
ALTER TABLE "attention_events" ADD CONSTRAINT "attention_events_quest_session_id_quest_sessions_id_fk" FOREIGN KEY ("quest_session_id") REFERENCES "public"."quest_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attention_event_session_sequence_unique" ON "attention_events" USING btree ("quest_session_id","sequence");--> statement-breakpoint
CREATE INDEX "attention_event_session_idx" ON "attention_events" USING btree ("quest_session_id");