CREATE TABLE "literature" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"isbn" text,
	"date_published" date,
	"edition" text,
	"summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "literature_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"literature_id" uuid NOT NULL,
	"page" integer,
	"line_start" integer,
	"line_end" integer,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "literature_blocks" ADD CONSTRAINT "literature_blocks_literature_id_fk" FOREIGN KEY ("literature_id") REFERENCES "public"."literature"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_literature_blocks_literature_id" ON "literature_blocks" USING btree ("literature_id");