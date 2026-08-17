import { NextRequest, NextResponse } from "next/server";
import { AnalyticsService } from "@/analytics/AnalyticsService";
import { requireSessionUser } from "@/auth/requireSessionUser";
import { errorResponse } from "@/app/api/errorResponse";

export async function GET(req: NextRequest) {
  try {
    await requireSessionUser(req);
    const windowParam = Number(req.nextUrl.searchParams.get("windowHours"));
    const windowHours = Number.isFinite(windowParam) && windowParam > 0 ? Math.min(windowParam, 24 * 30) : 24;

    const summary = await new AnalyticsService().summarize(windowHours);
    return NextResponse.json({ summary });
  } catch (err) {
    return errorResponse(err);
  }
}
