import { describe, expect, it } from "vitest";
import {
  newSession,
  SESSION_TTL_S,
  sessionCookie,
  signSession,
  verifySession,
} from "../worker/session.js";

const SECRET = "test-secret-please-rotate";

describe("session token", () => {
  it("round-trips sign → verify", async () => {
    const payload = newSession("11111111-2222-3333-4444-555555555555");
    const token = await signSession(payload, SECRET);
    expect(await verifySession(token, SECRET)).toEqual(payload);
  });

  it("sets a rolling 90-day expiry from issue time", () => {
    const now = 1_780_000_000_000;
    const p = newSession("u", now);
    expect(p.iat).toBe(Math.floor(now / 1000));
    expect(p.exp - p.iat).toBe(SESSION_TTL_S);
    expect(SESSION_TTL_S).toBe(90 * 24 * 3600);
  });

  it("rejects a tampered payload", async () => {
    const token = await signSession(newSession("real-user"), SECRET);
    const [v, body, mac] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ uid: "attacker", iat: 0, exp: 9999999999 }))
      .toString("base64url");
    expect(await verifySession(`${v}.${forged}.${mac}`, SECRET)).toBeNull();
    expect(await verifySession(`${v}.${body}.${mac!.slice(0, -2)}xx`, SECRET)).toBeNull();
  });

  it("rejects a token signed with a different secret (rotation = revocation)", async () => {
    const token = await signSession(newSession("u"), SECRET);
    expect(await verifySession(token, "rotated-secret")).toBeNull();
  });

  it("rejects an expired token", async () => {
    const issued = newSession("u", Date.now() - (SESSION_TTL_S + 60) * 1000);
    const token = await signSession(issued, SECRET);
    expect(await verifySession(token, SECRET)).toBeNull();
    // ...but the same token is fine when "now" is inside the window.
    expect(await verifySession(token, SECRET, issued.iat * 1000 + 1000)).not.toBeNull();
  });

  it("rejects malformed input", async () => {
    expect(await verifySession("", SECRET)).toBeNull();
    expect(await verifySession("v1.only-two", SECRET)).toBeNull();
    expect(await verifySession("v2.a.b", SECRET)).toBeNull();
    expect(await verifySession("v1.a.b.c", SECRET)).toBeNull();
    expect(await verifySession("v1.!!!.###", SECRET)).toBeNull();
  });

  it("emits httpOnly SameSite=Lax cookies, Secure only over https", () => {
    expect(sessionCookie("tok", true)).toBe(
      `corpus_session=tok; Max-Age=${SESSION_TTL_S}; Path=/; HttpOnly; SameSite=Lax; Secure`,
    );
    expect(sessionCookie("tok", false)).not.toContain("Secure");
  });
});
