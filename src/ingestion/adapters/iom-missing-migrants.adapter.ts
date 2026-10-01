import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { basename, isAbsolute, resolve } from 'node:path';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { IngestionStatus, Prisma, SourceFileFormat, VitalStatus } from '@prisma/client';
import { foldForCompare } from '../../common/fold-text';
import { PrismaService } from '../../prisma/prisma.service';
import { INGESTION_BATCH_SIZE } from '../ingestion.constants';
import { BaseIngestionAdapter } from './base-ingestion.adapter';
import { readExcelRows } from './read-excel-rows';
import {
  asRecord,
  fieldIndex,
  isBlankRecord,
  parseEventDate,
  readCoordinates,
  readString,
} from '../field-readers';
import { NormalizedObservation } from '../normalized-observation';

const SOURCE_ORGANIZATION_ID = '__organizationId';

/** IOM Missing Migrants workbook. One incident row becomes one anonymous raw record. */
@Injectable()
export class IomMissingMigrantsAdapter implements BaseIngestionAdapter {
  readonly acronym = 'IOM';
  readonly format = SourceFileFormat.EXCEL;

  private readonly logger = new Logger(IomMissingMigrantsAdapter.name);

  constructor(private readonly prisma: PrismaService) {}

  async processFile(
    filePath: string,
    options?: { organizationId?: string },
  ): Promise<{
    filePath: string;
    sourceFileId: string;
    processed: number;
    committed: number;
    skipped: number;
    malformed: number;
  }> {
    const absolute = resolve(filePath);
    await access(absolute);
    this.logger.log(`Ingesting ${absolute}`);

    const owner = options?.organizationId
      ? await this.organizationById(options.organizationId)
      : await this.ensureIomOrganization();
    const sourceFile = await this.ensureSourceFile(owner.id, absolute);
    await this.prisma.sourceFile.update({
      where: { id: sourceFile.id },
      data: { ingestionStatus: IngestionStatus.PROCESSING, errorMessage: null },
    });

    const organizations = new Map<string, string>();
    let batch: Prisma.RawRecordCreateManyInput[] = [];
    let sheetRow = 1;
    let processed = 0;
    let committed = 0;
    let skipped = 0;
    let malformed = 0;

    try {
      for await (const raw of readExcelRows(absolute)) {
        sheetRow += 1;
        try {
          const record = asRecord(raw);
          if (!record) {
            malformed += 1;
            this.logger.warn(`Row ${sheetRow} skipped: malformed row`);
            continue;
          }
          if (!originIncludesSyria(record)) {
            skipped += 1;
            continue;
          }

          const publisher = await this.organizationFor(record, organizations);
          const observation = this.normalizeRecord(
            publisher ? { ...record, [SOURCE_ORGANIZATION_ID]: publisher.id } : record,
          );
          if (!observation) {
            malformed += 1;
            this.logger.warn(`Row ${sheetRow} skipped: missing Incident ID`);
            continue;
          }
          observation.organizationId ??= owner.id;
          if (!observation.organizationId || !observation.sourceLocator) {
            throw new Error('Row is missing an organization or Incident ID');
          }

          batch.push(this.toRow(sourceFile.id, observation));
          processed += 1;
          this.logger.log(
            `Row ${sheetRow} processed (${observation.sourceLocator}, ${observation.location ?? 'unknown location'})`,
          );

          if (batch.length >= INGESTION_BATCH_SIZE) {
            committed += await this.flush(batch);
            this.logger.log(`Batch committed (${committed} records so far)`);
            batch = [];
          }
        } catch (error) {
          malformed += 1;
          const message = error instanceof Error ? error.message : 'Unknown row error';
          this.logger.error(`Row ${sheetRow} failed: ${message}`);
        }
      }

      if (batch.length > 0) {
        committed += await this.flush(batch);
      }

      const recordCount = await this.prisma.rawRecord.count({
        where: { sourceFileId: sourceFile.id },
      });
      await this.prisma.sourceFile.update({
        where: { id: sourceFile.id },
        data: {
          ingestionStatus: IngestionStatus.COMPLETED,
          recordCount,
          processedAt: new Date(),
          errorMessage: null,
        },
      });
      this.logger.log(
        `Skipped ${skipped} rows whose country of origin is not Syria. Malformed rows: ${malformed}.`,
      );
      this.logger.log(`Total ${committed} records committed`);
      return {
        filePath: absolute,
        sourceFileId: sourceFile.id,
        processed,
        committed,
        skipped,
        malformed,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ingestion failed';
      await this.prisma.sourceFile.update({
        where: { id: sourceFile.id },
        data: {
          ingestionStatus: IngestionStatus.FAILED,
          errorMessage: message,
          processedAt: new Date(),
        },
      });
      this.logger.error(`Ingestion failed: ${message}`);
      throw error;
    }
  }

  static matchesHeaders(headers: string[]): boolean {
    const folded = new Set(headers.map((header) => header.trim().toLowerCase()));
    return (
      folded.has('incident id') &&
      folded.has('country of origin') &&
      folded.has('information source')
    );
  }

  async *readRecords(filePath: string): AsyncIterable<unknown> {
    const organizations = new Map<string, string>();
    for await (const row of readExcelRows(filePath)) {
      const record = asRecord(row);
      if (!record || !originIncludesSyria(record)) {
        continue;
      }
      const publisher = await this.organizationFor(record, organizations);
      yield publisher ? { ...record, [SOURCE_ORGANIZATION_ID]: publisher.id } : record;
    }
  }

  normalizeRecord(record: unknown): NormalizedObservation | null {
    const row = asRecord(record);
    if (!row || isBlankRecord(publicColumns(row)) || !originIncludesSyria(row)) {
      return null;
    }

    const fields = fieldIndex(publicColumns(row));
    const incidentId = readString(fields, ['incident id', 'main id']);
    if (!incidentId) {
      return null;
    }

    const dateText = readString(fields, ['incident date']);
    const eventDate = parseEventDate(dateText);
    const location = readString(fields, ['location of incident']);
    const coordinatesText = readString(fields, ['coordinates']);
    const coordinates = readCoordinates(fields);
    const route = readString(fields, ['migration route']);
    const causeOfDeath = readString(fields, ['cause of death']);
    const sourceUrl = readString(fields, ['url']);
    const totalCasualties = readCasualtyCount(fields, 'total number of dead and missing');
    const organizationId = readOrganizationId(row);

    return {
      organizationId,
      sourceLocator: incidentId,
      payload: {
        sourceRecordId: incidentId,
        date: eventDate ? eventDate.toISOString().slice(0, 10) : dateText,
        location,
        coordinates: coordinatesText,
        status: VitalStatus.DECEASED_OR_MISSING,
        metadata: {
          route,
          causeOfDeath,
          totalCasualties,
          sourceUrl,
        },
        sourceRow: publicColumns(row),
      },
      extractedName: null,
      vitalStatus: VitalStatus.DECEASED_OR_MISSING,
      location,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      eventDate,
      reportedAt: null,
      birthYear: null,
    };
  }

  private async organizationFor(
    row: Record<string, unknown>,
    cache: Map<string, string>,
  ): Promise<{ id: string; name: string } | undefined> {
    const fields = fieldIndex(row);
    const name = readString(fields, ['information source']);
    if (!name) {
      return undefined;
    }

    const cacheKey = name.toLowerCase();
    const cached = cache.get(cacheKey);
    if (cached) {
      return { id: cached, name };
    }

    const existing = await this.prisma.organization.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
      select: { id: true, name: true },
    });
    if (existing) {
      cache.set(cacheKey, existing.id);
      this.logger.log(`Organization ${existing.name} found`);
      return existing;
    }

