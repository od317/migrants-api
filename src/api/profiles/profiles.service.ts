import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProfileStatus, VitalStatus } from '@prisma/client';
import { normalizePersonName } from '../../matching/normalize-name';
import { PrismaService } from '../../prisma/prisma.service';
import { ConflictReport, RecordLinkageService } from '../../resolution/record-linkage.service';
import { SearchProfilesQueryDto } from './dto/search-profiles.query';

const DEFAULT_LIMIT = 50;
const ARABIC_MARKS = '[\u064B-\u065F\u0670]';

export type ProfileSummary = {
  id: string;
  canonicalName: string | null;
  knownNames: string[];
  resolvedStatus: VitalStatus;
  resolvedLocation: string | null;
  resolvedBirthYear: number | null;
  profileStatus: ProfileStatus;
  hasConflict: boolean;
  linkedSourceCount: number;
  linkedOrganizationCount: number;
  confidenceAverage: number | null;
};

export type ProfileSearchPage = {
  total: number;
  limit: number;
  offset: number;
  data: ProfileSummary[];
};

type LinkedObservation = {
  linkageId: string;
  confidenceScore: number;
  conflictFlag: boolean;
  conflictReason: string | null;
  matchMethod: string;
  reviewStatus: string;
  linkedAt: Date;
  rawRecord: {
    id: string;
    sourceLocator: string | null;
    extractedName: string | null;
    vitalStatus: VitalStatus;
    location: string | null;
    latitude: number | null;
    longitude: number | null;
    birthYear: number | null;
    eventDate: Date | null;
    reportedAt: Date | null;
    ingestedAt: Date;
    payload: Prisma.JsonValue;
  };
  organization: {
    id: string;
    name: string;
    acronym: string | null;
    reliabilityScore: number;
    url: string | null;
  };
  source: {
    organizationId: string;
    organizationName: string;
    acronym: string | null;
    reliabilityScore: number;
    url: string | null;
    sourceFileId: string;
    originalFilename: string;
    format: string;
  };
};

export type TimelineGroup = {
  year: string | null;
  records: LinkedObservation[];
};

export type ProfileDetail = {
  id: string;
  canonicalName: string | null;
  knownNames: string[];
  resolvedStatus: VitalStatus;
  resolvedLocation: string | null;
  resolvedBirthYear: number | null;
  resolvedEventDate: Date | null;
  profileStatus: ProfileStatus;
  hasConflict: boolean;
  fieldProvenance: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
  linkages: LinkedObservation[];
  timeline: TimelineGroup[];
  contradictions: ConflictReport | null;
};

const profileInclude = {
  linkages: {
    include: {
      rawRecord: {
        include: {
          organization: true,
          sourceFile: true,
        },
      },
    },
  },
} satisfies Prisma.MasterProfileInclude;

