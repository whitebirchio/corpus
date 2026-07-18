CREATE TYPE "public"."food_source" AS ENUM('label', 'fdc', 'off', 'estimate');--> statement-breakpoint
CREATE TABLE "foods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"canonical_name" text NOT NULL,
	"brand" text,
	"aliases" text[] DEFAULT '{}' NOT NULL,
	"barcode" text,
	"calories_per100g" double precision NOT NULL,
	"protein_per100g" double precision NOT NULL,
	"carbs_per100g" double precision NOT NULL,
	"fat_per100g" double precision NOT NULL,
	"micros" jsonb,
	"portions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" "food_source" NOT NULL,
	"source_ref" text,
	"verified" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "foods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "recipe_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"recipe_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"food_id" uuid NOT NULL,
	"grams" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recipe_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"aliases" text[] DEFAULT '{}' NOT NULL,
	"servings" double precision DEFAULT 1 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recipes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meal_items" ADD COLUMN "food_id" uuid;--> statement-breakpoint
ALTER TABLE "meal_items" ADD COLUMN "grams_resolved" double precision;--> statement-breakpoint
ALTER TABLE "foods" ADD CONSTRAINT "foods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "foods_user_name_uq" ON "foods" USING btree ("user_id",lower("canonical_name"));--> statement-breakpoint
CREATE UNIQUE INDEX "foods_user_barcode_uq" ON "foods" USING btree ("user_id","barcode") WHERE "foods"."barcode" is not null;--> statement-breakpoint
CREATE INDEX "recipe_items_recipe_idx" ON "recipe_items" USING btree ("recipe_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recipes_user_name_uq" ON "recipes" USING btree ("user_id",lower("name"));--> statement-breakpoint
ALTER TABLE "meal_items" ADD CONSTRAINT "meal_items_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "owner_only" ON "foods" AS PERMISSIVE FOR ALL TO public USING ("foods"."user_id" = (select current_setting('app.user_id', true)::uuid)) WITH CHECK ("foods"."user_id" = (select current_setting('app.user_id', true)::uuid));--> statement-breakpoint
CREATE POLICY "owner_only" ON "recipe_items" AS PERMISSIVE FOR ALL TO public USING ("recipe_items"."user_id" = (select current_setting('app.user_id', true)::uuid)) WITH CHECK ("recipe_items"."user_id" = (select current_setting('app.user_id', true)::uuid));--> statement-breakpoint
CREATE POLICY "owner_only" ON "recipes" AS PERMISSIVE FOR ALL TO public USING ("recipes"."user_id" = (select current_setting('app.user_id', true)::uuid)) WITH CHECK ("recipes"."user_id" = (select current_setting('app.user_id', true)::uuid));