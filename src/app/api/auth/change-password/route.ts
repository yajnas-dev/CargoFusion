import { NextRequest, NextResponse } from "next/server";
import { AuthService } from "@/auth/AuthService";
import { requireSessionUser } from "@/auth/requireSessionUser";
import { errorResponse } from "@/app/api/errorResponse";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSessionUser(req);

    const body = await req.json().catch(() => ({}));
    const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";
    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: "'currentPassword' and 'newPassword' are required." }, { status: 400 });
    }

    await new AuthService().changePassword(session.sub, currentPassword, newPassword);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
