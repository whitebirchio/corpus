import { useState } from "react";
import { api, type MeResponse } from "../api.js";
import { addDays, fmtDate, fmtGrams, fmtInt, fmtTime, MEAL_TYPE_LABEL } from "../format.js";
import { useData } from "../useData.js";

/**
 * The "today's macros vs. target" view (SPEC §4 use case 1) plus the day's
 * Garmin metrics when present. A small day stepper reuses the same
 * /days/:date resources for "how did yesterday end up".
 */
export function Today({ me }: { me: MeResponse }) {
  const [date, setDate] = useState(me.today);
  const nutrition = useData(() => api.dayNutrition(date), [date]);
  const metrics = useData(() => api.dayMetrics(date), [date]);

  const day = nutrition.data;
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
