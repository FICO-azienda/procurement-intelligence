CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "auth_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"order_id" uuid,
	"order_product_id" uuid,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_org_id" uuid,
	"actor_user_id" uuid,
	"actor_name" text,
	"action" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"data" jsonb,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"position" integer DEFAULT 1 NOT NULL,
	"order_product_id" uuid,
	"buyer_product_id" uuid,
	"code" text,
	"name" text NOT NULL,
	"description" text,
	"unit" text NOT NULL,
	"quantity" numeric(16, 4) NOT NULL,
	"unit_price" numeric(16, 6) NOT NULL,
	"currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_product_buyers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_product_id" uuid NOT NULL,
	"relationship_id" uuid NOT NULL,
	"buyer_product_id" uuid,
	"allowed" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_org_id" uuid NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"description" text,
	"unit" text NOT NULL,
	"spec_confirmed_at" timestamp with time zone,
	"spec_confirmed_by" text,
	"audience" text DEFAULT 'all' NOT NULL,
	"enabled_at" timestamp with time zone,
	"enabled_by" text,
	"suspended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"changes" jsonb NOT NULL,
	"note" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_note" text
);
--> statement-breakpoint
CREATE TABLE "order_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_product_id" uuid NOT NULL,
	"relationship_id" uuid,
	"unit_price" numeric(16, 6),
	"currency" text,
	"taxes_included" boolean,
	"min_quantity" numeric(16, 4),
	"quantity_step" numeric(16, 4),
	"lead_time" text,
	"lead_time_note" text,
	"delivery" text,
	"delivery_place" text,
	"incoterms_version" text,
	"delivery_note" text,
	"transport_included" boolean,
	"payment" text,
	"payment_note" text,
	"valid_until" date,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" text,
	"replaced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"relationship_id" uuid NOT NULL,
	"buyer_org_id" uuid NOT NULL,
	"supplier_org_id" uuid NOT NULL,
	"status" text NOT NULL,
	"idempotency_key" text,
	"destination_id" uuid,
	"destination" jsonb NOT NULL,
	"wanted_date" date,
	"buyer_notes" text,
	"terms" jsonb NOT NULL,
	"terms_id" uuid,
	"transport_cost" numeric(16, 6),
	"delivery_date" date,
	"confirmed" jsonb,
	"confirmed_at" timestamp with time zone,
	"expires_on" date,
	"created_by" text,
	"sent_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"buyer_org_id" uuid NOT NULL,
	"supplier_id" uuid,
	"rfq_supplier_id" uuid,
	"company_name" text NOT NULL,
	"email" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_org_id" uuid,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "org_invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "org_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"email_verified_at" timestamp with time zone,
	"email_code_hash" text,
	"email_code_expires_at" timestamp with time zone,
	"email_code_attempts" integer DEFAULT 0 NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"is_workspace" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"vat_number" text,
	"tax_code" text,
	"country" text,
	"address" text,
	"postal_code" text,
	"city" text,
	"province" text,
	"order_terms_version" text,
	"order_terms_accepted_at" timestamp with time zone,
	"order_terms_accepted_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trade_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"buyer_org_id" uuid NOT NULL,
	"supplier_org_id" uuid NOT NULL,
	"supplier_id" uuid,
	"rfq_supplier_id" uuid,
	"ordering" text DEFAULT 'allowed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "direct_order" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_org_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."org_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_order_product_id_order_products_id_fk" FOREIGN KEY ("order_product_id") REFERENCES "public"."order_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_product_id_order_products_id_fk" FOREIGN KEY ("order_product_id") REFERENCES "public"."order_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_buyer_product_id_products_id_fk" FOREIGN KEY ("buyer_product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_product_buyers" ADD CONSTRAINT "order_product_buyers_order_product_id_order_products_id_fk" FOREIGN KEY ("order_product_id") REFERENCES "public"."order_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_product_buyers" ADD CONSTRAINT "order_product_buyers_relationship_id_trade_relationships_id_fk" FOREIGN KEY ("relationship_id") REFERENCES "public"."trade_relationships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_product_buyers" ADD CONSTRAINT "order_product_buyers_buyer_product_id_products_id_fk" FOREIGN KEY ("buyer_product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_products" ADD CONSTRAINT "order_products_supplier_org_id_organizations_id_fk" FOREIGN KEY ("supplier_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_proposals" ADD CONSTRAINT "order_proposals_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_terms" ADD CONSTRAINT "order_terms_order_product_id_order_products_id_fk" FOREIGN KEY ("order_product_id") REFERENCES "public"."order_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_terms" ADD CONSTRAINT "order_terms_relationship_id_trade_relationships_id_fk" FOREIGN KEY ("relationship_id") REFERENCES "public"."trade_relationships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_relationship_id_trade_relationships_id_fk" FOREIGN KEY ("relationship_id") REFERENCES "public"."trade_relationships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_buyer_org_id_organizations_id_fk" FOREIGN KEY ("buyer_org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_supplier_org_id_organizations_id_fk" FOREIGN KEY ("supplier_org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_destination_id_delivery_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."delivery_destinations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_invites" ADD CONSTRAINT "org_invites_buyer_org_id_organizations_id_fk" FOREIGN KEY ("buyer_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_invites" ADD CONSTRAINT "org_invites_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_invites" ADD CONSTRAINT "org_invites_rfq_supplier_id_rfq_suppliers_id_fk" FOREIGN KEY ("rfq_supplier_id") REFERENCES "public"."rfq_suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_invites" ADD CONSTRAINT "org_invites_accepted_org_id_organizations_id_fk" FOREIGN KEY ("accepted_org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_users" ADD CONSTRAINT "org_users_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_relationships" ADD CONSTRAINT "trade_relationships_buyer_org_id_organizations_id_fk" FOREIGN KEY ("buyer_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_relationships" ADD CONSTRAINT "trade_relationships_supplier_org_id_organizations_id_fk" FOREIGN KEY ("supplier_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_relationships" ADD CONSTRAINT "trade_relationships_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_relationships" ADD CONSTRAINT "trade_relationships_rfq_supplier_id_rfq_suppliers_id_fk" FOREIGN KEY ("rfq_supplier_id") REFERENCES "public"."rfq_suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_org_idx" ON "notifications" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "order_events_order_idx" ON "order_events" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_lines_order_idx" ON "order_lines" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_product_buyers_pair_idx" ON "order_product_buyers" USING btree ("order_product_id","relationship_id");--> statement-breakpoint
