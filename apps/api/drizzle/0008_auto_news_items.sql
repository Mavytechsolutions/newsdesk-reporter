CREATE TYPE "public"."auto_news_item_status" AS ENUM('NEW', 'DUPLICATE', 'TIP', 'SKIPPED');--> statement-breakpoint
CREATE TABLE "auto_news_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid,
	"source_name" text NOT NULL,
	"external_id" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"details" jsonb,
	"area" text,
	"language" text,
	"published_at" timestamp with time zone,
	"fingerprint" text NOT NULL,
	"status" "auto_news_item_status" DEFAULT 'NEW' NOT NULL,
	"duplicate_of" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auto_news_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid,
	"source_name" text NOT NULL,
	"trigger" text DEFAULT 'schedule' NOT NULL,
	"found" integer DEFAULT 0 NOT NULL,
	"added" integer DEFAULT 0 NOT NULL,
	"duplicates" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "auto_news_items" ADD CONSTRAINT "auto_news_items_source_id_auto_news_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."auto_news_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_news_runs" ADD CONSTRAINT "auto_news_runs_source_id_auto_news_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."auto_news_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auto_news_items_source_ext_idx" ON "auto_news_items" USING btree ("source_id","external_id");--> statement-breakpoint
CREATE INDEX "auto_news_items_fp_idx" ON "auto_news_items" USING btree ("fingerprint","created_at");--> statement-breakpoint
CREATE INDEX "auto_news_items_created_idx" ON "auto_news_items" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "auto_news_runs_started_idx" ON "auto_news_runs" USING btree ("started_at");--> statement-breakpoint
UPDATE "auto_news_sources" SET "enabled" = false, "note" = 'Switched off: the I&PR website has no readable press-release list or feed (checked 26 Nov 2026). Press notes can be added later by e-mail forwarding.' WHERE "url" = 'https://ipr.ap.gov.in';--> statement-breakpoint
INSERT INTO "auto_news_sources" ("name", "url", "kind", "enabled", "photos_allowed", "note") VALUES
 ('NDMA Sachet — APSDMA / IMD alerts (AP & Telangana)', 'https://sachet.ndma.gov.in/cap_public_website/rss/rss_india.xml', 'OFFICIAL_ALERT', true, false, 'Official disaster and weather alerts. Only Andhra Pradesh and Telangana alerts are kept.'),
 ('PIB — Government of India press releases', 'https://pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3', 'RSS', false, true, 'Switched off: PIB blocks our server (Access Denied, checked 26 Nov 2026). We do not try to get around a block.')
ON CONFLICT DO NOTHING;
