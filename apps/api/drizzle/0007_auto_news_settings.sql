CREATE TYPE "public"."auto_news_source_kind" AS ENUM('PRESS_RELEASE', 'OFFICIAL_ALERT', 'RSS', 'TIP_ONLY');--> statement-breakpoint
CREATE TABLE "auto_news_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"test_mode" boolean DEFAULT true NOT NULL,
	"interval_minutes" integer DEFAULT 30 NOT NULL,
	"daily_cost_limit_cents" integer DEFAULT 150 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auto_news_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"kind" "auto_news_source_kind" DEFAULT 'PRESS_RELEASE' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"auto_publish" boolean DEFAULT false NOT NULL,
	"photos_allowed" boolean DEFAULT false NOT NULL,
	"note" text,
	"last_checked_at" timestamp with time zone,
	"last_error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auto_news_sources_url_unique" UNIQUE("url")
);
--> statement-breakpoint
ALTER TABLE "auto_news_settings" ADD CONSTRAINT "auto_news_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_news_sources" ADD CONSTRAINT "auto_news_sources_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_news_settings" ADD CONSTRAINT "auto_news_settings_single_row" CHECK ("id" = 1);--> statement-breakpoint
ALTER TABLE "auto_news_settings" ADD CONSTRAINT "auto_news_settings_interval" CHECK ("interval_minutes" BETWEEN 15 AND 1440);--> statement-breakpoint
ALTER TABLE "auto_news_settings" ADD CONSTRAINT "auto_news_settings_limit" CHECK ("daily_cost_limit_cents" BETWEEN 0 AND 10000);--> statement-breakpoint
INSERT INTO "auto_news_settings" ("id") VALUES (1) ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "auto_news_sources" ("name", "url", "kind", "photos_allowed", "note")
VALUES ('AP I&PR — press releases (ఆంధ్రప్రదేశ్ సమాచార పౌర సంబంధాల శాఖ)', 'https://ipr.ap.gov.in', 'PRESS_RELEASE', true, 'First source. Exact press-release address is checked in Step 2.')
ON CONFLICT DO NOTHING;
