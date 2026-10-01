CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"storage_path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_sha256_unique" UNIQUE("sha256")
);
--> statement-breakpoint
CREATE TABLE "import_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"line" integer NOT NULL,
	"record_type" text DEFAULT 'purchase' NOT NULL,
	"raw" jsonb NOT NULL,
	"extracted" jsonb NOT NULL,
	"data" jsonb NOT NULL,
	"confidence" real,
	"supplier_id" uuid,
	"supplier_match" jsonb,
	"supplier_resolution" text,
	"product_id" uuid,
	"product_match" jsonb,
	"product_resolution" text,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"acknowledged" boolean DEFAULT false NOT NULL,
	"duplicate_decision" text,
	"status" text DEFAULT 'attention' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid,
	"filename" text NOT NULL,
	"file_type" text NOT NULL,
	"source_type" text NOT NULL,
	"record_type" text DEFAULT 'purchase' NOT NULL,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"records_detected" integer DEFAULT 0 NOT NULL,
	"records_imported" integer DEFAULT 0 NOT NULL,
	"records_review" integer DEFAULT 0 NOT NULL,
	"records_rejected" integer DEFAULT 0 NOT NULL,
	"new_suppliers" integer DEFAULT 0 NOT NULL,
	"new_products" integer DEFAULT 0 NOT NULL,
	"extraction" jsonb,
	"mapping" jsonb,
	"duplicate_of_session_id" uuid,
	"summary" jsonb,
	"error_message" text,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"normalized" text NOT NULL,
	"supplier_id" uuid,
	"source" text DEFAULT 'import' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_aliases_normalized_unique" UNIQUE("normalized")
);
--> statement-breakpoint
CREATE TABLE "supplier_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"normalized" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_aliases_normalized_unique" UNIQUE("normalized")
);
--> statement-breakpoint
CREATE TABLE "supplier_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"supplier_sku" text,
	"supplier_product_name" text,
	"moq" numeric(16, 4),
	"lead_time_days" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "purchases" ALTER COLUMN "fx_rate" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ALTER COLUMN "fx_rate" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "payment_terms_days" integer;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "incoterm" text;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "original_description" text;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "import_item_id" uuid;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "freight_cost" numeric(16, 6);--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "original_description" text;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "import_item_id" uuid;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "vat_number" text;--> statement-breakpoint
ALTER TABLE "import_items" ADD CONSTRAINT "import_items_session_id_import_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."import_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_items" ADD CONSTRAINT "import_items_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_items" ADD CONSTRAINT "import_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_sessions" ADD CONSTRAINT "import_sessions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_aliases" ADD CONSTRAINT "product_aliases_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_aliases" ADD CONSTRAINT "product_aliases_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_aliases" ADD CONSTRAINT "supplier_aliases_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_products" ADD CONSTRAINT "supplier_products_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_products" ADD CONSTRAINT "supplier_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_items_session_idx" ON "import_items" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "import_items_status_idx" ON "import_items" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_products_pair_idx" ON "supplier_products" USING btree ("supplier_id","product_id");--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_import_item_id_import_items_id_fk" FOREIGN KEY ("import_item_id") REFERENCES "public"."import_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_import_item_id_import_items_id_fk" FOREIGN KEY ("import_item_id") REFERENCES "public"."import_items"("id") ON DELETE set null ON UPDATE no action;