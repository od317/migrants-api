import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const profileDetail = {
  linkages: {
    orderBy: { confidenceScore: 'desc' as const },
    include: {
      rawRecord: {
        include: {
          organization: {
            select: {
              id: true,
              name: true,
              acronym: true,
              reliabilityScore: true,
            },
          },
          sourceFile: {
            select: {
              id: true,
              originalFilename: true,
              format: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.MasterProfileInclude;

@Injectable()
export class MasterProfilesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(skip: number, take: number, hasConflict?: boolean) {
    return this.prisma.masterProfile.findMany({
      skip,
      take,
      where: hasConflict === undefined ? undefined : { hasConflict },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const profile = await this.prisma.masterProfile.findUnique({
      where: { id },
      include: profileDetail,
    });
    if (!profile) {
      throw new NotFoundException('Master profile not found');
    }
    return profile;
  }
}
