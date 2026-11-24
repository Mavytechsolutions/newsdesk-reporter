CREATE TYPE "public"."application_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."contributor_level" AS ENUM('JUNIOR', 'JOURNALIST', 'SENIOR');--> statement-breakpoint
CREATE TABLE "journalist_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"location_id" uuid NOT NULL,
	"aadhaar_file" text,
	"status" "application_status" DEFAULT 'PENDING' NOT NULL,
	"note" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "point_events" (
	"article_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"points" integer NOT NULL,
	"level" "contributor_level" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "contributor_level" "contributor_level";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "contributor_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "contributor_suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "points" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "approved_posts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "journalist_applications" ADD CONSTRAINT "journalist_applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journalist_applications" ADD CONSTRAINT "journalist_applications_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journalist_applications" ADD CONSTRAINT "journalist_applications_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_events" ADD CONSTRAINT "point_events_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_events" ADD CONSTRAINT "point_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ja_status_idx" ON "journalist_applications" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "ja_user_idx" ON "journalist_applications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "pe_user_idx" ON "point_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ja_one_pending_per_user" ON "journalist_applications" ("user_id") WHERE "status" = 'PENDING';