@Injectable()
export class ProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recordLinkage: RecordLinkageService,
  ) {}

  async search(query: SearchProfilesQueryDto): Promise<ProfileSearchPage> {
    const offset = query.offset ?? query.skip ?? 0;
    const limit = query.limit ?? query.take ?? DEFAULT_LIMIT;
    const where = await this.buildWhere(query);

    const [total, profiles] = await Promise.all([
      this.prisma.masterProfile.count({ where }),
      this.prisma.masterProfile.findMany({
        where,
        skip: offset,
        take: limit,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      }),
    ]);

    const stats = await this.linkageStats(profiles.map((profile) => profile.id));

    return {
      total,
      limit,
      offset,
      data: profiles.map((profile) => {
        const stat = stats.get(profile.id);
        return {
          id: profile.id,
          canonicalName: profile.canonicalName,
          knownNames: profile.knownNames,
          resolvedStatus: profile.resolvedStatus,
          resolvedLocation: profile.resolvedLocation,
          resolvedBirthYear: profile.resolvedBirthYear,
          profileStatus: profile.profileStatus,
          hasConflict: profile.hasConflict,
          linkedSourceCount: stat?.count ?? 0,
          linkedOrganizationCount: stat?.organizations ?? 0,
          confidenceAverage: stat?.average ?? null,
        };
      }),
    };
  }

  async findOne(id: string): Promise<ProfileDetail> {
    const existing = await this.prisma.masterProfile.findUnique({
      where: { id },
      select: { hasConflict: true },
    });
    if (!existing) {
      throw new NotFoundException('Master profile not found');
    }

    const contradictions = existing.hasConflict
      ? await this.recordLinkage.detectConflicts(id)
      : null;

    const profile = await this.prisma.masterProfile.findUnique({
      where: { id },
      include: profileInclude,
    });
    if (!profile) {
      throw new NotFoundException('Master profile not found');
    }

    const records = profile.linkages
      .map((linkage) => ({
        linkageId: linkage.id,
        confidenceScore: linkage.confidenceScore,
        conflictFlag: linkage.conflictFlag,
        conflictReason: linkage.conflictReason,
        matchMethod: linkage.matchMethod,
        reviewStatus: linkage.reviewStatus,
        linkedAt: linkage.linkedAt,
        rawRecord: {
          id: linkage.rawRecord.id,
          sourceLocator: linkage.rawRecord.sourceLocator,
          extractedName: linkage.rawRecord.extractedName,
          vitalStatus: linkage.rawRecord.vitalStatus,
          location: linkage.rawRecord.location,
          latitude: linkage.rawRecord.latitude,
          longitude: linkage.rawRecord.longitude,
          birthYear: linkage.rawRecord.birthYear,
          eventDate: linkage.rawRecord.eventDate,
          reportedAt: linkage.rawRecord.reportedAt,
          ingestedAt: linkage.rawRecord.ingestedAt,
          payload: linkage.rawRecord.payload,
        },
        organization: {
          id: linkage.rawRecord.organization.id,
          name: linkage.rawRecord.organization.name,
          acronym: linkage.rawRecord.organization.acronym,
          reliabilityScore: linkage.rawRecord.organization.reliabilityScore,
          url: linkage.rawRecord.organization.url,
        },
        source: {
          organizationId: linkage.rawRecord.organization.id,
          organizationName: linkage.rawRecord.organization.name,
          acronym: linkage.rawRecord.organization.acronym,
          reliabilityScore: linkage.rawRecord.organization.reliabilityScore,
          url: linkage.rawRecord.organization.url,
          sourceFileId: linkage.rawRecord.sourceFile.id,
          originalFilename: linkage.rawRecord.sourceFile.originalFilename,
          format: linkage.rawRecord.sourceFile.format,
        },
      }))
      .sort(byEventThenReport);

    return {
      id: profile.id,
      canonicalName: profile.canonicalName,
      knownNames: profile.knownNames,
      resolvedStatus: profile.resolvedStatus,
      resolvedLocation: profile.resolvedLocation,
      resolvedBirthYear: profile.resolvedBirthYear,
      resolvedEventDate: profile.resolvedEventDate,
      profileStatus: profile.profileStatus,
      hasConflict: profile.hasConflict,
      fieldProvenance: profile.fieldProvenance,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
      linkages: records,
      timeline: groupChronologically(records),
      contradictions,
    };
  }

  private async buildWhere(
    query: SearchProfilesQueryDto,
  ): Promise<Prisma.MasterProfileWhereInput> {
    const filters: Prisma.MasterProfileWhereInput[] = [];

    const name = query.query ?? query.name;
    if (name) {
      const ids = await this.profileIdsMatchingName(name);
      filters.push({ id: { in: ids } });
    }

    if (query.governorate) {
      filters.push({
        resolvedLocation: { contains: query.governorate, mode: 'insensitive' },
      });
    }
    if (query.yearOfBirth != null) {
      filters.push({ resolvedBirthYear: query.yearOfBirth });
    }
    if (query.status) {
      filters.push({ resolvedStatus: query.status });
    }
    if (query.hasConflict != null) {
      filters.push({ hasConflict: query.hasConflict });
    }

    return filters.length > 0 ? { AND: filters } : {};
  }

  private async profileIdsMatchingName(term: string): Promise<string[]> {
    const rawPattern = `%${escapeLike(term)}%`;
    const folded = normalizePersonName(term);
    const foldedPattern = folded ? `%${escapeLike(folded)}%` : null;
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM master_profiles
      WHERE "canonicalName" ILIKE ${rawPattern} ESCAPE '\\'
         OR EXISTS (
           SELECT 1
           FROM unnest("knownNames") AS known
           WHERE known ILIKE ${rawPattern} ESCAPE '\\'
         )
         OR (
           ${foldedPattern}::text IS NOT NULL
           AND (
             ${foldedName(Prisma.sql`"canonicalName"`)} ILIKE ${foldedPattern} ESCAPE '\\'
             OR EXISTS (
               SELECT 1
               FROM unnest("knownNames") AS known
               WHERE ${foldedName(Prisma.sql`known`)} ILIKE ${foldedPattern} ESCAPE '\\'
             )
           )
         )
    `);
    return rows.map((row) => row.id);
  }

  private async linkageStats(
    profileIds: string[],
  ): Promise<Map<string, { count: number; organizations: number; average: number | null }>> {
    const stats = new Map<string, { count: number; organizations: number; average: number | null }>();
    if (profileIds.length === 0) {
      return stats;
    }

    const aggregates = await this.prisma.$queryRaw<
      Array<{ id: string; links: number; organizations: number; average: number | null }>
    >(Prisma.sql`
      SELECT l."masterProfileId" AS id,
             COUNT(*)::int AS links,
             COUNT(DISTINCT r."organizationId")::int AS organizations,
             AVG(l."confidenceScore")::float AS average
      FROM profile_linkages l
      JOIN raw_records r ON r.id = l."rawRecordId"
      WHERE l."masterProfileId" IN (${Prisma.join(profileIds.map((id) => Prisma.sql`${id}::uuid`))})
      GROUP BY l."masterProfileId"
    `);

    for (const aggregate of aggregates) {
      stats.set(aggregate.id, {
        count: aggregate.links,
        organizations: aggregate.organizations,
        average: aggregate.average == null ? null : roundAverage(Number(aggregate.average)),
      });
    }
    return stats;
  }
}

function foldedName(expression: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    btrim(regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              translate(lower(coalesce(${expression}, '')), 'أإآٱةىـ', 'ااااهي '),
              ${ARABIC_MARKS},
              '',
              'g'
            ),
            '[^[:alnum:][:space:]]',
            ' ',
            'g'
          ),
          '\\s+',
          ' ',
          'g'
        ),
        '(^|\\s)ال',
        '\\1',
        'g'
      ),
      '(^|\\s)(al|el)(\\s|$)',
      '\\1',
      'g'
    ))
  `;
}

