import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/auth/requireSessionUser";

export async function GET(req: NextRequest) {
  const session = await getSessionUser(req);
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  return NextResponse.json({
    user: { id: session.sub, email: session.email, name: session.name, role: session.role, workerId: session.workerId },
  });
}
