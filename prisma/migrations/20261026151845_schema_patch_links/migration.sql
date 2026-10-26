-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Issue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "departmentId" TEXT NOT NULL,
    "venueId" TEXT,
    "reportedBy" TEXT,
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Issue_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Issue_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Issue_reportedBy_fkey" FOREIGN KEY ("reportedBy") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Issue" ("createdAt", "departmentId", "id", "status", "text", "updatedAt", "venueId") SELECT "createdAt", "departmentId", "id", "status", "text", "updatedAt", "venueId" FROM "Issue";
DROP TABLE "Issue";
ALTER TABLE "new_Issue" RENAME TO "Issue";
CREATE INDEX "Issue_departmentId_idx" ON "Issue"("departmentId");
CREATE INDEX "Issue_venueId_idx" ON "Issue"("venueId");
CREATE INDEX "Issue_reportedBy_idx" ON "Issue"("reportedBy");
CREATE INDEX "Issue_status_idx" ON "Issue"("status");
CREATE TABLE "new_RescheduleRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entryId" TEXT NOT NULL,
    "requestedBy" TEXT,
    "proposedDay" TEXT NOT NULL,
    "proposedStart" TEXT NOT NULL,
    "proposedEnd" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "decisionNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RescheduleRequest_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "TimetableEntry" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RescheduleRequest_requestedBy_fkey" FOREIGN KEY ("requestedBy") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_RescheduleRequest" ("createdAt", "entryId", "id", "proposedDay", "proposedEnd", "proposedStart", "reason", "status", "updatedAt") SELECT "createdAt", "entryId", "id", "proposedDay", "proposedEnd", "proposedStart", "reason", "status", "updatedAt" FROM "RescheduleRequest";
DROP TABLE "RescheduleRequest";
ALTER TABLE "new_RescheduleRequest" RENAME TO "RescheduleRequest";
CREATE INDEX "RescheduleRequest_entryId_idx" ON "RescheduleRequest"("entryId");
CREATE INDEX "RescheduleRequest_requestedBy_idx" ON "RescheduleRequest"("requestedBy");
CREATE INDEX "RescheduleRequest_status_idx" ON "RescheduleRequest"("status");
CREATE TABLE "new_Submission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "departmentId" TEXT NOT NULL,
    "semester" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "reviewerId" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Submission_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Submission_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Submission" ("createdAt", "departmentId", "id", "note", "reviewerId", "status", "updatedAt") SELECT "createdAt", "departmentId", "id", "note", "reviewerId", "status", "updatedAt" FROM "Submission";
DROP TABLE "Submission";
ALTER TABLE "new_Submission" RENAME TO "Submission";
CREATE INDEX "Submission_departmentId_idx" ON "Submission"("departmentId");
CREATE INDEX "Submission_semester_idx" ON "Submission"("semester");
CREATE INDEX "Submission_reviewerId_idx" ON "Submission"("reviewerId");
CREATE INDEX "Submission_status_idx" ON "Submission"("status");
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "departmentId" TEXT,
    "studentGroupId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "User_studentGroupId_fkey" FOREIGN KEY ("studentGroupId") REFERENCES "StudentGroup" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_User" ("createdAt", "departmentId", "email", "id", "name", "passwordHash", "role", "updatedAt") SELECT "createdAt", "departmentId", "email", "id", "name", "passwordHash", "role", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_departmentId_idx" ON "User"("departmentId");
CREATE INDEX "User_studentGroupId_idx" ON "User"("studentGroupId");
CREATE INDEX "User_role_idx" ON "User"("role");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
