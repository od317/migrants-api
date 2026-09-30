-- AlterEnum
CREATE TYPE "LinkReviewStatus" AS ENUM ('AUTO_LINKED', 'PENDING_HUMAN_REVIEW');

-- AlterTable
ALTER TABLE "raw_records" ADD COLUMN "birthYear" INTEGER;
ALTER TABLE "master_profiles" ADD COLUMN "resolvedBirthYear" INTEGER;
ALTER TABLE "master_profiles" ADD COLUMN "nameBlockKey" TEXT;
ALTER TABLE "profile_linkages" ADD COLUMN "reviewStatus" "LinkReviewStatus" NOT NULL DEFAULT 'AUTO_LINKED';

-- CreateIndex
CREATE INDEX "raw_records_birthYear_idx" ON "raw_records"("birthYear");
CREATE INDEX "master_profiles_nameBlockKey_idx" ON "master_profiles"("nameBlockKey");
CREATE INDEX "master_profiles_resolvedBirthYear_idx" ON "master_profiles"("resolvedBirthYear");
CREATE INDEX "profile_linkages_reviewStatus_idx" ON "profile_linkages"("reviewStatus");
