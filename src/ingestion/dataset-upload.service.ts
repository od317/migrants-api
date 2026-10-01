import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, mkdirSync } from 'node:fs';
import { mkdir, open, rm } from 'node:fs/promises';
import { extname, join } from 'node:path';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { diskStorage } from 'multer';
import { IngestionStatus, Prisma, SourceFileFormat } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { HdxConflictEventsAdapter } from './adapters/hdx-conflict-events.adapter';
import { IomMissingMigrantsAdapter } from './adapters/iom-missing-migrants.adapter';
import { readExcelHeaders } from './adapters/read-excel-rows';
import { DatasetType, UploadDatasetDto } from './dto/upload-dataset.dto';

export const DATASET_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
export const SOURCE_UPLOAD_DIR = join(process.cwd(), 'uploads', 'sources');

const CSV_MIME_TYPES = new Set([
  'text/csv',
  'application/csv',
  'text/plain',
  'application/vnd.ms-excel',
  'application/octet-stream',
]);

const XLSX_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/zip',
  'application/octet-stream',
]);

export type DatasetUploadResult = {
  success: true;
  sourceFileId: string;
  recordsProcessed: number;
  message: string;
};

type StoredUpload = {
  originalname: string;
  mimetype?: string;
  size: number;
  path?: string;
};

export function sourceFileUploadOptions() {
  mkdirSync(SOURCE_UPLOAD_DIR, { recursive: true });
  return {
    storage: diskStorage({
      destination: SOURCE_UPLOAD_DIR,
      filename: (_req: unknown, file: { originalname: string }, callback: (error: Error | null, name: string) => void) => {
        const extension = extname(file.originalname).toLowerCase();
        const safeExtension = extension === '.csv' || extension === '.xlsx' ? extension : '';
        callback(null, `${randomUUID()}${safeExtension}`);
      },
    }),
    limits: { fileSize: DATASET_UPLOAD_MAX_BYTES },
  };
}

@Injectable()
export class DatasetUploadService {
  private readonly logger = new Logger(DatasetUploadService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly iomMissingMigrants: IomMissingMigrantsAdapter,
    private readonly hdxConflictEvents: HdxConflictEventsAdapter,
  ) {}

  async upload(file: StoredUpload | undefined, dto: UploadDatasetDto): Promise<DatasetUploadResult> {
    if (!file?.path) {
      throw new BadRequestException('A CSV or XLSX file is required');
    }
    let registered = false;
    try {
      this.assertFile(file);
      const datasetType = await this.resolveDataset(dto.datasetType, file.path, file.originalname);
      const organization = await this.resolveOrganization(dto.organizationId, datasetType);
      const sourceFile = await this.registerProcessing(organization.id, file, datasetType);
      registered = true;
      this.logger.log(
        `Source file ${sourceFile.id} registered as PROCESSING for ${datasetType}`,
      );

      try {
        const result = await this.dispatch(datasetType, file.path, organization.id);
        const message = `Committed ${result.committed} ${datasetType} records`;
        this.logger.log(message);
        return {
          success: true,
          sourceFileId: result.sourceFileId,
          recordsProcessed: result.committed,
          message,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Ingestion failed';
        await this.markFailed(sourceFile.id, message);
        this.logger.error(`Source file ${sourceFile.id} failed: ${message}`);
        throw error;
      }
    } catch (error) {
      if (!registered) {
        await rm(file.path, { force: true }).catch(() => undefined);
      }
      throw error;
    }
  }

  private assertFile(file: StoredUpload): void {
    if (file.size > DATASET_UPLOAD_MAX_BYTES) {
      throw new BadRequestException('Upload exceeds the 50 MB limit');
    }
    const extension = extname(file.originalname).toLowerCase();
    if (extension !== '.csv' && extension !== '.xlsx') {
      throw new BadRequestException('Upload must be a .csv or .xlsx file');
    }
    const mime = (file.mimetype ?? '').toLowerCase();
    const allowed = extension === '.csv' ? CSV_MIME_TYPES : XLSX_MIME_TYPES;
    if (mime && !allowed.has(mime)) {
      throw new BadRequestException(`Unsupported MIME type "${file.mimetype}" for ${extension} uploads`);
    }
  }

  private async resolveDataset(
    requested: DatasetType,
    filePath: string,
    originalName: string,
  ): Promise<Exclude<DatasetType, DatasetType.AUTO_DETECT>> {
    const extension = extname(originalName).toLowerCase();
    if (requested === DatasetType.IOM_MISSING_MIGRANTS) {
      if (extension !== '.xlsx') {
        throw new BadRequestException('IOM Missing Migrants uploads must be .xlsx files');
      }
      return DatasetType.IOM_MISSING_MIGRANTS;
    }
    if (requested === DatasetType.HDX_CONFLICT) {
      if (extension !== '.csv') {
        throw new BadRequestException('HDX conflict uploads must be .csv files');
      }
      return DatasetType.HDX_CONFLICT;
    }

    if (extension === '.xlsx') {
      const headers = await readExcelHeaders(filePath);
      if (IomMissingMigrantsAdapter.matchesHeaders(headers)) {
        return DatasetType.IOM_MISSING_MIGRANTS;
      }
    }
    if (extension === '.csv') {
      const headers = await readCsvHeaders(filePath);
      if (HdxConflictEventsAdapter.matchesHeaders(headers)) {
        return DatasetType.HDX_CONFLICT;
      }
    }
    throw new BadRequestException(
      'Could not detect the dataset. Set datasetType to IOM_MISSING_MIGRANTS or HDX_CONFLICT.',
    );
  }

  private async resolveOrganization(organizationId: string | undefined, datasetType: DatasetType) {
    if (organizationId) {
      const existing = await this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { id: true, name: true },
      });
      if (!existing) {
        throw new NotFoundException('Organization not found');
      }
      return existing;
    }

