import { ProfileStatus, VitalStatus } from '@prisma/client';

/** Two or more links at or above this score, and no conflict, mark a profile CONFIRMED. */
export const CONFIRMED_LINK_CONFIDENCE = 0.9;

export type RankedObservation = {
  id: string;
  organizationId: string;
  reliabilityScore: number;
  extractedName: string | null;
  vitalStatus: VitalStatus;
  location: string | null;
  eventDate: Date | null;
  birthYear: number | null;
  ingestedAt: Date;
};

export type FieldSource = {
  rawRecordId: string;
  organizationId: string;
  reliabilityScore: number;
};

export type FieldProvenance = {
  canonicalName: FieldSource | null;
  resolvedStatus: (FieldSource & { value: VitalStatus }) | null;
  resolvedLocation: (FieldSource & { value: string }) | null;
  resolvedEventDate: (FieldSource & { value: string }) | null;
};

export type ResolvedProfileFields = {
  canonicalName: string | null;
  knownNames: string[];
  resolvedStatus: VitalStatus;
  resolvedLocation: string | null;
  resolvedBirthYear: number | null;
  resolvedEventDate: Date | null;
  profileStatus: ProfileStatus;
  fieldProvenance: FieldProvenance;
};

export function deriveProfileStatus(
  hasConflict: boolean,
  confidenceScores: number[],
): ProfileStatus {
  if (hasConflict) {
    return ProfileStatus.DISPUTED;
  }
  if (
    confidenceScores.length >= 2 &&
    confidenceScores.every((score) => score >= CONFIRMED_LINK_CONFIDENCE)
  ) {
    return ProfileStatus.CONFIRMED;
  }
  return ProfileStatus.PROVISIONAL;
}

/**
 * Name and location follow the more reliable organization, then the later date.
 * Status follows the later dated report when vital statuses form a timeline,
 * and the more reliable organization when those statuses contradict.
 */
export function resolveProfileFields(
  records: RankedObservation[],
  hasConflict: boolean,
  hasVitalStatusConflict: boolean,
  confidenceScores: number[],
): ResolvedProfileFields {
  const name = pick(
    records.filter((record) => record.extractedName),
    moreTrusted,
  );
  const location = pick(
    records.filter((record) => record.location),
    moreTrusted,
  );
  const statusPool = records.filter(
    (record) => record.vitalStatus !== VitalStatus.UNKNOWN,
  );
  const status = pick(
    preferDated(statusPool),
    hasVitalStatusConflict ? moreTrusted : moreRecent,
  );
  const birthYear = pick(
    records.filter((record) => record.birthYear != null),
    moreTrusted,
  );
  const dated = pick(
    records.filter((record) => record.eventDate),
    moreTrusted,
  );

  const knownNames = [
    ...new Set(
      records
        .map((record) => record.extractedName)
        .filter((nameValue): nameValue is string => Boolean(nameValue)),
    ),
  ].sort((left, right) => left.localeCompare(right));

  return {
    canonicalName: name?.extractedName ?? null,
    knownNames,
    resolvedStatus: status?.vitalStatus ?? VitalStatus.UNKNOWN,
    resolvedLocation: location?.location ?? null,
    resolvedBirthYear: birthYear?.birthYear ?? null,
    resolvedEventDate: dated?.eventDate ?? null,
    profileStatus: deriveProfileStatus(hasConflict, confidenceScores),
    fieldProvenance: {
      canonicalName: name ? sourceOf(name) : null,
      resolvedStatus: status
        ? { ...sourceOf(status), value: status.vitalStatus }
        : null,
      resolvedLocation: location?.location
        ? { ...sourceOf(location), value: location.location }
        : null,
      resolvedEventDate: dated?.eventDate
        ? {
            ...sourceOf(dated),
            value: dated.eventDate.toISOString().slice(0, 10),
          }
        : null,
    },
  };
}

function preferDated(records: RankedObservation[]): RankedObservation[] {
  const dated = records.filter((record) => record.eventDate);
  return dated.length > 0 ? dated : records;
}

function pick(
  records: RankedObservation[],
  isBetter: (candidate: RankedObservation, current: RankedObservation) => boolean,
): RankedObservation | null {
  if (records.length === 0) {
    return null;
  }
  return records.reduce((best, candidate) =>
    isBetter(candidate, best) ? candidate : best,
  );
}

function moreTrusted(
  candidate: RankedObservation,
  current: RankedObservation,
): boolean {
  if (candidate.reliabilityScore !== current.reliabilityScore) {
    return candidate.reliabilityScore > current.reliabilityScore;
  }
  return moreRecent(candidate, current);
}

function moreRecent(
  candidate: RankedObservation,
  current: RankedObservation,
): boolean {
  const candidateDate = candidate.eventDate?.getTime() ?? Number.NEGATIVE_INFINITY;
  const currentDate = current.eventDate?.getTime() ?? Number.NEGATIVE_INFINITY;
  if (candidateDate !== currentDate) {
    return candidateDate > currentDate;
  }
  if (candidate.reliabilityScore !== current.reliabilityScore) {
    return candidate.reliabilityScore > current.reliabilityScore;
  }
  if (candidate.ingestedAt.getTime() !== current.ingestedAt.getTime()) {
    return candidate.ingestedAt.getTime() > current.ingestedAt.getTime();
  }
  return candidate.id > current.id;
}

function sourceOf(record: RankedObservation): FieldSource {
  return {
    rawRecordId: record.id,
    organizationId: record.organizationId,
    reliabilityScore: record.reliabilityScore,
  };
}
