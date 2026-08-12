import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { UnauthorizedError, ForbiddenError } from "@/auth/errors";

/**
 * Shared error-to-JSON-response mapping for route handlers: an auth
 * failure becomes 401/403, a Prisma "record not found" (e.g. an id that
 * doesn't exist) becomes 404, and every other thrown error (guard
 * rejections from the service layer, validation failures) becomes 400.
 * Keeps the many thin route handlers under `app/api/` from each
 * re-implementing this mapping.
 */
export function errorResponse(err: unknown): NextResponse {
  const message = err instanceof Error ? err.message : "Unexpected error.";

  if (err instanceof UnauthorizedError) return NextResponse.json({ error: message }, { status: 401 });
  if (err instanceof ForbiddenError) return NextResponse.json({ error: message }, { status: 403 });

  const status =
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025" ? 404 : 400;
  return NextResponse.json({ error: message }, { status });
}
