import { useState } from "react";
import {
  api,
  type ApiWorkout,
  type ApiWorkoutBlock,
  type MeResponse,
  type WorkoutDetailResponse,
} from "../api.js";
import {
  addDays,
  fmtDate,
  fmtDuration,
  fmtGrams,
  fmtInt,
  fmtTime,
  MEAL_TYPE_LABEL,
} from "../format.js";
import { useData } from "../useData.js";

/**
 * The "today's macros vs. target" view (SPEC §4 use case 1) plus the day's
 * Garmin metrics when present. A small day stepper reuses the same
 * /days/:date resources for "how did yesterday end up".
 */
export function Today({ me }: { me: MeResponse }) {
  const [date, setDate] = useState(me.today);
  const nutrition = useData(() => api.dayNutrition(date), [date]);
  const workouts = useData(() => api.dayWorkouts(date), [date]);
  const metrics = useData(() => api.dayMetrics(date), [date]);

  const day = nutrition.data;
  const sessions = workouts.data?.workouts ?? null;
  const m = metrics.data?.metrics ?? null;
  const isToday = date === me.today;

  return (
    <>
      <div className="day-nav">
        <button aria-label="Previous day" onClick={() => setDate(addDays(date, -1))}>
          ‹
        </button>
        <div className="date">
          {isToday ? "Today" : fmtDate(date)}
          {isToday ? <span style={{ color: "var(--ink-muted)" }}> · {fmtDate(date)}</span> : null}
        </div>
        <button aria-label="Next day" disabled={isToday} onClick={() => setDate(addDays(date, 1))}>
          ›
        </button>
      </div>

      {nutrition.error ? <div className="card error-note">{nutrition.error}</div> : null}

      <section className={`card${nutrition.stale ? " stale" : ""}`}>
        <h2>Nutrition</h2>
        {day ? (
          <>
            <div className="hero-value">{fmtInt(day.totals.calories)}</div>
            <div className="hero-caption">
              {day.targets
                ? `of ${fmtInt(day.targets.calories)} kcal target · ${remainingLabel(day.totals.calories, day.targets.calories)}`
                : "kcal eaten — no target set"}
            </div>
            <Meter
              name="Protein"
              value={day.totals.proteinG}
              target={day.targets?.proteinG ?? null}
            />
            <Meter name="Carbs" value={day.totals.carbsG} target={day.targets?.carbsG ?? null} />
            <Meter name="Fat" value={day.totals.fatG} target={day.targets?.fatG ?? null} />
          </>
        ) : (
          <div className="empty-note">Loading…</div>
        )}
      </section>

      <section className={`card${nutrition.stale ? " stale" : ""}`}>
        <h2>Meals</h2>
        {day && day.meals.length > 0 ? (
          <div className="meal-list">
            {day.meals.map((meal) => (
              <div className="meal-row" key={meal.id} data-meal-id={meal.id}>
                <div className="what">
                  <div className="desc">{meal.description}</div>
                  <div className="when">
                    {MEAL_TYPE_LABEL[meal.mealType] ?? meal.mealType} ·{" "}
                    {fmtTime(meal.eatenAt, me.user.timezone)}
                  </div>
                </div>
                <div className="macros">
                  <div className="kcal">{fmtInt(meal.calories)} kcal</div>
                  <div className="pcf">
                    P {fmtGrams(meal.proteinG)} · C {fmtGrams(meal.carbsG)} · F{" "}
                    {fmtGrams(meal.fatG)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-note">
            {day ? "Nothing logged — tell Claude what you ate." : "Loading…"}
          </div>
        )}
      </section>

      {workouts.error ? <div className="card error-note">{workouts.error}</div> : null}

      <section className={`card${workouts.stale ? " stale" : ""}`}>
        <h2>Workouts</h2>
        {sessions && sessions.length > 0 ? (
          <div className="meal-list">
            {sessions.map((w) => (
              <WorkoutRow key={w.id} workout={w} timezone={me.user.timezone} />
            ))}
          </div>
        ) : (
          <div className="empty-note">
            {sessions ? "Nothing logged — tell Claude about your training." : "Loading…"}
          </div>
        )}
      </section>

      {m ? (
        <div className={`tile-grid${metrics.stale ? " stale" : ""}`}>
          {m.bodyBattery != null ? (
            <StatTile
              label="Body Battery"
              value={String(m.bodyBattery)}
              suffix={m.bodyBatteryLow != null ? ` / ${m.bodyBatteryLow} low` : undefined}
            />
          ) : null}
          {m.restingHr != null ? (
            <StatTile label="Resting HR" value={String(m.restingHr)} suffix=" bpm" />
          ) : null}
          {m.steps != null ? <StatTile label="Steps" value={fmtInt(m.steps)} /> : null}
          {m.activeKcal != null ? (
            <StatTile label="Active burn" value={fmtInt(m.activeKcal)} suffix=" kcal" />
          ) : null}
          {m.sleepScore != null ? (
            <StatTile label="Sleep score" value={String(m.sleepScore)} />
          ) : null}
          {m.trainingReadiness != null ? (
            <StatTile label="Readiness" value={String(m.trainingReadiness)} />
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/**
 * One workout: a glanceable summary row (movements, HR, notes) that expands on
 * tap to the full block/set breakdown, fetched lazily on first open.
 */
function WorkoutRow({ workout: w, timezone }: { workout: ApiWorkout; timezone: string }) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<WorkoutDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    const next = !expanded;
    setExpanded(next);
    if (next && !detail && !error) {
      api
        .workoutDetail(w.id)
        .then(setDetail)
        .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    }
  }

  const meta = [
    fmtTime(w.startedAt, timezone),
    fmtDuration(w.durationS),
    w.sessionRpe != null ? `RPE ${w.sessionRpe}` : null,
    w.avgHr != null ? `♥ ${w.avgHr}${w.maxHr != null ? `/${w.maxHr}` : ""}` : null,
  ].filter(Boolean);

  return (
    <div className="workout-item" data-workout-id={w.id}>
      <button className="meal-row workout-head" onClick={toggle} aria-expanded={expanded}>
        <div className="what">
          <div className="desc">
            <span className={`caret${expanded ? " open" : ""}`}>›</span>
            {w.title || w.movements.slice(0, 3).join(", ") || "Workout"}
          </div>
          <div className="when">
            {w.blockTypes.length > 0 ? `${w.blockTypes.map(cap).join(" · ")} — ` : ""}
            {meta.join(" · ")}
          </div>
        </div>
        <div className="macros">
          {w.calories != null ? <div className="kcal">{fmtInt(w.calories)} kcal</div> : null}
          {w.muscleGroups.length > 0 ? (
            <div className="pcf">{w.muscleGroups.slice(0, 4).join(" · ")}</div>
          ) : null}
        </div>
      </button>

      {expanded ? (
        <div className="workout-detail">
          {error ? <div className="empty-note">{error}</div> : null}
          {!detail && !error ? <div className="empty-note">Loading…</div> : null}
          {detail ? (
            <>
              {detail.blocks.map((b) => (
                <WorkoutBlock key={b.seq} block={b} />
              ))}
              {w.notes ? <div className="workout-notes">{w.notes}</div> : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function WorkoutBlock({ block: b }: { block: ApiWorkoutBlock }) {
  // Metcon/cardio facts that live on the block itself, in display order.
  const facts = [
    b.scheme ? cap(b.scheme.replace(/_/g, " ")) : null,
    b.rounds != null ? `${b.rounds} rounds` : null,
    b.timeCap ? `cap ${b.timeCap}` : null,
    b.distance,
    b.duration,
    b.pace,
    b.result ? `→ ${b.result}${b.rx ? " Rx" : ""}` : null,
    b.avgHr != null ? `♥ ${b.avgHr}${b.maxHr != null ? `/${b.maxHr}` : ""}` : null,
    b.rpe != null ? `RPE ${b.rpe}` : null,
  ].filter(Boolean);

  return (
    <div className="block">
      <div className="block-head">
        <span className="block-type">{cap(b.blockType)}</span>
        {facts.length > 0 ? <span className="block-facts">{facts.join(" · ")}</span> : null}
      </div>
      {b.movements.map((mv, i) => (
        <div className="mv" key={i}>
          <div className="mv-name">
            {mv.name}
            {mv.prescription ? <span className="mv-rx"> {mv.prescription}</span> : null}
            {mv.load ? <span className="mv-rx"> @ {mv.load}</span> : null}
          </div>
          {mv.sets.length > 0 ? (
            <div className="sets">
              {mv.sets.map((s) => (
                <span
                  className={`set${s.isWarmup ? " warmup" : ""}${s.isFailure ? " failure" : ""}`}
                  key={s.setNumber}
                  title={s.isWarmup ? "Warm-up set" : undefined}
                >
                  {s.load ? `${s.load} × ${s.reps ?? "—"}` : `${s.reps ?? "—"} reps`}
                  {s.rpe != null ? ` @${s.rpe}` : ""}
                  {s.isFailure ? " ✗" : ""}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ))}
      {b.notes ? <div className="workout-notes">{b.notes}</div> : null}
    </div>
  );
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function remainingLabel(eaten: number, target: number): string {
  const diff = Math.round(target - eaten);
  return diff >= 0 ? `${fmtInt(diff)} left` : `${fmtInt(-diff)} over`;
}

function Meter({ name, value, target }: { name: string; value: number; target: number | null }) {
  const pct = target && target > 0 ? Math.min(100, (value / target) * 100) : 0;
  return (
    <div className="meter">
      <div className="meter-head">
        <span className="name">{name}</span>
        <span className="nums">
          <strong>{fmtGrams(value)}</strong>
          {target ? ` / ${fmtGrams(target)}` : ""}
        </span>
      </div>
      {target ? (
        <div className="track">
          <div className="fill" style={{ width: `${pct}%` }} />
        </div>
      ) : null}
    </div>
  );
}

function StatTile({ label, value, suffix }: { label: string; value: string; suffix?: string }) {
  return (
    <div className="stat-tile">
      <div className="label">{label}</div>
      <div className="value">
        {value}
        {suffix ? <small>{suffix}</small> : null}
      </div>
    </div>
  );
}
