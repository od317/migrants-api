/** 1 - distance / max length. Empty strings score 0 unless both are empty. */
export function levenshteinSimilarity(left: string, right: string): number {
  if (left === right) {
    return 1;
  }
  const maxLength = Math.max(left.length, right.length);
  if (maxLength === 0) {
    return 1;
  }
  return 1 - levenshtein(left, right) / maxLength;
}

export function jaroWinkler(left: string, right: string): number {
  const jaro = jaroSimilarity(left, right);
  const prefix = sharedPrefixLength(left, right, 4);
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** Bigram Dice coefficient. */
export function diceCoefficient(left: string, right: string): number {
  if (left === right) {
    return 1;
  }
  if (left.length < 2 || right.length < 2) {
    return 0;
  }

  const rightCounts = new Map<string, number>();
  for (const gram of bigrams(right)) {
    rightCounts.set(gram, (rightCounts.get(gram) ?? 0) + 1);
  }

  let overlap = 0;
  for (const gram of bigrams(left)) {
    const count = rightCounts.get(gram) ?? 0;
    if (count > 0) {
      overlap += 1;
      rightCounts.set(gram, count - 1);
    }
  }

  return (2 * overlap) / (left.length - 1 + (right.length - 1));
}

function levenshtein(left: string, right: string): number {
  const previous = new Array<number>(right.length + 1);
  const current = new Array<number>(right.length + 1);
  for (let column = 0; column <= right.length; column += 1) {
    previous[column] = column;
  }

  for (let row = 1; row <= left.length; row += 1) {
    current[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + cost,
      );
    }
    for (let column = 0; column <= right.length; column += 1) {
      previous[column] = current[column];
    }
  }

  return previous[right.length];
}

function jaroSimilarity(left: string, right: string): number {
  if (left === right) {
    return 1;
  }
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const matchDistance = Math.max(0, Math.floor(Math.max(left.length, right.length) / 2) - 1);
  const leftMatches = new Array<boolean>(left.length).fill(false);
  const rightMatches = new Array<boolean>(right.length).fill(false);
  let matches = 0;

  for (let index = 0; index < left.length; index += 1) {
    const start = Math.max(0, index - matchDistance);
    const end = Math.min(index + matchDistance + 1, right.length);
    for (let cursor = start; cursor < end; cursor += 1) {
      if (rightMatches[cursor] || left[index] !== right[cursor]) {
        continue;
      }
      leftMatches[index] = true;
      rightMatches[cursor] = true;
      matches += 1;
      break;
    }
  }

  if (matches === 0) {
    return 0;
  }

  let transpositions = 0;
  let cursor = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (!leftMatches[index]) {
      continue;
    }
    while (!rightMatches[cursor]) {
      cursor += 1;
    }
    if (left[index] !== right[cursor]) {
      transpositions += 1;
    }
    cursor += 1;
  }

  const transpositionCount = transpositions / 2;
  return (
    (matches / left.length +
      matches / right.length +
      (matches - transpositionCount) / matches) /
    3
  );
}

function sharedPrefixLength(left: string, right: string, limit: number): number {
  const max = Math.min(limit, left.length, right.length);
  let length = 0;
  while (length < max && left[length] === right[length]) {
    length += 1;
  }
  return length;
}

function bigrams(value: string): string[] {
  const grams: string[] = [];
  for (let index = 0; index < value.length - 1; index += 1) {
    grams.push(value.slice(index, index + 2));
  }
  return grams;
}
