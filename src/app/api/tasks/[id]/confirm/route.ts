import { NextRequest, NextResponse } from "next/server";
import { WorkerTaskService } from "@/worker/WorkerTaskService";
import { errorResponse } from "@/app/api/errorResponse";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const workerId = typeof body.workerId === "string" ? body.workerId : "";
  if (!workerId) return NextResponse.json({ error: "workerId is required" }, { status: 400 });

  try {
    const task = await new WorkerTaskService().confirmRetrieval(id, workerId);
    return NextResponse.json({ task });
  } catch (err) {
    return errorResponse(err);
  }
}
