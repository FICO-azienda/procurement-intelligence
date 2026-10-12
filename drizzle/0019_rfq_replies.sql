CREATE TABLE "rfq_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"key" text NOT NULL,
	"date" date NOT NULL,
	"kind" text DEFAULT 'reply' NOT NULL,
	"status" text,
	"summary" text,
	"reference" text,
	"attachments" text,
	"source" text DEFAULT 'file' NOT NULL,
	"source_file" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rfq_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"key" text NOT NULL,
	"product_name" text NOT NULL,
	"product_code" text,
	"grade" text,
	"category" text,
	"unit_price" numeric(16, 6) NOT NULL,
	"currency" text NOT NULL,
	"unit" text NOT NULL,
	"quantity" numeric(16, 4),
	"moq" numeric(16, 4),
	"incoterm" text,
	"destination" text,
	"payment_terms" text,
	"offered_on" date,
	"valid_until" date,
	"validity" text,
	"specs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"validation" text DEFAULT 'required' NOT NULL,
	"technical_status" text,
	"missing" text,
	"source_url" text,
	"source_document" text,
	"original" jsonb,
	"source_file" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rfq_suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"country" text,
	"address" text,
	"website" text,
	"email" text,
	"phone" text,
	"contact_name" text,
	"vat_number" text,
	"tax_code" text,
	"company_type" text,
	"confirmed" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checked_at" date,
	"source_file" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rfq_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"reference" text,
	"categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text NOT NULL,
	"status_text" text,
	"products" text,
	"offer_summary" text,
	"moq" text,
	"payment_terms" text,
	"lead_time" text,
	"samples" text,
	"missing" text,
	"next_action" text,
	"priority" text,
	"notes" text,
	"original" jsonb,
	"confirmed" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checked_at" date,
	"source_file" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rfq_messages" ADD CONSTRAINT "rfq_messages_thread_id_rfq_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."rfq_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_offers" ADD CONSTRAINT "rfq_offers_thread_id_rfq_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."rfq_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_threads" ADD CONSTRAINT "rfq_threads_supplier_id_rfq_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."rfq_suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rfq_messages_line_idx" ON "rfq_messages" USING btree ("thread_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "rfq_offers_line_idx" ON "rfq_offers" USING btree ("thread_id","key");--> statement-breakpoint
CREATE INDEX "rfq_threads_supplier_idx" ON "rfq_threads" USING btree ("supplier_id");