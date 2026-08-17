import { NextRequest, NextResponse } from "next/server";
import { WhatIfService } from "@/whatif/WhatIfService";
import { MockTOSAdapter } from "@/adapters/tos/MockTOSAdapter";
import { requireSessionUser } from "@/auth/requireSessionUser";
import { errorResponse } from "@/app/api/errorResponse";

export async function GET(req: NextRequest) {
  try {
    await requireSessionUser(req);
    const laneId = req.nextUrl.searchParams.get("laneId");
    if (!laneId) return NextResponse.json({ error: "laneId is required." }, { status: 400 });

    const preview = await new WhatIfService(new MockTOSAdapter()).previewLaneBlock(laneId);
    return NextResponse.json({ preview });
  } catch (err) {
    return errorResponse(err);
  }
}
