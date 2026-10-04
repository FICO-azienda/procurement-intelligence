ALTER TABLE "product_aliases" DROP CONSTRAINT "product_aliases_normalized_unique";--> statement-breakpoint
ALTER TABLE "product_aliases" ADD COLUMN "supplier_sku" text;--> statement-breakpoint
ALTER TABLE "product_aliases" ADD COLUMN "ean" text;--> statement-breakpoint
ALTER TABLE "product_aliases" ADD COLUMN "confidence" text;--> statement-breakpoint
ALTER TABLE "product_aliases" ADD COLUMN "confirmed_by_user" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "product_aliases" ADD COLUMN "source_session_id" uuid;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "kind" text DEFAULT 'needs_review' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "invoice_line" integer;--> statement-breakpoint
ALTER TABLE "product_aliases" ADD CONSTRAINT "product_aliases_source_session_id_import_sessions_id_fk" FOREIGN KEY ("source_session_id") REFERENCES "public"."import_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_aliases_normalized_idx" ON "product_aliases" USING btree ("normalized");--> statement-breakpoint
CREATE INDEX "product_aliases_product_idx" ON "product_aliases" USING btree ("product_id");