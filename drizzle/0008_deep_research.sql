CREATE TABLE "research_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"kind" text NOT NULL,
	"request" text NOT NULL,
	"response" jsonb,
	"retrieved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"candidate_id" uuid,
	"type" text NOT NULL,
	"source_name" text NOT NULL,
	"source_url" text,
	"retrieved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" date,
	"finding" jsonb NOT NULL,
	"excerpt" text,
	"reliability" text DEFAULT 'external' NOT NULL,
	"comparability" text,
	"confidence" text
);
--> statement-breakpoint
CREATE TABLE "research_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"depth" text DEFAULT 'standard' NOT NULL,
	"product_class" text,
	"sources_checked" integer DEFAULT 0 NOT NULL,
	"results_found" integer DEFAULT 0 NOT NULL,
	"confidence" text,
	"summary" jsonb,
	"steps" jsonb,
	"queries" jsonb,
	"errors" jsonb
);
--> statement-breakpoint
CREATE TABLE "research_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid,
	"product_id" uuid,
	"provider" text NOT NULL,
	"kind" text NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"cached" integer DEFAULT 0 NOT NULL,
	"estimated_cost" numeric(12, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "market_benchmarks" ADD COLUMN "fx_rate" numeric(16, 6);--> statement-breakpoint
ALTER TABLE "market_benchmarks" ADD COLUMN "fx_date" date;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "customs_code" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "customs_code_confirmed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "research_class" text;--> statement-breakpoint
ALTER TABLE "supplier_candidates" ADD COLUMN "company_type" text;--> statement-breakpoint
ALTER TABLE "supplier_candidates" ADD COLUMN "source_title" text;--> statement-breakpoint
ALTER TABLE "supplier_candidates" ADD COLUMN "discovered_at" date;--> statement-breakpoint
ALTER TABLE "supplier_candidates" ADD COLUMN "spec_check" jsonb;--> statement-breakpoint
ALTER TABLE "research_evidence" ADD CONSTRAINT "research_evidence_run_id_research_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."research_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_evidence" ADD CONSTRAINT "research_evidence_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_evidence" ADD CONSTRAINT "research_evidence_candidate_id_supplier_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."supplier_candidates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_runs" ADD CONSTRAINT "research_runs_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_usage" ADD CONSTRAINT "research_usage_run_id_research_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."research_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_usage" ADD CONSTRAINT "research_usage_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "research_evidence_product_idx" ON "research_evidence" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "research_evidence_run_idx" ON "research_evidence" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "research_runs_product_idx" ON "research_runs" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "research_usage_created_idx" ON "research_usage" USING btree ("created_at");