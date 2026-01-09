CREATE TABLE "message_turns" (
	"turn_id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"user_message_id" text NOT NULL,
	"assistant_message_id" text NOT NULL,
	"sequence_number" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "message_turns" ADD CONSTRAINT "turns_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("conversation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_turns" ADD CONSTRAINT "turns_user_message_id_fk" FOREIGN KEY ("user_message_id") REFERENCES "public"."messages"("message_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_turns" ADD CONSTRAINT "turns_assistant_message_id_fk" FOREIGN KEY ("assistant_message_id") REFERENCES "public"."messages"("message_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_turns_conversation" ON "message_turns" USING btree ("conversation_id","sequence_number");--> statement-breakpoint
CREATE INDEX "idx_turns_user_msg" ON "message_turns" USING btree ("user_message_id");--> statement-breakpoint
CREATE INDEX "idx_turns_assistant_msg" ON "message_turns" USING btree ("assistant_message_id");