CREATE TABLE "product_data_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"field" text NOT NULL,
	"value" text,
	"source" text DEFAULT 'user' NOT NULL,
	"document_id" uuid,
	"note" text,
	"estimate" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_data_fields" ADD CONSTRAINT "product_data_fields_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_data_fields" ADD CONSTRAINT "product_data_fields_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_data_fields_product_field_idx" ON "product_data_fields" USING btree ("product_id","field");