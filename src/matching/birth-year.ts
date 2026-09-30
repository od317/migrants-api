const YEAR = /\b(?:18|19|20)\d{2}\b/;

const YEAR_KEYS = [
  'birthyear',
  'birth year',
  'year of birth',
  'yearofbirth',
  'yob',
  'dob year',
];

const DATE_KEYS = ['date of birth', 'dateofbirth', 'birth date', 'dob'];

export function birthYearFromPayload(payload: unknown): number | null {
  const record = asRecord(payload);
  if (!record) {
    return null;
  }

  const indexed = new Map<string, unknown>();
  for (const [key, value] of Object.entries(record)) {
    indexed.set(foldKey(key), value);
  }

  for (const key of YEAR_KEYS) {
    const year = parseYear(indexed.get(key));
    if (year) {
      return year;
    }
  }
  for (const key of DATE_KEYS) {
    const year = parseYear(indexed.get(key));
    if (year) {
      return year;
    }
  }
  return null;
}

export function parseYear(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return acceptableYear(value);
  }
  if (typeof value !== 'string') {
    return null;
  }
  const match = value.match(YEAR);
  if (!match) {
    return null;
  }
  return acceptableYear(Number(match[0]));
}

function acceptableYear(year: number): number | null {
  const current = new Date().getUTCFullYear();
  if (year < 1850 || year > current) {
    return null;
  }
  return year;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function foldKey(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}
