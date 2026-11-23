-- Fast "contains" search that works for Telugu and English text (trigram indexes)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS article_tr_headline_trgm ON article_translations USING gin (headline gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS article_tr_summary_trgm ON article_translations USING gin (summary gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS locations_name_en_trgm ON locations USING gin (name_en gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS locations_name_te_trgm ON locations USING gin (name_te gin_trgm_ops);
