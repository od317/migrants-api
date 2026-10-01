import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { basename, isAbsolute, resolve } from 'node:path';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { IngestionStatus, Prisma, SourceFileFormat, VitalStatus } from '@prisma/client';
import csvParser from 'csv-parser';
import { foldForCompare } from '../../common/fold-text';
import { PrismaService } from '../../prisma/prisma.service';
import {
  asRecord,
  fieldIndex,
  isBlankRecord,
  parseEventDate,
  readCoordinates,
  readString,
} from '../field-readers';
import { NormalizedObservation } from '../normalized-observation';
import { BaseIngestionAdapter } from './base-ingestion.adapter';

const SOURCE_ORGANIZATION_ID = '__organizationId';
const HDX_BATCH_SIZE = 1000;
const HDX_RELIABILITY = 0.85;

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

/** ACLED conflict events from HDX. One CSV row becomes one anonymous raw record. */
@Injectable()
export class HdxConflictEventsAdapter implements BaseIngestionAdapter {
  readonly acronym = 'HDX';
  readonly format = SourceFileFormat.CSV;

  private readonly logger = new Logger(HdxConflictEventsAdapter.name);

  constructor(private readonly prisma: PrismaService) {}

  static matchesHeaders(headers: string[]): boolean {
    const folded = new Set(headers.map((header) => header.trim().toLowerCase()));
    return folded.has('event_id_cnty') && folded.has('country') && folded.has('event_type');
  }

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
      : await this.ensureHdxOrganization();
    const sourceFile = await this.ensureSourceFile(owner.id, absolute);
    await this.prisma.sourceFile.update({
      where: { id: sourceFile.id },
      data: { ingestionStatus: IngestionStatus.PROCESSING, errorMessage: null },
    });

    const organizations = new Map<string, string>();
    let batch: Prisma.RawRecordCreateManyInput[] = [];
    let batchNumber = 0;
    let fileRow = 1;
    let processed = 0;
    let committed = 0;
    let skipped = 0;
    let malformed = 0;

