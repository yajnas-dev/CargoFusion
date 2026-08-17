-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "workerId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentAlert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "severity" TEXT NOT NULL,
    "taskId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "subjectJson" TEXT NOT NULL,
    "suggestedActionType" TEXT NOT NULL,
    "suggestedActionPayloadJson" TEXT NOT NULL,
    "rankScore" REAL,
    "explanation" TEXT NOT NULL,
    "detectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    "resolvedBy" TEXT,
    "resolutionNoteJson" TEXT,
    CONSTRAINT "AgentAlert_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TosWriteBackLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recommendationId" TEXT NOT NULL,
    "taskId" TEXT,
    "payloadJson" TEXT NOT NULL,
    "writtenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT,
    "agentAlertId" TEXT,
    "action" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "detailsJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AuditEvent_agentAlertId_fkey" FOREIGN KEY ("agentAlertId") REFERENCES "AgentAlert" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_AuditEvent" ("action", "actor", "createdAt", "detailsJson", "id", "taskId") SELECT "action", "actor", "createdAt", "detailsJson", "id", "taskId" FROM "AuditEvent";
DROP TABLE "AuditEvent";
ALTER TABLE "new_AuditEvent" RENAME TO "AuditEvent";
CREATE INDEX "AuditEvent_taskId_idx" ON "AuditEvent"("taskId");
CREATE INDEX "AuditEvent_action_idx" ON "AuditEvent"("action");
CREATE INDEX "AuditEvent_agentAlertId_idx" ON "AuditEvent"("agentAlertId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_workerId_key" ON "User"("workerId");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "AgentAlert_status_idx" ON "AgentAlert"("status");

-- CreateIndex
CREATE INDEX "AgentAlert_type_idx" ON "AgentAlert"("type");

-- CreateIndex
CREATE INDEX "AgentAlert_taskId_idx" ON "AgentAlert"("taskId");

-- CreateIndex
CREATE INDEX "AgentAlert_dedupeKey_status_idx" ON "AgentAlert"("dedupeKey", "status");

-- CreateIndex
CREATE INDEX "TosWriteBackLog_recommendationId_idx" ON "TosWriteBackLog"("recommendationId");
