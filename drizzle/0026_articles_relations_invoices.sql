CREATE TABLE "article_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"type" text NOT NULL,
	"application" text,
	"reason" text,
	"state" text DEFAULT 'active' NOT NULL,
	"decided_by_type" text NOT NULL,
	"decided_by" text,
	"evidence_document_id" uuid,
	"supersedes_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"number" text NOT NULL,
	"date" date,
	"document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_a" uuid NOT NULL,
	"product_b" uuid NOT NULL,
	"type" text NOT NULL,
	"application" text,
	"reason" text,
	"state" text DEFAULT 'active' NOT NULL,
	"decided_by" text NOT NULL,
	"decided_by_type" text DEFAULT 'user' NOT NULL,
	"evidence_document_id" uuid,
	"supersedes_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"supplier_id" uuid,
	"code" text,
	"name" text NOT NULL,
	"key" text NOT NULL,
	"stated_specs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"unit" text,
	"source" text NOT NULL,
	"first_seen" date,
	"last_seen" date,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_products" ADD COLUMN "article_id" uuid;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "rfq_offers" ADD COLUMN "article_id" uuid;--> statement-breakpoint
ALTER TABLE "rfq_requests" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "rfq_threads" ADD COLUMN "request_id" uuid;--> statement-breakpoint
ALTER TABLE "supplier_products" ADD COLUMN "article_id" uuid;--> statement-breakpoint
ALTER TABLE "article_links" ADD CONSTRAINT "article_links_article_id_supplier_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."supplier_articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_links" ADD CONSTRAINT "article_links_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_links" ADD CONSTRAINT "article_links_evidence_document_id_documents_id_fk" FOREIGN KEY ("evidence_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_links" ADD CONSTRAINT "article_links_supersedes_id_article_links_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."article_links"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_relations" ADD CONSTRAINT "product_relations_product_a_products_id_fk" FOREIGN KEY ("product_a") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_relations" ADD CONSTRAINT "product_relations_product_b_products_id_fk" FOREIGN KEY ("product_b") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_relations" ADD CONSTRAINT "product_relations_evidence_document_id_documents_id_fk" FOREIGN KEY ("evidence_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_relations" ADD CONSTRAINT "product_relations_supersedes_id_product_relations_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."product_relations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_articles" ADD CONSTRAINT "supplier_articles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_articles" ADD CONSTRAINT "supplier_articles_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "article_links_article_idx" ON "article_links" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "article_links_product_idx" ON "article_links" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_supplier_number_idx" ON "invoices" USING btree ("supplier_id","number");--> statement-breakpoint
CREATE INDEX "product_relations_a_idx" ON "product_relations" USING btree ("product_a");--> statement-breakpoint
CREATE INDEX "product_relations_b_idx" ON "product_relations" USING btree ("product_b");--> statement-breakpoint
CREATE INDEX "supplier_articles_company_idx" ON "supplier_articles" USING btree ("company_id","key");--> statement-breakpoint
ALTER TABLE "order_products" ADD CONSTRAINT "order_products_article_id_supplier_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."supplier_articles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_offers" ADD CONSTRAINT "rfq_offers_article_id_supplier_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."supplier_articles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_requests" ADD CONSTRAINT "rfq_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_threads" ADD CONSTRAINT "rfq_threads_request_id_rfq_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."rfq_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_products" ADD CONSTRAINT "supplier_products_article_id_supplier_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."supplier_articles"("id") ON DELETE set null ON UPDATE no action;