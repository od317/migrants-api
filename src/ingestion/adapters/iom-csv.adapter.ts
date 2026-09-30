import { createReadStream } from 'node:fs';
import { Injectable } from '@nestjs/common';
import { SourceFileFormat, VitalStatus } from '@prisma/client';
import csvParser from 'csv-parser';
import { BaseIngestionAdapter } from './base-ingestion.adapter';
import {
  asRecord,
  fieldIndex,
  isBlankRecord,
  mapStatusLabel,
  parseEventDate,
  readCoordinates,
  readCount,
  readBirthYear,
  readString,
  statusTable,
} from '../field-readers';
import { NormalizedObservation } from '../normalized-observation';
import { readExcelRows } from './read-excel-rows';

const STATUS_LABELS = statusTable([
  ['alive', VitalStatus.ALIVE],
  ['survivor', VitalStatus.ALIVE],
  ['missing', VitalStatus.MISSING],
  ['deceased', VitalStatus.DECEASED],
  ['dead', VitalStatus.DECEASED],
  ['killed', VitalStatus.DECEASED],
  ['detained', VitalStatus.DETAINED],
]);

/** Incident-level IOM CSV. One source row becomes one raw record, not one row per death. */
@Injectable()
export class IomCsvAdapter implements BaseIngestionAdapter {
  readonly acronym = 'IOM';
  readonly format = SourceFileFormat.CSV;

  async *readRecords(filePath: string): AsyncIterable<unknown> {
    if (filePath.toLowerCase().endsWith('.xlsx')) {
      yield* readExcelRows(filePath);
      return;
    }

    const input = createReadStream(filePath);
    const parser = input.pipe(
      csvParser({
        mapHeaders: ({ header }) => header.replace(/^\uFEFF/, '').trim(),
      }),
    );

    try {
      for await (const row of parser) {
        yield row;
      }
    } finally {
      input.destroy();
    }
  }

  normalizeRecord(record: unknown): NormalizedObservation | null {
    const row = asRecord(record);
    if (!row || isBlankRecord(row)) {
      return null;
    }

    const fields = fieldIndex(row);
    const dead = readCount(fields, ['total dead', 'number of dead', 'number dead']);
    const missing = readCount(fields, [
      'minimum estimated number of missing',
      'total missing',
      'number of missing',
      'number missing',
    ]);
    const survivors = readCount(fields, ['number of survivors', 'total survivors']);
    const coordinates = readCoordinates(fields);

    return {
      payload: row,
      extractedName: readString(fields, ['victim name', 'migrant name', 'name']),
      vitalStatus: incidentStatus(dead, missing, survivors, fields),
      location: readString(fields, [
        'location of death',
        'location of incident',
        'location',
        'region of incident',
      ]),
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      eventDate: parseEventDate(readString(fields, ['incident date', 'event date', 'date'])),
      reportedAt: reportedTimestamp(readString(fields, ['reported date', 'reported at'])),
      birthYear: readBirthYear(fields),
    };
  }
}

function incidentStatus(
  dead: number,
  missing: number,
  survivors: number,
  fields: Map<string, unknown>,
): VitalStatus {
  if (dead > 0 && missing === 0) {
    return VitalStatus.DECEASED;
  }
  if (missing > 0 && dead === 0) {
    return VitalStatus.MISSING;
  }
  if (dead === 0 && missing === 0 && survivors > 0) {
    return VitalStatus.ALIVE;
  }
  if (dead > 0 && missing > 0) {
    return VitalStatus.UNKNOWN;
  }
  return mapStatusLabel(readString(fields, ['status']), STATUS_LABELS);
}

function reportedTimestamp(value: string | null): Date | null {
  const day = parseEventDate(value);
  if (!day || !value) {
    return day;
  }
  if (value.trim().length <= 10) {
    return day;
  }
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? day : timestamp;
}
