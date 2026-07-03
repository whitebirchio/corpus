/**
 * The REST surface (specs/02-pwa-client/IMPLEMENTATION.md §3.1): thin
 * validate → withUserDb → core repo → serialize shells, GET-only in v1 but
 * shaped as resources so PATCH/DELETE /meals/:id slot in later (SPEC §5.2).
 *
 * Every request re-loads the user row inside the same RLS transaction as the
 * repo call — timezone/unit changes apply immediately and the allowlist is
 * enforced per request, not just at sign-in.
 */
import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import { z } from "zod";
import {
  getDailyMetrics,
  getDayNutrition,
  getMealWithItems,
  getTrend,
  getUser,
  localDate as localDateSchema,
  metersToMiles,
  todayIn,
  trendQuerySchema,
  type Db,
  type TrendResult,
  type User,
  type UserCtx,
} from "@corpus/core";
import { isSecureRequest, allowedEmails } from "./auth.js";
import { withUserDb } from "./db.js";
import { newSession, sessionCookie, signSession, verifySession, SESSION_COOKIE } from "./session.js";

/** Thrown by handlers; mapped to a JSON error response in index.ts. */
export class ApiError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404,
    message: string,
  ) {
    super(message);
  }
}

type ApiEnv = { Bindings: Env; Variables: { uid: string } };

export const apiRoutes = new Hono<ApiEnv>();

apiRoutes.use("*", async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  const session = token ? await verifySession(token, c.env.SESSION_SECRET) : null;
  if (!session) throw new ApiError(401, "Not signed in");
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    // CSRF: SameSite=Lax plus this custom header on anything mutating
    // (SPEC §2 #15). v1 is read-only; the rule is set for the write phase.
    if (c.req.header("x-corpus-csrf") !== "1") {
      throw new ApiError(403, "Missing X-Corpus-Csrf header");
    }
  }
  c.set("uid", session.uid);
  await next();
  // Rolling session (SPEC §2 #8): each authenticated response restarts the
  // 90-day window.
  const fresh = await signSession(newSession(session.uid), c.env.SESSION_SECRET);
  c.res.headers.append("Set-Cookie", sessionCookie(fresh, isSecureRequest(c.req.url)));
});

/** Open the RLS-scoped transaction and resolve the fresh user row within it. */
async function runAsUser<T>(
  c: Context<ApiEnv>,
  fn: (db: Db, ctx: UserCtx, user: User) => Promise<T>,
): Promise<T> {
  const uid = c.get("uid");
  return withUserDb(c.env, uid, async (db) => {
    const user = await getUser(db, uid);
    if (!user) throw new ApiError(401, "Unknown user");
    if (!allowedEmails(c.env).includes(user.email.toLowerCase())) {
      throw new ApiError(403, "This Corpus instance is private.");
    }
    return fn(db, { userId: user.id, timezone: user.timezone, unitPreference: user.unitPreference }, user);
  });
}

function parseDateParam(c: Context<ApiEnv>): string {
  const date = c.req.param("date");
  if (!localDateSchema.safeParse(date).success) {
    throw new ApiError(400, "Invalid date — expected YYYY-MM-DD");
  }
  return date!;
}

apiRoutes.get("/me", async (c) => {
  const body = await runAsUser(c, async (_db, ctx, user) => ({
    user: {
      email: user.email,
      displayName: user.displayName,
      timezone: user.timezone,
      unitPreference: user.unitPreference,
    },
    today: todayIn(ctx.timezone),
  }));
  return c.json(body);
});

apiRoutes.get("/days/:date/nutrition", async (c) => {
  const date = parseDateParam(c);
  const day = await runAsUser(c, (db, ctx) => getDayNutrition(db, ctx, date));
  // Meals ride along whole (id, source, granularity, ...) — the dashboard
  // shows totals but the records stay addressable (SPEC §5.1).
  return c.json({ date, meals: day.meals, totals: day.totals, targets: day.targets ?? null });
});

apiRoutes.get("/days/:date/metrics", async (c) => {
  const date = parseDateParam(c);
  const metrics = await runAsUser(c, (db, ctx) => getDailyMetrics(db, ctx, date));
  return c.json({ date, metrics: metrics ?? null });
});

apiRoutes.get("/meals/:id", async (c) => {
  const id = c.req.param("id");
  if (!z.uuid().safeParse(id).success) throw new ApiError(400, "Invalid meal id");
  const detail = await runAsUser(c, (db, ctx) => getMealWithItems(db, ctx, id!));
  if (!detail) throw new ApiError(404, "Meal not found");
  return c.json(detail);
});

apiRoutes.get("/trends/:metric", async (c) => {
  const parsed = trendQuerySchema.safeParse({
    metric: c.req.param("metric"),
    from: c.req.query("from"),
    to: c.req.query("to"),
    bucket: c.req.query("bucket"),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ApiError(400, `Invalid trend query: ${issue?.path.join(".")} ${issue?.message}`);
  }
  const body = await runAsUser(c, async (db, ctx, user) =>
    displayUnits(await getTrend(db, ctx, parsed.data), user.unitPreference),
  );
  return c.json(body);
});

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Canonical → display conversion at the adapter edge, never in core
 * (SPEC §3). Only distance carries a unit worth converting; kcal/bpm/score
 * pass through.
 */
function displayUnits(trend: TrendResult, pref: "imperial" | "metric"): TrendResult {
  return {
    ...trend,
    series: trend.series.map((s) => {
      if (s.unit !== "m") return s;
      const unit = pref === "imperial" ? "mi" : "km";
      const convert = (m: number) => (pref === "imperial" ? metersToMiles(m) : m / 1000);
      return {
        ...s,
        unit,
        points: s.points.map((p) => ({ ...p, value: p.value == null ? null : r2(convert(p.value)) })),
      };
    }),
  };
}
