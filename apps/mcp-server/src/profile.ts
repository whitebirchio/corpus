/**
 * The corpus://profile resource (specs/01-initial-platform/SPEC.md §6.3): who the user is and what
 * they're working toward — identity, timezone, unit preference, and an
 * active-goals digest (with milestones) ordered by priority. Reading it primes
 * any conversation with context that would otherwise be re-derived each
 * session. Pure rendering so it's unit-testable; the data (grant props + active
 * goals + milestones) is gathered in tools.ts where the RLS-scoped db lives.
 */
import type { GoalMilestone, GoalWithMilestones } from "@corpus/core";
import type { GrantProps } from "./types.js";

/** A goal/milestone's target as a compact phrase, e.g. "increase → 40 miles". */
function targetPhrase(t: { direction?: string; metric?: string; targetValue?: number; unit?: string } | null | undefined): string {
  const parts: string[] = [];
  if (t?.direction) parts.push(t.direction);
  if (t?.metric) parts.push(t.metric);
  if (t?.targetValue !== undefined) parts.push(`→ ${t.targetValue}${t.unit ? ` ${t.unit}` : ""}`);
  return parts.length ? `, target: ${parts.join(" ")}` : "";
}

/** One milestone as an indented sub-line under its goal. */
function milestoneLine(m: GoalMilestone): string {
  const by = m.targetDate ? `, by ${m.targetDate}` : "";
  const status = m.status !== "active" ? `, ${m.status}` : "";
  return `   - ${m.title}${targetPhrase(m.target)}${by}${status}`;
}

/** One active goal as a digest line plus its milestones (soonest first). */
function goalLine(g: GoalWithMilestones): string {
  const by = g.targetDate ? `, by ${g.targetDate}` : "";
  const desc = g.description ? `\n   ${g.description}` : "";
  const head = `- **${g.title}** (${g.domain}, priority ${g.priority}${targetPhrase(g.target)}${by})${desc}`;
  if (g.milestones.length === 0) return head;
  return `${head}\n${g.milestones.map(milestoneLine).join("\n")}`;
}

export function renderProfile(props: GrantProps, goals: GoalWithMilestones[]): string {
  const units = props.unitPreference === "metric" ? "metric (kg, km)" : "imperial (lb, mi)";
  const goalsSection = goals.length
    ? `Ordered by priority (most important first).\n\n${goals.map(goalLine).join("\n")}`
    : "No active goals recorded.";
  return [
    `# Corpus profile — ${props.displayName}`,
    "",
    "## Identity & preferences",
    `- User: ${props.displayName} (${props.email})`,
    `- Timezone: ${props.timezone} (all local dates/times are in this zone)`,
    `- Units: ${units} — convert canonical metric storage to these for display`,
    "",
    `## Active goals (${goals.length})`,
    goalsSection,
    "",
  ].join("\n");
}
