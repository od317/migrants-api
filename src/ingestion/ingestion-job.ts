export type IngestionJobData = {
  sourceFileId: string;
  organizationId: string;
  filePath: string;
};

export type IngestionProgress = {
  processedRows: number;
  inserted: number;
  skipped: number;
};
