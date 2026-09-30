import { Injectable } from '@nestjs/common';
import { Prisma, VitalStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ListIncidentsQueryDto } from './dto/list-incidents.query';

const DEFAULT_LIMIT = 50;

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

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}