    if (datasetType === DatasetType.IOM_MISSING_MIGRANTS) {
      return this.ensureOrganization({
        acronym: 'IOM',
        name: 'International Organization for Migration',
        reliabilityScore: 0.8,
      });
    }
    return this.ensureOrganization({
      acronym: 'HDX',
      name: 'Humanitarian Data Exchange',
      reliabilityScore: 0.85,
      mandate: 'Publishes humanitarian datasets, including ACLED conflict events.',
    });
  }

  private async ensureOrganization(input: {
    acronym: string;
    name: string;
    reliabilityScore: number;
    mandate?: string;
  }) {
    const existing = await this.prisma.organization.findUnique({
      where: { acronym: input.acronym },
      select: { id: true, name: true },
    });
    if (existing) {
      return existing;
    }
    return this.prisma.organization.create({
      data: input,
      select: { id: true, name: true },
    });
  }

  private async registerProcessing(
    organizationId: string,
    file: StoredUpload,
    datasetType: DatasetType,
  ) {
    const extension = extname(file.originalname).toLowerCase();
    const checksumSha256 = await sha256(file.path as string);
    const format = extension === '.csv' ? SourceFileFormat.CSV : SourceFileFormat.EXCEL;
    const storageKey = join('uploads', 'sources', file.path ? basenameSafe(file.path) : '');
    const data = {
      originalFilename: file.originalname,
      storageKey,
      format,
      mimeType: file.mimetype || null,
      byteSize: file.size,
      ingestionStatus: IngestionStatus.PROCESSING,
      errorMessage: null,
      metadata: {
        datasetType,
        adapter:
          datasetType === DatasetType.IOM_MISSING_MIGRANTS
            ? 'IomMissingMigrantsAdapter'
            : 'HdxConflictEventsAdapter',
      } satisfies Prisma.InputJsonObject,
    };

    const existing = await this.prisma.sourceFile.findUnique({
      where: { organizationId_checksumSha256: { organizationId, checksumSha256 } },
    });
    if (existing) {
      return this.prisma.sourceFile.update({
        where: { id: existing.id },
        data,
      });
    }

    await mkdir(SOURCE_UPLOAD_DIR, { recursive: true });
    return this.prisma.sourceFile.create({
      data: {
        organizationId,
        checksumSha256,
        ...data,
      },
    });
  }

  private dispatch(datasetType: DatasetType, filePath: string, organizationId: string) {
    if (datasetType === DatasetType.IOM_MISSING_MIGRANTS) {
      return this.iomMissingMigrants.processFile(filePath, { organizationId });
    }
    return this.hdxConflictEvents.processFile(filePath, { organizationId });
  }

  private async markFailed(sourceFileId: string, message: string) {
    await this.prisma.sourceFile.update({
      where: { id: sourceFileId },
      data: {
        ingestionStatus: IngestionStatus.FAILED,
        errorMessage: message,
        processedAt: new Date(),
      },
    }).catch((error: unknown) => {
      this.logger.error(
        `Could not mark source file ${sourceFileId} as FAILED: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    });
  }
}

function basenameSafe(filePath: string): string {
  const name = filePath.split(/[/\\]/).pop();
  return name || 'upload';
}

function sha256(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  return new Promise((resolveHash, reject) => {
    const input = createReadStream(filePath);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('error', reject);
    input.on('end', () => resolveHash(hash.digest('hex')));
  });
}

async function readCsvHeaders(filePath: string): Promise<string[]> {
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(8192);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const line = buffer.subarray(0, bytesRead).toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? '';
    return line.split(',').map((header) => header.trim().replace(/^"|"$/g, ''));
  } finally {
    await handle.close();
  }
}
