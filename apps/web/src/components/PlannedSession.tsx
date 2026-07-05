import type { ApiPlannedBlock, PlannedSessionStatus } from "../api.js";

/** Status chip for a planned session (SPEC 04 §6): done / skipped / upcoming. */
export function StatusChip({ status }: { status: PlannedSessionStatus }) {
  const label =
    status === "completed"
      ? "Done"
      : status === "skipped"
        ? "Skipped"
        : status === "cancelled"
          ? "Cancelled"
          : "Planned";
  return <span className={`status-chip ${status}`}>{label}</span>;
}

/** One planned movement as a single prescription line. */
function movementLine(m: ApiPlannedBlock["movements"][number]): string {
  if (m.prescription) return m.prescription;
  const scheme =
    m.sets != null ? `${m.sets}×${m.reps ?? m.repsText ?? "?"}` : (m.repsText ?? "");
  const load = m.targetLoad ? ` @ ${m.targetLoad}` : "";
  const rpe = m.targetRpe != null ? ` RPE ${m.targetRpe}` : "";
  return [scheme, load, rpe].join("").trim();
}

/** The prescription body of a planned session, reused by Today and Plan views. */
export function PlannedBlocks({ blocks }: { blocks: ApiPlannedBlock[] }) {
  return (
    <>
      {blocks.map((b) => {
        const facts = [
          b.scheme ? cap(b.scheme.replace(/_/g, " ")) : null,
          b.rounds != null ? `${b.rounds} rounds` : null,
          b.timeCap ? `cap ${b.timeCap}` : null,
          b.targetDistance,
          b.targetDuration,
          b.targetPace ? `@ ${b.targetPace}` : null,
          b.targetRpe != null ? `RPE ${b.targetRpe}` : null,
        ].filter(Boolean);
        return (
          <div className="block" key={b.seq}>
            <div className="block-head">
              <span className="block-type">{cap(b.blockType)}</span>
              {facts.length > 0 ? <span className="block-facts">{facts.join(" · ")}</span> : null}
            </div>
            {b.structure ? <div className="block-facts">{b.structure}</div> : null}
            {b.movements.map((m, i) => (
              <div className="mv" key={i}>
                <div className="mv-name">
                  {m.name}
                  <span className="mv-rx"> {movementLine(m)}</span>
                </div>
              </div>
            ))}
            {b.notes ? <div className="workout-notes">{b.notes}</div> : null}
          </div>
        );
      })}
    </>
  );
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
