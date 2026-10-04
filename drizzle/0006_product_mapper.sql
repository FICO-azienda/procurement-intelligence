CREATE TABLE "product_families" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"subcategory" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_separations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_a" uuid NOT NULL,
	"product_b" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "subcategory" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "family_id" uuid;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "variant" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "mapped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "product_separations" ADD CONSTRAINT "product_separations_product_a_products_id_fk" FOREIGN KEY ("product_a") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_separations" ADD CONSTRAINT "product_separations_product_b_products_id_fk" FOREIGN KEY ("product_b") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_separations_pair_idx" ON "product_separations" USING btree ("product_a","product_b");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_family_id_product_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."product_families"("id") ON DELETE set null ON UPDATE no action;