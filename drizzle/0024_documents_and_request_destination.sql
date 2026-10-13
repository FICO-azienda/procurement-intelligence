ALTER TABLE "rfq_documents" ADD COLUMN "product_id" uuid;--> statement-breakpoint
ALTER TABLE "rfq_documents" ADD COLUMN "received_on" date;--> statement-breakpoint
ALTER TABLE "rfq_documents" ADD COLUMN "origin" text;--> statement-breakpoint
ALTER TABLE "rfq_documents" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rfq_documents" ADD COLUMN "verified_by" text;--> statement-breakpoint
ALTER TABLE "rfq_requests" ADD COLUMN "destination" text;--> statement-breakpoint
ALTER TABLE "rfq_documents" ADD CONSTRAINT "rfq_documents_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;