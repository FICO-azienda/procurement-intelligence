CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"unit" text NOT NULL,
	"technical_specifications" text,
	"current_supplier_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"date" date NOT NULL,
	"quantity" numeric(16, 4) NOT NULL,
	"unit" text NOT NULL,
	"unit_price" numeric(16, 6) NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"fx_rate" numeric(16, 6) DEFAULT '1' NOT NULL,
	"freight_cost" numeric(16, 6) DEFAULT '0' NOT NULL,
	"other_costs" numeric(16, 6) DEFAULT '0' NOT NULL,
	"total_amount" numeric(16, 6) NOT NULL,
	"invoice_reference" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"date" date NOT NULL,
	"quantity" numeric(16, 4),
	"unit_price" numeric(16, 6) NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"fx_rate" numeric(16, 6) DEFAULT '1' NOT NULL,
	"moq" numeric(16, 4),
	"lead_time_days" integer,
	"payment_terms_days" integer,
	"incoterm" text,
	"valid_until" date,
	"source" text DEFAULT 'manual' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"country" text,
	"city" text,
	"contact_name" text,
	"email" text,
	"phone" text,
	"website" text,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"payment_terms_days" integer,
	"default_lead_time_days" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_current_supplier_id_suppliers_id_fk" FOREIGN KEY ("current_supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchases_product_date_idx" ON "purchases" USING btree ("product_id","date");--> statement-breakpoint
CREATE INDEX "purchases_supplier_date_idx" ON "purchases" USING btree ("supplier_id","date");--> statement-breakpoint
CREATE INDEX "quotes_product_idx" ON "quotes" USING btree ("product_id","date");