/**
 * The corpus://schema resource (specs/01-initial-platform/SPEC.md §6.3): an annotated schema reference
 * so the model writes correct SQL through query_data without trial and error.
 * Keep in sync with @corpus/core src/db/schema.ts.
 */
export const SCHEMA_DOC = `# Corpus database schema (Postgres)

Conventions:
- All quantities are CANONICAL METRIC: kg (mass/load), meters (distance), seconds (duration), kcal (energy). Convert for display only.
- Daily tables key on local_date (DATE, the user's calendar day). Timestamps are timestamptz UTC.
- Row-level security scopes every query to the authenticated user automatically — do NOT filter by user_id, it's already applied.
- Enums are lowercase strings as listed.

## Biometrics
- daily_metrics(local_date UNIQUE/user, source, sleep_duration_s, sleep_score, sleep_quality_subjective 1-5,
    sleep_deep_s, sleep_light_s, sleep_rem_s, sleep_awake_s,
    hrv_ms, resting_hr, steps, body_battery (day high), body_battery_low, stress_score,
    respiration_avg (breaths/min), spo2_avg (%), active_kcal, bmr_kcal,
    intensity_minutes_moderate, intensity_minutes_vigorous, training_readiness 0-100, vo2max (watch estimate),
    energy_subjective 1-5, soreness_notes, notes)
- body_measurements(measured_at, source, weight_kg, body_fat_pct, lean_mass_kg, fat_mass_kg, bone_mineral_content_kg, visceral_fat_kg, android_gynoid_ratio, almi, ffmi, bmd_total_gcm2, bmd_tscore, bmd_zscore, body_score, fitness_test_id)
- body_composition_regions(measurement_id -> body_measurements.id, region: total|arm|leg|trunk|head|ribs|spine|pelvis|android|gynoid, side: left|right|both, lean_mass_kg, fat_mass_kg, fat_pct, bmd_gcm2, bmd_percentile)

## Workouts (session -> block -> block_movement -> set)
- workout_sessions(started_at, local_date, title, source, duration_s, session_rpe 1-10, avg_hr, max_hr, calories, notes, planned_session_id -> planned_sessions.id NULL=unplanned)
- workout_blocks(session_id, seq, block_type: strength|run|metcon|interval|warmup|cooldown|mobility|other,
    scheme: amrap|emom|for_time|rounds_for_time|tabata|chipper|ladder|custom, rounds_planned, time_cap_s, interval_s,
    result_time_s, result_rounds, result_reps, rx,
    distance_m, duration_s, avg_pace_s_per_km, avg_hr, max_hr, elevation_gain_m, splits jsonb, rpe, notes)
- movements(name UNIQUE, aliases text[], category: squat|hinge|press|pull|carry|olympic|core|monostructural|plyo|other, primary_muscles text[], secondary_muscles text[], equipment text[], verified)
  Muscle vocabulary: chest, front_delts, side_delts, rear_delts, triceps, biceps, forearms, lats, upper_back, traps, lower_back, core, obliques, glutes, quads, hamstrings, adductors, calves, hip_flexors, full_body, cardio.
- block_movements(block_id, movement_id, seq, prescription, reps_per_round, load_kg, distance_m_per_round)
- strength_sets(block_movement_id, set_number, reps, load_kg, rpe, is_warmup, is_failure, notes)

Example — working sets per muscle group, last 7 days:
  SELECT m.primary_muscles, count(*) AS working_sets
  FROM strength_sets ss
  JOIN block_movements bm ON bm.id = ss.block_movement_id
  JOIN movements m ON m.id = bm.movement_id
  JOIN workout_blocks wb ON wb.id = bm.block_id
  JOIN workout_sessions ws ON ws.id = wb.session_id
  WHERE ws.local_date >= current_date - 7 AND NOT ss.is_warmup
  GROUP BY m.primary_muscles;

## Nutrition
- nutrition_targets(effective_date UNIQUE/user, calories, protein_g, carbs_g, fat_g, fiber_g) — the row with the greatest effective_date <= a day governs that day
- meals(eaten_at, local_date, meal_type: breakfast|lunch|dinner|snack, description, granularity: itemized|totals, calories, protein_g, carbs_g, fat_g, source, notes)
- meal_items(meal_id, seq, name, quantity, unit_note, food_id -> foods NULL=unresolved, grams_resolved, calories, protein_g, carbs_g, fat_g, micros jsonb, estimate_confidence)
  micros keys: fiber_g, sugar_g, sat_fat_g, sodium_mg, cholesterol_mg, potassium_mg (numbers; use (micros->>'fiber_g')::float)
- foods(canonical_name UNIQUE/user (lower), brand, aliases text[], barcode UNIQUE/user, calories_per100g, protein_per100g, carbs_per100g, fat_per100g, micros jsonb per 100 g, portions jsonb [{label,grams}], source: label|fdc|off|estimate, source_ref, verified) — personal catalog; macros stored per 100 g
- recipes(name UNIQUE/user (lower), aliases text[], servings, notes); recipe_items(recipe_id, seq, food_id -> foods, grams) — per-serving totals derived on read
  repeated low-confidence meal_items with no food_id are catalog candidates (weekly review sweep)

## Medications & supplements
- regimen_items(name, type: medication|supplement, dose_amount, dose_unit, schedule_text, schedule jsonb, purpose, prescriber, started_on, ended_on NULL=active, notes) — dose changes end a row and open a new one, so history is the row sequence
- regimen_events(regimen_item_id, local_date, event_type: skipped|extra_dose|dose_changed|paused|resumed, notes) — adherence is assumed except these exceptions

## Labs & tests
- documents(r2_key, filename, kind: lab_report|dexa_report|fitness_test|meal_photo|export|screenshot|other, sha256, extraction_status)
- lab_panels(collected_on, source: function_health|pcp|dexafit|other, lab_name, accession_number, fasting, document_id, notes)
- lab_results(panel_id, sub_panel, analyte canonical snake_case e.g. 'ldl_cholesterol', raw_name, category: lipids|cardio_advanced|metabolic|cbc|hormones|thyroid|vitamins_minerals|inflammation|autoimmune|urinalysis|heavy_metals|other,
    value_text verbatim, value_num NULL for qualitative, comparator: eq|lt|gt|le|ge (censored values like '<10' are lt,10), unit, ref_low, ref_high, ref_text, flag: normal|low|high|critical|abnormal)
  Trend example: SELECT p.collected_on, r.value_num FROM lab_results r JOIN lab_panels p ON p.id = r.panel_id WHERE r.analyte = 'ldl_cholesterol' ORDER BY p.collected_on;
- fitness_tests(performed_on, test_type: vo2max|rmr|dexa|other, provider, primary_value, primary_unit, results jsonb, notes)
  results shapes — vo2max: {biological_age, max_hr, vt1_bpm, vt2_bpm, training_zones, redline_ratio, lean_vo2max, leg_lean_vo2max}; rmr: {rmr_kcal, rer, fuel_fat_pct, fuel_carb_pct, predicted_rmr, tdee_by_activity}

## Goals, insights, observations
- goals(title, domain: fitness|nutrition|body_comp|labs|lifestyle, description, priority int ASC=more important, target jsonb {metric,targetValue,unit,direction}, target_date, status: active|paused|achieved|abandoned, notes)
- goal_milestones(goal_id, title, description, target jsonb {metric,targetValue,unit,direction}, target_date, status: active|paused|achieved|abandoned, notes) — dated checkpoints under a goal
- insights(title, body, tags text[], status: active|archived, source) — durable agent conclusions; check these before re-deriving
- observations(observed_at, local_date, kind: energy|mood|soreness|symptom|note, value_num 1-5, body_area, text)

## Training plan (week -> planned_session -> planned_block -> planned_block_movement)
- training_weeks(week_start DATE UNIQUE/user (the Monday), focus, notes) — one plan per calendar week
- planned_sessions(week_id, planned_date UNIQUE/user, title, status: planned|completed|skipped|cancelled, status_changed_at, notes)
  completed = a logged workout is linked (workout_sessions.planned_session_id); skipped counts against adherence, cancelled doesn't
- planned_blocks(planned_session_id, seq, block_type, scheme, rounds_planned, time_cap_s, interval_s,
    target_distance_m, target_duration_s, target_pace_s_per_km, structure, target_rpe, notes) — prescriptions, not results
- planned_block_movements(planned_block_id, movement_id, seq, sets, reps, reps_text, target_load_kg, target_rpe, rest_s, prescription, notes)
- plan_changes(week_id, planned_session_id NULLABLE, category: sickness|injury|weather|schedule|fatigue|equipment|preference|progression|other, summary, created_at) — append-only adjustment history

Example — adherence by week, last 8 weeks:
  SELECT tw.week_start, count(*) FILTER (WHERE ps.status = 'completed') AS done,
         count(*) FILTER (WHERE ps.status = 'skipped') AS skipped, count(*) AS planned_total
  FROM planned_sessions ps JOIN training_weeks tw ON tw.id = ps.week_id
  WHERE tw.week_start >= current_date - interval '8 weeks'
  GROUP BY tw.week_start ORDER BY tw.week_start;

## Athlete model
- equipment_items(name UNIQUE/user, category: barbell|dumbbell|kettlebell|rack|bench|band|machine|cardio|other, details jsonb, location, active, notes)
- capability_estimates(movement_id NULL=movement-less, metric e.g. 'working_load'|'e1rm'|'weekly_run_volume'|'zone2_pace', rep_max, value, unit: kg|m|s|s_per_km|m_per_week, confidence, basis, effective_date) — current beliefs, one row per key
- planning_constraints(kind: schedule|injury|seasonal|equipment_access|preference|other, rule, params jsonb, active, notes) — binding planning rules

Example — prescribed vs. actual load for a movement:
  SELECT ps.planned_date, m.name, pbm.sets, pbm.reps, pbm.target_load_kg, ss.reps AS actual_reps, ss.load_kg AS actual_load_kg
  FROM planned_block_movements pbm
  JOIN planned_blocks pb ON pb.id = pbm.planned_block_id
  JOIN planned_sessions ps ON ps.id = pb.planned_session_id
  JOIN movements m ON m.id = pbm.movement_id
  LEFT JOIN workout_sessions ws ON ws.planned_session_id = ps.id
  LEFT JOIN workout_blocks wb ON wb.session_id = ws.id
  LEFT JOIN block_movements bm ON bm.block_id = wb.id AND bm.movement_id = pbm.movement_id
  LEFT JOIN strength_sets ss ON ss.block_movement_id = bm.id AND NOT ss.is_warmup
  WHERE m.name = 'back squat' ORDER BY ps.planned_date;
`;
