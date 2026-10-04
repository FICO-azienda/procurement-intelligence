CREATE TABLE "product_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"type" text DEFAULT 'technical_datasheet' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "true_cost_scenarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"freight_per_unit" numeric(16, 6),
	"freight_basis" text,
	"duty_rate_pct" real,
	"duty_basis" text,
	"customs_per_unit" numeric(16, 6),
	"other_per_unit" numeric(16, 6),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "true_cost_scenarios_quote_id_unique" UNIQUE("quote_id")
);
--> statement-breakpoint
ALTER TABLE "market_benchmarks" ADD COLUMN "period_month" text;--> statement-breakpoint
ALTER TABLE "market_benchmarks" ADD COLUMN "fx_method" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "rfq_name" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "application" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "in_pilot" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "financing_rate_pct" real;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "holding_rate_pct" real;--> statement-breakpoint
ALTER TABLE "product_documents" ADD CONSTRAINT "product_documents_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_documents" ADD CONSTRAINT "product_documents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "true_cost_scenarios" ADD CONSTRAINT "true_cost_scenarios_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_documents_product_idx" ON "product_documents" USING btree ("product_id");