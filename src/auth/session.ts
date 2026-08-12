import { SignJWT, jwtVerify } from "jose";
import type { UserRole } from "@/domain/types";

/**
 * Edge-safe session handling — deliberately has no dependency on Prisma
 * (@prisma/adapter-better-sqlite3 wraps a native addon that can't run on
 * the Edge runtime middleware.ts uses by default). jose is pure JS, so
 * this file can be imported from both middleware.ts and Node-runtime
 * route handlers without a runtime split.
 *
 * Sessions are stateless signed JWTs in an httpOnly cookie, not DB-backed
 * — three static roles and one credentials login don't need a Session
 * table; revocation-before-expiry isn't supported (a 12h expiry bounds
 * the blast radius of a compromised cookie instead).
 */
export interface SessionPayload {
  sub: string; // User.id
  email: string;
  name: string;
  role: UserRole;
  workerId?: string;
}

export const SESSION_COOKIE = "acsa_session";
const SESSION_TTL_SECONDS = 12 * 60 * 60; // 12h

function secretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is not set. Add it to .env (see .env.example) to use auth.");
  }
  return new TextEncoder().encode(secret);
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey());
}

/** Never throws — returns null for a missing, expired, tampered, or malformed token. */
export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (
      typeof payload.sub !== "string" ||
      typeof payload.email !== "string" ||
      typeof payload.name !== "string" ||
      typeof payload.role !== "string"
    ) {
      return null;
    }
    return {
      sub: payload.sub,
      email: payload.email,
      name: payload.name,
      role: payload.role as UserRole,
      workerId: typeof payload.workerId === "string" ? payload.workerId : undefined,
    };
  } catch {
    return null;
  }
}

export function sessionCookieOptions(maxAgeSeconds: number = SESSION_TTL_SECONDS) {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/" as const,
    maxAge: maxAgeSeconds,
  };
}
