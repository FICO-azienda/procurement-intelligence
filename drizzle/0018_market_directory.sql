CREATE TABLE "market_research" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market" text NOT NULL,
	"file" text NOT NULL,
	"researched_at" date NOT NULL,
	"cycle" text,
	"source" text,
	"coverage" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market" text NOT NULL,
	"name" text NOT NULL,
	"trade_name" text,
	"country" text,
	"city" text,
	"website" text,
	"email" text,
	"phone" text,
	"role" text DEFAULT 'unknown' NOT NULL,
	"status" text DEFAULT 'discovered' NOT NULL,
	"materials" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"technologies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"product_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"profile" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"evidence_url" text NOT NULL,
	"source_level" text DEFAULT 'supplier_official' NOT NULL,
	"checked_at" date,
	"source_file" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
