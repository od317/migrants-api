import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { readdir, rename, rm } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, VitalStatus } from '@prisma/client';
import { diskStorage } from 'multer';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateIncidentEvidenceDto } from './dto/create-incident-evidence.dto';
import { ListIncidentsQueryDto } from './dto/list-incidents.query';

const DEFAULT_LIMIT = 50;
export const EVIDENCE_MAX_BYTES = 15 * 1024 * 1024;
export const EVIDENCE_DIR = join(process.cwd(), 'uploads', 'evidence');
const EVIDENCE_EXTENSIONS = new Set([
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.csv',
  '.xlsx',
  '.txt',
  '.doc',
  '.docx',
]);

const organizationSelect = {
  id: true,
  name: true,
  acronym: true,
  reliabilityScore: true,
  url: true,
} as const;

export function evidenceUploadOptions() {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  return {
    storage: diskStorage({
      destination: EVIDENCE_DIR,
      filename: (_req, file, callback) => {
        callback(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`);
      },
    }),
    limits: { fileSize: EVIDENCE_MAX_BYTES },
  };
}

export type IncidentItem = {
  id: string;
  sourceRecordId: string | null;
  date: string | null;
  year: number | null;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  coordinates: string | null;
  status: VitalStatus;
  route: string | null;
  causeOfDeath: string | null;
  totalCasualties: number | null;
  sourceUrl: string | null;
  sourceOrg: {
    id: string;
    name: string;
    acronym: string | null;
    reliabilityScore: number;
  };
};

export type IncidentPage = {
  total: number;
  limit: number;
  offset: number;
  data: IncidentItem[];
};

export type IncidentStats = {
  totalSyrianCasualties: number;
  incidentCount: number;
  byRoute: Array<{ route: string; casualties: number; incidents: number }>;
  topSources: Array<{
    name: string;
    reliabilityScore: number;
    incidents: number;
    casualties: number;
  }>;
};

@Injectable()
export class IncidentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListIncidentsQueryDto): Promise<IncidentPage> {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const offset = query.offset ?? 0;
    const where = this.buildWhere(query);

    const [total, records] = await Promise.all([
      this.prisma.rawRecord.count({ where }),
      this.prisma.rawRecord.findMany({
        where,
        skip: offset,
        take: limit,
        orderBy: [{ eventDate: 'desc' }, { sourceLocator: 'asc' }],
        include: {
          organization: {
            select: { id: true, name: true, acronym: true, reliabilityScore: true },
          },
        },
      }),
    ]);

    return {
      total,
      limit,
      offset,
      data: records.map((record) => {
        const metadata = readMetadata(record.payload);
        const coordinates = readCoordinatesText(record.payload);
        return {
          id: record.id,
          sourceRecordId: record.sourceLocator,
          date: record.eventDate ? record.eventDate.toISOString().slice(0, 10) : metadata.date,
          year: record.eventDate ? record.eventDate.getUTCFullYear() : null,
          location: record.location,
          latitude: record.latitude,
          longitude: record.longitude,
          coordinates,
          status: record.vitalStatus,
          route: metadata.route,
          causeOfDeath: metadata.causeOfDeath,
          totalCasualties: metadata.totalCasualties,
          sourceUrl: metadata.sourceUrl,
          sourceOrg: record.organization,
        };
      }),
    };
  }

  async findOne(id: string) {
    const record = await this.prisma.rawRecord.findUnique({
      where: { id },
      include: {
        organization: {
          select: { id: true, name: true, acronym: true, reliabilityScore: true, url: true },
        },
        claims: {
          orderBy: { createdAt: 'asc' },
          include: {
            organization: {
              select: { id: true, name: true, acronym: true, reliabilityScore: true, url: true },
            },
          },
        },
        evidence: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!record) {
      throw new NotFoundException('Incident not found');
    }

    const metadata = readMetadata(record.payload);
    const sourceRow = readSourceRow(record.payload);
    const coordinates = readCoordinatesText(record.payload);
    const fileClaim = claimFromRecord(record);
    const peers = await this.peerRecords(record.id, record.eventDate, coordinates);
    const claims = dedupeClaims([
      fileClaim,
      ...peers.map((peer) => claimFromRecord(peer)),
      ...record.claims.map((claim) => ({
        id: claim.id,
        fromSourceFile: false,
        organization: claim.organization,
        reportedDead: claim.reportedDead,
        reportedMissing: claim.reportedMissing,
        reportedSurvivors: claim.reportedSurvivors,
        reportedDate: claim.reportedDate ? claim.reportedDate.toISOString().slice(0, 10) : null,
        summary: claim.summary,
        sourceUrl: claim.sourceUrl,
        sourceQuality: claim.sourceQuality,
        createdAt: claim.createdAt,
      })),
    ]);

    return {
      id: record.id,
      sourceRecordId: record.sourceLocator,
      date: fileClaim.reportedDate,
      year: record.eventDate ? record.eventDate.getUTCFullYear() : null,
      location: record.location,
      region: readText(sourceRow, ['region of incident', 'admin1', 'region']),
      latitude: record.latitude,
      longitude: record.longitude,
      coordinates,
      status: record.vitalStatus,
      route: metadata.route ?? readText(sourceRow, ['migration route', 'event_type', 'event type']),
      causeOfDeath: metadata.causeOfDeath,
      totalCasualties: metadata.totalCasualties ?? readCount(sourceRow, ['fatalities']),
      sourceUrl: metadata.sourceUrl,
      sourceOrg: record.organization,
      demographics: {
        men: readCount(sourceRow, ['number of males']),
        women: readCount(sourceRow, ['number of females']),
        children: readCount(sourceRow, ['number of children']),
      },
      claims,
      evidence: record.evidence,
      contradictions: contradict(claims),
    };
  }

  async addEvidence(
    incidentId: string,
    dto: CreateIncidentEvidenceDto,
    file?: Express.Multer.File,
  ) {
    const incident = await this.prisma.rawRecord.findUnique({
      where: { id: incidentId },
      select: { id: true },
    });
    if (!incident) {
      if (file) await rm(file.path, { force: true });
      throw new NotFoundException('Incident not found');
    }

    const extension = file ? extname(file.originalname).toLowerCase() : '';
    if (file && !EVIDENCE_EXTENSIONS.has(extension)) {
      await rm(file.path, { force: true });
      throw new BadRequestException('Attachment must be PDF, image, CSV, XLSX, or a text document');
    }

    const created = await this.prisma.incidentEvidence.create({
      data: {
        incidentId,
        type: dto.type,
        title: dto.title,
        description: dto.description,
        fileUrl: file ? null : (dto.fileUrl ?? null),
        submittedBy: dto.submittedBy ?? null,
        isVerified: false,
      },
    });

    if (!file) {
      return created;
    }

    const storedName = `${created.id}${extension}`;
    try {
      await rename(file.path, join(EVIDENCE_DIR, storedName));
    } catch (error) {
      await rm(file.path, { force: true });
      await this.prisma.incidentEvidence.delete({ where: { id: created.id } });
      throw error;
    }

    return this.prisma.incidentEvidence.update({
      where: { id: created.id },
      data: { fileUrl: `/api/incidents/${incidentId}/evidence/${created.id}/file` },
    });
  }

  async evidenceFile(incidentId: string, evidenceId: string) {
    const evidence = await this.prisma.incidentEvidence.findFirst({
      where: { id: evidenceId, incidentId },
    });
    const downloadPath = `/api/incidents/${incidentId}/evidence/${evidenceId}/file`;
    if (!evidence || evidence.fileUrl !== downloadPath) {
      throw new NotFoundException('Attachment not found');
    }
    const names = await readdir(EVIDENCE_DIR);
    const stored = names.find((name) => name.startsWith(`${evidenceId}.`) || name === evidenceId);
    if (!stored) {
      throw new NotFoundException('Attachment not found');
    }
    const absolute = resolve(EVIDENCE_DIR, stored);
    if (!absolute.startsWith(resolve(EVIDENCE_DIR))) {
      throw new NotFoundException('Attachment not found');
    }
    return { absolute, filename: stored };
  }

  private async peerRecords(
    id: string,
    eventDate: Date | null,
    coordinates: string | null,
  ) {
    if (!eventDate || !coordinates) {
      return [];
    }
    return this.prisma.rawRecord.findMany({
      where: {
        id: { not: id },
        eventDate,
        payload: { path: ['coordinates'], equals: coordinates },
      },
      include: { organization: { select: organizationSelect } },
      orderBy: { sourceLocator: 'asc' },
      take: 12,
    });
  }

  async stats(): Promise<IncidentStats> {
    const [totals, byRoute, topSources] = await Promise.all([
      this.prisma.$queryRaw<Array<{ incidents: number; casualties: number }>>`
        SELECT COUNT(*)::int AS incidents,
               COALESCE(SUM(${casualtySql}), 0)::float AS casualties
        FROM raw_records
        WHERE "vitalStatus" = 'DECEASED_OR_MISSING'::"VitalStatus"
      `,
      this.prisma.$queryRaw<Array<{ route: string; casualties: number; incidents: number }>>`
        SELECT COALESCE(NULLIF(payload #>> '{metadata,route}', ''), 'Unknown') AS route,
               COALESCE(SUM(${casualtySql}), 0)::float AS casualties,
               COUNT(*)::int AS incidents
        FROM raw_records
        WHERE "vitalStatus" = 'DECEASED_OR_MISSING'::"VitalStatus"
        GROUP BY 1
        ORDER BY casualties DESC, route ASC
      `,
      this.prisma.$queryRaw<
        Array<{
          name: string;
          reliabilityScore: number;
          incidents: number;
          casualties: number;
        }>
      >`
        SELECT o.name,
               o."reliabilityScore" AS "reliabilityScore",
               COUNT(r.id)::int AS incidents,
               COALESCE(SUM(${casualtySqlOn('r')}), 0)::float AS casualties
        FROM raw_records r
        JOIN organizations o ON o.id = r."organizationId"
        WHERE r."vitalStatus" = 'DECEASED_OR_MISSING'::"VitalStatus"
        GROUP BY o.id, o.name, o."reliabilityScore"
        ORDER BY incidents DESC, casualties DESC, o.name ASC
        LIMIT 5
      `,
    ]);

    return {
      totalSyrianCasualties: Number(totals[0]?.casualties ?? 0),
      incidentCount: Number(totals[0]?.incidents ?? 0),
      byRoute: byRoute.map((row) => ({
        route: row.route,
        casualties: Number(row.casualties),
        incidents: Number(row.incidents),
      })),
      topSources: topSources.map((row) => ({
        name: row.name,
        reliabilityScore: Number(row.reliabilityScore),
        incidents: Number(row.incidents),
        casualties: Number(row.casualties),
      })),
    };
  }

  private buildWhere(query: ListIncidentsQueryDto): Prisma.RawRecordWhereInput {
    const filters: Prisma.RawRecordWhereInput[] = [
      { vitalStatus: VitalStatus.DECEASED_OR_MISSING },
    ];
    if (query.route) {
      filters.push({
        payload: { path: ['metadata', 'route'], string_contains: query.route },
      });
    }
    if (query.year != null) {
      filters.push({
        eventDate: {
          gte: new Date(Date.UTC(query.year, 0, 1)),
          lt: new Date(Date.UTC(query.year + 1, 0, 1)),
        },
      });
    }
    if (query.sourceOrg) {
      filters.push({
        organization: { name: { contains: query.sourceOrg, mode: 'insensitive' } },
      });
    }
    if (query.search) {
      filters.push({
        location: { contains: query.search, mode: 'insensitive' },
      });
    }
    return { AND: filters };
  }
}

const casualtySql = Prisma.sql`COALESCE(NULLIF(payload #>> '{metadata,totalCasualties}', '')::numeric, 0)`;

function casualtySqlOn(alias: string): Prisma.Sql {
  return Prisma.sql`COALESCE(NULLIF(${Prisma.raw(`${alias}.payload`)} #>> '{metadata,totalCasualties}', '')::numeric, 0)`;
}

type IncidentMetadata = {
  date: string | null;
  route: string | null;
  causeOfDeath: string | null;
  totalCasualties: number | null;
  sourceUrl: string | null;
};

function readMetadata(payload: Prisma.JsonValue): IncidentMetadata {
  const root = asObject(payload);
  const metadata = asObject(root?.metadata);
  const casualties = metadata?.totalCasualties;
  return {
    date: typeof root?.date === 'string' ? root.date : null,
    route: typeof metadata?.route === 'string' ? metadata.route : null,
    causeOfDeath: typeof metadata?.causeOfDeath === 'string' ? metadata.causeOfDeath : null,
    totalCasualties: typeof casualties === 'number' ? casualties : null,
    sourceUrl: typeof metadata?.sourceUrl === 'string' ? metadata.sourceUrl : null,
  };
}

function readCoordinatesText(payload: Prisma.JsonValue): string | null {
  const root = asObject(payload);
  return typeof root?.coordinates === 'string' ? root.coordinates : null;
}

type ClaimNumbers = {
  organization: { id: string; name: string };
  reportedDead: number | null;
  reportedMissing: number | null;
  reportedSurvivors: number | null;
  reportedDate: string | null;
};

function contradict(claims: ClaimNumbers[]) {
  const fields = ['reportedDead', 'reportedMissing', 'reportedSurvivors', 'reportedDate'] as const;
  const disagreements = fields.flatMap((field) => {
    const present = claims.filter((claim) => claim[field] != null);
    const distinct = new Set(present.map((claim) => String(claim[field])));
    if (distinct.size < 2) {
      return [];
    }
    return [
      {
        field,
        values: present.map((claim) => ({
          organizationId: claim.organization.id,
          organizationName: claim.organization.name,
          value: claim[field],
        })),
      },
    ];
  });
  return { detected: disagreements.length > 0, disagreements };
}

function fileSummary(metadata: IncidentMetadata, location: string | null): string {
  const parts = [metadata.causeOfDeath, location].filter((part): part is string => Boolean(part));
  return parts.join(' — ') || 'Reported in the source file';
}

type SourceClaimRecord = {
  id: string;
  payload: Prisma.JsonValue;
  location: string | null;
  eventDate: Date | null;
  ingestedAt: Date;
  organization: {
    id: string;
    name: string;
    acronym: string | null;
    reliabilityScore: number;
    url: string | null;
  };
};

function claimFromRecord(record: SourceClaimRecord) {
  const metadata = readMetadata(record.payload);
  const sourceRow = readSourceRow(record.payload);
  const notes = readText(sourceRow, ['notes']);
  const summary = [fileSummary(metadata, record.location), notes && notes !== metadata.causeOfDeath ? notes : null]
    .filter((part): part is string => Boolean(part))
    .join('\n');
  return {
    id: record.id,
    fromSourceFile: true,
    organization: record.organization,
    reportedDead: readCount(sourceRow, ['number of dead', 'total dead', 'fatalities']),
    reportedMissing: readCount(sourceRow, [
      'minimum estimated number of missing',
      'number of missing',
      'total missing',
    ]),
    reportedSurvivors: readCount(sourceRow, ['number of survivors', 'total survivors']),
    reportedDate: record.eventDate ? record.eventDate.toISOString().slice(0, 10) : metadata.date,
    summary: summary || 'Reported in the source file',
    sourceUrl: metadata.sourceUrl ?? readText(sourceRow, ['url', 'source_url']),
    sourceQuality: record.organization.reliabilityScore,
    createdAt: record.ingestedAt,
  };
}

function dedupeClaims<T extends ClaimNumbers & { summary: string; sourceUrl: string | null }>(claims: T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const claim of claims) {
    const key = [
      claim.organization.id,
      claim.reportedDead,
      claim.reportedMissing,
      claim.reportedSurvivors,
      claim.reportedDate,
      claim.summary,
      claim.sourceUrl,
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(claim);
  }
  return unique;
}

function readText(row: Record<string, unknown> | null, names: string[]): string | null {
  if (!row) return null;
  const indexed = new Map<string, unknown>();
  for (const [key, value] of Object.entries(row)) {
    indexed.set(key.trim().toLowerCase(), value);
  }
  for (const name of names) {
    const value = indexed.get(name);
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function readSourceRow(payload: Prisma.JsonValue): Record<string, unknown> | null {
  const root = asObject(payload);
  return asObject(root?.sourceRow);
}

function readCount(row: Record<string, unknown> | null, names: string[]): number | null {
  if (!row) {
    return null;
  }
  const indexed = new Map<string, unknown>();
  for (const [key, value] of Object.entries(row)) {
    indexed.set(key.trim().toLowerCase(), value);
  }
  for (const name of names) {
    const value = indexed.get(name);
    const parsed =
      typeof value === 'number'
        ? value
        : typeof value === 'string' && value.trim()
          ? Number(value.replace(/,/g, '').trim())
          : Number.NaN;
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.trunc(parsed);
    }
  }
  return null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}
