import { NextRequest, NextResponse } from "next/server";
import { RetrievalRequestService } from "@/pipeline/RetrievalRequestService";
import { requireSessionUser } from "@/auth/requireSessionUser";
import { errorResponse } from "@/app/api/errorResponse";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSessionUser(req);

    const body = await req.json().catch(() => null);
    const rawRequest = typeof body?.request === "string" ? body.request.trim() : "";
    if (!rawRequest) {
      return NextResponse.json({ error: "'request' is required." }, { status: 400 });
    }
    const dueBy =
      typeof body?.dueBy === "string" && body.dueBy && !Number.isNaN(Date.parse(body.dueBy))
        ? new Date(body.dueBy)
        : undefined;

    const result = await new RetrievalRequestService().submit(rawRequest, session.email, dueBy);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
