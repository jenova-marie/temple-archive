CREATE TABLE "system_prompts" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"content" text NOT NULL,
	"variables" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created" timestamp with time zone NOT NULL,
	"updated" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ALTER COLUMN "conversation_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "conversations" ALTER COLUMN "conversation_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "conversations" ALTER COLUMN "user_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "crisis_events" ALTER COLUMN "event_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "crisis_events" ALTER COLUMN "event_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "crisis_events" ALTER COLUMN "conversation_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "crisis_events" ALTER COLUMN "user_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "message_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "message_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "conversation_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "user_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "session_summaries" ALTER COLUMN "summary_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "session_summaries" ALTER COLUMN "summary_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "session_summaries" ALTER COLUMN "conversation_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "user_profiles" ALTER COLUMN "user_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "user_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
CREATE INDEX "idx_system_prompts_name" ON "system_prompts" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_system_prompts_active_unique" ON "system_prompts" USING btree ("name") WHERE active = true;