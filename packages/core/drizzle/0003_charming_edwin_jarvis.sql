CREATE TYPE "public"."constraint_kind" AS ENUM('schedule', 'injury', 'seasonal', 'equipment_access', 'preference', 'other');--> statement-breakpoint
CREATE TYPE "public"."equipment_category" AS ENUM('barbell', 'dumbbell', 'kettlebell', 'rack', 'bench', 'band', 'machine', 'cardio', 'other');--> statement-breakpoint
CREATE TABLE "capability_estimates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"movement_id" uuid,
	"metric" text NOT NULL,
	"rep_max" integer,
	"value" double precision NOT NULL,
	"unit" text NOT NULL,
	"confidence" "estimate_confidence" DEFAULT 'medium' NOT NULL,
	"basis" text NOT NULL,
	"effective_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capability_estimates_nk_uq" UNIQUE NULLS NOT DISTINCT("user_id","movement_id","metric","rep_max")
);
--> statement-breakpoint
ALTER TABLE "capability_estimates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "equipment_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" "equipment_category" DEFAULT 'other' NOT NULL,
	"details" jsonb,
	"location" text,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "equipment_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "planning_constraints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "constraint_kind" NOT NULL,
	"rule" text NOT NULL,
	"params" jsonb,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "planning_constraints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "home_location" text;--> statement-breakpoint
ALTER TABLE "capability_estimates" ADD CONSTRAINT "capability_estimates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_estimates" ADD CONSTRAINT "capability_estimates_movement_id_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_items" ADD CONSTRAINT "equipment_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_constraints" ADD CONSTRAINT "planning_constraints_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "capability_estimates_user_metric_idx" ON "capability_estimates" USING btree ("user_id","metric");--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_items_user_name_uq" ON "equipment_items" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "planning_constraints_user_active_idx" ON "planning_constraints" USING btree ("user_id","active");--> statement-breakpoint
CREATE POLICY "owner_only" ON "capability_estimates" AS PERMISSIVE FOR ALL TO public USING ("capability_estimates"."user_id" = (select current_setting('app.user_id', true)::uuid)) WITH CHECK ("capability_estimates"."user_id" = (select current_setting('app.user_id', true)::uuid));--> statement-breakpoint
CREATE POLICY "owner_only" ON "equipment_items" AS PERMISSIVE FOR ALL TO public USING ("equipment_items"."user_id" = (select current_setting('app.user_id', true)::uuid)) WITH CHECK ("equipment_items"."user_id" = (select current_setting('app.user_id', true)::uuid));--> statement-breakpoint
CREATE POLICY "owner_only" ON "planning_constraints" AS PERMISSIVE FOR ALL TO public USING ("planning_constraints"."user_id" = (select current_setting('app.user_id', true)::uuid)) WITH CHECK ("planning_constraints"."user_id" = (select current_setting('app.user_id', true)::uuid));