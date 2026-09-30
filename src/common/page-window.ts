export function pageWindow(
  skip?: string,
  take?: string,
): { skip: number; take: number } {
  const parsedSkip = Number(skip);
  const parsedTake = Number(take);

  return {
    skip:
      Number.isFinite(parsedSkip) && parsedSkip > 0 ? Math.floor(parsedSkip) : 0,
    take:
      Number.isFinite(parsedTake) && parsedTake > 0
        ? Math.min(Math.floor(parsedTake), 100)
        : 50,
  };
}
