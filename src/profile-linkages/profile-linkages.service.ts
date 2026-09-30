import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProfileLinkagesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(skip: number, take: number, masterProfileId?: string) {
    return this.prisma.profileLinkage.findMany({
      skip,
      take,
      where: masterProfileId ? { masterProfileId } : undefined,
      orderBy: { linkedAt: 'desc' },
      include: {
        rawRecord: {
          select: {
            id: true,
            extractedName: true,
            vitalStatus: true,
            location: true,
            eventDate: true,
            organizationId: true,
          },
        },
      },
    });
  }

  async findOne(id: string) {
    const linkage = await this.prisma.profileLinkage.findUnique({
      where: { id },
      include: { rawRecord: true, masterProfile: true },
    });
    if (!linkage) {
      throw new NotFoundException('Linkage not found');
    }
    return linkage;
  }
}
