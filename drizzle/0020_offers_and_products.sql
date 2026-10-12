CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"field" text,
	"old_value" text,
	"new_value" text,
	"source" text,
	"note" text,
	"attribution" text DEFAULT 'recorded' NOT NULL,
	"original_actor_type" text
);
--> statement-breakpoint
CREATE TABLE "company_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"a_kind" text NOT NULL,
	"a_id" text NOT NULL,
	"b_kind" text NOT NULL,
	"b_id" text NOT NULL,
	"relation" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_destinations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient" text,
	"address" text,
	"postal_code" text,
	"city" text NOT NULL,
	"province" text,
	"country" text,
	"unloading" text,
	"restrictions" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rfq_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"offer_id" uuid,
	"kind" text DEFAULT 'other' NOT NULL,
	"name" text NOT NULL,
	"url" text,
	"document_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rfq_offers" ADD COLUMN "product_id" uuid;--> statement-breakpoint
ALTER TABLE "rfq_offers" ADD COLUMN "compatibility" text DEFAULT 'not_analyzed' NOT NULL;--> statement-breakpoint
ALTER TABLE "rfq_offers" ADD COLUMN "compatibility_note" text;--> statement-breakpoint
ALTER TABLE "rfq_offers" ADD COLUMN "declined_product_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "rfq_offers" ADD COLUMN "decision" text;--> statement-breakpoint
ALTER TABLE "rfq_offers" ADD COLUMN "decision_note" text;--> statement-breakpoint
ALTER TABLE "rfq_offers" ADD COLUMN "landed" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "rfq_offers" ADD COLUMN "destination_id" uuid;--> statement-breakpoint
ALTER TABLE "rfq_threads" ADD COLUMN "follow_up_on" date;--> statement-breakpoint
ALTER TABLE "rfq_documents" ADD CONSTRAINT "rfq_documents_thread_id_rfq_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."rfq_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_documents" ADD CONSTRAINT "rfq_documents_offer_id_rfq_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."rfq_offers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_documents" ADD CONSTRAINT "rfq_documents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_links_pair_idx" ON "company_links" USING btree ("a_kind","a_id","b_kind","b_id");--> statement-breakpoint
CREATE INDEX "rfq_documents_thread_idx" ON "rfq_documents" USING btree ("thread_id");--> statement-breakpoint
ALTER TABLE "rfq_offers" ADD CONSTRAINT "rfq_offers_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_offers" ADD CONSTRAINT "rfq_offers_destination_id_delivery_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."delivery_destinations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
UPDATE "rfq_offers" SET "compatibility" = CASE "validation" WHEN 'validated' THEN 'validated' WHEN 'not_equivalent' THEN 'not_equivalent' ELSE 'not_analyzed' END;
--> statement-breakpoint
INSERT INTO "audit_events" ("at","actor_type","actor_id","action","entity","entity_id","source","attribution") SELECT "created_at",'import',"source_file",'create','rfq_supplier',"id"::text,"source_file",'reconstructed' FROM "rfq_suppliers" WHERE "source_file" IS NOT NULL;
--> statement-breakpoint
INSERT INTO "audit_events" ("at","actor_type","actor_id","action","entity","entity_id","source","attribution") SELECT "created_at",'import',"source_file",'create','rfq_thread',"id"::text,"source_file",'reconstructed' FROM "rfq_threads" WHERE "source_file" IS NOT NULL;
--> statement-breakpoint
INSERT INTO "audit_events" ("at","actor_type","actor_id","action","entity","entity_id","source","attribution") SELECT "created_at",'import',"source_file",'create','rfq_offer',"id"::text,"source_file",'reconstructed' FROM "rfq_offers" WHERE "source_file" IS NOT NULL;
--> statement-breakpoint
INSERT INTO "audit_events" ("at","actor_type","action","entity","entity_id","field","source","attribution") SELECT "updated_at",'user','update','rfq_thread',"id"::text,(SELECT string_agg(t.value, ', ') FROM jsonb_array_elements_text("confirmed") AS t(value)),'ui','uncertain' FROM "rfq_threads" WHERE jsonb_array_length("confirmed") > 0;
--> statement-breakpoint
INSERT INTO "audit_events" ("at","actor_type","action","entity","entity_id","field","source","attribution") SELECT "updated_at",'user','update','rfq_supplier',"id"::text,(SELECT string_agg(t.value, ', ') FROM jsonb_array_elements_text("confirmed") AS t(value)),'ui','uncertain' FROM "rfq_suppliers" WHERE jsonb_array_length("confirmed") > 0;
--> statement-breakpoint
INSERT INTO "audit_events" ("at","actor_type","action","entity","entity_id","new_value","source","attribution") SELECT "created_at",'user','note','rfq_thread',"thread_id"::text,"summary",'ui','uncertain' FROM "rfq_messages" WHERE "source" = 'manual';
