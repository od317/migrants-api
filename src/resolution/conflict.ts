import { VitalStatus } from '@prisma/client';
import { foldForCompare } from '../common/fold-text';

export type Observation = {
  id: string;
  vitalStatus: VitalStatus;
  location: string | null;
  eventDate: Date | null;
};

export type StatusClaim = {
  vitalStatus: VitalStatus;
  eventDate: Date | null;
};

export type ConflictAssessment = {
  byRecordId: Map<string, string | null>;
  hasVitalStatusConflict: boolean;
};

/**
 * Undated or same-day disagreements are contradictions, including ALIVE
 * against DECEASED or MISSING. Ordered changes are updates: MISSING then a
 * later ALIVE, or any status then a later DECEASED. A claim after DECEASED
 * is fatal — death in 2014 and alive in 2018 contradict.
 */
export function claimsContradict(left: StatusClaim, right: StatusClaim): boolean {
  if (
    left.vitalStatus === right.vitalStatus ||
    left.vitalStatus === VitalStatus.UNKNOWN ||
    right.vitalStatus === VitalStatus.UNKNOWN
  ) {
    return false;
  }

  if (!left.eventDate || !right.eventDate || sameDay(left.eventDate, right.eventDate)) {
    return true;
  }

  const [earlier, later] =
    left.eventDate.getTime() < right.eventDate.getTime() ? [left, right] : [right, left];
  return !isChronologicalUpdate(earlier.vitalStatus, later.vitalStatus);
}

export function contradictingIds<T extends StatusClaim & { id: string }>(
  claims: T[],
): Set<string> {
  const ids = new Set<string>();
  for (let i = 0; i < claims.length; i += 1) {
    for (let j = i + 1; j < claims.length; j += 1) {
      if (claimsContradict(claims[i], claims[j])) {
        ids.add(claims[i].id);
        ids.add(claims[j].id);
      }
    }
  }
  return ids;
}

function isChronologicalUpdate(earlier: VitalStatus, later: VitalStatus): boolean {
  if (earlier === VitalStatus.MISSING && later === VitalStatus.ALIVE) {
    return true;
  }
  if (later === VitalStatus.DECEASED) {
    return true;
  }
  return earlier !== VitalStatus.DECEASED;
}

export function assessConflicts(records: Observation[]): ConflictAssessment {
  const reasons = new Map<string, string[]>(
    records.map((record) => [record.id, []]),
  );
  let hasVitalStatusConflict = false;

  for (let i = 0; i < records.length; i += 1) {
    for (let j = i + 1; j < records.length; j += 1) {
      const left = records[i];
      const right = records[j];
      const status = vitalStatusConflict(left, right);
      if (status) {
        hasVitalStatusConflict = true;
        reasons.get(left.id)?.push(status.forLeft);
        reasons.get(right.id)?.push(status.forRight);
      }

      const location = locationConflict(left, right);
      if (location) {
        reasons.get(left.id)?.push(location.forLeft);
        reasons.get(right.id)?.push(location.forRight);
      }
    }
  }

  const byRecordId = new Map<string, string | null>();
  for (const [id, parts] of reasons) {
    byRecordId.set(id, parts.length > 0 ? parts.join(' | ') : null);
  }

  return { byRecordId, hasVitalStatusConflict };
}

function vitalStatusConflict(
  left: Observation,
  right: Observation,
): { forLeft: string; forRight: string } | null {
  if (!claimsContradict(left, right)) {
    return null;
  }
  return statusMessages(left, right);
}

function statusMessages(
  left: Observation,
  right: Observation,
): { forLeft: string; forRight: string } {
  return {
    forLeft: `vitalStatus ${left.vitalStatus} contradicts ${right.id} (${right.vitalStatus})`,
    forRight: `vitalStatus ${right.vitalStatus} contradicts ${left.id} (${left.vitalStatus})`,
  };
}

function locationConflict(
  left: Observation,
  right: Observation,
): { forLeft: string; forRight: string } | null {
  const leftLocation = foldForCompare(left.location);
  const rightLocation = foldForCompare(right.location);
  if (!leftLocation || !rightLocation || !sameDay(left.eventDate, right.eventDate)) {
    return null;
  }
  if (leftLocation === rightLocation) {
    return null;
  }

  return {
    forLeft: `location "${left.location}" contradicts ${right.id} ("${right.location}") on ${calendarDay(left.eventDate!)}`,
    forRight: `location "${right.location}" contradicts ${left.id} ("${left.location}") on ${calendarDay(right.eventDate!)}`,
  };
}

function sameDay(left: Date | null, right: Date | null): boolean {
  if (!left || !right) {
    return false;
  }
  return calendarDay(left) === calendarDay(right);
}

function calendarDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}
