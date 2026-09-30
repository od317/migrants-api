import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { rethrowPrisma } from '../common/prisma-errors';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateOrganizationDto) {
    return this.prisma.organization.create({ data: dto }).catch((error: unknown) =>
      rethrowPrisma(error, {
        notFound: 'Organization not found',
        conflict: 'An organization with this acronym already exists',
      }),
    );
  }

  findAll(skip: number, take: number) {
    return this.prisma.organization.findMany({
      skip,
      take,
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id },
    });
    if (!organization) {
      throw new NotFoundException('Organization not found');
    }
    return organization;
  }

  update(id: string, dto: UpdateOrganizationDto) {
    return this.prisma.organization
      .update({ where: { id }, data: dto })
      .catch((error: unknown) =>
        rethrowPrisma(error, {
          notFound: 'Organization not found',
          conflict: 'An organization with this acronym already exists',
        }),
      );
  }
}
