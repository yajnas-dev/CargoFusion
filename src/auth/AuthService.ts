import { prisma } from "@/domain/db";
import { verifyPassword } from "@/auth/passwords";
import { UnauthorizedError } from "@/auth/errors";
import type { SessionPayload } from "@/auth/session";

/** Node-runtime only (touches Prisma) — not imported from middleware.ts. */
export class AuthService {
  async authenticate(email: string, password: string): Promise<SessionPayload> {
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) throw new UnauthorizedError("Invalid email or password.");

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) throw new UnauthorizedError("Invalid email or password.");

    return {
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      workerId: user.workerId ?? undefined,
    };
  }
}
