/**
 * MCP prompts (SPEC.md §6.3): reusable, versioned workflows that encode the
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

1. First call \`get_daily_summary\`${forDate(date)} to see what the overnight Garmin sync already captured (sleep, HRV, resting HR, steps, body battery, training readiness). Do NOT ask me for numbers it already has.
2. Ask me only for what's missing or subjective: how rested I feel (energy 1–5), any soreness, and my morning weigh-in if I took one.
3. Call \`log_daily_checkin\` with just those fields (unit-tag the weight, e.g. { value: 178.2, unit: 'lb' }). It upserts by date, so it won't clobber the Garmin-measured fields.
4. Echo back a one-line recap of the day's recovery picture and flag anything notable — poor sleep, low HRV or training readiness, or an elevated resting HR.
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

1. \`get_daily_summary\` for today — read last night's sleep, HRV, resting HR, training readiness, body battery, and my subjective energy.
2. \`query_data\` to see recent training load: working sets per muscle group over the last 5–7 days, days since each major lift, and recent cardio. The \`corpus://schema\` resource has the muscle-volume query to start from.
3. \`get_goals\` to weigh my active priorities.
4. Recommend a specific session (blocks + movements) that: respects recovery — go lighter or suggest rest if sleep/HRV/readiness are low; targets under-trained muscle groups and avoids ones hit hard in the last 48h; and moves my top goals forward. Give a short rationale, then offer to log it with \`log_workout\` when I'm done.
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
1. Training — sessions, working sets per muscle group, cardio volume/load, vs. the prior week; call out imbalances or skipped muscle groups.
2. Nutrition — average calories and protein vs. target, adherence, notable gaps.
3. Recovery — sleep duration/score, HRV, resting HR, and training-readiness trend; flag concerning drifts.
4. Body comp — weight trend if I logged weigh-ins.
5. Goals — progress on each active goal (\`get_goals\`): what moved, what stalled.

End with 2–3 specific, actionable focus points for next week. If you spot a durable pattern worth remembering, save it with \`save_insight\`.
`),
  );
}
