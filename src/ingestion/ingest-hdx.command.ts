import 'reflect-metadata';
import '../load-env';

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { HdxConflictEventsAdapter } from './adapters/hdx-conflict-events.adapter';

const DEFAULT_CANDIDATES = [
  resolve(process.cwd(), 'data', 'acled-syria.csv'),
  resolve(process.cwd(), 'data', 'acled.csv'),
  resolve(process.cwd(), 'acled-syria.csv'),
];

async function main(): Promise<void> {
  const filePath = resolveCsv(process.argv[2] ?? process.env.HDX_CSV);
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const adapter = app.get(HdxConflictEventsAdapter);
    const result = await adapter.processFile(filePath);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await app.close();
  }
}

function resolveCsv(argument: string | undefined): string {
  const candidates = [argument, ...DEFAULT_CANDIDATES].filter(
    (candidate): candidate is string => Boolean(candidate),
  );
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      'ACLED CSV not found. Run npm run ingest:hdx -- "C:\\\\path\\\\acled-syria.csv"',
    );
  }
  return resolve(found);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
