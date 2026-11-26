CREATE TABLE "auto_news_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid,
	"item_id" uuid,
	"origin" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_name" text NOT NULL,
	"source_url" text,
	"input_text" text,
	"photo_count" integer DEFAULT 0 NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_paise" integer DEFAULT 0 NOT NULL,
	"needs_verification" boolean DEFAULT false NOT NULL,
	"notes" text,
	"error" text,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auto_news_secrets" (
	"name" text PRIMARY KEY NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"tag" text NOT NULL,
	"last4" text NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auto_news_posts" ADD CONSTRAINT "auto_news_posts_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_news_posts" ADD CONSTRAINT "auto_news_posts_item_id_auto_news_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."auto_news_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_news_posts" ADD CONSTRAINT "auto_news_posts_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_news_secrets" ADD CONSTRAINT "auto_news_secrets_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auto_news_posts_created_idx" ON "auto_news_posts" USING btree ("created_at");