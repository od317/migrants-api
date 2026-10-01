CREATE TYPE "EvidenceType" AS ENUM (
  'LEAK',
  'SURVIVOR_TESTIMONY',
  'INVESTIGATIVE_REPORT',
  'OFFICIAL_STATEMENT',
  'SATELLITE_IMAGERY'
);

CREATE TABLE "incident_claims" (
  "id" UUID NOT NULL,
  "incidentId" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "reportedDead" INTEGER,
  "reportedMissing" INTEGER,
  "reportedSurvivors" INTEGER,
  "reportedDate" DATE,
  "summary" TEXT NOT NULL,
  "sourceUrl" TEXT,
  "sourceQuality" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "incident_claims_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "incident_evidence" (
  "id" UUID NOT NULL,
  "incidentId" UUID NOT NULL,
  "type" "EvidenceType" NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "fileUrl" TEXT,
  "submittedBy" TEXT,
  "isVerified" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "incident_evidence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "incident_claims_incidentId_idx" ON "incident_claims"("incidentId");
CREATE INDEX "incident_claims_organizationId_idx" ON "incident_claims"("organizationId");
CREATE INDEX "incident_evidence_incidentId_isVerified_idx" ON "incident_evidence"("incidentId", "isVerified");

ALTER TABLE "incident_claims"
  ADD CONSTRAINT "incident_claims_incidentId_fkey"
  FOREIGN KEY ("incidentId") REFERENCES "raw_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "incident_claims"
  ADD CONSTRAINT "incident_claims_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "incident_evidence"
  ADD CONSTRAINT "incident_evidence_incidentId_fkey"
  FOREIGN KEY ("incidentId") REFERENCES "raw_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
