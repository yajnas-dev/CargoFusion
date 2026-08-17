import { NextRequest, NextResponse } from "next/server";
import { RetrievalRequestService } from "@/pipeline/RetrievalRequestService";
import { requireSessionUser } from "@/auth/requireSessionUser";
import { errorResponse } from "@/app/api/errorResponse";

const MAX_BATCH_SIZE = 20;

export async function POST(req: NextRequest) {
  try {
    const session = await requireSessionUser(req);

    const body = await req.json().catch(() => null);
    const requests = Array.isArray(body?.requests)
      ? body.requests.filter((r: unknown): r is string => typeof r === "string" && r.trim().length > 0).map((r: string) => r.trim())
      : [];
    if (requests.length === 0) {
      return NextResponse.json({ error: "'requests' must be a non-empty array of strings." }, { status: 400 });
    }
    if (requests.length > MAX_BATCH_SIZE) {
      return NextResponse.json({ error: `Batch limited to ${MAX_BATCH_SIZE} requests at a time.` }, { status: 400 });
    }

    const items = await new RetrievalRequestService().submitBatch(requests, session.email);
    return NextResponse.json({ items });
  } catch (err) {
    return errorResponse(err);
  }
}
