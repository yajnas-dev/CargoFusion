import { NextResponse } from "next/server";
import { prisma } from "@/domain/db";

export async function GET() {
  const workers = await prisma.worker.findMany({ orderBy: { id: "asc" } });
  return NextResponse.json({ workers });
}
