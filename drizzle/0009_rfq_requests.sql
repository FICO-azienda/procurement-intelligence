CREATE TABLE "rfq_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_key" text NOT NULL,
	"supplier_name" text NOT NULL,
	"candidate_ids" jsonb NOT NULL,
	"product_ids" jsonb NOT NULL,
	"kind" text DEFAULT 'request' NOT NULL,
	"sent_at" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "rfq_requests_supplier_idx" ON "rfq_requests" USING btree ("supplier_key");