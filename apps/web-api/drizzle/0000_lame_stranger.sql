CREATE TABLE "transcriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"text" text NOT NULL,
	"duration" real,
	"source" varchar(20) NOT NULL,
	"filename" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL
);
