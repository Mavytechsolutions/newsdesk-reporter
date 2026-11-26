ALTER TABLE "auto_news_settings" ADD COLUMN "daily_cost_limit_inr" integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "auto_news_settings" ADD CONSTRAINT "auto_news_settings_limit_inr" CHECK ("daily_cost_limit_inr" BETWEEN 0 AND 10000);--> statement-breakpoint
-- alerts saved without their details (no place, no expiry) are removed; they are collected again properly at the next check
DELETE FROM "auto_news_items" WHERE "details" IS NULL AND "source_id" IN (SELECT "id" FROM "auto_news_sources" WHERE "kind" = 'OFFICIAL_ALERT');