    const created = await this.prisma.organization.create({
      data: {
        name,
        reliabilityScore: reliabilityFromQuality(fields.get('source quality')),
      },
      select: { id: true, name: true },
    });
    cache.set(cacheKey, created.id);
    this.logger.log(`Organization ${created.name} created`);
    return created;
  }

  private async organizationById(id: string): Promise<{ id: string; name: string }> {
    const existing = await this.prisma.organization.findUnique({
      where: { id },
      select: { id: true, name: true },
    });
    if (!existing) {
      throw new NotFoundException('Organization not found');
    }
    this.logger.log(`Organization ${existing.name} found`);
    return existing;
  }

  private async ensureIomOrganization(): Promise<{ id: string; name: string }> {
    const existing = await this.prisma.organization.findUnique({
      where: { acronym: 'IOM' },
      select: { id: true, name: true },
    });
    if (existing) {
      this.logger.log(`Organization ${existing.name} found`);
      return existing;
    }
    const created = await this.prisma.organization.create({
      data: {
        name: 'International Organization for Migration',
        acronym: 'IOM',
        reliabilityScore: 0.8,
      },
      select: { id: true, name: true },
    });
    this.logger.log(`Organization ${created.name} created`);
    return created;
  }

  private async ensureSourceFile(organizationId: string, filePath: string) {
    const checksumSha256 = await sha256(filePath);
    const existing = await this.prisma.sourceFile.findUnique({
      where: { organizationId_checksumSha256: { organizationId, checksumSha256 } },
    });
    if (existing) {
      return existing;
    }
    const fileStat = await stat(filePath);
    return this.prisma.sourceFile.create({
      data: {
        organizationId,
        originalFilename: basename(filePath),
        storageKey: isAbsolute(filePath) ? filePath : resolve(filePath),
        format: SourceFileFormat.EXCEL,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        checksumSha256,
        byteSize: fileStat.size,
        ingestionStatus: IngestionStatus.PENDING,
        metadata: { adapter: 'IomMissingMigrantsAdapter' },
      },
    });
  }

  private toRow(
    sourceFileId: string,
    observation: NormalizedObservation,
  ): Prisma.RawRecordCreateManyInput {
    return {
      sourceFileId,
      organizationId: observation.organizationId as string,
      sourceLocator: observation.sourceLocator as string,
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

  private async flush(batch: Prisma.RawRecordCreateManyInput[]): Promise<number> {
    const result = await this.prisma.$transaction((tx) =>
      tx.rawRecord.createMany({ data: batch, skipDuplicates: true }),
    );
    return result.count;
  }
}

function originIncludesSyria(row: Record<string, unknown>): boolean {
  const origin = readString(fieldIndex(row), ['country of origin']);
  return Boolean(origin && origin.toLowerCase().includes('syria'));
}

function publicColumns(row: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key !== SOURCE_ORGANIZATION_ID) {
      copy[key] = value;
    }
  }
  return copy;
}

function readOrganizationId(row: Record<string, unknown>): string | undefined {
  const value = row[SOURCE_ORGANIZATION_ID];
  return typeof value === 'string' && value ? value : undefined;
}

function readCasualtyCount(
  fields: Map<string, unknown>,
  alias: string,
): number | null {
  const value = fields.get(alias);
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(/,/g, '').trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Source Quality is 1–5. 1 maps to 0.2 and 5 maps to 1.0. Anything else stays at the default prior. */
function sha256(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  return new Promise((resolveHash, reject) => {
    const input = createReadStream(filePath);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('error', reject);
    input.on('end', () => resolveHash(hash.digest('hex')));
  });
}

function reliabilityFromQuality(value: unknown): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value.trim())
        : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 5) {
    return 0.5;
  }
  return Math.round((parsed / 5) * 1000) / 1000;
}
