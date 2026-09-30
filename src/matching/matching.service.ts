import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  LinkReviewStatus,
  MatchMethod,
  Prisma,
  RawRecord,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RecordLinkageService } from '../resolution/record-linkage.service';
import { ResolutionService } from '../resolution/resolution.service';
import { birthYearFromPayload } from './birth-year';
import {
  calculateMatchScore as scorePair,
  MatchableProfile,
  MatchScore,
} from './match-score';
import { MATCH_WEIGHTS } from './match-weights';
import { nameBlockKey, normalizePersonName } from './normalize-name';

export type MatchDecisionKind =
  | 'AUTO_LINKED'
  | 'PENDING_HUMAN_REVIEW'
  | 'CREATED_PROFILE';

export type MatchDecision = {
  rawRecordId: string;
  decision: MatchDecisionKind;
  masterProfileId: string;
  confidence: number;
  score: MatchScore | null;
};

type StoredRecord = RawRecord;

@Injectable()
export class MatchingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolution: ResolutionService,
    private readonly recordLinkage: RecordLinkageService,
  ) {}

  calculateMatchScore(
    rawRecord: StoredRecord,
    masterProfile: MatchableProfile,
  ): MatchScore {
    return scorePair(
      {
        extractedName: rawRecord.extractedName,
        birthYear: effectiveBirthYear(rawRecord),
        location: rawRecord.location,
      },
      masterProfile,
    );
  }

  async linkRecordToProfile(rawRecordId: string): Promise<MatchDecision> {
    const rawRecord = await this.prisma.rawRecord.findUnique({
      where: { id: rawRecordId },
      include: { linkage: true },
    });
    if (!rawRecord) {
      throw new NotFoundException('Raw record not found');
    }
    if (rawRecord.linkage) {
      throw new ConflictException('Raw record is already linked to a master profile');
    }

    const birthYear = effectiveBirthYear(rawRecord);
    const blockKey = nameBlockKey(normalizePersonName(rawRecord.extractedName));
    const candidates = await this.findCandidates(blockKey, birthYear);

    let best: { id: string; score: MatchScore } | null = null;
    for (const candidate of candidates) {
      const score = this.calculateMatchScore(rawRecord, candidate);
      if (!best || score.confidence > best.score.confidence) {
        best = { id: candidate.id, score };
      }
    }

    if (!best || best.score.confidence < MATCH_WEIGHTS.reviewThreshold) {
      return this.openProfile(rawRecord, birthYear);
    }
    if (best.score.confidence >= MATCH_WEIGHTS.autoLinkThreshold) {
      await this.attach(rawRecord.id, best.id, best.score, LinkReviewStatus.AUTO_LINKED);
      await this.resolution.recompute(best.id);
      await this.ensureSearchKeys(best.id, birthYear);
      await this.recordLinkage.detectConflicts(best.id);
      return decision(rawRecord.id, 'AUTO_LINKED', best.id, best.score);
    }

    await this.attach(
      rawRecord.id,
      best.id,
      best.score,
      LinkReviewStatus.PENDING_HUMAN_REVIEW,
    );
    await this.resolution.recompute(best.id);
    await this.ensureSearchKeys(best.id, birthYear);
    return decision(rawRecord.id, 'PENDING_HUMAN_REVIEW', best.id, best.score);
  }

  private async findCandidates(blockKey: string | null, birthYear: number | null) {
    const filters: Prisma.MasterProfileWhereInput[] = [];
    if (blockKey) {
      filters.push({ nameBlockKey: blockKey });
    }
    if (birthYear != null) {
      filters.push({ resolvedBirthYear: birthYear });
    }
    if (filters.length === 0) {
      return [];
    }

    return this.prisma.masterProfile.findMany({
      where: { OR: filters },
      take: MATCH_WEIGHTS.candidateLimit,
      select: {
        id: true,
        canonicalName: true,
        knownNames: true,
        resolvedBirthYear: true,
        resolvedLocation: true,
      },
    });
  }

  private async openProfile(
    rawRecord: StoredRecord,
    birthYear: number | null,
  ): Promise<MatchDecision> {
    const profile = await this.resolution.openFromRecord({
      rawRecordId: rawRecord.id,
    });
    await this.ensureSearchKeys(profile.id, birthYear);
    return {
      rawRecordId: rawRecord.id,
      decision: 'CREATED_PROFILE',
      masterProfileId: profile.id,
      confidence: 1,
      score: null,
    };
  }

  private async attach(
    rawRecordId: string,
    masterProfileId: string,
    score: MatchScore,
    reviewStatus: LinkReviewStatus,
  ): Promise<void> {
    try {
      await this.prisma.profileLinkage.create({
        data: {
          masterProfileId,
          rawRecordId,
          confidenceScore: score.confidence,
          matchMethod: MatchMethod.FUZZY,
          reviewStatus,
          matchedOn: score as unknown as Prisma.InputJsonValue,
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
  }

  private async ensureSearchKeys(
    masterProfileId: string,
    birthYear: number | null,
  ): Promise<void> {
    const profile = await this.prisma.masterProfile.findUnique({
      where: { id: masterProfileId },
    });
    if (!profile) {
      return;
    }

    const block = nameBlockKey(normalizePersonName(profile.canonicalName));
    await this.prisma.masterProfile.update({
      where: { id: masterProfileId },
      data: {
        nameBlockKey: profile.nameBlockKey ?? block,
        resolvedBirthYear: profile.resolvedBirthYear ?? birthYear,
      },
    });
  }
}

function effectiveBirthYear(rawRecord: StoredRecord): number | null {
  return rawRecord.birthYear ?? birthYearFromPayload(rawRecord.payload);
}

function decision(
  rawRecordId: string,
  kind: MatchDecisionKind,
  masterProfileId: string,
  score: MatchScore,
): MatchDecision {
  return {
    rawRecordId,
    decision: kind,
    masterProfileId,
    confidence: score.confidence,
    score,
  };
}
