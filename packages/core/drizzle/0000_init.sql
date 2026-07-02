CREATE TYPE "public"."block_type" AS ENUM('strength', 'run', 'metcon', 'interval', 'warmup', 'cooldown', 'mobility', 'other');--> statement-breakpoint
CREATE TYPE "public"."body_region" AS ENUM('total', 'arm', 'leg', 'trunk', 'head', 'ribs', 'spine', 'pelvis', 'android', 'gynoid');--> statement-breakpoint
CREATE TYPE "public"."body_side" AS ENUM('left', 'right', 'both');--> statement-breakpoint
CREATE TYPE "public"."data_source" AS ENUM('checkin', 'conversation', 'garmin_export', 'macrofactor_export', 'document_extraction', 'manual');--> statement-breakpoint
CREATE TYPE "public"."document_kind" AS ENUM('lab_report', 'dexa_report', 'fitness_test', 'meal_photo', 'export', 'screenshot', 'other');--> statement-breakpoint
CREATE TYPE "public"."estimate_confidence" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."extraction_status" AS ENUM('pending', 'extracted', 'verified', 'failed');--> statement-breakpoint
CREATE TYPE "public"."fitness_test_type" AS ENUM('vo2max', 'rmr', 'dexa', 'other');--> statement-breakpoint
CREATE TYPE "public"."goal_domain" AS ENUM('fitness', 'nutrition', 'body_comp', 'labs', 'lifestyle');--> statement-breakpoint
CREATE TYPE "public"."goal_status" AS ENUM('active', 'paused', 'achieved', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."insight_source" AS ENUM('agent', 'user');--> statement-breakpoint
CREATE TYPE "public"."insight_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."lab_category" AS ENUM('lipids', 'cardio_advanced', 'metabolic', 'cbc', 'hormones', 'thyroid', 'vitamins_minerals', 'inflammation', 'autoimmune', 'urinalysis', 'heavy_metals', 'other');--> statement-breakpoint
CREATE TYPE "public"."lab_flag" AS ENUM('normal', 'low', 'high', 'critical', 'abnormal');--> statement-breakpoint
CREATE TYPE "public"."lab_source" AS ENUM('function_health', 'pcp', 'dexafit', 'other');--> statement-breakpoint
CREATE TYPE "public"."meal_granularity" AS ENUM('itemized', 'totals');--> statement-breakpoint
CREATE TYPE "public"."meal_type" AS ENUM('breakfast', 'lunch', 'dinner', 'snack');--> statement-breakpoint
CREATE TYPE "public"."metcon_scheme" AS ENUM('amrap', 'emom', 'for_time', 'rounds_for_time', 'tabata', 'chipper', 'ladder', 'custom');--> statement-breakpoint
CREATE TYPE "public"."movement_category" AS ENUM('squat', 'hinge', 'press', 'pull', 'carry', 'olympic', 'core', 'monostructural', 'plyo', 'other');--> statement-breakpoint
CREATE TYPE "public"."observation_kind" AS ENUM('energy', 'mood', 'soreness', 'symptom', 'note');--> statement-breakpoint
CREATE TYPE "public"."regimen_event_type" AS ENUM('skipped', 'extra_dose', 'dose_changed', 'paused', 'resumed');--> statement-breakpoint
CREATE TYPE "public"."regimen_type" AS ENUM('medication', 'supplement');--> statement-breakpoint
CREATE TYPE "public"."unit_preference" AS ENUM('imperial', 'metric');--> statement-breakpoint
CREATE TYPE "public"."value_comparator" AS ENUM('eq', 'lt', 'gt', 'le', 'ge');--> statement-breakpoint
CREATE TABLE "block_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"block_id" uuid NOT NULL,
	"movement_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"prescription" text,
	"reps_per_round" integer,
	"load_kg" double precision,
	"distance_m_per_round" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "block_movements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "body_composition_regions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"measurement_id" uuid NOT NULL,
	"region" "body_region" NOT NULL,
	"side" "body_side",
	"lean_mass_kg" double precision,
	"fat_mass_kg" double precision,
	"fat_pct" double precision,
	"bmd_gcm2" double precision,
	"bmd_percentile" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "body_composition_regions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "body_measurements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	"source" "data_source" DEFAULT 'checkin' NOT NULL,
	"document_id" uuid,
	"fitness_test_id" uuid,
	"weight_kg" double precision,
	"body_fat_pct" double precision,
	"lean_mass_kg" double precision,
	"fat_mass_kg" double precision,
	"bone_mineral_content_kg" double precision,
	"visceral_fat_kg" double precision,
	"visceral_fat_rating" double precision,
	"android_gynoid_ratio" double precision,
	"almi" double precision,
	"ffmi" double precision,
	"bmd_total_gcm2" double precision,
	"bmd_tscore" double precision,
	"bmd_zscore" double precision,
	"body_score" text,
	"extras" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "body_measurements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "daily_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"source" "data_source" DEFAULT 'checkin' NOT NULL,
	"sleep_duration_s" integer,
	"sleep_score" integer,
	"sleep_quality_subjective" integer,
	"hrv_ms" double precision,
	"resting_hr" integer,
	"steps" integer,
	"body_battery" integer,
	"stress_score" integer,
	"energy_subjective" integer,
	"soreness_notes" text,
	"notes" text,
	"extras" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "daily_metrics" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"r2_key" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer,
	"sha256" text,
	"kind" "document_kind" NOT NULL,
	"uploaded_at" timestamp with time zone,
	"description" text,
	"extraction_status" "extraction_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fitness_tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"performed_on" date NOT NULL,
	"test_type" "fitness_test_type" NOT NULL,
	"provider" text,
	"document_id" uuid,
	"primary_value" double precision,
	"primary_unit" text,
	"results" jsonb,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fitness_tests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"domain" "goal_domain" NOT NULL,
	"description" text,
	"priority" integer DEFAULT 100 NOT NULL,
	"target" jsonb,
	"target_date" date,
	"status" "goal_status" DEFAULT 'active' NOT NULL,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "goals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"status" "insight_status" DEFAULT 'active' NOT NULL,
	"source" "insight_source" DEFAULT 'agent' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "insights" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "lab_panels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"collected_on" date NOT NULL,
	"reported_on" date,
	"source" "lab_source" NOT NULL,
	"lab_name" text,
	"ordering_provider" text,
	"accession_number" text,
	"fasting" boolean,
	"document_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lab_panels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "lab_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"panel_id" uuid NOT NULL,
	"sub_panel" text,
	"analyte" text NOT NULL,
	"raw_name" text NOT NULL,
	"category" "lab_category" NOT NULL,
	"value_text" text NOT NULL,
	"value_num" double precision,
	"comparator" "value_comparator" DEFAULT 'eq' NOT NULL,
	"unit" text,
	"ref_low" double precision,
	"ref_high" double precision,
	"ref_text" text,
	"flag" "lab_flag",
	"method" text,
	"performing_lab" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lab_results" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "meal_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"meal_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"name" text NOT NULL,
	"quantity" double precision,
	"unit_note" text,
	"calories" double precision,
	"protein_g" double precision,
	"carbs_g" double precision,
	"fat_g" double precision,
	"micros" jsonb,
	"estimate_confidence" "estimate_confidence",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meal_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "meals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"eaten_at" timestamp with time zone NOT NULL,
	"local_date" date NOT NULL,
	"meal_type" "meal_type" NOT NULL,
	"description" text NOT NULL,
	"granularity" "meal_granularity" NOT NULL,
	"calories" double precision NOT NULL,
	"protein_g" double precision NOT NULL,
	"carbs_g" double precision NOT NULL,
	"fat_g" double precision NOT NULL,
	"photo_document_id" uuid,
	"source" "data_source" DEFAULT 'conversation' NOT NULL,
	"source_ref" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"aliases" text[] DEFAULT '{}' NOT NULL,
	"category" "movement_category" NOT NULL,
	"primary_muscles" text[] DEFAULT '{}' NOT NULL,
	"secondary_muscles" text[] DEFAULT '{}' NOT NULL,
	"equipment" text[] DEFAULT '{}' NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nutrition_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"effective_date" date NOT NULL,
	"calories" integer NOT NULL,
	"protein_g" double precision NOT NULL,
	"carbs_g" double precision NOT NULL,
	"fat_g" double precision NOT NULL,
	"fiber_g" double precision,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "nutrition_targets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"local_date" date NOT NULL,
	"kind" "observation_kind" NOT NULL,
	"value_num" integer,
	"body_area" text,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "observations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "regimen_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"regimen_item_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"event_type" "regimen_event_type" NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "regimen_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "regimen_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "regimen_type" NOT NULL,
	"dose_amount" double precision,
	"dose_unit" text,
	"schedule_text" text,
	"schedule" jsonb,
	"purpose" text,
	"prescriber" text,
	"started_on" date NOT NULL,
	"ended_on" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "regimen_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "strength_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"block_movement_id" uuid NOT NULL,
	"set_number" integer NOT NULL,
	"reps" integer,
	"load_kg" double precision,
	"rpe" double precision,
	"is_warmup" boolean DEFAULT false NOT NULL,
	"is_failure" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "strength_sets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"unit_preference" "unit_preference" DEFAULT 'imperial' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "workout_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"block_type" "block_type" NOT NULL,
	"scheme" "metcon_scheme",
	"rounds_planned" integer,
	"time_cap_s" integer,
	"interval_s" integer,
	"result_time_s" integer,
	"result_rounds" integer,
	"result_reps" integer,
	"rx" boolean,
	"distance_m" double precision,
	"duration_s" integer,
	"avg_pace_s_per_km" double precision,
	"avg_hr" integer,
	"max_hr" integer,
	"elevation_gain_m" double precision,
	"splits" jsonb,
	"rpe" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workout_blocks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "workout_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"local_date" date NOT NULL,
	"title" text,
	"source" "data_source" DEFAULT 'conversation' NOT NULL,
	"source_ref" text,
	"duration_s" integer,
	"session_rpe" integer,
	"avg_hr" integer,
	"max_hr" integer,
	"calories" integer,
	"notes" text,
	"extras" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workout_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "block_movements" ADD CONSTRAINT "block_movements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block_movements" ADD CONSTRAINT "block_movements_block_id_workout_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."workout_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block_movements" ADD CONSTRAINT "block_movements_movement_id_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "body_composition_regions" ADD CONSTRAINT "body_composition_regions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "body_composition_regions" ADD CONSTRAINT "body_composition_regions_measurement_id_body_measurements_id_fk" FOREIGN KEY ("measurement_id") REFERENCES "public"."body_measurements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "body_measurements" ADD CONSTRAINT "body_measurements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "body_measurements" ADD CONSTRAINT "body_measurements_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "body_measurements" ADD CONSTRAINT "body_measurements_fitness_test_id_fitness_tests_id_fk" FOREIGN KEY ("fitness_test_id") REFERENCES "public"."fitness_tests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_metrics" ADD CONSTRAINT "daily_metrics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fitness_tests" ADD CONSTRAINT "fitness_tests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fitness_tests" ADD CONSTRAINT "fitness_tests_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insights" ADD CONSTRAINT "insights_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_panels" ADD CONSTRAINT "lab_panels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_panels" ADD CONSTRAINT "lab_panels_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_panel_id_lab_panels_id_fk" FOREIGN KEY ("panel_id") REFERENCES "public"."lab_panels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_items" ADD CONSTRAINT "meal_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_items" ADD CONSTRAINT "meal_items_meal_id_meals_id_fk" FOREIGN KEY ("meal_id") REFERENCES "public"."meals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meals" ADD CONSTRAINT "meals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meals" ADD CONSTRAINT "meals_photo_document_id_documents_id_fk" FOREIGN KEY ("photo_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_targets" ADD CONSTRAINT "nutrition_targets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regimen_events" ADD CONSTRAINT "regimen_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regimen_events" ADD CONSTRAINT "regimen_events_regimen_item_id_regimen_items_id_fk" FOREIGN KEY ("regimen_item_id") REFERENCES "public"."regimen_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regimen_items" ADD CONSTRAINT "regimen_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strength_sets" ADD CONSTRAINT "strength_sets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strength_sets" ADD CONSTRAINT "strength_sets_block_movement_id_block_movements_id_fk" FOREIGN KEY ("block_movement_id") REFERENCES "public"."block_movements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_blocks" ADD CONSTRAINT "workout_blocks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_blocks" ADD CONSTRAINT "workout_blocks_session_id_workout_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."workout_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "block_movements_block_idx" ON "block_movements" USING btree ("block_id");--> statement-breakpoint
CREATE INDEX "block_movements_movement_idx" ON "block_movements" USING btree ("movement_id");--> statement-breakpoint
CREATE INDEX "bcr_measurement_idx" ON "body_composition_regions" USING btree ("measurement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "body_measurements_user_time_source_uq" ON "body_measurements" USING btree ("user_id","measured_at","source");--> statement-breakpoint
CREATE INDEX "body_measurements_user_time_idx" ON "body_measurements" USING btree ("user_id","measured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_metrics_user_date_uq" ON "daily_metrics" USING btree ("user_id","local_date");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_user_sha_uq" ON "documents" USING btree ("user_id","sha256") WHERE "documents"."sha256" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "fitness_tests_user_type_date_uq" ON "fitness_tests" USING btree ("user_id","test_type","performed_on");--> statement-breakpoint
CREATE INDEX "goals_user_status_idx" ON "goals" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "insights_user_status_idx" ON "insights" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "lab_panels_accession_uq" ON "lab_panels" USING btree ("user_id","source","accession_number") WHERE "lab_panels"."accession_number" is not null;--> statement-breakpoint
CREATE INDEX "lab_panels_user_date_idx" ON "lab_panels" USING btree ("user_id","collected_on");--> statement-breakpoint
CREATE UNIQUE INDEX "lab_results_panel_analyte_uq" ON "lab_results" USING btree ("panel_id","analyte");--> statement-breakpoint
CREATE INDEX "lab_results_user_analyte_idx" ON "lab_results" USING btree ("user_id","analyte");--> statement-breakpoint
CREATE INDEX "meal_items_meal_idx" ON "meal_items" USING btree ("meal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meals_source_ref_uq" ON "meals" USING btree ("user_id","source","source_ref") WHERE "meals"."source_ref" is not null;--> statement-breakpoint
CREATE INDEX "meals_user_date_idx" ON "meals" USING btree ("user_id","local_date");--> statement-breakpoint
CREATE UNIQUE INDEX "movements_name_uq" ON "movements" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "nutrition_targets_user_date_uq" ON "nutrition_targets" USING btree ("user_id","effective_date");--> statement-breakpoint
CREATE INDEX "observations_user_date_idx" ON "observations" USING btree ("user_id","local_date");--> statement-breakpoint
CREATE INDEX "regimen_events_item_idx" ON "regimen_events" USING btree ("regimen_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "regimen_items_user_name_start_uq" ON "regimen_items" USING btree ("user_id","name","started_on");--> statement-breakpoint
CREATE INDEX "strength_sets_bm_idx" ON "strength_sets" USING btree ("block_movement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "workout_blocks_session_idx" ON "workout_blocks" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workout_sessions_source_ref_uq" ON "workout_sessions" USING btree ("user_id","source","source_ref") WHERE "workout_sessions"."source_ref" is not null;--> statement-breakpoint
CREATE INDEX "workout_sessions_user_date_idx" ON "workout_sessions" USING btree ("user_id","local_date");--> statement-breakpoint
CREATE POLICY "owner_only" ON "block_movements" AS PERMISSIVE FOR ALL TO public USING ("block_movements"."user_id" = (select current_setting('app.user_id', true)::uuid)) WITH CHECK ("block_movements"."user_id" = (select current_setting('app.user_id', true)::uuid));--> statement-breakpoint
CREATE POLICY "owner_only" ON "body_composition_regions" AS PERMISSIVE FOR ALL TO public USING ("body_composition_regions"."user_id" = (select current_setting('app.user_id', true)::uuid)) WITH CHECK ("body_composition_regions"."user_id" = (select current_setting('app.user_id', true)::uuid));--> statement-breakpoint
CREATE POLICY "owner_only" ON "body_measurements" AS PERMISSIVE FOR ALL TO public USING ("body_measurements"."user_id" = (select current_setting('app.user_id', true)::uuid)) WITH CHECK ("body_measurements"."user_id" = (select current_setting('app.user_id', true)::uuid));--> statement-breakpoint
CREATE POLICY "owner_only" ON "daily_metrics" AS PERMISSIVE FOR ALL TO public USING ("daily_metrics"."user_id" = (select current_setting('app.user_id', true)::uuid)) WITH CHECK ("daily_metrics"."user_id" = (select current_setting('app.user_id', true)::uuid));--> statement-breakpoint
CREATE POLICY "owner_only" ON "documents" AS PERMISSIVE FOR ALL TO public USING ("documents"."user_id" = (select current_setting('app.user_id', true)::uuid)) WITH CHECK ("documents"."user_id" = (select current_setting('app.user_id', true)::uuid));--> statement-breakpoint
CREATE POLICY "owner_only" ON "fitness_tests" AS PERMISSIVE FOR ALL TO public USING ("fitness_tests"."user_id" = (select current_setting('app.user_id', true)::uuid)) WITH CHECK ("fitness_tests"."user_id" = (select current_setting('app.user_id', true)::uuid));--> statement-breakpoint
CREATE POLICY "owner_only" ON "goals" AS PERMISSIVE FOR ALL TO public USING ("goals"."user_id" = (select current_setting('app.user_id', true)::uuid)) WITH CHECK ("goals"."user_id" = (select current_setting('app.user_id', true)::uuid));--> statement-breakpoint
CREATE POLICY "owner_only" ON "insights" AS PERMISSIVE FOR ALL TO public USING ("insights"."user_id" = (select current_setting('app.user_id', true)::uuid)) WITH CHECK ("insights"."user_id" = (select current_setting('app.user_id', true)::uuid));--> statement-breakpoint
CREATE POLICY "owner_only" ON "lab_panels" AS PERMISSIVE FOR ALL TO public USING ("lab_panels"."user_id" = (select current_setting('app.user_id', true)::uuid)) WITH CHECK ("lab_panels"."user_id" = (select current_setting('app.user_id', true)::uuid));--> statement-breakpoint
CREATE POLICY "owner_only" ON "lab_results" AS PERMISSIVE FOR ALL TO public USING ("lab_results"."user_id" = (select current_setting('app.user_id', true)::uuid)) WITH CHECK ("lab_results"."user_id" = (select current_setting('app.user_id', true)::uuid));--> statement-breakpoint
CREATE POLICY "owner_only" ON "meal_items" AS PERMISSIVE FOR ALL TO public USING ("meal_items"."user_id" = (select current_setting('app.user_id', true)::uuid)) WITH CHECK ("meal_items"."user_id" = (select current_setting('app.user_id', true)::uuid));--> statement-breakpoint
CREATE POLICY "owner_only" ON "meals" AS PERMISSIVE FOR ALL TO public USING ("meals"."user_id" = (select current_setting('app.user_id', true)::uuid)) WITH CHECK ("meals"."user_id" = (select current_setting('app.user_id', true)::uuid));--> statement-breakpoint
CREATE POLICY "owner_only" ON "nutrition_targets" AS PERMISSIVE FOR ALL TO public USING ("nutrition_targets"."user_id" = (select current_setting('app.user_id', true)::uuid)) WITH CHECK ("nutrition_targets"."user_id" = (select current_setting('app.user_id', true)::uuid));--> statement-breakpoint
CREATE POLICY "owner_only" ON "observations" AS PERMISSIVE FOR ALL TO public USING ("observations"."user_id" = (select current_setting('app.user_id', true)::uuid)) WITH CHECK ("observations"."user_id" = (select current_setting('app.user_id', true)::uuid));--> statement-breakpoint
CREATE POLICY "owner_only" ON "regimen_events" AS PERMISSIVE FOR ALL TO public USING ("regimen_events"."user_id" = (select current_setting('app.user_id', true)::uuid)) WITH CHECK ("regimen_events"."user_id" = (select current_setting('app.user_id', true)::uuid));--> statement-breakpoint
CREATE POLICY "owner_only" ON "regimen_items" AS PERMISSIVE FOR ALL TO public USING ("regimen_items"."user_id" = (select current_setting('app.user_id', true)::uuid)) WITH CHECK ("regimen_items"."user_id" = (select current_setting('app.user_id', true)::uuid));--> statement-breakpoint
CREATE POLICY "owner_only" ON "strength_sets" AS PERMISSIVE FOR ALL TO public USING ("strength_sets"."user_id" = (select current_setting('app.user_id', true)::uuid)) WITH CHECK ("strength_sets"."user_id" = (select current_setting('app.user_id', true)::uuid));--> statement-breakpoint
CREATE POLICY "users_self" ON "users" AS PERMISSIVE FOR ALL TO public USING ("users"."id" = (select current_setting('app.user_id', true)::uuid)
        or "users"."email" = (select current_setting('app.auth_email', true))) WITH CHECK ("users"."id" = (select current_setting('app.user_id', true)::uuid)
        or "users"."email" = (select current_setting('app.auth_email', true)));--> statement-breakpoint
CREATE POLICY "owner_only" ON "workout_blocks" AS PERMISSIVE FOR ALL TO public USING ("workout_blocks"."user_id" = (select current_setting('app.user_id', true)::uuid)) WITH CHECK ("workout_blocks"."user_id" = (select current_setting('app.user_id', true)::uuid));--> statement-breakpoint
CREATE POLICY "owner_only" ON "workout_sessions" AS PERMISSIVE FOR ALL TO public USING ("workout_sessions"."user_id" = (select current_setting('app.user_id', true)::uuid)) WITH CHECK ("workout_sessions"."user_id" = (select current_setting('app.user_id', true)::uuid));