import { open } from 'node:fs/promises';
import { BadRequestException, Injectable } from '@nestjs/common';
import { SourceFileFormat } from '@prisma/client';
import { BaseIngestionAdapter } from './base-ingestion.adapter';
import { HdxConflictEventsAdapter } from './hdx-conflict-events.adapter';
import { IomCsvAdapter } from './iom-csv.adapter';
import { IomMissingMigrantsAdapter } from './iom-missing-migrants.adapter';
import { readExcelHeaders } from './read-excel-rows';
import { VdcJsonAdapter } from './vdc-json.adapter';

@Injectable()
export class IngestionAdapterRegistry {
  private readonly adapters: Map<string, BaseIngestionAdapter>;

  constructor(
    private readonly iomCsvAdapter: IomCsvAdapter,
    private readonly iomMissingMigrantsAdapter: IomMissingMigrantsAdapter,
    private readonly hdxConflictEventsAdapter: HdxConflictEventsAdapter,
    private readonly vdcJsonAdapter: VdcJsonAdapter,
  ) {
    this.adapters = new Map(
      [iomCsvAdapter, hdxConflictEventsAdapter, vdcJsonAdapter].map((adapter) => [
        adapter.acronym,
        adapter,
      ]),
    );
  }

  require(acronym: string | null): BaseIngestionAdapter {
    const adapter = acronym
      ? this.adapters.get(acronym.trim().toUpperCase())
      : undefined;
    if (!adapter) {
      throw new BadRequestException(
        `No ingestion adapter is registered for organization acronym "${acronym ?? ''}". Expected IOM, HDX, or VDC.`,
      );
    }
    return adapter;
  }

  /**
   * Missing Migrants workbooks and ACLED CSVs are chosen from their headers.
   * Other files stay on the organization adapter.
   */
  async requireForFile(
    acronym: string | null,
    format: SourceFileFormat,
    filePath: string,
  ): Promise<BaseIngestionAdapter> {
    if (format === SourceFileFormat.EXCEL && filePath.toLowerCase().endsWith('.xlsx')) {
      const headers = await readExcelHeaders(filePath);
      if (IomMissingMigrantsAdapter.matchesHeaders(headers)) {
        return this.iomMissingMigrantsAdapter;
      }
    }
    if (format === SourceFileFormat.CSV && filePath.toLowerCase().endsWith('.csv')) {
      const headers = await readCsvHeaders(filePath);
      if (HdxConflictEventsAdapter.matchesHeaders(headers)) {
        return this.hdxConflictEventsAdapter;
      }
    }
    return this.require(acronym);
  }
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
