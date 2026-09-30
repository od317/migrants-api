import { Injectable, NotFoundException } from '@nestjs/common';
import { IngestionStatus, Prisma } from '@prisma/client';
import { rethrowPrisma } from '../common/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSourceFileDto } from './dto/create-source-file.dto';
import { UpdateIngestionDto } from './dto/update-ingestion.dto';

@Injectable()
export class SourceFilesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateSourceFileDto) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: dto.organizationId },
    });
    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    return this.prisma.sourceFile
      .create({
        data: {
          organizationId: dto.organizationId,
          originalFilename: dto.originalFilename,
          storageKey: dto.storageKey,
          format: dto.format,
          mimeType: dto.mimeType,
          checksumSha256: dto.checksumSha256.toLowerCase(),
          byteSize: dto.byteSize,
          metadata: dto.metadata as Prisma.InputJsonValue | undefined,
        },
      })
      .catch((error: unknown) =>
        rethrowPrisma(error, {
          notFound: 'Source file not found',
          conflict: 'This file was already ingested for the organization',
        }),
      );
  }

  findAll(skip: number, take: number, organizationId?: string) {
    return this.prisma.sourceFile.findMany({
      skip,
      take,
      where: organizationId ? { organizationId } : undefined,
      orderBy: { uploadedAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const sourceFile = await this.prisma.sourceFile.findUnique({
      where: { id },
    });
    if (!sourceFile) {
      throw new NotFoundException('Source file not found');
    }
    return sourceFile;
  }

  updateIngestion(id: string, dto: UpdateIngestionDto) {
    const finished =
      dto.ingestionStatus === IngestionStatus.COMPLETED ||
      dto.ingestionStatus === IngestionStatus.FAILED;

    return this.prisma.sourceFile
      .update({
        where: { id },
        data: {
          ingestionStatus: dto.ingestionStatus,
          recordCount: dto.recordCount,
          errorMessage: dto.errorMessage,
          processedAt: finished ? new Date() : undefined,
        },
      })
      .catch((error: unknown) =>
        rethrowPrisma(error, {
          notFound: 'Source file not found',
          conflict: 'This file was already ingested for the organization',
        }),
      );
  }
}
