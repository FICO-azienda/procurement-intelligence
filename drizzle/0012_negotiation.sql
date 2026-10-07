CREATE TABLE "negotiation_estimates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"status" text NOT NULL,
	"data_class" text DEFAULT 'model_estimate' NOT NULL,
	"current_price" numeric(16, 6),
	"low" numeric(16, 6),
	"high" numeric(16, 6),
	"target" numeric(16, 6),
	"confidence" text,
	"strength" text NOT NULL,
	"signature" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "negotiation_estimates" ADD CONSTRAINT "negotiation_estimates_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "negotiation_estimates_product_idx" ON "negotiation_estimates" USING btree ("product_id","created_at");