/**
 * The corpus://profile resource (SPEC.md §6.3): who the user is and what
 * they're working toward — identity, timezone, unit preference, and an
 * active-goals digest ordered by priority. Reading it primes any conversation
 * with context that would otherwise be re-derived each session. Pure rendering
 * so it's unit-testable; the data (grant props + active goals) is gathered in
 * tools.ts where the RLS-scoped db and grant props live.
 */
import type { Goal } from "@corpus/core";
import type { GrantProps } from "./types.js";

/** One active goal as a digest line: title, domain, target phrase, deadline. */
function goalLine(g: Goal): string {
  const t = g.target ?? {};
  const targetParts: string[] = [];
  if (t.direction) targetParts.push(t.direction);
  if (t.metric) targetParts.push(t.metric);
  if (t.targetValue !== undefined)
    targetParts.push(`→ ${t.targetValue}${t.unit ? ` ${t.unit}` : ""}`);
  const target = targetParts.length ? `, target: ${targetParts.join(" ")}` : "";
  const by = g.targetDate ? `, by ${g.targetDate}` : "";
  const desc = g.description ? `\n   ${g.description}` : "";
  return `- **${g.title}** (${g.domain}, priority ${g.priority}${target}${by})${desc}`;
}

export function renderProfile(props: GrantProps, goals: Goal[]): string {
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
