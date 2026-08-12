import { NextRequest, NextResponse } from "next/server";
import { WorkerTaskService } from "@/worker/WorkerTaskService";
import { errorResponse } from "@/app/api/errorResponse";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const actor = typeof body.actor === "string" && body.actor ? body.actor : "supervisor";

  try {
    const task = await new WorkerTaskService().completeTask(id, actor);
    return NextResponse.json({ task });
  } catch (err) {
    return errorResponse(err);
  }
}
