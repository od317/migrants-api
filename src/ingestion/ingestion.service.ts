import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { IngestionStatus, Prisma, SourceFileFormat } from '@prisma/client';
import { Queue } from 'bullmq';
import { rethrowPrisma } from '../common/prisma-errors';
import { foldForCompare } from '../common/fold-text';
import { MatchingService } from '../matching/matching.service';
import { PrismaService } from '../prisma/prisma.service';
import { BaseIngestionAdapter } from './adapters/base-ingestion.adapter';
import { IngestionAdapterRegistry } from './adapters/ingestion-adapter.registry';
import { IngestionJobData, IngestionProgress } from './ingestion-job';
import { DATA_INGESTION_QUEUE, INGESTION_BATCH_SIZE } from './ingestion.constants';
import { NormalizedObservation } from './normalized-observation';

export const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

export type UploadedSpreadsheet = {
  originalname: string;
  mimetype?: string;
  size: number;
  buffer: Buffer;
};

export type UploadReceipt = {
  jobId: string;
  sourceFileId: string;
  organizationId: string;
  originalFilename: string;
  format: SourceFileFormat;
  checksumSha256: string;
  byteSize: number;
  ingestionStatus: IngestionStatus;
};

export type IngestionSummary = {
  sourceFileId: string;
  organizationId: string;
  adapter: string;
  inserted: number;
  skipped: number;
  recordCount: number;
  processedRows: number;
};

export type IngestionJobStatus = {
  jobId: string;
  queue: typeof DATA_INGESTION_QUEUE;
  status: string;
  progress: IngestionProgress | number | null;
  sourceFileId: string | null;
  organizationId: string | null;
  ingestionStatus: IngestionStatus | null;
  recordCount: number | null;
  processedRows: number | null;
  error: string | null;
};

