import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MatchingModule } from '../matching/matching.module';
import { HdxConflictEventsAdapter } from './adapters/hdx-conflict-events.adapter';
import { IngestionAdapterRegistry } from './adapters/ingestion-adapter.registry';
import { IomCsvAdapter } from './adapters/iom-csv.adapter';
import { IomMissingMigrantsAdapter } from './adapters/iom-missing-migrants.adapter';
import { VdcJsonAdapter } from './adapters/vdc-json.adapter';
import { DATA_INGESTION_QUEUE } from './ingestion.constants';
import { DatasetUploadService } from './dataset-upload.service';
import { IngestionController } from './ingestion.controller';
import { IngestionProcessor } from './ingestion.processor';
import { IngestionService } from './ingestion.service';

@Module({
  imports: [
    MatchingModule,
    BullModule.registerQueue({
      name: DATA_INGESTION_QUEUE,
      defaultJobOptions: {
        removeOnComplete: { age: 60 * 60 * 24, count: 1000 },
        removeOnFail: { age: 60 * 60 * 24 * 7 },
      },
    }),
  ],
  controllers: [IngestionController],
  providers: [
    IngestionService,
    DatasetUploadService,
    IngestionProcessor,
    IngestionAdapterRegistry,
    IomCsvAdapter,
    IomMissingMigrantsAdapter,
    HdxConflictEventsAdapter,
    VdcJsonAdapter,
  ],
  exports: [IngestionService],
})
export class IngestionModule {}
