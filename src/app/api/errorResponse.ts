import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";

/**
 * Shared error-to-JSON-response mapping for route handlers: a Prisma
 * "record not found" (e.g. an id that doesn't exist) becomes 404; every
 * other thrown error (guard rejections from the service layer, validation
 * failures) becomes 400. Keeps the many thin route handlers under
 * `app/api/` from each re-implementing this mapping.
 */
export function errorResponse(err: unknown): NextResponse {
  const status =
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025" ? 404 : 400;
  const message = err instanceof Error ? err.message : "Unexpected error.";
  return NextResponse.json({ error: message }, { status });
}
