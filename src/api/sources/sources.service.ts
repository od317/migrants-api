import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export type SourceOrganization = {
  id: string;
  name: string;
  acronym: string | null;
  mandate: string | null;
  methodology: string | null;
  reliabilityScore: number;
  url: string | null;
  isActive: boolean;
  rawRecordCount: number;
};

@Injectable()
export class SourcesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<SourceOrganization[]> {
    const organizations = await this.prisma.organization.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { rawRecords: true } } },
    });

    return organizations.map((organization) => ({
      id: organization.id,
      name: organization.name,
      acronym: organization.acronym,
      mandate: organization.mandate,
      methodology: organization.methodology,
      reliabilityScore: organization.reliabilityScore,
      url: organization.url,
      isActive: organization.isActive,
      rawRecordCount: organization._count.rawRecords,
    }));
  }
}
