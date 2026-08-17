import { describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { signSession, verifySession, sessionCookieOptions, SESSION_COOKIE } from "@/auth/session";

const SAMPLE_PAYLOAD = {
  sub: "user-1",
  email: "test@cargofusion.demo",
  name: "Test User",
  role: "SUPERVISOR" as const,
};

describe("session", () => {
  it("signs and verifies a round trip", async () => {
    const token = await signSession(SAMPLE_PAYLOAD);
    const verified = await verifySession(token);
    expect(verified).toEqual(SAMPLE_PAYLOAD);
  });

  it("includes workerId when present, omits it when absent", async () => {
    const withWorker = await signSession({ ...SAMPLE_PAYLOAD, role: "WORKER", workerId: "WORKER-001" });
    expect((await verifySession(withWorker))?.workerId).toBe("WORKER-001");

    const withoutWorker = await signSession(SAMPLE_PAYLOAD);
    expect((await verifySession(withoutWorker))?.workerId).toBeUndefined();
  });

  it("returns null for a malformed token instead of throwing", async () => {
    expect(await verifySession("not.a.jwt")).toBeNull();
    expect(await verifySession("")).toBeNull();
  });

  it("returns null for an expired token", async () => {
    const secret = new TextEncoder().encode(process.env.SESSION_SECRET);
    const expired = await new SignJWT({ ...SAMPLE_PAYLOAD })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 10)
      .sign(secret);

    expect(await verifySession(expired)).toBeNull();
  });

  it("returns null for a token signed with a different secret (tampered)", async () => {
    const wrongSecret = new TextEncoder().encode("a-completely-different-secret-value");
    const forged = await new SignJWT({ ...SAMPLE_PAYLOAD })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(wrongSecret);

    expect(await verifySession(forged)).toBeNull();
  });

  it("sessionCookieOptions sets httpOnly/lax defaults with the given max age", () => {
    const opts = sessionCookieOptions(600);
    expect(opts).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 });
  });

  it("SESSION_COOKIE has a stable, non-empty name", () => {
    expect(SESSION_COOKIE).toBe("acsa_session");
  });
});
