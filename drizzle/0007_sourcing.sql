CREATE TABLE "market_benchmarks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"type" text NOT NULL,
	"label" text NOT NULL,
	"low" numeric(16, 6),
	"high" numeric(16, 6),
	"unit" text,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"change_pct" real,
	"period" text,
	"source_name" text NOT NULL,
	"source_url" text,
	"source_date" date,
	"source_level" text DEFAULT 'external' NOT NULL,
	"comparability" text DEFAULT 'partial' NOT NULL,
	"notes" text,
	"provider" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"country" text,
	"website" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"source_level" text DEFAULT 'external' NOT NULL,
	"source_url" text,
	"source_date" date,
	"product_matched" text,
	"match_reason" text,
	"technical_compatibility" text,
	"specifications" jsonb,
	"price_low" numeric(16, 6),
	"price_high" numeric(16, 6),
	"price_type" text,
	"price_source_url" text,
	"currency" text,
	"unit" text,
	"incoterm" text,
	"moq" numeric(16, 4),
	"lead_time_days" integer,
	"payment_terms" text,
	"certifications" text,
	"shipping_origin" text,
	"confidence" text,
	"notes" text,
	"status" text DEFAULT 'discovered' NOT NULL,
	"supplier_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "market_benchmarks" ADD CONSTRAINT "market_benchmarks_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_candidates" ADD CONSTRAINT "supplier_candidates_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_candidates" ADD CONSTRAINT "supplier_candidates_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "market_benchmarks_product_idx" ON "market_benchmarks" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "supplier_candidates_product_idx" ON "supplier_candidates" USING btree ("product_id");