import { NextResponse } from "next/server";
import { prisma } from "@/domain/db";

export async function GET() {
  const tasks = await prisma.task.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      container: true,
      assignedEquipment: true,
      assignedWorker: true,
      recommendations: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  return NextResponse.json({ tasks });
}
