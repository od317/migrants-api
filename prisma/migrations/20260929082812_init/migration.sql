-- CreateEnum
CREATE TYPE "VitalStatus" AS ENUM ('ALIVE', 'MISSING', 'DEAD', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SourceFileFormat" AS ENUM ('CSV', 'PDF', 'EXCEL', 'JSON', 'OTHER');

-- CreateEnum
CREATE TYPE "IngestionStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "ProfileStatus" AS ENUM ('PROVISIONAL', 'CONFIRMED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "MatchMethod" AS ENUM ('DETERMINISTIC', 'FUZZY', 'MANUAL');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "acronym" TEXT,
    "mandate" TEXT,
    "url" TEXT,
    "methodology" TEXT,
    "reliabilityScore" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_files" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "format" "SourceFileFormat" NOT NULL,
    "mimeType" TEXT,
    "checksumSha256" TEXT NOT NULL,
    "byteSize" INTEGER,
    "ingestionStatus" "IngestionStatus" NOT NULL DEFAULT 'PENDING',
    "recordCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "metadata" JSONB,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "source_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_records" (
    "id" UUID NOT NULL,
    "sourceFileId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "sourceLocator" TEXT,
    "payload" JSONB NOT NULL,
    "extractedName" TEXT,
    "extractedNameNormalized" TEXT,
    "vitalStatus" "VitalStatus" NOT NULL DEFAULT 'UNKNOWN',
    "location" TEXT,
    "eventDate" DATE,
    "reportedAt" TIMESTAMP(3),
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raw_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master_profiles" (
    "id" UUID NOT NULL,
    "canonicalName" TEXT,
    "knownNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "resolvedStatus" "VitalStatus" NOT NULL DEFAULT 'UNKNOWN',
    "resolvedLocation" TEXT,
    "resolvedEventDate" DATE,
    "profileStatus" "ProfileStatus" NOT NULL DEFAULT 'PROVISIONAL',
    "hasConflict" BOOLEAN NOT NULL DEFAULT false,
    "fieldProvenance" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "master_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_linkages" (
    "id" UUID NOT NULL,
    "masterProfileId" UUID NOT NULL,
    "rawRecordId" UUID NOT NULL,
    "confidenceScore" DOUBLE PRECISION NOT NULL,
    "conflictFlag" BOOLEAN NOT NULL DEFAULT false,
    "conflictReason" TEXT,
    "matchMethod" "MatchMethod" NOT NULL DEFAULT 'FUZZY',
    "matchedOn" JSONB,
    "linkedBy" TEXT,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profile_linkages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_acronym_key" ON "organizations"("acronym");

-- CreateIndex
CREATE INDEX "organizations_name_idx" ON "organizations"("name");

-- CreateIndex
CREATE INDEX "source_files_organizationId_uploadedAt_idx" ON "source_files"("organizationId", "uploadedAt");

-- CreateIndex
CREATE UNIQUE INDEX "source_files_organizationId_checksumSha256_key" ON "source_files"("organizationId", "checksumSha256");

-- CreateIndex
CREATE INDEX "raw_records_organizationId_idx" ON "raw_records"("organizationId");

-- CreateIndex
CREATE INDEX "raw_records_extractedNameNormalized_idx" ON "raw_records"("extractedNameNormalized");

-- CreateIndex
CREATE INDEX "raw_records_vitalStatus_eventDate_idx" ON "raw_records"("vitalStatus", "eventDate");

-- CreateIndex
CREATE UNIQUE INDEX "raw_records_sourceFileId_sourceLocator_key" ON "raw_records"("sourceFileId", "sourceLocator");

-- CreateIndex
CREATE INDEX "master_profiles_canonicalName_idx" ON "master_profiles"("canonicalName");

-- CreateIndex
CREATE INDEX "master_profiles_resolvedStatus_idx" ON "master_profiles"("resolvedStatus");

-- CreateIndex
CREATE INDEX "master_profiles_hasConflict_idx" ON "master_profiles"("hasConflict");

-- CreateIndex
CREATE UNIQUE INDEX "profile_linkages_rawRecordId_key" ON "profile_linkages"("rawRecordId");

-- CreateIndex
CREATE INDEX "profile_linkages_masterProfileId_conflictFlag_idx" ON "profile_linkages"("masterProfileId", "conflictFlag");

-- AddForeignKey
ALTER TABLE "source_files" ADD CONSTRAINT "source_files_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_records" ADD CONSTRAINT "raw_records_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_records" ADD CONSTRAINT "raw_records_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "source_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_linkages" ADD CONSTRAINT "profile_linkages_masterProfileId_fkey" FOREIGN KEY ("masterProfileId") REFERENCES "master_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_linkages" ADD CONSTRAINT "profile_linkages_rawRecordId_fkey" FOREIGN KEY ("rawRecordId") REFERENCES "raw_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
