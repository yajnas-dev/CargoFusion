-- CreateTable
CREATE TABLE "CongestionSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "laneId" TEXT NOT NULL,
    "congestionWeight" REAL NOT NULL,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "CongestionSnapshot_laneId_recordedAt_idx" ON "CongestionSnapshot"("laneId", "recordedAt");
