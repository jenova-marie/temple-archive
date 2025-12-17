-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "conversations" (
	"conversation_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'active',
	"summary" text,
	"metadata" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE TABLE "crisis_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"conversation_id" text,
	"user_id" text NOT NULL,
	"crisis_level" integer NOT NULL,
	"patterns" jsonb NOT NULL,
	"action_taken" text NOT NULL,
	"handled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"message_id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE TABLE "session_summaries" (
	"summary_id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"time_window_start" timestamp with time zone NOT NULL,
	"time_window_end" timestamp with time zone NOT NULL,
	"summary_text" text NOT NULL,
	"summary_embedding" vector(1536),
	"key_topics" text[] DEFAULT '{}',
	"entities_mentioned" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE "user_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"recovery_phase" text,
	"sobriety_date" date,
	"triggers" text[] DEFAULT '{}',
	"coping_strategies" text[] DEFAULT '{}',
	"preferences" jsonb DEFAULT '{}'::jsonb,
	"milestones" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_updated" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"user_id" text PRIMARY KEY NOT NULL,
	"email" text,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crisis_events" ADD CONSTRAINT "crisis_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("conversation_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crisis_events" ADD CONSTRAINT "crisis_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("conversation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_summaries" ADD CONSTRAINT "summaries_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("conversation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_conversations_user_updated" ON "conversations" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "idx_conversations_status" ON "conversations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_crisis_events_user" ON "crisis_events" USING btree ("user_id","handled_at");--> statement-breakpoint
CREATE INDEX "idx_crisis_events_level" ON "crisis_events" USING btree ("crisis_level");--> statement-breakpoint
CREATE INDEX "idx_messages_conversation" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_messages_user" ON "messages" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_summaries_conversation" ON "session_summaries" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_system_prompts_name" ON "system_prompts" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_system_prompts_active_unique" ON "system_prompts" USING btree ("name") WHERE active = true;