-- CreateTable
CREATE TABLE "ClassOccurrenceActivity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "versionId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "originalDate" TEXT NOT NULL,
    "actualDate" TEXT NOT NULL,
    "actualStart" TEXT NOT NULL,
    "actualEnd" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "teachingId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "startedBy" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "endedBy" TEXT,
    "endedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ClassOccurrenceActivity_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "TimetableVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ClassOccurrenceActivity_entryId_versionId_fkey" FOREIGN KEY ("entryId", "versionId") REFERENCES "TimetableEntry" ("id", "versionId") ON DELETE RESTRICT ON UPDATE NO ACTION,
    CONSTRAINT "ClassOccurrenceActivity_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ClassOccurrenceActivity_teachingId_fkey" FOREIGN KEY ("teachingId") REFERENCES "Teaching" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ClassOccurrenceActivity_startedBy_fkey" FOREIGN KEY ("startedBy") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ClassOccurrenceActivity_endedBy_fkey" FOREIGN KEY ("endedBy") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AttendanceAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "windowStart" DATETIME NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "AttendanceAttempt_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AttendanceSession" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AttendanceAttempt_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AttendanceSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entryId" TEXT NOT NULL,
    "openedBy" TEXT NOT NULL,
    "opensAt" DATETIME NOT NULL,
    "closesAt" DATETIME NOT NULL,
    "scanFrom" DATETIME NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'STATIC',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "versionId" TEXT,
    "originalDate" TEXT,
    "actualDate" TEXT,
    "actualStart" TEXT,
    "actualEnd" TEXT,
    "timeZone" TEXT NOT NULL DEFAULT 'Africa/Nairobi',
    "tokenGeneration" INTEGER NOT NULL DEFAULT 0,
    "policyVersion" TEXT NOT NULL DEFAULT 'M7-v1',
    "closedAt" DATETIME,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AttendanceSession_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "TimetableEntry" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AttendanceSession_entryId_versionId_fkey" FOREIGN KEY ("entryId", "versionId") REFERENCES "TimetableEntry" ("id", "versionId") ON DELETE RESTRICT ON UPDATE NO ACTION,
    CONSTRAINT "AttendanceSession_openedBy_fkey" FOREIGN KEY ("openedBy") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AttendanceSession_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "TimetableVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_AttendanceSession" ("closesAt", "createdAt", "entryId", "id", "mode", "openedBy", "opensAt", "scanFrom", "status", "updatedAt") SELECT "closesAt", "createdAt", "entryId", "id", "mode", "openedBy", "opensAt", "scanFrom", "status", "updatedAt" FROM "AttendanceSession";
DROP TABLE "AttendanceSession";
ALTER TABLE "new_AttendanceSession" RENAME TO "AttendanceSession";
CREATE INDEX "AttendanceSession_versionId_actualDate_idx" ON "AttendanceSession"("versionId", "actualDate");
CREATE INDEX "AttendanceSession_status_closesAt_idx" ON "AttendanceSession"("status", "closesAt");
CREATE INDEX "AttendanceSession_entryId_idx" ON "AttendanceSession"("entryId");
CREATE INDEX "AttendanceSession_openedBy_idx" ON "AttendanceSession"("openedBy");
CREATE INDEX "AttendanceSession_status_idx" ON "AttendanceSession"("status");
CREATE UNIQUE INDEX "AttendanceSession_entryId_originalDate_key" ON "AttendanceSession"("entryId", "originalDate");
CREATE TABLE "new_AttendanceRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deviceId" TEXT,
    CONSTRAINT "AttendanceRecord_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AttendanceSession" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AttendanceRecord_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_AttendanceRecord" ("deviceId", "id", "recordedAt", "sessionId", "studentId") SELECT "deviceId", "id", "recordedAt", "sessionId", "studentId" FROM "AttendanceRecord";
DROP TABLE "AttendanceRecord";
ALTER TABLE "new_AttendanceRecord" RENAME TO "AttendanceRecord";
CREATE INDEX "AttendanceRecord_studentId_recordedAt_idx" ON "AttendanceRecord"("studentId", "recordedAt");
CREATE INDEX "AttendanceRecord_sessionId_recordedAt_idx" ON "AttendanceRecord"("sessionId", "recordedAt");
CREATE INDEX "AttendanceRecord_sessionId_idx" ON "AttendanceRecord"("sessionId");
CREATE INDEX "AttendanceRecord_studentId_idx" ON "AttendanceRecord"("studentId");
CREATE UNIQUE INDEX "AttendanceRecord_sessionId_studentId_key" ON "AttendanceRecord"("sessionId", "studentId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ClassOccurrenceActivity_versionId_actualDate_venueId_idx" ON "ClassOccurrenceActivity"("versionId", "actualDate", "venueId");

-- CreateIndex
CREATE INDEX "ClassOccurrenceActivity_startedBy_startedAt_idx" ON "ClassOccurrenceActivity"("startedBy", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClassOccurrenceActivity_entryId_originalDate_key" ON "ClassOccurrenceActivity"("entryId", "originalDate");

-- CreateIndex
CREATE INDEX "AttendanceAttempt_studentId_windowStart_idx" ON "AttendanceAttempt"("studentId", "windowStart");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceAttempt_sessionId_studentId_key" ON "AttendanceAttempt"("sessionId", "studentId");

