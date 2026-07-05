import { useState } from "react";
import { api, type ApiPlannedSession, type MeResponse } from "../api.js";
import { PlannedBlocks, StatusChip } from "../components/PlannedSession.js";
import { addDays, fmtBucket, fmtDate } from "../format.js";
import { useData } from "../useData.js";

/**
 * The week's training plan (SPEC 04 §6): Mon–Sun with per-session status and
 * prescriptions. Read-only — all plan changes happen conversationally.
 */
export function Plan({ me }: { me: MeResponse }) {
  // Any date works as the anchor; the API normalizes to that week's Monday.
  const [anchor, setAnchor] = useState(me.today);
  const plan = useData(() => api.planWeek(anchor), [anchor]);

  const p = plan.data;
  const weekStart = p?.weekStart ?? anchor;
  const days = p ? Array.from({ length: 7 }, (_, i) => addDays(p.weekStart, i)) : [];
  const byDate = new Map<string, ApiPlannedSession>(
    (p?.sessions ?? []).map((s) => [s.plannedDate, s]),
  );

  return (
    <>
      <div className="day-nav">
        <button aria-label="Previous week" onClick={() => setAnchor(addDays(weekStart, -7))}>
          ‹
        </button>
        <div className="date">
          Week of {fmtBucket(weekStart, "week")}
          {p?.week?.focus ? (
            <span style={{ color: "var(--ink-muted)" }}> · {p.week.focus}</span>
          ) : null}
        </div>
        <button aria-label="Next week" onClick={() => setAnchor(addDays(weekStart, 7))}>
          ›
        </button>
      </div>

      {plan.error ? <div className="card error-note">{plan.error}</div> : null}

      {p && !p.week ? (
        <section className="card">
          <h2>No plan for this week</h2>
          <div className="empty-note">Ask Claude to “plan my week” to draft one.</div>
        </section>
      ) : null}

      {p?.week ? (
        <section className={`card${plan.stale ? " stale" : ""}`}>
          <h2>Sessions</h2>
          <div className="meal-list">
            {days.map((d) => {
              const s = byDate.get(d);
              return s ? (
                <PlannedSessionRow key={d} date={d} session={s} today={me.today} />
              ) : (
                <div className={`meal-row plan-row${d === me.today ? " today" : ""}`} key={d}>
                  <div className="what">
                    <div className="desc rest">{fmtDate(d)} — Rest</div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {p && p.changes.length > 0 ? (
        <section className={`card${plan.stale ? " stale" : ""}`}>
          <h2>Adjustments</h2>
          <div className="meal-list">
            {p.changes.map((ch, i) => (
              <div className="meal-row" key={i}>
                <div className="what">
                  <div className="desc">{ch.summary}</div>
                  <div className="when">{cap(ch.category)}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

function PlannedSessionRow({
  date,
  session: s,
  today,
}: {
  date: string;
  session: ApiPlannedSession;
  today: string;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="workout-item">
      <button
        className={`meal-row workout-head plan-row${date === today ? " today" : ""}`}
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <div className="what">
          <div className="desc">
            <span className={`caret${expanded ? " open" : ""}`}>›</span>
            {fmtDate(date)} — {s.title}
          </div>
          <div className="when">
            {s.blocks.map((b) => cap(b.blockType)).join(" · ")}
            {s.linkedWorkouts.length > 0 && s.linkedWorkouts[0]!.duration
              ? ` · did ${s.linkedWorkouts[0]!.duration}`
              : ""}
          </div>
        </div>
        <div className="macros">
          <StatusChip status={s.status} />
        </div>
      </button>
      {expanded ? (
        <div className="workout-detail">
          <PlannedBlocks blocks={s.blocks} />
          {s.notes ? <div className="workout-notes">{s.notes}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
