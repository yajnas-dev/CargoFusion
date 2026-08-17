-- AlterTable
ALTER TABLE "Equipment" ADD COLUMN "movementArrivesAt" DATETIME;
ALTER TABLE "Equipment" ADD COLUMN "movementStartedAt" DATETIME;
ALTER TABLE "Equipment" ADD COLUMN "movementTargetNodeId" TEXT;
