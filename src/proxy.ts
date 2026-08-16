import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/auth/session";

// Next.js 16 renamed middleware.ts -> proxy.ts (same mechanism, Proxy now
// defaults to the Node.js runtime instead of Edge — see
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md).
// This still uses the jose-based, Prisma-free verifySession rather than
// hitting the DB on every request: cheap, and avoids a runtime dependency
// this file doesn't otherwise need.
const PUBLIC_PATHS = ["/login", "/api/auth/login"];

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/simulation/:path*",
    "/worker/:path*",
    "/agent/:path*",
    "/tasks/:path*",
    "/equipment/:path*",
    "/workers/:path*",
    "/audit/:path*",
    "/api/:path*",
  ],
};
