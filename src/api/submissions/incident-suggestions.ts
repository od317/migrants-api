const DATE_WINDOW_DAYS = 14;
const DATE_WEIGHT = 0.4;
const PLACE_WEIGHT = 0.6;
const BOTH_SIGNALS_BONUS = 0.1;
const MAX_KEYWORDS = 8;

const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'of',
  'and',
  'or',
  'to',
  'from',
  'in',
  'on',
  'at',
  'near',
  'by',
  'with',
  'for',
  'via',
  'de',
  'el',
  'al',
  'la',
  'le',
  'les',
  'un',
  'une',
  'des',
  'du',
  'sea',
  'off',
  'about',
  'after',
  'before',
  'during',
  'into',
  'over',
  'under',
  'was',
  'were',
  'his',
  'her',
  'their',
  'who',
  'that',
  'this',
  'its',
  'are',
  'been',
  'have',
  'has',
  'had',
  'not',
  'but',
  'they',
  'them',
  'she',
  'him',
  'our',
  'your',
  'you',
  'person',
  'people',
  'missing',
  'died',
  'dead',
  'boat',
  'ship',
  'left',
  'went',
  'then',
  'than',
  'when',
  'where',
  'what',
  'which',
  'while',
  'also',
  'some',
  'any',
  'all',
  'out',
]);

const ALIASES: Record<string, string[]> = {
  turkey: ['turkey', 'turkiye'],
  turkiye: ['turkey', 'turkiye'],
  libya: ['libya', 'libyan'],
  libyan: ['libya', 'libyan'],
  syria: ['syria', 'syrian'],
  syrian: ['syria', 'syrian'],
};

export type MatchField = 'location' | 'route' | 'metadata';

export type IncidentMatchInput = {
  eventDate: Date | null;
  location: string | null;
  route: string | null;
  causeOfDeath: string | null;
};

export type IncidentMatchScore = {
  confidence: number;
  dayDistance: number | null;
  matchedKeywords: Array<{ keyword: string; field: MatchField }>;
  reasons: string[];
};

export function extractSearchKeywords(...texts: Array<string | null | undefined>): string[] {
  const found = new Set<string>();
  for (const text of texts) {
    if (!text) {
      continue;
    }
    for (const token of foldText(text).split(/[^a-z0-9\u0600-\u06ff]+/u)) {
      if (token.length < 4 || STOP_WORDS.has(token)) {
        continue;
      }
      found.add(token);
    }
  }
  return [...found].sort((left, right) => right.length - left.length).slice(0, MAX_KEYWORDS);
}

export function scoreIncidentMatch(
  reportDate: Date | null,
  keywords: string[],
  incident: IncidentMatchInput,
): IncidentMatchScore | null {
  const dayDistance =
    reportDate && incident.eventDate ? daysBetween(reportDate, incident.eventDate) : null;
  const dateScore =
    dayDistance != null && dayDistance <= DATE_WINDOW_DAYS
      ? (DATE_WINDOW_DAYS + 1 - dayDistance) / (DATE_WINDOW_DAYS + 1)
      : 0;

  const fields: Array<{ field: MatchField; text: string }> = [
    { field: 'location', text: foldText(incident.location ?? '') },
    { field: 'route', text: foldText(incident.route ?? '') },
    { field: 'metadata', text: foldText(incident.causeOfDeath ?? '') },
  ];
  const matchedKeywords = keywords.flatMap((keyword) => {
    const forms = ALIASES[keyword] ?? [keyword];
    const hit = fields.find((field) => forms.some((form) => includesTerm(field.text, form)));
    return hit ? [{ keyword, field: hit.field }] : [];
  });

  if (dateScore === 0 && matchedKeywords.length === 0) {
    return null;
  }

  const placeScore = keywords.length === 0 ? 0 : matchedKeywords.length / keywords.length;
  let confidence = DATE_WEIGHT * dateScore + PLACE_WEIGHT * placeScore;
  if (dateScore > 0 && placeScore > 0) {
    confidence = Math.min(1, confidence + BOTH_SIGNALS_BONUS);
  }

  return {
    confidence,
    dayDistance: dateScore > 0 ? dayDistance : null,
    matchedKeywords,
    reasons: buildReasons(dateScore > 0 ? dayDistance : null, matchedKeywords),
  };
}

export function addUtcDays(date: Date, days: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

function buildReasons(
  dayDistance: number | null,
  matches: Array<{ keyword: string; field: MatchField }>,
): string[] {
  const reasons: string[] = [];
  if (dayDistance === 0) {
    reasons.push('Incident date is the same as the reported date of loss');
  } else if (dayDistance != null) {
    reasons.push(
      `Incident date is ${dayDistance} day${dayDistance === 1 ? '' : 's'} from the reported date of loss`,
    );
  }
  for (const match of matches) {
    const label = match.field === 'location' ? 'Location' : match.field === 'route' ? 'Route' : 'Incident details';
    reasons.push(`${label} matches "${match.keyword}"`);
  }
  return reasons;
}

function includesTerm(haystack: string, term: string): boolean {
  if (!haystack || !term) {
    return false;
  }
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?:^|[^a-z0-9\\u0600-\\u06ff])${escaped}h?(?:$|[^a-z0-9\\u0600-\\u06ff])`, 'i');
  return pattern.test(haystack);
}

function daysBetween(left: Date, right: Date): number {
  const leftDay = Date.UTC(left.getUTCFullYear(), left.getUTCMonth(), left.getUTCDate());
  const rightDay = Date.UTC(right.getUTCFullYear(), right.getUTCMonth(), right.getUTCDate());
  return Math.round(Math.abs(leftDay - rightDay) / 86_400_000);
}

function foldText(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}
