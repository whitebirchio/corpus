import { useState } from "react";
import {
  api,
  type ApiWorkout,
  type ApiWorkoutBlock,
  type MeResponse,
  type WorkoutDetailResponse,
} from "../api.js";
import { PlannedBlocks, StatusChip } from "../components/PlannedSession.js";
import {
  addDays,
  fmtBucket,
  fmtDate,
  fmtDuration,
  fmtGrams,
  fmtInt,
  fmtMetric,
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
  const body = useData(() => api.dayBody(date), [date]);
  const plan = useData(() => api.planWeek(date), [date]);

  const day = nutrition.data;
  const sessions = workouts.data?.workouts ?? null;
  // The planned session for the shown day; the card renders only when the
  // week has a plan at all (SPEC 04 §6 — glanceable, not naggy).
  const planned = plan.data?.week
    ? (plan.data.sessions.find((s) => s.plannedDate === date) ?? null)
    : null;
  const m = metrics.data?.metrics ?? null;
  const b = body.data?.body ?? null;
  const isToday = date === me.today;
  // Weight is logged sporadically; label the tile with the reading's date when
  // it's carried forward from an earlier day.
  const weightLabel = b && b.measuredOn !== date ? `Weight · ${fmtBucket(b.measuredOn, "day")}` : "Weight";
  // Garmin counts vigorous minutes double, but we show the raw sum of logged
  // moderate + vigorous; render only when the watch reported either.
  const intensityMin =
    m && (m.intensityMinutesModerate != null || m.intensityMinutesVigorous != null)
      ? (m.intensityMinutesModerate ?? 0) + (m.intensityMinutesVigorous ?? 0)
      : null;

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

      {planned ? (
        <section className={`card${plan.stale ? " stale" : ""}`}>
          <h2>
            {isToday ? "Today's plan" : "Planned"}
            <StatusChip status={planned.status} />
          </h2>
          <div className="plan-title">{planned.title}</div>
          <PlannedBlocks blocks={planned.blocks} />
          {planned.notes ? <div className="workout-notes">{planned.notes}</div> : null}
        </section>
      ) : null}

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

      {m || b ? (
        <div className={`tile-grid${metrics.stale || body.stale ? " stale" : ""}`}>
          {b ? (
            <StatTile label={weightLabel} value={fmtMetric(b.weight, b.weightUnit)} suffix={` ${b.weightUnit}`} />
          ) : null}
          {b?.bodyFatPct != null ? (
            <StatTile label="Body fat" value={fmtMetric(b.bodyFatPct, "%")} suffix="%" />
          ) : null}
          {m?.bodyBattery != null ? (
            <StatTile
              label="Body Battery"
              value={String(m.bodyBattery)}
              suffix={m.bodyBatteryLow != null ? ` / ${m.bodyBatteryLow} low` : undefined}
            />
          ) : null}
          {m?.restingHr != null ? (
            <StatTile label="Resting HR" value={String(m.restingHr)} suffix=" bpm" />
          ) : null}
          {m?.steps != null ? <StatTile label="Steps" value={fmtInt(m.steps)} /> : null}
          {m?.activeKcal != null ? (
            <StatTile label="Active burn" value={fmtInt(m.activeKcal)} suffix=" kcal" />
          ) : null}
          {fmtDuration(m?.sleepDurationS ?? null) != null ? (
            <StatTile label="Sleep" value={fmtDuration(m?.sleepDurationS ?? null)!} />
          ) : null}
          {m?.sleepScore != null ? (
            <StatTile label="Sleep score" value={String(m.sleepScore)} />
          ) : null}
          {m?.trainingReadiness != null ? (
            <StatTile label="Readiness" value={String(m.trainingReadiness)} />
          ) : null}
          {m?.hrvMs != null ? (
            <StatTile label="HRV" value={fmtInt(m.hrvMs)} suffix=" ms" />
          ) : null}
          {m?.stressScore != null ? (
            <StatTile label="Stress" value={String(m.stressScore)} />
          ) : null}
          {m?.spo2Avg != null ? (
            <StatTile label="SpO₂" value={String(m.spo2Avg)} suffix="%" />
          ) : null}
          {m?.respirationAvg != null ? (
            <StatTile label="Respiration" value={fmtInt(m.respirationAvg)} suffix=" brpm" />
          ) : null}
          {intensityMin != null ? (
            <StatTile label="Intensity" value={fmtInt(intensityMin)} suffix=" min" />
          ) : null}
          {m?.vo2max != null ? (
            <StatTile label="VO₂max" value={fmtInt(m.vo2max)} />
          ) : null}
          {m?.energySubjective != null ? (
            <StatTile label="Energy" value={String(m.energySubjective)} suffix=" / 5" />
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
