import { VitalStatus } from '@prisma/client';
import { foldForCompare } from '../common/fold-text';

const STATUS_PRIORITY: VitalStatus[] = [
  VitalStatus.DECEASED,
  VitalStatus.DETAINED,
  VitalStatus.MISSING,
  VitalStatus.ALIVE,
];

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function isBlankRecord(record: Record<string, unknown>): boolean {
  return Object.values(record).every(
    (value) => value == null || String(value).trim() === '',
  );
}

export function fieldIndex(record: Record<string, unknown>): Map<string, unknown> {
  const indexed = new Map<string, unknown>();
  for (const [key, value] of Object.entries(record)) {
    indexed.set(foldKey(key), value);
  }
  return indexed;
}

export function readString(
  indexed: Map<string, unknown>,
  aliases: string[],
): string | null {
  for (const alias of aliases) {
    const value = indexed.get(foldKey(alias));
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

export function readCount(indexed: Map<string, unknown>, aliases: string[]): number {
  for (const alias of aliases) {
    const value = indexed.get(foldKey(alias));
    const parsed = parseCount(value);
    if (parsed > 0) {
      return parsed;
    }
  }
  return 0;
}

export function parseEventDate(value: string | null): Date | null {
  if (!value) {
    return null;
  }
  const text = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) {
    return utcDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }
  const dayFirst = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (dayFirst) {
    return utcDate(Number(dayFirst[3]), Number(dayFirst[2]), Number(dayFirst[1]));
  }
  return null;
}

export function readBirthYear(indexed: Map<string, unknown>): number | null {
  const direct = readString(indexed, [
    'birth year',
    'birthyear',
    'year of birth',
    'yob',
    'dob year',
  ]);
  const parsed = yearIn(direct);
  if (parsed) {
    return parsed;
  }
  return yearIn(readString(indexed, ['date of birth', 'birth date', 'dob']));
}

function yearIn(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const match = value.match(/\b(?:18|19|20)\d{2}\b/);
  if (!match) {
    return null;
  }
  const year = Number(match[0]);
  const current = new Date().getUTCFullYear();
  if (year < 1850 || year > current) {
    return null;
  }
  return year;
}

export function readCoordinates(indexed: Map<string, unknown>): {
  latitude: number | null;
  longitude: number | null;
} {
  const latitude = readNumber(indexed, ['latitude', 'lat']);
  const longitude = readNumber(indexed, ['longitude', 'lon', 'lng', 'long']);
  if (isLatitude(latitude) && isLongitude(longitude)) {
    return { latitude, longitude };
  }

  const combined = readString(indexed, ['coordinates', 'coords']);
  const pair = combined?.match(/(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)/);
  if (!pair) {
    return { latitude: null, longitude: null };
  }

  const first = Number(pair[1]);
  const second = Number(pair[2]);
  if (isLatitude(first) && isLongitude(second)) {
    return { latitude: first, longitude: second };
  }
  if (isLatitude(second) && isLongitude(first)) {
    return { latitude: second, longitude: first };
  }
  return { latitude: null, longitude: null };
}

/** Exact label match, then a whole-word phrase match. Death outranks other hits. */
export function statusTable(
  labels: ReadonlyArray<readonly [string, VitalStatus]>,
): Map<string, VitalStatus> {
  const table = new Map<string, VitalStatus>();
  for (const [label, status] of labels) {
    const key = foldForCompare(label);
    if (key) {
      table.set(key, status);
    }
  }
  return table;
}

export function mapStatusLabel(
  value: string | null,
  table: Map<string, VitalStatus>,
): VitalStatus {
  const text = foldForCompare(value);
  if (!text) {
    return VitalStatus.UNKNOWN;
  }

  const exact = table.get(text);
  if (exact) {
    return exact;
  }

  const found = new Set<VitalStatus>();
  const padded = ` ${text} `;
  for (const [label, status] of table) {
    if (padded.includes(` ${label} `)) {
      found.add(status);
    }
  }
  for (const status of STATUS_PRIORITY) {
    if (found.has(status)) {
      return status;
    }
  }
  return VitalStatus.UNKNOWN;
}

function foldKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function parseCount(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 0 ? value : 0;
  }
  if (typeof value !== 'string' || !value.trim()) {
    return 0;
  }
  const parsed = Number(value.replace(/,/g, '').trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function readNumber(indexed: Map<string, unknown>, aliases: string[]): number | null {
  for (const alias of aliases) {
    const value = indexed.get(foldKey(alias));
    const parsed =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number(value.trim())
          : Number.NaN;
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function isLatitude(value: number | null): value is number {
  return value != null && value >= -90 && value <= 90;
}

function isLongitude(value: number | null): value is number {
  return value != null && value >= -180 && value <= 180;
}

function utcDate(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}
