/**
 * MCP prompts (specs/01-initial-platform/SPEC.md §6.3): reusable, versioned workflows that encode the
 * recurring interaction patterns so every chat doesn't reinvent them. A prompt
 * returns a single user-turn message that states the intent and the procedure
 * the assistant should follow using the real tools/resources — no data access
 * happens here, the model does the work by calling tools.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type PromptResult = {
  messages: Array<{ role: "user"; content: { type: "text"; text: string } }>;
};

/** Wrap instruction text as the single user message a prompt expands to. */
function userMessage(text: string): PromptResult {
  return { messages: [{ role: "user", content: { type: "text", text: text.trim() } }] };
}

/** "for 2026-07-01" when a date was supplied, else "" (assistant uses today). */
function forDate(date: string | undefined): string {
  return date && date.trim() ? ` for ${date.trim()}` : "";
}

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "morning_checkin",
    {
      title: "Morning check-in",
      description:
        "Guide the ~30-second morning check-in, reusing whatever the overnight Garmin sync already captured and only asking for the subjective bits.",
      argsSchema: { date: z.string().optional().describe("YYYY-MM-DD; defaults to today") },
    },
    ({ date }) =>
      userMessage(`
Let's do my morning check-in${forDate(date)}.

1. First call \`get_daily_summary\`${forDate(date)} to see what the overnight Garmin sync already captured (sleep, HRV, resting HR, steps, body battery, training readiness) AND what I have planned today (\`todaysPlan\`). Do NOT ask me for numbers it already has.
2. Ask me only for what's missing or subjective: how rested I feel (energy 1–5), any soreness, and my morning weigh-in if I took one.
3. Call \`log_daily_checkin\` with just those fields (unit-tag the weight, e.g. { value: 178.2, unit: 'lb' }). It upserts by date, so it won't clobber the Garmin-measured fields.
4. Echo back a one-line recap of the day's recovery picture and flag anything notable — poor sleep, low HRV or training readiness, or an elevated resting HR.
5. If \`todaysPlan\` has a session (and it isn't already done), remind me what's on for today in a line. If recovery looks rough against what's planned — e.g. a hard session on a low-readiness day, or soreness where I'm about to train — proactively offer to adapt it (scale it, or swap with an easier day) and, if I agree, apply the change with \`update_planned_session\` (or walk through \`adjust_my_plan\`). If nothing's planned, offer \`plan_todays_workout\`.
`),
  );

  server.registerPrompt(
    "log_workout_conversation",
    {
      title: "Log a workout by describing it",
      description:
        "Capture a workout conversationally into log_workout with correct sets-vs-metcon data placement.",
      argsSchema: {},
    },
    () =>
      userMessage(`
I want to log a workout by describing it. Capture it accurately into \`log_workout\`.

- If I haven't described it yet, ask what I did: movements, sets, reps, loads, plus any cardio or metcon.
- CRITICAL data placement (getting this wrong silently loses data): every set-based movement — strength lifts AND weighted accessories — needs a \`sets\` array, one entry per set with reps + unit-tagged load (bodyweight sets omit load). Only true metcons use block-level repsPerRound/load. Runs and other cardio take distance/duration/HR on the block. Never put a lift's reps/weight only in \`prescription\` text — that's a fallback, not structured data.
- Confirm the parsed structure back to me before saving if anything is ambiguous, and supply category + primaryMuscles for any movement new to the catalog.
- After saving, echo a concise recap (per-movement top sets, rough total volume) and mention if it matched or enriched a Garmin-imported session for the day.
- Check \`get_training_plan\`: if today had a planned session, link this workout to it with \`link_workout_to_plan\`, then compare prescribed vs. actual. If the gap says my capability belief is off (e.g. prescribed loads felt easy at low RPE), update it with \`upsert_capability_estimate\`, citing this session as the basis.
`),
  );

  server.registerPrompt(
    "plan_todays_workout",
    {
      title: "Plan today's workout",
      description:
        "Recommend today's training from real recovery + recent-volume data, not guesses.",
      argsSchema: {
        focus: z
          .string()
          .optional()
          .describe("Optional bias, e.g. 'upper body', 'easy cardio', 'legs'"),
      },
    },
    ({ focus }) =>
      userMessage(`
Help me decide what workout to do today${focus && focus.trim() ? `, biased toward ${focus.trim()}` : ""}. Base it on real data:

1. \`get_training_plan\` — if today has a planned session, the job is EXECUTE-OR-ADAPT, not invent: present the prescription, sanity-check it against recovery (step 2), and only scale or swap with a reason. Apply any change via \`update_planned_session\` with an honest change category.
2. \`get_daily_summary\` for today — read last night's sleep, HRV, resting HR, training readiness, body battery, and my subjective energy.
3. If nothing is planned today: \`query_data\` for recent training load (working sets per muscle group over the last 5–7 days, days since each major lift, recent cardio — the \`corpus://schema\` resource has the starter query), \`get_goals\` for priorities, and \`get_training_profile\` for equipment and constraints.
4. Recommend a specific session (blocks + movements) that: respects recovery — go lighter or suggest rest if sleep/HRV/readiness are low; targets under-trained muscle groups and avoids ones hit hard in the last 48h; and moves my top goals forward. Give a short rationale, then offer to log it with \`log_workout\` when I'm done (and link it to the plan with \`link_workout_to_plan\` if it was planned).
`),
  );

  server.registerPrompt(
    "log_meal_conversation",
    {
      title: "Log a meal (photo + description)",
      description:
        "Capture a meal accurately from a photo + short caption and/or a description — itemized, portion-checked, with honest confidence.",
      argsSchema: {},
    },
    () =>
      userMessage(`
I want to log a meal. Capture it accurately into \`log_meal\` (specs/05-nutrition-accuracy/SPEC.md, phase 1 protocol).

- If I haven't shared it yet, ask what I ate — a photo plus a short caption is the preferred input; a plain description works too.
- Itemize every component, including the easy-to-miss ones: cooking fat, dressings, sauces, cheese, beverages. Record each portion verbatim in \`unitNote\` ("1 cup", "2 scoops", "6 oz"); when I give an exact weight, use it as-is — never round it away.
- Use the photo two ways: to spot items I didn't mention, and to sanity-check my stated portions against visual cues (plate coverage, depth, utensil scale). If the photo and my caption disagree by more than ~25% on a calorie-dense item, ask ONE clarifying question; otherwise proceed. Never block a log on uncertainty — save the best estimate and flag it.
- Set per-item \`confidence\` honestly: "high" for label-backed or weighed items, "medium" for solid visual estimates, "low" for guesses (hidden oils, restaurant portions). Include key micros when inferable: fiber_g, sugar_g, sat_fat_g, sodium_mg.
- Keep item names consistent with my history so the same food doesn't fragment across spellings (e.g. always "Ascent vanilla whey protein"). If unsure what name I've used before, check recent \`meal_items\` via \`query_data\`.
- When overall confidence is medium or lower, put a plausible calorie range in \`notes\` (e.g. "~620 kcal, plausible 520-750").
- After saving, echo a one-line recap (items, total kcal/P/C/F) and where the day now stands against my targets (\`get_daily_summary\`). If the result is \`possible_duplicate\`, show me the candidates and ask before retrying.
`),
  );

  server.registerPrompt(
    "finish_my_macros",
    {
      title: "Finish my macros",
      description:
        "Given today's intake vs. targets, suggest what to eat to close the remaining macro budget.",
      argsSchema: { date: z.string().optional().describe("YYYY-MM-DD; defaults to today") },
    },
    ({ date }) =>
      userMessage(`
Help me finish my macros${forDate(date)}.

1. Call \`get_daily_summary\`${forDate(date)} to get calories / protein / carbs / fat consumed so far vs. my targets.
2. Compute what's remaining in each macro.
3. Suggest 1–2 concrete meal or snack options that fit the remaining budget, prioritizing my protein target and preferring real foods I could plausibly have on hand.
4. If I pick one and eat it, log it with \`log_meal\` (itemized when you can infer items, totals otherwise), then re-check what's left.
`),
  );

  server.registerPrompt(
    "import_lab_report",
    {
      title: "Import a lab / fitness-test report",
      description:
        "Walk through extracting, confirming, and saving a lab panel or fitness test (and optionally storing the original).",
      argsSchema: {},
    },
    () =>
      userMessage(`
Help me import a lab or fitness-test report.

1. Ask me to share the report — a PDF/photo, or pasted values.
2. Extract the panel metadata (collection date, ordering provider, performing lab, fasting?) and each result. Map printed analyte names to the canonical keys in the \`corpus://analytes\` resource, but keep the verbatim value and reference range.
3. Show me the parsed results grouped by category and ask me to confirm or correct BEFORE saving.
4. On confirmation: if I have the original file, call \`create_document_upload\` and give me the PUT URL to store it, then \`record_lab_panel\` (or \`record_fitness_test\` for VO2 max / RMR / DEXA) with the results and the returned document_id. Flag any out-of-range values in your recap.
`),
  );

  server.registerPrompt(
    "weekly_review",
    {
      title: "Weekly review",
      description:
        "Summarize the past 7 days of training, nutrition, recovery, body comp, and goal progress, with actionable next steps.",
      argsSchema: {
        date: z
          .string()
          .optional()
          .describe("End of the review week, YYYY-MM-DD; defaults to today"),
      },
    },
    ({ date }) =>
      userMessage(`
Run my weekly review for the 7 days ending ${date && date.trim() ? date.trim() : "today"}.

Pull the real numbers with \`query_data\` and \`get_daily_summary\`, then give me a tight written review covering:
1. Training — sessions, working sets per muscle group, cardio volume/load, vs. the prior week; call out imbalances or skipped muscle groups. Include plan adherence from \`get_training_plan\`: planned vs. completed vs. skipped, with the week's change log as the explanation layer (a skip with a recorded reason is signal, not failure).
2. Nutrition — average calories and protein vs. target, adherence, notable gaps.
3. Recovery — sleep duration/score, HRV, resting HR, and training-readiness trend; flag concerning drifts.
4. Body comp — weight trend if I logged weigh-ins.
5. Goals — progress on each active goal (\`get_goals\`): what moved, what stalled.

End with 2–3 specific, actionable focus points for next week. If you spot a durable pattern worth remembering, save it with \`save_insight\`.
`),
  );

  server.registerPrompt(
    "plan_my_week",
    {
      title: "Plan my training week",
      description:
        "Draft next week's training plan from goals, milestones, recent volume, recovery, and the forecast — then save it.",
      argsSchema: {
        weekStart: z
          .string()
          .optional()
          .describe("Monday of the week to plan, YYYY-MM-DD; defaults to the upcoming week"),
      },
    },
    ({ weekStart }) =>
      userMessage(`
Help me plan my training week${weekStart && weekStart.trim() ? ` starting ${weekStart.trim()}` : ""}. Work from real data, then propose a concrete week:

1. \`get_training_profile\` — milestones to serve, capability estimates for loads/paces, available equipment, and binding constraints. Ask about and save anything important that's missing (equipment via \`upsert_equipment_item\`, location via \`set_home_location\`).
2. \`get_training_plan\` for the finishing week — adherence (completed vs. skipped) and what the change log says went wrong; carry those lessons forward.
3. \`query_data\` for recent training volume — weekly run mileage trend and working sets per muscle group (the \`corpus://schema\` resource has starter queries). Progress sensibly: keep weekly mileage ramps around ~10%, and plan a deload if recent weeks stacked heavy load or adherence cratered.
4. \`get_daily_summary\` — current recovery trend (sleep, HRV, readiness); temper the week if it looks rough.
5. Check the weather forecast for my home location for the week and route runs indoors/outdoors per my seasonal constraints.
6. Draft Mon–Sun with full prescriptions: strength days as movements with sets × reps @ target load (unit-tagged), runs with target distance/duration/pace, and explicit rest days. Prescribe loads from my capability estimates — fall back to \`get_movement_history\` where no estimate exists, and save confirmed new estimates with \`upsert_capability_estimate\`.
7. Present the draft for my confirmation, adjust to my feedback, THEN save with \`plan_week\` (weekStart is the Monday) and recap what was saved.
`),
  );

  server.registerPrompt(
    "adjust_my_plan",
    {
      title: "Adjust my training plan",
      description:
        "Rework the current week's plan around a disruption — sickness, weather, schedule, fatigue — with the change recorded.",
      argsSchema: {
        what_happened: z
          .string()
          .optional()
          .describe("What's forcing the change, e.g. 'woke up sick', 'legs are smoked', 'gym closed'"),
      },
    },
    ({ what_happened }) =>
      userMessage(`
My training plan needs to change${what_happened && what_happened.trim() ? `: ${what_happened.trim()}` : " — ask me what happened first"}.

1. \`get_training_plan\` for the current week; \`get_training_profile\` for constraints that bound the options.
2. Understand the disruption before proposing: how long will it last, does it affect everything or just some modalities (sick vs. sore legs are different problems)?
3. Propose the MINIMAL adjustment that protects the week's key sessions (e.g. keep the long run, drop an accessory day; swap a lower day for upper work when legs are the issue). Say what you'd change and why.
4. On my confirmation, apply it: \`update_planned_session\` per session (move date, replace blocks, or mark skipped/cancelled) — or \`plan_week\` with \`change\` if the whole week needs redrawing. Use an honest change category; quote my reasoning in the summary.
5. If this kind of disruption keeps recurring in the change history, propose a durable fix: a \`planning_constraint\` (via \`upsert_planning_constraint\`) or an insight.
`),
  );

  server.registerPrompt(
    "review_training_strategy",
    {
      title: "Review training strategy",
      description:
        "Periodic strategist session: goal & milestone progress against actuals, phase focus, and stale capability estimates.",
      argsSchema: {},
    },
    () =>
      userMessage(`
Run a training strategy review — the periodic check that the goal → milestone → weekly-plan chain still makes sense.

1. \`get_training_profile\` + \`get_goals\` — current goals, milestones, capabilities, constraints.
2. \`query_data\` for progress against each active milestone: weekly mileage trend, strength progression on key lifts, adherence by week (the \`corpus://schema\` resource has starter queries).
3. Milestone hygiene: mark achieved milestones (\`update_milestone_status\`), re-date ones that have drifted, and propose new ones where a gap between goal and next checkpoint is too large. Confirm before writing (\`upsert_milestone\`).
4. Recommend the next block's training focus (e.g. 'aerobic base' → 'build') and say what changes about the weekly template; the focus lands on future weeks via \`plan_week\`.
5. Sweep capability estimates for staleness against recent performances; update the ones that are off (\`upsert_capability_estimate\`, citing evidence).
6. Close with a short written summary: on/off track per goal, what changes, and anything worth a \`save_insight\`.
`),
  );
}