type ProcessOptions = {
  filePath?: string;
  resume?: boolean;
  onProgress?: (progress: IngestionProgress) => Promise<void>;
};

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapters: IngestionAdapterRegistry,
    private readonly matching: MatchingService,
    @InjectQueue(DATA_INGESTION_QUEUE) private readonly ingestionQueue: Queue<IngestionJobData>,
  ) {}

  async receiveUpload(
    organizationId: string,
    file: UploadedSpreadsheet | undefined,
  ): Promise<UploadReceipt> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('A CSV or XLSX file is required');
    }
    if (file.size > UPLOAD_MAX_BYTES || file.buffer.length > UPLOAD_MAX_BYTES) {
      throw new BadRequestException('Upload exceeds the 25 MB limit');
    }

    const format = spreadsheetFormat(file.originalname);
    if (!format) {
      throw new BadRequestException('Upload must be a .csv or .xlsx file');
    }

    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    const adapter = this.adapters.require(organization.acronym);
    if (!adapterAcceptsFormat(adapter, format)) {
      throw new BadRequestException(
        `${adapter.acronym} uploads must be ${acceptedFormats(adapter)}`,
      );
    }

    const checksumSha256 = createHash('sha256').update(file.buffer).digest('hex');
    const extension = format === SourceFileFormat.CSV ? '.csv' : '.xlsx';
    const storageKey = join('uploads', organizationId, `${checksumSha256}${extension}`);
    const absolutePath = this.resolveStoragePath(storageKey);
    await mkdir(resolve(absolutePath, '..'), { recursive: true });
    await writeFile(absolutePath, file.buffer);

    const originalFilename = displayFilename(file.originalname, extension);
    const sourceFile = await this.prisma.sourceFile
      .create({
        data: {
          organizationId,
          originalFilename,
          storageKey,
          format,
          mimeType: file.mimetype || null,
          checksumSha256,
          byteSize: file.size,
          ingestionStatus: IngestionStatus.PENDING,
        },
      })
      .catch((error: unknown) =>
        rethrowPrisma(error, {
          notFound: 'Source file not found',
          conflict: 'This file was already uploaded for the organization',
        }),
      );

    const jobId = await this.enqueueJob(sourceFile.id, organizationId, absolutePath);

    return {
      jobId,
      sourceFileId: sourceFile.id,
      organizationId,
      originalFilename,
      format,
      checksumSha256,
      byteSize: file.size,
      ingestionStatus: IngestionStatus.PENDING,
    };
  }

  async getJobStatus(jobId: string): Promise<IngestionJobStatus> {
    if (!/^[\w:-]{1,64}$/.test(jobId)) {
      throw new BadRequestException('Invalid job id');
    }

    let job;
    try {
      job = await this.ingestionQueue.getJob(jobId);
    } catch (error) {
      this.logger.error(
        `Failed to read ingestion job ${jobId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new ServiceUnavailableException('Ingestion queue is unavailable');
    }
    if (!job) {
      throw new NotFoundException('Ingestion job not found');
    }

    const state = await job.getState();
    const progress = normalizeProgress(job.progress);
    const sourceFile = job.data?.sourceFileId
      ? await this.prisma.sourceFile.findUnique({ where: { id: job.data.sourceFileId } })
      : null;

    return {
      jobId: job.id ?? jobId,
      queue: DATA_INGESTION_QUEUE,
      status: state,
      progress,
      sourceFileId: job.data?.sourceFileId ?? null,
      organizationId: job.data?.organizationId ?? null,
      ingestionStatus: sourceFile?.ingestionStatus ?? null,
      recordCount: sourceFile?.recordCount ?? null,
      processedRows: progressRows(progress, sourceFile?.metadata),
      error: job.failedReason || sourceFile?.errorMessage || null,
      };
  }

  async processFile(
    fileId: string,
    organizationId: string,
    options: ProcessOptions = {},
  ): Promise<IngestionSummary> {
    const sourceFile = await this.prisma.sourceFile.findUnique({
      where: { id: fileId },
      include: { organization: true },
    });
    if (!sourceFile) {
      throw new NotFoundException('Source file not found');
    }
    if (sourceFile.organizationId !== organizationId) {
      throw new BadRequestException(
        'Source file does not belong to this organization',
      );
    }
    if (sourceFile.ingestionStatus === IngestionStatus.COMPLETED) {
      throw new ConflictException('Source file has already been ingested');
    }
    if (sourceFile.ingestionStatus === IngestionStatus.PROCESSING && !options.resume) {
      throw new ConflictException('Source file is already being processed');
    }

    const filePath = this.resolveStoragePath(sourceFile.storageKey);
    if (options.filePath && resolve(options.filePath) !== filePath) {
      throw new BadRequestException('Job file path does not match the stored source file');
    }
    try {
      await access(filePath, constants.R_OK);
    } catch {
      throw new NotFoundException(
        'Source file bytes were not found at the storage key',
      );
    }

    const adapter = await this.adapters.requireForFile(
      sourceFile.organization.acronym,
      sourceFile.format,
      filePath,
    );
    if (!adapterAcceptsFormat(adapter, sourceFile.format)) {
      throw new BadRequestException(
        `${adapter.acronym} files must be registered as ${acceptedFormats(adapter)}`,
      );
    }

    await this.prisma.sourceFile.update({
      where: { id: sourceFile.id },
      data: { ingestionStatus: IngestionStatus.PROCESSING, errorMessage: null },
    });

    let inserted = 0;
    let skipped = 0;
    let rowNumber = 0;
    let batch: Prisma.RawRecordCreateManyInput[] = [];

    const report = async (): Promise<void> => {
      if (!options.onProgress) {
        return;
      }
      await options.onProgress({ processedRows: rowNumber, inserted, skipped });
    };

    try {
      for await (const record of adapter.readRecords(filePath)) {
        rowNumber += 1;
        const observation = adapter.normalizeRecord(record);
        if (!observation) {
          skipped += 1;
          continue;
        }
        batch.push(
          this.toRow(sourceFile.id, sourceFile.organizationId, rowNumber, observation),
        );
        if (batch.length >= INGESTION_BATCH_SIZE) {
          inserted += await this.flushAndMatch(sourceFile.id, batch);
          batch = [];
          await this.rememberProgress(sourceFile.id, sourceFile.metadata, {
            processedRows: rowNumber,
            inserted,
            skipped,
          });
          await report();
        }
      }

      if (batch.length > 0) {
        inserted += await this.flushAndMatch(sourceFile.id, batch);
      }

      const recordCount = await this.prisma.rawRecord.count({
        where: { sourceFileId: sourceFile.id },
      });
      const progress = { processedRows: rowNumber, inserted, skipped };
      await this.prisma.sourceFile.update({
        where: { id: sourceFile.id },
        data: {
          ingestionStatus: IngestionStatus.COMPLETED,
          recordCount,
          processedAt: new Date(),
          errorMessage: null,
          metadata: withProgress(sourceFile.metadata, progress),
        },
      });
      await report();

      this.logger.log(
        `Ingested source file ${sourceFile.id}: inserted ${inserted}, skipped ${skipped}, processed ${rowNumber}`,
      );

      return {
        sourceFileId: sourceFile.id,
        organizationId: sourceFile.organizationId,
        adapter: adapter.acronym,
        inserted,
        skipped,
        recordCount,
        processedRows: rowNumber,
      };
    } catch (error) {
      const recordCount = await this.prisma.rawRecord.count({
        where: { sourceFileId: sourceFile.id },
      });
      const message = error instanceof Error ? error.message : 'Ingestion failed';
      await this.prisma.sourceFile.update({
        where: { id: sourceFile.id },
        data: {
          ingestionStatus: IngestionStatus.FAILED,
          recordCount,
          processedAt: new Date(),
          errorMessage: message,
          metadata: withProgress(sourceFile.metadata, {
            processedRows: rowNumber,
            inserted,
            skipped,
          }),
        },
      });
      this.logger.error(
        `Ingestion failed for source file ${sourceFile.id}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  private async enqueueJob(
    sourceFileId: string,
    organizationId: string,
    filePath: string,
  ): Promise<string> {
    try {
      const job = await this.ingestionQueue.add('ingest-source-file', {
        sourceFileId,
        organizationId,
        filePath,
      });
      if (!job.id) {
        throw new Error('Ingestion queue did not assign a job id');
      }
      return job.id;
    } catch (error) {
      this.logger.error(
        `Failed to enqueue ingestion for source file ${sourceFileId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new ServiceUnavailableException('Ingestion queue is unavailable');
    }
  }

  private async flushAndMatch(
    sourceFileId: string,
    batch: Prisma.RawRecordCreateManyInput[],
  ): Promise<number> {
    const locators = batch
      .map((row) => row.sourceLocator)
      .filter((locator): locator is string => typeof locator === 'string');
    const inserted = await this.prisma.$transaction(async (tx) => {
      const result = await tx.rawRecord.createMany({
        data: batch,
        skipDuplicates: true,
      });
      return result.count;
    });

    const pending = await this.prisma.rawRecord.findMany({
      where: {
        sourceFileId,
        sourceLocator: { in: locators },
        linkage: { is: null },
        extractedName: { not: null },
      },
      select: { id: true },
      orderBy: { sourceLocator: 'asc' },
    });
    for (const record of pending) {
      try {
        await this.matching.linkRecordToProfile(record.id);
      } catch (error) {
        if (error instanceof ConflictException) {
          continue;
        }
        throw error;
      }
    }
    return inserted;
  }

  private async rememberProgress(
    sourceFileId: string,
    metadata: Prisma.JsonValue | null,
    progress: IngestionProgress,
  ): Promise<void> {
    const recordCount = await this.prisma.rawRecord.count({ where: { sourceFileId } });
    await this.prisma.sourceFile.update({
      where: { id: sourceFileId },
      data: {
        recordCount,
        metadata: withProgress(metadata, progress),
      },
    });
  }

  private toRow(
    sourceFileId: string,
    organizationId: string,
    rowNumber: number,
    observation: NormalizedObservation,
  ): Prisma.RawRecordCreateManyInput {
    return {
      sourceFileId,
      organizationId: observation.organizationId ?? organizationId,
      sourceLocator: observation.sourceLocator ?? `row:${rowNumber}`,
      payload: JSON.parse(JSON.stringify(observation.payload)) as Prisma.InputJsonValue,
      extractedName: observation.extractedName,
      extractedNameNormalized: foldForCompare(observation.extractedName),
      vitalStatus: observation.vitalStatus,
      location: observation.location,
      latitude: observation.latitude,
      longitude: observation.longitude,
      eventDate: observation.eventDate,
      reportedAt: observation.reportedAt,
      birthYear: observation.birthYear,
    };
  }

  private resolveStoragePath(storageKey: string): string {
    if (isAbsolute(storageKey)) {
      return storageKey;
    }

    const root = resolve(process.env.STORAGE_ROOT ?? join(process.cwd(), 'storage'));
    const resolved = resolve(root, storageKey);
    const fromRoot = relative(root, resolved);
    if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
      throw new BadRequestException('Storage key escapes the storage root');
    }
    return resolved;
  }
}

function spreadsheetFormat(filename: string): SourceFileFormat | null {
  const lower = basename(filename).toLowerCase();
  if (lower.endsWith('.csv')) {
    return SourceFileFormat.CSV;
  }
  if (lower.endsWith('.xlsx')) {
    return SourceFileFormat.EXCEL;
  }
  return null;
}

function adapterAcceptsFormat(
  adapter: BaseIngestionAdapter,
  format: SourceFileFormat,
): boolean {
  if (adapter.format === format) {
    return true;
  }
  return adapter.format === SourceFileFormat.CSV && format === SourceFileFormat.EXCEL;
}

function acceptedFormats(adapter: BaseIngestionAdapter): string {
  return adapter.format === SourceFileFormat.CSV ? 'CSV or XLSX' : adapter.format;
}

function displayFilename(filename: string, extension: string): string {
  const cleaned = basename(filename)
    .replace(/[\u0000-\u001f]/g, '')
    .trim()
    .slice(0, 240);
  return cleaned || `upload${extension}`;
}

function withProgress(
  metadata: Prisma.JsonValue | null,
  progress: IngestionProgress,
): Prisma.InputJsonValue {
  const base =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
  return { ...base, ...progress };
}

function normalizeProgress(progress: unknown): IngestionProgress | number | null {
  if (typeof progress === 'number') {
    return progress;
  }
  if (
    progress &&
    typeof progress === 'object' &&
    'processedRows' in progress &&
    'inserted' in progress &&
    'skipped' in progress
  ) {
    const value = progress as IngestionProgress;
    return {
      processedRows: Number(value.processedRows) || 0,
      inserted: Number(value.inserted) || 0,
      skipped: Number(value.skipped) || 0,
    };
  }
  return null;
}

function progressRows(
  progress: IngestionProgress | number | null,
  metadata: Prisma.JsonValue | null | undefined,
): number | null {
  if (progress && typeof progress === 'object') {
    return progress.processedRows;
  }
  if (typeof progress === 'number') {
    return progress;
  }
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata) && 'processedRows' in metadata) {
    const value = metadata.processedRows;
    return typeof value === 'number' ? value : null;
  }
  return null;
}
