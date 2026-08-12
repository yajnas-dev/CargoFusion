import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession, type SessionPayload } from "@/auth/session";
import { UnauthorizedError, ForbiddenError } from "@/auth/errors";
import type { UserRole } from "@/domain/types";

export async function getSessionUser(req: NextRequest): Promise<SessionPayload | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

export async function requireSessionUser(req: NextRequest): Promise<SessionPayload> {
  const session = await getSessionUser(req);
  if (!session) throw new UnauthorizedError("Not signed in.");
  return session;
}

export function requireRole(session: SessionPayload, ...roles: UserRole[]): void {
  if (!roles.includes(session.role)) {
    throw new ForbiddenError(`This action requires role ${roles.join(" or ")} (you are ${session.role}).`);
  }
}
