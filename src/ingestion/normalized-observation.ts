import { VitalStatus } from '@prisma/client';

/** Comparable projection of one NGO row. payload keeps the original fields. */
export type NormalizedObservation = {
  payload: Record<string, unknown>;
  extractedName: string | null;
  vitalStatus: VitalStatus;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  eventDate: Date | null;
  reportedAt: Date | null;
  birthYear: number | null;
  /** Set when the row names a publisher other than the file's organization. */
  organizationId?: string;
  /** Source identifier. Falls back to the worksheet row number. */
  sourceLocator?: string;
};
