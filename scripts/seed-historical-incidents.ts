import 'dotenv/config';
import { createHash } from 'node:crypto';
import {
  EvidenceType,
  IngestionStatus,
  Prisma,
  PrismaClient,
  SourceFileFormat,
  VitalStatus,
} from '@prisma/client';

const prisma = new PrismaClient();

const SOURCE_CHECKSUM = createHash('sha256')
  .update('historical-migration-tragedies-v1')
  .digest('hex');

type OrganizationSeed = {
  acronym: string;
  name: string;
  url: string;
  reliabilityScore: number;
  mandate: string;
};

type ClaimSeed = {
  organizationAcronym: string;
  reportedDead?: number;
  reportedMissing?: number;
  reportedSurvivors?: number;
  summary: string;
  sourceUrl?: string;
};

type EvidenceSeed = {
  type: EvidenceType;
  title: string;
  description: string;
  submittedBy: string;
  fileUrl?: string;
};

type IncidentSeed = {
  sourceLocator: string;
  date: string;
  location: string;
  latitude: number;
  longitude: number;
  metadata: {
    route: string;
    vesselType: string;
    causeOfDeath?: string;
  };
  claim: ClaimSeed;
  evidence?: EvidenceSeed;
};

const ORGANIZATIONS: OrganizationSeed[] = [
  {
    acronym: 'IOM',
    name: 'International Organization for Migration',
    url: 'https://www.iom.int/',
    reliabilityScore: 0.8,
    mandate: 'Tracks missing migrants and compiles incident-level casualty figures.',
  },
  {
    acronym: 'STATEWATCH',
    name: 'Statewatch',
    url: 'https://www.statewatch.org/',
    reliabilityScore: 0.85,
    mandate: 'Publishes investigative reporting on European migration policy and border deaths.',
  },
  {
    acronym: 'SOS',
    name: 'SOS Méditerranée',
    url: 'https://www.sosmediterranee.org/',
    reliabilityScore: 0.85,
    mandate: 'Runs search-and-rescue operations and documents Mediterranean shipwrecks.',
  },
];

const INCIDENTS: IncidentSeed[] = [
  {
    sourceLocator: 'HIST-2013-10-11',
    date: '2013-10-11',
    location: 'Zuwara, Libya',
    latitude: 33.1,
    longitude: 12.0,
    metadata: { route: 'Central Mediterranean', vesselType: 'Fishing Boat' },
    claim: {
      organizationAcronym: 'IOM',
      reportedDead: 200,
      summary:
        'Over 400 passengers on board, 200 dead including 60 children. 147 survivors.',
    },
    evidence: {
      type: EvidenceType.INVESTIGATIVE_REPORT,
      title: 'Statewatch Investigation',
      description:
        'Boat fired upon by Libyan militia; delayed rescue response from Italy and Malta.',
      submittedBy: 'Statewatch',
    },
  },
  {
    sourceLocator: 'HIST-2015-04-18',
    date: '2015-04-18',
    location: 'Garabulli / Channel of Sicily',
    latitude: 35.03,
    longitude: 14.6777,
    metadata: { route: 'Central Mediterranean', vesselType: '27m Wooden Boat' },
    claim: {
      organizationAcronym: 'IOM',
      reportedDead: 750,
      reportedMissing: 272,
      reportedSurvivors: 28,
      summary:
        'Deadliest shipwreck in modern Mediterranean history. Capsized during rescue attempt by Portuguese container ship.',
    },
  },
  {
    sourceLocator: 'HIST-2015-08-27',
    date: '2015-08-27',
    location: 'Zuwara coast',
    latitude: 33.0,
    longitude: 12.1,
    metadata: {
      route: 'Central Mediterranean',
      vesselType: 'Wooden Boat',
      causeOfDeath: 'Asphyxiation/Drowning',
    },
    claim: {
      organizationAcronym: 'IOM',
      reportedDead: 200,
      summary:
        'Dozens found dead in the hull due to engine exhaust asphyxiation before the boat sank.',
    },
  },
  {
    sourceLocator: 'HIST-2023-06-14',
    date: '2023-06-14',
    location: 'Pylos SAR zone / Departed Tobruk',
    latitude: 36.04,
    longitude: 21.0,
    metadata: { route: 'Central Mediterranean', vesselType: 'Metal Fishing Vessel' },
    claim: {
      organizationAcronym: 'SOS',
      reportedDead: 600,
      reportedSurvivors: 104,
      summary:
        'Approx 750 passengers onboard including ~150 Syrians from Daraa. 35 Syrians survived.',
    },
    evidence: {
      type: EvidenceType.INVESTIGATIVE_REPORT,
      title: 'Forensic Architecture & Media Investigation',
      description: 'Greek Coast Guard attempted to tow the vessel, causing it to capsize.',
      submittedBy: 'Forensic Architecture',
    },
  },
];

