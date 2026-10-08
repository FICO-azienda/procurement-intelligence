CREATE TABLE "product_merges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"merged_id" uuid NOT NULL,
	"moved" jsonb NOT NULL,
	"name_before" text NOT NULL,
	"name_after" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "merged_into_id" uuid;--> statement-breakpoint
ALTER TABLE "product_merges" ADD CONSTRAINT "product_merges_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_merges" ADD CONSTRAINT "product_merges_merged_id_products_id_fk" FOREIGN KEY ("merged_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_merges_product_idx" ON "product_merges" USING btree ("product_id");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_merged_into_id_products_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;