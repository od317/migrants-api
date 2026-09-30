import { MATCH_WEIGHTS } from './match-weights';

const ARABIC_DIACRITICS = /[\u064B-\u065F\u0670\u0640]/g;
const ALEF_VARIANTS = /[أإآٱ]/g;
const PREFIX_TOKENS = new Set(['al', 'el', 'ال']);

/**
 * Fold a personal name for comparison.
 * Arabic: drop tashkeel and tatweel, map alef variants to ا, ة to ه, ى to ي,
 * and drop a leading ال. Latin: lowercase, drop punctuation, drop al- / el-.
 */
export function normalizePersonName(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const folded = value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(ARABIC_DIACRITICS, '')
    .replace(ALEF_VARIANTS, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!folded) {
    return null;
  }

  const tokens = folded
    .split(' ')
    .map(stripNamePrefix)
    .filter((token): token is string => Boolean(token));

  return tokens.join(' ') || null;
}

export function nameBlockKey(
  normalized: string | null,
  prefixLength = MATCH_WEIGHTS.blockPrefixLength,
): string | null {
  if (!normalized) {
    return null;
  }
  const compact = normalized.replace(/\s+/g, '');
  if (compact.length < 2) {
    return null;
  }
  return compact.slice(0, prefixLength);
}

function stripNamePrefix(token: string): string | null {
  let current = token;
  if (current.startsWith('ال') && current.length > 2) {
    current = current.slice(2);
  }
  if (PREFIX_TOKENS.has(current)) {
    return null;
  }
  return current || null;
}