function groupChronologically(records: LinkedObservation[]): TimelineGroup[] {
  const sorted = [...records].sort(byEventThenReport);
  const groups = new Map<string | null, LinkedObservation[]>();
  for (const record of sorted) {
    const year = record.rawRecord.eventDate
      ? String(record.rawRecord.eventDate.getUTCFullYear())
      : null;
    const bucket = groups.get(year);
    if (bucket) {
      bucket.push(record);
    } else {
      groups.set(year, [record]);
    }
  }
  return [...groups.entries()].map(([year, grouped]) => ({
    year,
    records: grouped,
  }));
}

function byEventThenReport(left: LinkedObservation, right: LinkedObservation): number {
  const leftEvent = left.rawRecord.eventDate?.getTime() ?? Number.POSITIVE_INFINITY;
  const rightEvent = right.rawRecord.eventDate?.getTime() ?? Number.POSITIVE_INFINITY;
  if (leftEvent !== rightEvent) {
    return leftEvent - rightEvent;
  }
  const leftReported = left.rawRecord.reportedAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const rightReported = right.rawRecord.reportedAt?.getTime() ?? Number.POSITIVE_INFINITY;
  if (leftReported !== rightReported) {
    return leftReported - rightReported;
  }
  return left.rawRecord.ingestedAt.getTime() - right.rawRecord.ingestedAt.getTime();
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function roundAverage(value: number): number {
  return Math.round(value * 10000) / 10000;
}
