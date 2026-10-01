CREATE TYPE "MissingPersonReportStatus" AS ENUM ('PENDING_REVIEW', 'MATCH_FOUND', 'ARCHIVED');

CREATE TABLE "missing_person_reports" (
  "id" UUID NOT NULL,
  "reporterName" TEXT NOT NULL,
  "reporterContact" TEXT NOT NULL,
  "missingPersonName" TEXT NOT NULL,
  "dateOfLoss" DATE,
  "lastKnownLocation" TEXT,
  "smugglerDetails" TEXT,
  "physicalMarks" TEXT,
  "status" "MissingPersonReportStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "missing_person_reports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "missing_person_reports_status_createdAt_idx"
  ON "missing_person_reports"("status", "createdAt");