    try {
      for await (const raw of streamCsv(absolute)) {
        fileRow += 1;
        try {
          const record = asRecord(raw);
          if (!record) {
            malformed += 1;
            this.logger.warn(`Row ${fileRow} skipped: malformed row`);
            continue;
          }
          if (!countryIsSyria(record)) {
            skipped += 1;
            continue;
          }

          const publisher = await this.organizationFor(record, organizations);
          const observation = this.normalizeRecord(
            publisher ? { ...record, [SOURCE_ORGANIZATION_ID]: publisher.id } : record,
          );
          if (!observation) {
            malformed += 1;
            this.logger.warn(`Row ${fileRow} skipped: missing event_id_cnty`);
            continue;
          }
          observation.organizationId ??= owner.id;
          if (!observation.organizationId || !observation.sourceLocator) {
            throw new Error('Row is missing an organization or event_id_cnty');
          }

          batch.push(this.toRow(sourceFile.id, observation));
          processed += 1;

          if (batch.length >= HDX_BATCH_SIZE) {
            committed += await this.commitBatch(batch, ++batchNumber, committed);
            batch = [];
          }
        } catch (error) {
          malformed += 1;
          const message = error instanceof Error ? error.message : 'Unknown row error';
          this.logger.error(`Row ${fileRow} failed: ${message}`);
        }
      }

      if (batch.length > 0) {
        committed += await this.commitBatch(batch, ++batchNumber, committed);
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
        `Skipped ${skipped} rows whose country is not Syria. Malformed rows: ${malformed}.`,
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

  async *readRecords(filePath: string): AsyncIterable<unknown> {
    const organizations = new Map<string, string>();
    for await (const row of streamCsv(filePath)) {
      const record = asRecord(row);
      if (!record || !countryIsSyria(record)) {
        continue;
      }
      const publisher = await this.organizationFor(record, organizations);
      yield publisher ? { ...record, [SOURCE_ORGANIZATION_ID]: publisher.id } : record;
    }
  }

  normalizeRecord(record: unknown): NormalizedObservation | null {
    const row = asRecord(record);
    if (!row || isBlankRecord(publicColumns(row)) || !countryIsSyria(row)) {
      return null;
    }

    const fields = fieldIndex(publicColumns(row));
    const eventId = readString(fields, ['event id cnty', 'event_id_cnty']);
    if (!eventId) {
      return null;
    }

    const dateText = readString(fields, ['event date', 'event_date']);
    const eventDate = parseAcledDate(dateText);
    const place = readString(fields, ['location']);
    const governorate = readString(fields, ['admin1']);
    const location = [place, governorate].filter((part): part is string => Boolean(part)).join(', ');
    const coordinates = readCoordinates(fields);
    const fatalities = readFatalities(fields.get('fatalities'));
    const status =
      fatalities > 0 ? VitalStatus.FATALITY_EVENT : VitalStatus.CONFLICT_EVENT;
    const metadata = {
      eventType: readString(fields, ['event type', 'event_type']),
      subEventType: readString(fields, ['sub event type', 'sub_event_type']),
      actor1: readString(fields, ['actor1']),
      actor2: readString(fields, ['actor2']),
      fatalities,
      description: readString(fields, ['notes']),
    };

    return {
      payload: {
        sourceRecordId: eventId,
        date: eventDate ? eventDate.toISOString().slice(0, 10) : dateText,
        location: location || null,
        coordinates:
          coordinates.latitude != null && coordinates.longitude != null
            ? `${coordinates.latitude}, ${coordinates.longitude}`
            : null,
        status,
        metadata,
        sourceRow: publicColumns(row),
      },
      extractedName: null,
      vitalStatus: status,
      location: location || null,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      eventDate,
      reportedAt: null,
      birthYear: null,
      organizationId: readString(fieldIndex(row), [SOURCE_ORGANIZATION_ID]) ?? undefined,
      sourceLocator: eventId,
    };
  }

  private async commitBatch(
    batch: Prisma.RawRecordCreateManyInput[],
    batchNumber: number,
    alreadyCommitted: number,
  ): Promise<number> {
    const inserted = await this.flush(batch);
    const total = alreadyCommitted + inserted;
    this.logger.log(
      `Batch ${batchNumber} committed (${inserted} records, ${total} total)`,
    );
    return inserted;
  }

  private async organizationFor(
    row: Record<string, unknown>,
    cache: Map<string, string>,
  ): Promise<{ id: string; name: string } | undefined> {
    const name = primarySource(readString(fieldIndex(row), ['source']));
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
      data: { name, reliabilityScore: HDX_RELIABILITY },
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

  private async ensureHdxOrganization(): Promise<{ id: string; name: string }> {
    const existing = await this.prisma.organization.findUnique({
      where: { acronym: 'HDX' },
      select: { id: true, name: true },
    });
    if (existing) {
      this.logger.log(`Organization ${existing.name} found`);
      return existing;
    }
    const created = await this.prisma.organization.create({
      data: {
        name: 'Humanitarian Data Exchange',
        acronym: 'HDX',
        reliabilityScore: HDX_RELIABILITY,
        mandate: 'Publishes humanitarian datasets, including ACLED conflict events.',
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
        format: SourceFileFormat.CSV,
        mimeType: 'text/csv',
        checksumSha256,
        byteSize: fileStat.size,
        ingestionStatus: IngestionStatus.PENDING,
        metadata: { adapter: 'HdxConflictEventsAdapter' },
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

function streamCsv(filePath: string): AsyncIterable<Record<string, string>> {
  const input = createReadStream(filePath);
  const parser = input.pipe(
    csvParser({
      mapHeaders: ({ header }) => header.replace(/^\uFEFF/, '').trim(),
    }),
  );
  return parser as AsyncIterable<Record<string, string>>;
}

function countryIsSyria(row: Record<string, unknown>): boolean {
  const country = readString(fieldIndex(row), ['country']);
  return country?.toLowerCase() === 'syria';
}

function primarySource(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const first = value.split(';')[0]?.trim();
  return first || null;
}

function readFatalities(value: unknown): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value.replace(/,/g, '').trim())
        : 0;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.trunc(parsed);
}

function parseAcledDate(value: string | null): Date | null {
  const parsed = parseEventDate(value);
  if (parsed || !value) {
    return parsed;
  }
  const text = value.trim();
  const dayMonth = /^(\d{1,2})[ ./-]+([A-Za-z]+)[ ./-]+(\d{4})$/.exec(text);
  if (dayMonth) {
    return utcDate(Number(dayMonth[3]), MONTHS[dayMonth[2].toLowerCase()] ?? 0, Number(dayMonth[1]));
  }
  const monthDay = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(text);
  if (monthDay) {
    return utcDate(Number(monthDay[3]), MONTHS[monthDay[1].toLowerCase()] ?? 0, Number(monthDay[2]));
  }
  return null;
}

function utcDate(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
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

function sha256(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  return new Promise((resolveHash, reject) => {
    const input = createReadStream(filePath);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('error', reject);
    input.on('end', () => resolveHash(hash.digest('hex')));
  });
}
