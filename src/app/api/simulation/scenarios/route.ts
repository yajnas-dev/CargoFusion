import { NextRequest, NextResponse } from "next/server";
import { SCENARIOS } from "@/simulation/scenarios";
import { requireSessionUser } from "@/auth/requireSessionUser";
import { errorResponse } from "@/app/api/errorResponse";

export async function GET(req: NextRequest) {
  try {
    await requireSessionUser(req);
    return NextResponse.json({ scenarios: SCENARIOS });
  } catch (err) {
    return errorResponse(err);
  }
}