async function main(): Promise<void> {
  const organizations = new Map<string, { id: string; name: string; reliabilityScore: number }>();
  for (const seed of ORGANIZATIONS) {
    const organization = await ensureOrganization(seed);
    organizations.set(seed.acronym, organization);
    console.log(`Organization ${organization.name} ready`);
  }

  const publisher = organizations.get('IOM');
  if (!publisher) {
    throw new Error('IOM organization was not created');
  }
  const sourceFile = await ensureSourceFile(publisher.id);
  console.log(`Source file ${sourceFile.id} ready`);

  for (const incident of INCIDENTS) {
    const claimOrg = organizations.get(incident.claim.organizationAcronym);
    if (!claimOrg) {
      throw new Error(`Missing organization ${incident.claim.organizationAcronym}`);
    }
    const saved = await upsertIncident(sourceFile.id, publisher.id, incident, claimOrg);
    console.log(
      `${saved.sourceLocator} ${saved.location} claims=${saved._count.claims} evidence=${saved._count.evidence}`,
    );
  }
}

async function ensureOrganization(seed: OrganizationSeed) {
  const existing = await prisma.organization.findUnique({
    where: { acronym: seed.acronym },
    select: { id: true, name: true, reliabilityScore: true },
  });
  if (existing) {
    return existing;
  }

  const byName = await prisma.organization.findFirst({
    where: { name: { equals: seed.name, mode: 'insensitive' } },
    select: { id: true, name: true, reliabilityScore: true },
  });
  if (byName) {
    return byName;
  }

  return prisma.organization.create({
    data: {
      name: seed.name,
      acronym: seed.acronym,
      url: seed.url,
      reliabilityScore: seed.reliabilityScore,
      mandate: seed.mandate,
    },
    select: { id: true, name: true, reliabilityScore: true },
  });
}

async function ensureSourceFile(organizationId: string) {
  const existing = await prisma.sourceFile.findUnique({
    where: {
      organizationId_checksumSha256: { organizationId, checksumSha256: SOURCE_CHECKSUM },
    },
    select: { id: true },
  });
  if (existing) {
    return existing;
  }

  return prisma.sourceFile.create({
    data: {
      organizationId,
      originalFilename: 'historical-migration-tragedies.json',
      storageKey: 'seed/historical-migration-tragedies.json',
      format: SourceFileFormat.JSON,
      mimeType: 'application/json',
      checksumSha256: SOURCE_CHECKSUM,
      ingestionStatus: IngestionStatus.COMPLETED,
      recordCount: INCIDENTS.length,
      processedAt: new Date(),
      metadata: { seed: 'historical-migration-tragedies' },
    },
    select: { id: true },
  });
}

async function upsertIncident(
  sourceFileId: string,
  publisherId: string,
  incident: IncidentSeed,
  claimOrg: { id: string; reliabilityScore: number },
) {
  const claim = {
    organizationId: claimOrg.id,
    reportedDead: incident.claim.reportedDead ?? null,
    reportedMissing: incident.claim.reportedMissing ?? null,
    reportedSurvivors: incident.claim.reportedSurvivors ?? null,
    reportedDate: utcDate(incident.date),
    summary: incident.claim.summary,
    sourceUrl: incident.claim.sourceUrl ?? null,
    sourceQuality: claimOrg.reliabilityScore,
  };
  const evidence = incident.evidence
    ? {
        type: incident.evidence.type,
        title: incident.evidence.title,
        description: incident.evidence.description,
        fileUrl: incident.evidence.fileUrl ?? null,
        submittedBy: incident.evidence.submittedBy,
        isVerified: true,
      }
    : null;
  const shared = {
    organizationId: publisherId,
    vitalStatus: VitalStatus.DECEASED_OR_MISSING,
    location: incident.location,
    latitude: incident.latitude,
    longitude: incident.longitude,
    eventDate: utcDate(incident.date),
    payload: incidentPayload(incident),
  };

  return prisma.rawRecord.upsert({
    where: {
      sourceFileId_sourceLocator: {
        sourceFileId,
        sourceLocator: incident.sourceLocator,
      },
    },
    create: {
      sourceFileId,
      sourceLocator: incident.sourceLocator,
      ...shared,
      claims: { create: claim },
      ...(evidence ? { evidence: { create: evidence } } : {}),
    },
    update: {
      ...shared,
      claims: { deleteMany: {}, create: claim },
      evidence: { deleteMany: {}, ...(evidence ? { create: evidence } : {}) },
    },
    select: {
      sourceLocator: true,
      location: true,
      _count: { select: { claims: true, evidence: true } },
    },
  });
}

function incidentPayload(incident: IncidentSeed): Prisma.InputJsonValue {
  const dead = incident.claim.reportedDead ?? 0;
  const missing = incident.claim.reportedMissing ?? 0;
  return {
    sourceRecordId: incident.sourceLocator,
    date: incident.date,
    location: incident.location,
    coordinates: `${incident.latitude}, ${incident.longitude}`,
    status: VitalStatus.DECEASED_OR_MISSING,
    metadata: {
      route: incident.metadata.route,
      vesselType: incident.metadata.vesselType,
      causeOfDeath: incident.metadata.causeOfDeath ?? null,
      totalCasualties: dead + missing,
    },
    sourceRow: {
      'Number of Dead': incident.claim.reportedDead ?? null,
      'Minimum Estimated Number of Missing': incident.claim.reportedMissing ?? null,
      'Number of Survivors': incident.claim.reportedSurvivors ?? null,
      'Vessel Type': incident.metadata.vesselType,
    },
  };
}

function utcDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

void main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
