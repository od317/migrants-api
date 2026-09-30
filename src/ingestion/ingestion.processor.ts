import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { DATA_INGESTION_QUEUE } from './ingestion.constants';
import { IngestionJobData } from './ingestion-job';
import { IngestionService } from './ingestion.service';

@Processor(DATA_INGESTION_QUEUE)
export class IngestionProcessor extends WorkerHost {
  private readonly logger = new Logger(IngestionProcessor.name);

  constructor(private readonly ingestion: IngestionService) {
    super();
  }

  async process(job: Job<IngestionJobData>): Promise<void> {
    const { sourceFileId, organizationId, filePath } = job.data;
    this.logger.log(`Ingestion job ${job.id ?? 'unknown'} started for source file ${sourceFileId}`);
    try {
      await this.ingestion.processFile(sourceFileId, organizationId, {
        filePath,
        resume: true,
        onProgress: (progress) => job.updateProgress(progress),
      });
    } catch (error) {
      this.logger.error(
        `Ingestion job ${job.id ?? 'unknown'} failed for source file ${sourceFileId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }
}
