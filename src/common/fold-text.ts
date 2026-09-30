/** Fold text for comparison only. Original spellings stay on the source row. */
export function foldForCompare(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const folded = value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return folded || null;
}
