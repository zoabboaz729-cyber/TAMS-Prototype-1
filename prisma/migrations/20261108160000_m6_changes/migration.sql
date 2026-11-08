BEGIN IMMEDIATE;
-- Additive upgrade. Duplicate legacy pending entries abort the unique index safely.
ALTER TABLE "TimetableVersion" ADD COLUMN "basePublishedVersionId" TEXT REFERENCES "TimetableVersion"("id") ON DELETE RESTRICT;
CREATE INDEX "TimetableVersion_basePublishedVersionId_idx" ON "TimetableVersion"("basePublishedVersionId");
ALTER TABLE "RescheduleRequest" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'WEEKLY';
ALTER TABLE "RescheduleRequest" ADD COLUMN "originalDate" TEXT;
ALTER TABLE "RescheduleRequest" ADD COLUMN "replacementDate" TEXT;
ALTER TABLE "RescheduleRequest" ADD COLUMN "pendingKey" TEXT;
ALTER TABLE "RescheduleRequest" ADD COLUMN "resultDraftVersionId" TEXT REFERENCES "TimetableVersion"("id") ON DELETE RESTRICT;
UPDATE "RescheduleRequest" SET "pendingKey" = "entryId" WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "RescheduleRequest_pendingKey_key" ON "RescheduleRequest"("pendingKey");
CREATE UNIQUE INDEX "TimetableEntry_id_versionId_key" ON "TimetableEntry"("id", "versionId");
CREATE TABLE "TimetableOccurrenceException" (
 "id" TEXT NOT NULL PRIMARY KEY, "versionId" TEXT NOT NULL, "entryId" TEXT NOT NULL,
 "originalDate" TEXT NOT NULL, "replacementDate" TEXT NOT NULL, "replacementStart" TEXT NOT NULL, "replacementEnd" TEXT NOT NULL,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("versionId") REFERENCES "TimetableVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 FOREIGN KEY ("entryId", "versionId") REFERENCES "TimetableEntry"("id", "versionId") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE UNIQUE INDEX "TimetableOccurrenceException_versionId_entryId_originalDate_key" ON "TimetableOccurrenceException"("versionId", "entryId", "originalDate");
CREATE INDEX "TimetableOccurrenceException_versionId_replacementDate_idx" ON "TimetableOccurrenceException"("versionId", "replacementDate");
CREATE INDEX "TimetableOccurrenceException_entryId_idx" ON "TimetableOccurrenceException"("entryId");

COMMIT;
