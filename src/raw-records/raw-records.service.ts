import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, VitalStatus } from '@prisma/client';
import { foldForCompare } from '../common/fold-text';
import { rethrowPrisma } from '../common/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRawRecordDto } from './dto/create-raw-record.dto';

/** Inserts source observations. Payload and extracted columns are write-once. */
@Injectable()
export class RawRecordsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateRawRecordDto) {
    return this.prisma.$transaction(async (tx) => {
      const sourceFile = await tx.sourceFile.findUnique({
        where: { id: dto.sourceFileId },
      });
      if (!sourceFile) {
        throw new NotFoundException('Source file not found');
      }

      try {
        const record = await tx.rawRecord.create({
          data: {
            sourceFileId: sourceFile.id,
            organizationId: sourceFile.organizationId,
            sourceLocator: dto.sourceLocator,
            payload: dto.payload as Prisma.InputJsonValue,
            extractedName: dto.extractedName,
            extractedNameNormalized: foldForCompare(dto.extractedName),
            vitalStatus: dto.vitalStatus ?? VitalStatus.UNKNOWN,
            location: dto.location,
            eventDate: dto.eventDate ? asUtcDate(dto.eventDate) : null,
            reportedAt: dto.reportedAt ? new Date(dto.reportedAt) : null,
          },
        });

        await tx.sourceFile.update({
          where: { id: sourceFile.id },
          data: { recordCount: { increment: 1 } },
        });

        return record;
      } catch (error) {
        rethrowPrisma(error, {
          notFound: 'Raw record not found',
          conflict:
            'A raw record with this source locator already exists for the file',
        });
      }
    });
  }

  findAll(skip: number, take: number, sourceFileId?: string) {
    return this.prisma.rawRecord.findMany({
      skip,
      take,
      where: sourceFileId ? { sourceFileId } : undefined,
      orderBy: { ingestedAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const record = await this.prisma.rawRecord.findUnique({
      where: { id },
      include: { sourceFile: true, organization: true, linkage: true },
    });
    if (!record) {
      throw new NotFoundException('Raw record not found');
    }
    return record;
  }
}

function asUtcDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}
