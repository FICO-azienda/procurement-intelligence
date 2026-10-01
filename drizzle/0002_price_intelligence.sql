CREATE TABLE "opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"type" text NOT NULL,
	"product_id" uuid,
	"alternative_supplier_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"note" text,
	"snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opportunities_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "specs" jsonb;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "price_review" text;--> statement-breakpoint
ALTER TABLE "supplier_products" ADD COLUMN "specs" jsonb;--> statement-breakpoint
ALTER TABLE "supplier_products" ADD COLUMN "comparability_override" text;--> statement-breakpoint
ALTER TABLE "supplier_products" ADD COLUMN "comparability_note" text;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_alternative_supplier_id_suppliers_id_fk" FOREIGN KEY ("alternative_supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;