-- Success is COMPLETED. Existing PROCESSED rows move with the enum value.
ALTER TYPE "IngestionStatus" RENAME VALUE 'PROCESSED' TO 'COMPLETED';
