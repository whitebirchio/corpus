CREATE TYPE "public"."plan_change_category" AS ENUM('sickness', 'injury', 'weather', 'schedule', 'fatigue', 'equipment', 'preference', 'progression', 'other');--> statement-breakpoint
CREATE TYPE "public"."planned_session_status" AS ENUM('planned', 'completed', 'skipped', 'cancelled');--> statement-breakpoint
CREATE TABLE "goal_milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"target" jsonb,
	"target_date" date,
	"status" "goal_status" DEFAULT 'active' NOT NULL,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "goal_milestones" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "plan_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"week_id" uuid NOT NULL,
	"planned_session_id" uuid,
	"category" "plan_change_category" NOT NULL,
	"summary" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plan_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "planned_block_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"planned_block_id" uuid NOT NULL,
	"movement_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"sets" integer,
	"reps" integer,
	"reps_text" text,
	"target_load_kg" double precision,
	"target_rpe" integer,
	"rest_s" integer,
	"prescription" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "planned_block_movements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "planned_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"planned_session_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"block_type" "block_type" NOT NULL,
	"scheme" "metcon_scheme",
	"rounds_planned" integer,
	"time_cap_s" integer,
	"interval_s" integer,
	"target_distance_m" double precision,
	"target_duration_s" integer,
	"target_pace_s_per_km" double precision,
	"structure" text,
	"target_rpe" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "planned_blocks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "planned_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"week_id" uuid NOT NULL,
	"planned_date" date NOT NULL,
	"title" text NOT NULL,
	"status" "planned_session_status" DEFAULT 'planned' NOT NULL,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "planned_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "training_weeks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"focus" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "training_weeks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD COLUMN "planned_session_id" uuid;--> statement-breakpoint
ALTER TABLE "goal_milestones" ADD CONSTRAINT "goal_milestones_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_milestones" ADD CONSTRAINT "goal_milestones_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_changes" ADD CONSTRAINT "plan_changes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_changes" ADD CONSTRAINT "plan_changes_week_id_training_weeks_id_fk" FOREIGN KEY ("week_id") REFERENCES "public"."training_weeks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_changes" ADD CONSTRAINT "plan_changes_planned_session_id_planned_sessions_id_fk" FOREIGN KEY ("planned_session_id") REFERENCES "public"."planned_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_block_movements" ADD CONSTRAINT "planned_block_movements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_block_movements" ADD CONSTRAINT "planned_block_movements_planned_block_id_planned_blocks_id_fk" FOREIGN KEY ("planned_block_id") REFERENCES "public"."planned_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_block_movements" ADD CONSTRAINT "planned_block_movements_movement_id_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_blocks" ADD CONSTRAINT "planned_blocks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_blocks" ADD CONSTRAINT "planned_blocks_planned_session_id_planned_sessions_id_fk" FOREIGN KEY ("planned_session_id") REFERENCES "public"."planned_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_sessions" ADD CONSTRAINT "planned_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_sessions" ADD CONSTRAINT "planned_sessions_week_id_training_weeks_id_fk" FOREIGN KEY ("week_id") REFERENCES "public"."training_weeks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_weeks" ADD CONSTRAINT "training_weeks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goal_milestones_user_status_idx" ON "goal_milestones" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "goal_milestones_goal_idx" ON "goal_milestones" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "plan_changes_week_idx" ON "plan_changes" USING btree ("week_id");--> statement-breakpoint
CREATE INDEX "planned_block_movements_block_idx" ON "planned_block_movements" USING btree ("planned_block_id");--> statement-breakpoint
CREATE INDEX "planned_blocks_session_idx" ON "planned_blocks" USING btree ("planned_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "planned_sessions_user_date_uq" ON "planned_sessions" USING btree ("user_id","planned_date");--> statement-breakpoint
CREATE INDEX "planned_sessions_week_idx" ON "planned_sessions" USING btree ("week_id");--> statement-breakpoint
CREATE UNIQUE INDEX "training_weeks_user_week_uq" ON "training_weeks" USING btree ("user_id","week_start");--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_planned_session_id_planned_sessions_id_fk" FOREIGN KEY ("planned_session_id") REFERENCES "public"."planned_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "owner_only" ON "goal_milestones" AS PERMISSIVE FOR ALL TO public USING ("goal_milestones"."user_id" = (select current_setting('app.user_id', true)::uuid)) WITH CHECK ("goal_milestones"."user_id" = (select current_setting('app.user_id', true)::uuid));--> statement-breakpoint
CREATE POLICY "owner_only" ON "plan_changes" AS PERMISSIVE FOR ALL TO public USING ("plan_changes"."user_id" = (select current_setting('app.user_id', true)::uuid)) WITH CHECK ("plan_changes"."user_id" = (select current_setting('app.user_id', true)::uuid));--> statement-breakpoint
CREATE POLICY "owner_only" ON "planned_block_movements" AS PERMISSIVE FOR ALL TO public USING ("planned_block_movements"."user_id" = (select current_setting('app.user_id', true)::uuid)) WITH CHECK ("planned_block_movements"."user_id" = (select current_setting('app.user_id', true)::uuid));--> statement-breakpoint
CREATE POLICY "owner_only" ON "planned_blocks" AS PERMISSIVE FOR ALL TO public USING ("planned_blocks"."user_id" = (select current_setting('app.user_id', true)::uuid)) WITH CHECK ("planned_blocks"."user_id" = (select current_setting('app.user_id', true)::uuid));--> statement-breakpoint
CREATE POLICY "owner_only" ON "planned_sessions" AS PERMISSIVE FOR ALL TO public USING ("planned_sessions"."user_id" = (select current_setting('app.user_id', true)::uuid)) WITH CHECK ("planned_sessions"."user_id" = (select current_setting('app.user_id', true)::uuid));--> statement-breakpoint
CREATE POLICY "owner_only" ON "training_weeks" AS PERMISSIVE FOR ALL TO public USING ("training_weeks"."user_id" = (select current_setting('app.user_id', true)::uuid)) WITH CHECK ("training_weeks"."user_id" = (select current_setting('app.user_id', true)::uuid));