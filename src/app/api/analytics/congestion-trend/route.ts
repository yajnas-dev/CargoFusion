import { NextRequest, NextResponse } from "next/server";
import { CongestionTrendService } from "@/analytics/CongestionTrendService";
import { requireSessionUser } from "@/auth/requireSessionUser";
import { errorResponse } from "@/app/api/errorResponse";

export async function GET(req: NextRequest) {
  try {
    await requireSessionUser(req);
    const laneId = req.nextUrl.searchParams.get("laneId");
    const service = new CongestionTrendService();

    if (laneId) {
      const trend = await service.getTrend(laneId);
      return NextResponse.json({ trends: [trend] });
    }

    const trends = await service.getTopTrends();
    return NextResponse.json({ trends });
  } catch (err) {
    return errorResponse(err);
  }
}
