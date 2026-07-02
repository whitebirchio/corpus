ALTER TABLE "daily_metrics" ADD COLUMN "sleep_deep_s" integer;--> statement-breakpoint
ALTER TABLE "daily_metrics" ADD COLUMN "sleep_light_s" integer;--> statement-breakpoint
ALTER TABLE "daily_metrics" ADD COLUMN "sleep_rem_s" integer;--> statement-breakpoint
ALTER TABLE "daily_metrics" ADD COLUMN "sleep_awake_s" integer;--> statement-breakpoint
ALTER TABLE "daily_metrics" ADD COLUMN "body_battery_low" integer;--> statement-breakpoint
ALTER TABLE "daily_metrics" ADD COLUMN "respiration_avg" double precision;--> statement-breakpoint
ALTER TABLE "daily_metrics" ADD COLUMN "spo2_avg" integer;--> statement-breakpoint
ALTER TABLE "daily_metrics" ADD COLUMN "active_kcal" integer;--> statement-breakpoint
ALTER TABLE "daily_metrics" ADD COLUMN "bmr_kcal" integer;--> statement-breakpoint
ALTER TABLE "daily_metrics" ADD COLUMN "intensity_minutes_moderate" integer;--> statement-breakpoint
ALTER TABLE "daily_metrics" ADD COLUMN "intensity_minutes_vigorous" integer;--> statement-breakpoint
ALTER TABLE "daily_metrics" ADD COLUMN "training_readiness" integer;--> statement-breakpoint
ALTER TABLE "daily_metrics" ADD COLUMN "vo2max" double precision;