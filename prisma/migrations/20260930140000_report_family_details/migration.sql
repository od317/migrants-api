ALTER TABLE "missing_person_reports" ADD COLUMN IF NOT EXISTS "relationship" TEXT;
ALTER TABLE "missing_person_reports" ADD COLUMN IF NOT EXISTS "approximateAge" INTEGER;
