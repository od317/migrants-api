import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MatchMethod, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { nameBlockKey, normalizePersonName } from '../matching/normalize-name';
import { assessConflicts, Observation } from './conflict';
import { LinkRecordDto } from './dto/link-record.dto';
import { OpenProfileDto } from './dto/open-profile.dto';
import { RankedObservation, resolveProfileFields } from './resolve-fields';

const profileInclude = {
  linkages: {
    include: {
      rawRecord: {
        include: {
          organization: true,
        },
      },
    },
    orderBy: { linkedAt: 'asc' as const },
  },
} satisfies Prisma.MasterProfileInclude;

type ProfileWithLinks = Prisma.MasterProfileGetPayload<{
  include: typeof profileInclude;
}>;

@Injectable()
export class ResolutionService {
  constructor(private readonly prisma: PrismaService) {}

  /** First observation defines a new person. The raw row is not edited. */
  openFromRecord(dto: OpenProfileDto): Promise<ProfileWithLinks> {
    return this.prisma.$transaction(async (tx) => {
      const raw = await tx.rawRecord.findUnique({
        where: { id: dto.rawRecordId },
      });
      if (!raw) {
        throw new NotFoundException('Raw record not found');
      }

      const existing = await tx.profileLinkage.findUnique({
        where: { rawRecordId: dto.rawRecordId },
      });
      if (existing) {
        throw new ConflictException(
          'Raw record is already linked to a master profile',
        );
      }

      const profile = await tx.masterProfile.create({ data: {} });
      await tx.profileLinkage.create({
        data: {
          masterProfileId: profile.id,
          rawRecordId: dto.rawRecordId,
          confidenceScore: 1,
          matchMethod: MatchMethod.DETERMINISTIC,
          linkedBy: dto.linkedBy,
          matchedOn: { openedFrom: dto.rawRecordId },
        },
      });

      return this.rebuild(profile.id, tx);
    });
  }

  /** Attach an existing observation to an existing person, then rebuild the golden record. */
  link(dto: LinkRecordDto): Promise<ProfileWithLinks> {
    return this.prisma.$transaction(async (tx) => {
      const [raw, profile] = await Promise.all([
        tx.rawRecord.findUnique({ where: { id: dto.rawRecordId } }),
        tx.masterProfile.findUnique({ where: { id: dto.masterProfileId } }),
      ]);
      if (!raw) {
        throw new NotFoundException('Raw record not found');
      }
      if (!profile) {
        throw new NotFoundException('Master profile not found');
      }

      try {
        await tx.profileLinkage.create({
          data: {
            masterProfileId: dto.masterProfileId,
            rawRecordId: dto.rawRecordId,
            confidenceScore: dto.confidenceScore,
            matchMethod: dto.matchMethod ?? MatchMethod.FUZZY,
            linkedBy: dto.linkedBy,
            matchedOn: dto.matchedOn as Prisma.InputJsonValue | undefined,
          },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new ConflictException(
            'Raw record is already linked to a master profile',
          );
        }
        throw error;
      }

      return this.rebuild(dto.masterProfileId, tx);
    });
  }

  /** Drop the link only. The raw record remains as evidence. */
  unlink(linkageId: string): Promise<ProfileWithLinks> {
    return this.prisma.$transaction(async (tx) => {
      const linkage = await tx.profileLinkage.findUnique({
        where: { id: linkageId },
      });
      if (!linkage) {
        throw new NotFoundException('Linkage not found');
      }

      await tx.profileLinkage.delete({ where: { id: linkageId } });
      return this.rebuild(linkage.masterProfileId, tx);
    });
  }

  recompute(masterProfileId: string): Promise<ProfileWithLinks> {
    return this.prisma.$transaction((tx) => this.rebuild(masterProfileId, tx));
  }

  private async rebuild(
    masterProfileId: string,
    client: Prisma.TransactionClient,
  ): Promise<ProfileWithLinks> {
    const profile = await client.masterProfile.findUnique({
      where: { id: masterProfileId },
      include: profileInclude,
    });
    if (!profile) {
      throw new NotFoundException('Master profile not found');
    }

    const observations: Observation[] = profile.linkages.map((linkage) => ({
      id: linkage.rawRecord.id,
      vitalStatus: linkage.rawRecord.vitalStatus,
      location: linkage.rawRecord.location,
      eventDate: linkage.rawRecord.eventDate,
    }));
    const assessment = assessConflicts(observations);

    await Promise.all(
      profile.linkages.map((linkage) =>
        client.profileLinkage.update({
          where: { id: linkage.id },
          data: {
            conflictFlag:
              assessment.byRecordId.get(linkage.rawRecord.id) != null,
            conflictReason:
              assessment.byRecordId.get(linkage.rawRecord.id) ?? null,
          },
        }),
      ),
    );

    const ranked: RankedObservation[] = profile.linkages.map((linkage) => ({
      id: linkage.rawRecord.id,
      organizationId: linkage.rawRecord.organizationId,
      reliabilityScore: linkage.rawRecord.organization.reliabilityScore,
      extractedName: linkage.rawRecord.extractedName,
      vitalStatus: linkage.rawRecord.vitalStatus,
      location: linkage.rawRecord.location,
      eventDate: linkage.rawRecord.eventDate,
      birthYear: linkage.rawRecord.birthYear,
      ingestedAt: linkage.rawRecord.ingestedAt,
    }));
    const hasConflict = [...assessment.byRecordId.values()].some(
      (reason) => reason !== null,
    );
    const resolved = resolveProfileFields(
      ranked,
      hasConflict,
      assessment.hasVitalStatusConflict,
      profile.linkages.map((linkage) => linkage.confidenceScore),
    );

    await client.masterProfile.update({
      where: { id: masterProfileId },
      data: {
        canonicalName: resolved.canonicalName,
        knownNames: resolved.knownNames,
        resolvedStatus: resolved.resolvedStatus,
        resolvedLocation: resolved.resolvedLocation,
        resolvedBirthYear: resolved.resolvedBirthYear,
        nameBlockKey: nameBlockKey(normalizePersonName(resolved.canonicalName)),
        resolvedEventDate: resolved.resolvedEventDate,
        profileStatus: resolved.profileStatus,
        hasConflict,
        fieldProvenance:
          profile.linkages.length === 0
            ? Prisma.DbNull
            : (resolved.fieldProvenance as Prisma.InputJsonValue),
      },
    });

    const rebuilt = await client.masterProfile.findUnique({
      where: { id: masterProfileId },
      include: profileInclude,
    });
    if (!rebuilt) {
      throw new NotFoundException('Master profile not found');
    }
    return rebuilt;
  }
}
