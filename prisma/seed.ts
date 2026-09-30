import 'reflect-metadata';
import '../src/load-env';

import { createHash } from 'node:crypto';
import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  IngestionStatus,
  Prisma,
  SourceFileFormat,
  VitalStatus,
} from '@prisma/client';
import { AppModule } from '../src/app.module';
import { foldForCompare } from '../src/common/fold-text';
import { MatchDecision, MatchingService } from '../src/matching/matching.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  ConflictReport,
  RecordLinkageService,
} from '../src/resolution/record-linkage.service';

const SNHR_METHODOLOGY_URL = 'https://snhr.org/methodology/';

type OrganizationSeed = {
  acronym: string;
  name: string;
  reliabilityScore: number;
  url?: string;
  methodology?: string;
  mandate?: string;
};

type ObservationSeed = {
  locator: string;
  label: string;
  filename: string;
  extractedName: string;
  birthYear: number;
  location: string;
  vitalStatus: VitalStatus;
  eventDate: string;
  notes: string;
};

const organizations: OrganizationSeed[] = [
  {
    acronym: 'SNHR',
    name: 'Syrian Network for Human Rights',
    reliabilityScore: 0.9,
    url: SNHR_METHODOLOGY_URL,
    methodology: SNHR_METHODOLOGY_URL,
    mandate:
      'Documents civilian casualties, detention, and enforced disappearance in Syria.',
  },
  {
    acronym: 'UNHCR',
    name: 'UN Refugee Agency',
    reliabilityScore: 0.95,
    url: 'https://www.unhcr.org/',
    methodology: 'Registers refugees and records protection interviews.',
    mandate: 'International protection and assistance for refugees.',
  },
];

const observations: ObservationSeed[] = [
  {
    locator: 'seed:ahmad-al-khalil-2015',
    label: 'A',
    filename: 'snhr-prison-casualties-2015.csv',
    extractedName: 'Ahmad Al-Khalil',
    birthYear: 1989,
    location: 'Homs',
    vitalStatus: VitalStatus.DECEASED,
    eventDate: '2015-06-15',
    notes: 'Reported casualty in prison',
  },
  {
    locator: 'seed:ahmad-khalil-2019',
    label: 'B',
    filename: 'unhcr-jordan-registration-2019.csv',
    extractedName: 'Ahmad Khalil',
    birthYear: 1989,
    location: 'Homs',
    vitalStatus: VitalStatus.ALIVE,
    eventDate: '2019-11-04',
    notes: 'Registered refugee in Jordan',
  },
];

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    await seedContradiction(app);
  } finally {
    await app.close();
  }
}

async function seedContradiction(app: INestApplicationContext): Promise<void> {
  const prisma = app.get(PrismaService);
  const matching = app.get(MatchingService);
  const recordLinkage = app.get(RecordLinkageService);

  const snhr = await upsertOrganization(prisma, organizations[0]);
  const unhcr = await upsertOrganization(prisma, organizations[1]);
  const publishers = [snhr, unhcr];

  const rawRecords = [];
  for (let index = 0; index < observations.length; index += 1) {
    rawRecords.push(
      await ensureRawRecord(prisma, publishers[index].id, observations[index]),
    );
  }

  await unlinkScenario(prisma, rawRecords.map((record) => record.id));

  const decisions = [];
  for (const record of rawRecords) {
    decisions.push(await matching.linkRecordToProfile(record.id));
  }

  const [first, second] = decisions;
  if (first.masterProfileId !== second.masterProfileId) {
    throw new Error(
      `Matching kept the records apart: ${first.masterProfileId} and ${second.masterProfileId}`,
    );
  }
  if (second.decision !== 'AUTO_LINKED') {
    throw new Error(
      `Record B was ${second.decision} at confidence ${second.confidence}, expected AUTO_LINKED`,
    );
  }

  const report = await recordLinkage.detectConflicts(first.masterProfileId);
  const profile = await prisma.masterProfile.findUnique({
    where: { id: first.masterProfileId },
    include: {
      linkages: {
        include: {
          rawRecord: { include: { organization: true } },
        },
        orderBy: { rawRecord: { eventDate: 'asc' } },
      },
    },
  });
  if (!profile) {
    throw new Error('Master profile disappeared after conflict detection');
  }

  printScenario(publishers, decisions, report, profile.hasConflict, profile.profileStatus, profile.linkages);

  assertReport(report, profile.hasConflict, profile.linkages);
}

async function upsertOrganization(
  prisma: PrismaService,
  seed: OrganizationSeed,
): Promise<{ id: string; acronym: string; name: string; reliabilityScore: number; methodology: string | null }> {
  const organization = await prisma.organization.upsert({
    where: { acronym: seed.acronym },
    update: {
      name: seed.name,
      reliabilityScore: seed.reliabilityScore,
      url: seed.url,
      methodology: seed.methodology,
      mandate: seed.mandate,
    },
    create: {
      name: seed.name,
      acronym: seed.acronym,
      reliabilityScore: seed.reliabilityScore,
      url: seed.url,
      methodology: seed.methodology,
      mandate: seed.mandate,
    },
  });
  return organization;
}

