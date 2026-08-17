import { NextRequest, NextResponse } from "next/server";
import { AuthService } from "@/auth/AuthService";
import { signSession, sessionCookieOptions, SESSION_COOKIE } from "@/auth/session";
import { errorResponse } from "@/app/api/errorResponse";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!email || !password) {
    return NextResponse.json({ error: "Both 'email' and 'password' are required." }, { status: 400 });
  }

  try {
    const session = await new AuthService().authenticate(email, password);
    const token = await signSession(session);

    const res = NextResponse.json({
      user: { id: session.sub, email: session.email, name: session.name, role: session.role, workerId: session.workerId },
    });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
