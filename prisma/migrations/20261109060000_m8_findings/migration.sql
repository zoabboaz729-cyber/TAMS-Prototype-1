ALTER TABLE "AssumptionFeedback" ADD COLUMN "meetingLabel" TEXT;
ALTER TABLE "AssumptionFeedback" ADD COLUMN "sourceRole" TEXT;
ALTER TABLE "AssumptionFeedback" ADD COLUMN "recordedByRole" TEXT;
ALTER TABLE "AssumptionFeedback" ADD COLUMN "submissionKey" TEXT;
CREATE UNIQUE INDEX "AssumptionFeedback_submissionKey_key" ON "AssumptionFeedback"("submissionKey");