async function ensureRawRecord(
  prisma: PrismaService,
  organizationId: string,
  seed: ObservationSeed,
) {
  const checksumSha256 = createHash('sha256')
    .update(`seed:${seed.locator}`)
    .digest('hex');
  const existingFile = await prisma.sourceFile.findUnique({
    where: {
      organizationId_checksumSha256: { organizationId, checksumSha256 },
    },
  });
  const sourceFile =
    existingFile ??
    (await prisma.sourceFile.create({
      data: {
        organizationId,
        originalFilename: seed.filename,
        storageKey: `seed/${seed.locator}.csv`,
        format: SourceFileFormat.CSV,
        mimeType: 'text/csv',
        checksumSha256,
        ingestionStatus: IngestionStatus.COMPLETED,
        recordCount: 1,
        processedAt: new Date(),
        metadata: { scenario: 'ahmad-khalil-contradiction' },
      },
    }));

  const payload = {
    name: seed.extractedName,
    birthYear: seed.birthYear,
    governorate: seed.location,
    status: seed.vitalStatus,
    date: seed.eventDate,
    notes: seed.notes,
  } satisfies Prisma.InputJsonObject;

  return prisma.rawRecord.upsert({
    where: {
      sourceFileId_sourceLocator: {
        sourceFileId: sourceFile.id,
        sourceLocator: seed.locator,
      },
    },
    update: {},
    create: {
      sourceFileId: sourceFile.id,
      organizationId,
      sourceLocator: seed.locator,
      payload,
      extractedName: seed.extractedName,
      extractedNameNormalized: foldForCompare(seed.extractedName),
      vitalStatus: seed.vitalStatus,
      location: seed.location,
      birthYear: seed.birthYear,
      eventDate: new Date(`${seed.eventDate}T00:00:00.000Z`),
    },
  });
}

async function unlinkScenario(prisma: PrismaService, rawRecordIds: string[]): Promise<void> {
  const links = await prisma.profileLinkage.findMany({
    where: { rawRecordId: { in: rawRecordIds } },
    select: { masterProfileId: true },
  });
  const profileIds = [...new Set(links.map((link) => link.masterProfileId))];
  if (rawRecordIds.length > 0) {
    await prisma.profileLinkage.deleteMany({
      where: { rawRecordId: { in: rawRecordIds } },
    });
  }
  for (const profileId of profileIds) {
    const remaining = await prisma.profileLinkage.count({
      where: { masterProfileId: profileId },
    });
    if (remaining === 0) {
      await prisma.masterProfile.delete({ where: { id: profileId } });
    }
  }
}

function printScenario(
  publishers: Array<{ acronym: string; name: string; reliabilityScore: number; methodology: string | null }>,
  decisions: MatchDecision[],
  report: ConflictReport,
  hasConflict: boolean,
  profileStatus: string,
  linkages: Array<{
    conflictFlag: boolean;
    confidenceScore: number;
    rawRecord: {
      extractedName: string | null;
      vitalStatus: VitalStatus;
      eventDate: Date | null;
      organization: { acronym: string | null; name: string };
    };
  }>,
): void {
  const lines = [
    '',
    'Ahmad Al-Khalil / Ahmad Khalil',
    'Same person reported dead in 2015 and alive in 2019',
    '',
    'Organizations',
  ];

  for (const organization of publishers) {
    lines.push(
      `  ${organization.acronym.padEnd(6)} ${organization.name}`,
      `         reliability ${organization.reliabilityScore.toFixed(2)}`,
    );
    if (organization.methodology) {
      lines.push(`         methodology ${organization.methodology}`);
    }
  }

  lines.push('', 'Incoming records');
  for (let index = 0; index < observations.length; index += 1) {
    const observation = observations[index];
    const publisher = publishers[index];
    lines.push(
      `  ${observation.label}  ${publisher.acronym.padEnd(6)} ${observation.eventDate}  ${observation.extractedName.padEnd(18)} born ${observation.birthYear}  ${observation.location}  ${observation.vitalStatus}`,
      `     ${observation.notes}`,
    );
  }

  lines.push('', 'MatchingService.linkRecordToProfile');
  observations.forEach((observation, index) => {
    const decision = decisions[index];
    lines.push(
      `  ${observation.label}  ${decision.decision.padEnd(22)} confidence ${decision.confidence.toFixed(2)}  profile ${decision.masterProfileId}`,
    );
  });

  lines.push(
    '',
    'detectConflicts',
    `  masterId: ${report.masterId}`,
    `  conflictDetected: ${report.conflictDetected}`,
    `  MasterProfile.hasConflict: ${hasConflict}`,
    `  profileStatus: ${profileStatus}`,
    '  contradictions:',
  );
  for (const entry of report.contradictions) {
    lines.push(`    - ${entry.date ?? 'undated'}  ${entry.org.padEnd(6)} ${entry.status}`);
  }
  lines.push('  linkage conflict flags:');
  for (const linkage of linkages) {
    const organization = linkage.rawRecord.organization.acronym ?? linkage.rawRecord.organization.name;
    lines.push(
      `    - ${organization.padEnd(6)} ${linkage.rawRecord.extractedName ?? 'unnamed'}  conflictFlag ${linkage.conflictFlag}  confidence ${linkage.confidenceScore.toFixed(2)}`,
    );
  }
  lines.push('');
  console.log(lines.join('\n'));
}

function assertReport(
  report: ConflictReport,
  hasConflict: boolean,
  linkages: Array<{ conflictFlag: boolean }>,
): void {
  const hasSnhr = report.contradictions.some(
    (entry) => entry.org === 'SNHR' && entry.status === VitalStatus.DECEASED && entry.date === '2015',
  );
  const hasUnhcr = report.contradictions.some(
    (entry) => entry.org === 'UNHCR' && entry.status === VitalStatus.ALIVE && entry.date === '2019',
  );
  if (!report.conflictDetected || !hasConflict || !hasSnhr || !hasUnhcr) {
    throw new Error(
      'Conflict detection did not flag SNHR DECEASED (2015) against UNHCR ALIVE (2019)',
    );
  }
  if (linkages.length < 2 || linkages.some((linkage) => !linkage.conflictFlag)) {
    throw new Error('Profile linkage conflict flags were not set');
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
