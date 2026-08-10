-- CreateTable
CREATE TABLE "Container" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "block" TEXT NOT NULL,
    "row" INTEGER NOT NULL,
    "bay" INTEGER NOT NULL,
    "tier" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_YARD',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "type" TEXT NOT NULL DEFAULT 'DRY',
    "weightKg" INTEGER NOT NULL,
    "destination" TEXT NOT NULL,
    "retrievalEligible" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Equipment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "capacityKg" INTEGER NOT NULL,
    "currentNodeId" TEXT NOT NULL,
    "lastSyncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Equipment_currentNodeId_fkey" FOREIGN KEY ("currentNodeId") REFERENCES "YardNode" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "YardBlock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "YardNode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "blockId" TEXT,
    "x" REAL NOT NULL,
    "y" REAL NOT NULL,
    CONSTRAINT "YardNode_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "YardBlock" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "YardLane" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromNodeId" TEXT NOT NULL,
    "toNodeId" TEXT NOT NULL,
    "distanceMeters" REAL NOT NULL,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "congestionWeight" REAL NOT NULL DEFAULT 1.0,
    CONSTRAINT "YardLane_fromNodeId_fkey" FOREIGN KEY ("fromNodeId") REFERENCES "YardNode" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "YardLane_toNodeId_fkey" FOREIGN KEY ("toNodeId") REFERENCES "YardNode" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Worker" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE'
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "containerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "requestedBy" TEXT NOT NULL,
    "naturalLanguageRequest" TEXT,
    "assignedEquipmentId" TEXT,
    "assignedWorkerId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Task_containerId_fkey" FOREIGN KEY ("containerId") REFERENCES "Container" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Task_assignedEquipmentId_fkey" FOREIGN KEY ("assignedEquipmentId") REFERENCES "Equipment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_assignedWorkerId_fkey" FOREIGN KEY ("assignedWorkerId") REFERENCES "Worker" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "routeJson" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "confidenceLevel" TEXT NOT NULL,
    "confidenceFactorsJson" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "twinValidated" BOOLEAN NOT NULL,
    "twinIssuesJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Recommendation_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT,
    "action" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "detailsJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SensorEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "nodeId" TEXT,
    "payloadJson" TEXT NOT NULL,
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "Container_block_row_bay_idx" ON "Container"("block", "row", "bay");

-- CreateIndex
CREATE INDEX "Container_status_idx" ON "Container"("status");

-- CreateIndex
CREATE INDEX "Equipment_status_type_idx" ON "Equipment"("status", "type");

-- CreateIndex
CREATE INDEX "YardLane_fromNodeId_idx" ON "YardLane"("fromNodeId");

-- CreateIndex
CREATE INDEX "YardLane_toNodeId_idx" ON "YardLane"("toNodeId");

-- CreateIndex
CREATE INDEX "Task_status_idx" ON "Task"("status");

-- CreateIndex
CREATE INDEX "Task_containerId_idx" ON "Task"("containerId");

-- CreateIndex
CREATE INDEX "Recommendation_taskId_idx" ON "Recommendation"("taskId");

-- CreateIndex
CREATE INDEX "AuditEvent_taskId_idx" ON "AuditEvent"("taskId");

-- CreateIndex
CREATE INDEX "AuditEvent_action_idx" ON "AuditEvent"("action");

-- CreateIndex
CREATE INDEX "SensorEvent_type_idx" ON "SensorEvent"("type");

-- CreateIndex
CREATE INDEX "SensorEvent_subjectId_idx" ON "SensorEvent"("subjectId");