CREATE INDEX "order_products_org_idx" ON "order_products" USING btree ("supplier_org_id");--> statement-breakpoint
CREATE INDEX "order_proposals_order_idx" ON "order_proposals" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_terms_product_idx" ON "order_terms" USING btree ("order_product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_number_idx" ON "orders" USING btree ("buyer_org_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_idempotency_idx" ON "orders" USING btree ("buyer_org_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "orders_supplier_idx" ON "orders" USING btree ("supplier_org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trade_relationships_pair_idx" ON "trade_relationships" USING btree ("buyer_org_id","supplier_org_id");--> statement-breakpoint
CREATE FUNCTION orders_keep_confirmed() RETURNS trigger AS $$
BEGIN
  IF OLD.confirmed IS NOT NULL AND NEW.confirmed IS DISTINCT FROM OLD.confirmed THEN
    RAISE EXCEPTION 'A confirmed order is never rewritten';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER orders_keep_confirmed BEFORE UPDATE ON "orders" FOR EACH ROW EXECUTE FUNCTION orders_keep_confirmed();
--> statement-breakpoint
CREATE FUNCTION order_events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'The events of an order are never rewritten';
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER order_events_append_only BEFORE UPDATE ON "order_events" FOR EACH ROW EXECUTE FUNCTION order_events_append_only();
