import { prisma } from "@/domain/db";
import { verifyPassword, hashPassword } from "@/auth/passwords";
import { UnauthorizedError } from "@/auth/errors";
import type { SessionPayload } from "@/auth/session";

const MIN_PASSWORD_LENGTH = 8;

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

  /** Requires re-proving the current password — a session cookie alone isn't enough to change it. */
  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`New password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const valid = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) throw new UnauthorizedError("Current password is incorrect.");

    const passwordHash = await hashPassword(newPassword);
    await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  }
}
