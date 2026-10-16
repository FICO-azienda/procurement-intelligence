CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"other_names" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"vat_number" text,
	"tax_code" text,
	"vat_key" text,
	"tax_key" text,
	"country" text,
	"city" text,
	"website" text,
	"domain" text,
	"merged_into_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text,
	"role" text,
	"email" text,
	"phone" text,
	"note" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"a_id" uuid NOT NULL,
	"b_id" uuid NOT NULL,
	"relation" text NOT NULL,
	"note" text,
	"decided_by" text NOT NULL,
	"decided_by_type" text DEFAULT 'user' NOT NULL,
	"undone_at" timestamp with time zone,
	"undone_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "market_suppliers" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "rfq_suppliers" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "supplier_candidates" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_merged_into_id_companies_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_contacts" ADD CONSTRAINT "company_contacts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_relations" ADD CONSTRAINT "company_relations_a_id_companies_id_fk" FOREIGN KEY ("a_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_relations" ADD CONSTRAINT "company_relations_b_id_companies_id_fk" FOREIGN KEY ("b_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "companies_vat_idx" ON "companies" USING btree ("vat_key");--> statement-breakpoint
CREATE INDEX "companies_tax_idx" ON "companies" USING btree ("tax_key");--> statement-breakpoint
CREATE INDEX "companies_domain_idx" ON "companies" USING btree ("domain");--> statement-breakpoint
ALTER TABLE "market_suppliers" ADD CONSTRAINT "market_suppliers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_suppliers" ADD CONSTRAINT "rfq_suppliers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_candidates" ADD CONSTRAINT "supplier_candidates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;