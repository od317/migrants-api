import 'reflect-metadata';
import '../load-env';

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { IomMissingMigrantsAdapter } from './adapters/iom-missing-migrants.adapter';

const DEFAULT_CANDIDATES = [
  resolve(process.cwd(), 'data', 'Missing_Migrants_Global_Figures_allData.xlsx'),
  resolve(process.cwd(), 'Missing_Migrants_Global_Figures_allData.xlsx'),
  'C:\\Users\\HP\\Downloads\\Missing_Migrants_Global_Figures_allData.xlsx',
];

async function main(): Promise<void> {
  const filePath = resolveWorkbook(process.argv[2] ?? process.env.IOM_WORKBOOK);
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const adapter = app.get(IomMissingMigrantsAdapter);
    const result = await adapter.processFile(filePath);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await app.close();
  }
}

function resolveWorkbook(argument: string | undefined): string {
  const candidates = [argument, ...DEFAULT_CANDIDATES].filter(
    (candidate): candidate is string => Boolean(candidate),
  );
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      'Missing Migrants workbook not found. Run npm run ingest:iom -- "C:\\\\path\\\\Missing_Migrants_Global_Figures_allData.xlsx"',
    );
  }
  return resolve(found);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
