import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/auth/passwords";

describe("passwords", () => {
  it("hashes a password and verifies the correct plaintext against it", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).not.toBe("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("rejects an incorrect password against a valid hash", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("wrong password", hash)).toBe(false);
  });

  it("produces a different hash each time (random salt)", async () => {
    const hash1 = await hashPassword("same input");
    const hash2 = await hashPassword("same input");
    expect(hash1).not.toBe(hash2);
    expect(await verifyPassword("same input", hash1)).toBe(true);
    expect(await verifyPassword("same input", hash2)).toBe(true);
  });
});
