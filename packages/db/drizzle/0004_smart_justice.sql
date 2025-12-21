CREATE TABLE "transcriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"text" text NOT NULL,
	"duration" real,
	"source" varchar(20) NOT NULL,
	"filename" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transcriptions" ADD CONSTRAINT "transcriptions_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transcriptions_user_id_idx" ON "transcriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "transcriptions_created_at_idx" ON "transcriptions" USING btree ("created_at");