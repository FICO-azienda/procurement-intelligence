CREATE TABLE "supplier_resolutions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"other_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"basis" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" text,
	"decided_by" text DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "tax_code" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "merged_into_id" uuid;--> statement-breakpoint
ALTER TABLE "supplier_resolutions" ADD CONSTRAINT "supplier_resolutions_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_resolutions" ADD CONSTRAINT "supplier_resolutions_other_id_suppliers_id_fk" FOREIGN KEY ("other_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supplier_resolutions_supplier_idx" ON "supplier_resolutions" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "supplier_resolutions_other_idx" ON "supplier_resolutions" USING btree ("other_id");--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_merged_into_id_suppliers_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;