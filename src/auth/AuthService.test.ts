import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthService } from "@/auth/AuthService";
import { UnauthorizedError } from "@/auth/errors";
import { hashPassword } from "@/auth/passwords";
import { prisma } from "@/domain/db";

describe("AuthService", () => {
  const TEST_EMAIL = "auth-service-test@cargofusion.demo";
  const TEST_PASSWORD = "test-password-123";
  let createdUserId: string;

  beforeEach(async () => {
    const passwordHash = await hashPassword(TEST_PASSWORD);
    const user = await prisma.user.create({
      data: { email: TEST_EMAIL, name: "Auth Test User", role: "OPERATOR", passwordHash },
    });
    createdUserId = user.id;
  });

  afterEach(async () => {
    await prisma.user.delete({ where: { id: createdUserId } });
  });

  it("authenticates with correct credentials and returns a matching session payload", async () => {
    const session = await new AuthService().authenticate(TEST_EMAIL, TEST_PASSWORD);
    expect(session).toEqual({
      sub: createdUserId,
      email: TEST_EMAIL,
      name: "Auth Test User",
      role: "OPERATOR",
      workerId: undefined,
    });
  });

  it("is case-insensitive on email", async () => {
    const session = await new AuthService().authenticate(TEST_EMAIL.toUpperCase(), TEST_PASSWORD);
    expect(session.email).toBe(TEST_EMAIL);
  });

  it("rejects an unknown email", async () => {
    await expect(new AuthService().authenticate("nobody@cargofusion.demo", TEST_PASSWORD)).rejects.toThrow(
      UnauthorizedError,
    );
  });

  it("rejects a wrong password", async () => {
    await expect(new AuthService().authenticate(TEST_EMAIL, "wrong-password")).rejects.toThrow(UnauthorizedError);
  });

  it("changePassword requires the correct current password and lets the new one authenticate afterward", async () => {
    const auth = new AuthService();
    await auth.changePassword(createdUserId, TEST_PASSWORD, "a-new-password-1");

    await expect(auth.authenticate(TEST_EMAIL, TEST_PASSWORD)).rejects.toThrow(UnauthorizedError);
    const session = await auth.authenticate(TEST_EMAIL, "a-new-password-1");
    expect(session.sub).toBe(createdUserId);
  });

  it("changePassword rejects an incorrect current password without changing anything", async () => {
    const auth = new AuthService();
    await expect(auth.changePassword(createdUserId, "wrong-current", "a-new-password-1")).rejects.toThrow(
      UnauthorizedError,
    );
    const session = await auth.authenticate(TEST_EMAIL, TEST_PASSWORD);
    expect(session.sub).toBe(createdUserId);
  });

  it("changePassword rejects a new password shorter than the minimum length", async () => {
    const auth = new AuthService();
    await expect(auth.changePassword(createdUserId, TEST_PASSWORD, "short")).rejects.toThrow(/at least/);
  });
});
