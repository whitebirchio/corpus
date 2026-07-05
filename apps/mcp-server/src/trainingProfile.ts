/**
 * Rendering for the get_training_profile tool (specs/04-training-plans/SPEC.md §4.2):
 * the athlete model as markdown that primes a planning conversation. A tool
 * rather than a resource by deliberate choice (SPEC 04 decision #13). Pure
 * rendering, unit-testable; data comes from @corpus/core getTrainingProfile.
 */
import {
  formatDistance,
  formatDuration,
  formatMass,
  formatPace,
  type TrainingProfile,
} from "@corpus/core";

type Pref = "imperial" | "metric";

/** Render a canonical capability value in the user's preferred units. */
function capabilityValueDisplay(value: number, unit: string, pref: Pref): string {
  switch (unit) {
    case "kg":
      return formatMass(value, pref);
    case "m":
      return formatDistance(value, pref);
    case "s":
      return formatDuration(value);
    case "s_per_km":
      return formatPace(value, pref);
    case "m_per_week":
      return `${formatDistance(value, pref)}/week`;
    default:
      return `${value} ${unit}`;
  }
}

export function renderTrainingProfile(profile: TrainingProfile, pref: Pref): string {
  const lines: string[] = ["# Training profile", ""];

  lines.push("## Context");
  lines.push(
    `- Home location: ${profile.homeLocation ?? "not set — ask and save with set_home_location"} (check the forecast here when planning)`,
  );
  lines.push(
    profile.currentWeek
      ? `- Current week (${profile.currentWeek.weekStart}): ${profile.currentWeek.focus ?? "no stated focus"}`
      : "- Current week: no plan yet — offer to run plan_my_week",
  );
  lines.push("");

  lines.push(`## Goals & milestones (${profile.goals.length})`);
  if (profile.goals.length === 0) lines.push("No active goals.");
  for (const g of profile.goals) {
    lines.push(`- **${g.title}** (priority ${g.priority}${g.targetDate ? `, by ${g.targetDate}` : ""})`);
    for (const m of g.milestones) {
      lines.push(`  - ${m.title}${m.targetDate ? ` — by ${m.targetDate}` : ""}`);
    }
  }
  lines.push("");

  lines.push(`## Capability estimates (${profile.capabilities.length})`);
  if (profile.capabilities.length === 0) {
    lines.push("None recorded yet — propose estimates from workout history and save what the user confirms.");
  }
  for (const c of profile.capabilities) {
    const subject = c.movementName ? `${c.movementName} ${c.metric}` : c.metric;
    const rep = c.repMax ? ` (${c.repMax}RM)` : "";
    lines.push(
      `- ${subject}${rep}: ${capabilityValueDisplay(c.value, c.unit, pref)} — ${c.confidence} confidence, as of ${c.effectiveDate} (${c.basis})`,
    );
  }
  lines.push("");

  lines.push(`## Equipment (${profile.equipment.length})`);
  if (profile.equipment.length === 0) lines.push("Nothing recorded — ask what's available and save it.");
  for (const e of profile.equipment) {
    const details = e.details ? ` ${JSON.stringify(e.details)}` : "";
    lines.push(`- ${e.name} (${e.category}${e.location ? `, ${e.location}` : ""})${details}${e.notes ? ` — ${e.notes}` : ""}`);
  }
  lines.push("");

  lines.push(`## Constraints (${profile.constraints.length}) — binding rules, respect these`);
  if (profile.constraints.length === 0) lines.push("None recorded.");
  for (const c of profile.constraints) {
    lines.push(`- [${c.kind}] ${c.rule}${c.notes ? ` — ${c.notes}` : ""}`);
  }
  lines.push("");

  return lines.join("\n");
}
