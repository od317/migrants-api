import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type ReportRecord = {
  id: string;
  originalFilename: string;
  publisher: string;
  acronym: string | null;
  mandate: string | null;
  reliabilityScore: number;
  recordCount: number;
  ingestionStatus: string;
  format: string;
  adapter: string | null;
};

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<ReportRecord[]> {
    const files = await this.prisma.sourceFile.findMany({
      include: { organization: true },
      orderBy: [{ recordCount: 'desc' }, { originalFilename: 'asc' }],
    });

    return files.map((file) => ({
      id: file.id,
      originalFilename: file.originalFilename,
      publisher: file.organization.name,
      acronym: file.organization.acronym,
      mandate: file.organization.mandate,
      reliabilityScore: file.organization.reliabilityScore,
      recordCount: file.recordCount,
      ingestionStatus: file.ingestionStatus,
      format: file.format,
      adapter: readAdapter(file.metadata),
    }));
  }
}

function readAdapter(metadata: Prisma.JsonValue | null): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }
  const adapter = (metadata as Record<string, unknown>).adapter;
  return typeof adapter === 'string' ? adapter : null;
}
