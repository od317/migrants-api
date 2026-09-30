import { SourceFileFormat } from '@prisma/client';
import { NormalizedObservation } from '../normalized-observation';

/**
 * Maps one source row into the shared raw-record shape.
 * A null return means the row has nothing to store.
 * readRecords must stream; it must not buffer the file.
 */
export interface BaseIngestionAdapter {
  readonly acronym: string;
  readonly format: SourceFileFormat;
  normalizeRecord(record: unknown): NormalizedObservation | null;
  readRecords(filePath: string): AsyncIterable<unknown>;
}
