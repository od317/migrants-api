import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { BadRequestException, Injectable } from '@nestjs/common';
import { SourceFileFormat, VitalStatus } from '@prisma/client';
import { chain } from 'stream-chain';
import { parser } from 'stream-json';
import { streamArray } from 'stream-json/streamers/StreamArray';
import { BaseIngestionAdapter } from './base-ingestion.adapter';
import {
  asRecord,
  fieldIndex,
  isBlankRecord,
  mapStatusLabel,
  parseEventDate,
  readCoordinates,
  readBirthYear,
  readString,
  statusTable,
} from '../field-readers';
import { NormalizedObservation } from '../normalized-observation';

const STATUS_LABELS = statusTable([
  ['alive', VitalStatus.ALIVE],
  ['released', VitalStatus.ALIVE],
  ['survivor', VitalStatus.ALIVE],
  ['missing', VitalStatus.MISSING],
  ['disappeared', VitalStatus.MISSING],
  ['disappearance', VitalStatus.MISSING],
  ['forcibly disappeared', VitalStatus.MISSING],
  ['kidnapped', VitalStatus.MISSING],
  ['مفقود', VitalStatus.MISSING],
  ['مختف', VitalStatus.MISSING],
  ['مختفي', VitalStatus.MISSING],
  ['deceased', VitalStatus.DECEASED],
  ['dead', VitalStatus.DECEASED],
  ['killed', VitalStatus.DECEASED],
  ['death', VitalStatus.DECEASED],
  ['martyr', VitalStatus.DECEASED],
  ['martyred', VitalStatus.DECEASED],
  ['شهيد', VitalStatus.DECEASED],
  ['قتيل', VitalStatus.DECEASED],
  ['متوفي', VitalStatus.DECEASED],
  ['detained', VitalStatus.DETAINED],
  ['detention', VitalStatus.DETAINED],
  ['arrested', VitalStatus.DETAINED],
  ['prisoner', VitalStatus.DETAINED],
  ['imprisoned', VitalStatus.DETAINED],
  ['معتقل', VitalStatus.DETAINED],
  ['موقوف', VitalStatus.DETAINED],
]);

/** VDC exports are a JSON array of victim objects, streamed one element at a time. */
@Injectable()
export class VdcJsonAdapter implements BaseIngestionAdapter {
  readonly acronym = 'VDC';
  readonly format = SourceFileFormat.JSON;

  async *readRecords(filePath: string): AsyncIterable<unknown> {
    await assertJsonArray(filePath);
    const pipeline = chain([
      createReadStream(filePath),
      parser(),
      streamArray(),
    ]);

    try {
      for await (const item of pipeline) {
        yield (item as { value: unknown }).value;
      }
    } finally {
      pipeline.destroy();
    }
  }

  normalizeRecord(record: unknown): NormalizedObservation | null {
    const row = asRecord(record);
    if (!row || isBlankRecord(row)) {
      return null;
    }

    const fields = fieldIndex(row);
    const vitalStatus = mapStatusLabel(
      readString(fields, ['status', 'victim status', 'current status']),
      STATUS_LABELS,
    );
    const coordinates = readCoordinates(fields);

    return {
      payload: row,
      extractedName: readString(fields, ['victim name', 'victim_name', 'name', 'full name']),
      vitalStatus,
      location: readString(fields, ['location', 'city', 'town', 'province', 'governorate']),
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      eventDate: eventDateFor(vitalStatus, fields),
      reportedAt: parseEventDate(readString(fields, ['reported date', 'reported at'])),
      birthYear: readBirthYear(fields),
    };
  }
}

function eventDateFor(
  status: VitalStatus,
  fields: Map<string, unknown>,
): Date | null {
  const generic = parseEventDate(readString(fields, ['date', 'event date']));
  if (status === VitalStatus.DECEASED) {
    return (
      parseEventDate(readString(fields, ['date of death', 'date_of_death'])) ?? generic
    );
  }
  if (status === VitalStatus.DETAINED) {
    return (
      parseEventDate(readString(fields, ['date of arrest', 'date_of_arrest'])) ?? generic
    );
  }
  if (status === VitalStatus.MISSING) {
    return (
      parseEventDate(
        readString(fields, ['date of disappearance', 'date_of_disappearance']),
      ) ?? generic
    );
  }
  return generic;
}

async function assertJsonArray(filePath: string): Promise<void> {
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(32);
    await handle.read(buffer, 0, 32, 0);
    const start = buffer.toString('utf8').replace(/^\uFEFF/, '').trimStart();
    if (!start.startsWith('[')) {
      throw new BadRequestException('VDC ingestion expects a JSON array');
    }
  } finally {
    await handle.close();
  }
}
