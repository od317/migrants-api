import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProfileStatus, VitalStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { deriveProfileStatus } from './resolve-fields';
import { claimsContradict, contradictingIds } from './conflict';

export type ContradictionEntry = {
  org: string;
  status: VitalStatus;
  date: string | null;
};

export type ConflictReport = {
  masterId: string;
  conflictDetected: boolean;
  contradictions: ContradictionEntry[];
};

const linkageInclude = {
  rawRecord: {
    include: { organization: true },
  },
} satisfies Prisma.ProfileLinkageInclude;

type LinkedRecord = Prisma.ProfileLinkageGetPayload<{
  include: typeof linkageInclude;
}>;

@Injectable()
export class RecordLinkageService {
  constructor(private readonly prisma: PrismaService) {}

  async detectConflicts(masterProfileId: string): Promise<ConflictReport> {
    const profile = await this.prisma.masterProfile.findUnique({
      where: { id: masterProfileId },
      include: { linkages: { include: linkageInclude } },
    });
    if (!profile) {
      throw new NotFoundException('Master profile not found');
    }

    const claims = profile.linkages.map((linkage) => ({
      id: linkage.rawRecord.id,
      vitalStatus: linkage.rawRecord.vitalStatus,
      eventDate: linkage.rawRecord.eventDate,
    }));
    const conflictingIds = contradictingIds(claims);
    const conflictDetected = conflictingIds.size > 0;
    const contradictions = profile.linkages
      .filter((linkage) => conflictingIds.has(linkage.rawRecord.id))
      .map((linkage) => toEntry(linkage))
      .sort(byDateThenOrg);

    await this.prisma.$transaction(async (tx) => {
      await Promise.all(
        profile.linkages.map((linkage) =>
          tx.profileLinkage.update({
            where: { id: linkage.id },
            data: {
              conflictFlag: conflictingIds.has(linkage.rawRecord.id),
              conflictReason: conflictReason(linkage, profile.linkages, conflictingIds),
            },
          }),
        ),
      );
      await tx.masterProfile.update({
        where: { id: profile.id },
        data: {
          hasConflict: conflictDetected,
          profileStatus: conflictDetected
            ? ProfileStatus.DISPUTED
            : deriveProfileStatus(
                false,
                profile.linkages.map((linkage) => linkage.confidenceScore),
              ),
        },
      });
    });

    return {
      masterId: profile.id,
      conflictDetected,
      contradictions,
    };
  }
}

function toEntry(linkage: LinkedRecord): ContradictionEntry {
  const organization = linkage.rawRecord.organization;
  return {
    org: organization.acronym ?? organization.name,
    status: linkage.rawRecord.vitalStatus,
    date: eventYear(linkage.rawRecord.eventDate),
  };
}

function eventYear(value: Date | null): string | null {
  if (!value) {
    return null;
  }
  return String(value.getUTCFullYear());
}

function byDateThenOrg(left: ContradictionEntry, right: ContradictionEntry): number {
  if (left.date === right.date) {
    return left.org.localeCompare(right.org);
  }
  if (left.date === null) {
    return 1;
  }
  if (right.date === null) {
    return -1;
  }
  return left.date.localeCompare(right.date);
}

function conflictReason(
  linkage: LinkedRecord,
  linkages: LinkedRecord[],
  conflictingIds: Set<string>,
): string | null {
  if (!conflictingIds.has(linkage.rawRecord.id)) {
    return null;
  }

  const reasons = linkages
    .filter(
      (other) =>
        other.rawRecord.id !== linkage.rawRecord.id &&
        conflictingIds.has(other.rawRecord.id) &&
        claimsContradict(linkage.rawRecord, other.rawRecord),
    )
    .map((other) => {
      const org = other.rawRecord.organization.acronym ?? other.rawRecord.organization.name;
      const date = eventYear(other.rawRecord.eventDate) ?? 'undated';
      return `${linkage.rawRecord.vitalStatus} contradicts ${org} ${other.rawRecord.vitalStatus} (${date})`;
    });

  return reasons.length > 0 ? reasons.join(' | ') : null;
}
