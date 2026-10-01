const DAY_MS = 86_400_000; // UTC day, used to score how close an incident date is to the report.
export const SUGGESTION_WINDOW_DAYS = 14;

const PLACE_ALIASES: Record<string, string[]> = {
  زوارة: ["zuwara", "zuwarah", "zawara", "زوارة"],
  طبرق: ["tobruk", "tobruq", "tubruq", "طبرق"],
  تركيا: ["turkey", "turkiye", "türkiye", "aegean", "bodrum", "تركيا"],
};

export type SuggestionCandidate = {
  id: string;
  eventDate: Date | null;
  location: string | null;
  route: string | null;
  casualties: number | null;
};

export type RankedSuggestion = {
  incidentId: string;
  date: string | null;
  location: string | null;
  casualties: number | null;
  confidence: number;
  reason: string;
};

export function suggestionDateWindow(dateOfLoss: Date | null): { gte: Date; lte: Date } | null {
  if (!dateOfLoss) return null;
  return {
    gte: new Date(dateOfLoss.getTime() - SUGGESTION_WINDOW_DAYS * DAY_MS),
    lte: new Date(dateOfLoss.getTime() + SUGGESTION_WINDOW_DAYS * DAY_MS),
  };
}

export function rankIncidentSuggestions(
  report: { dateOfLoss: Date | null; lastKnownLocation: string | null },
  candidates: SuggestionCandidate[],
): RankedSuggestion[] {
  const ranked = candidates.flatMap((candidate) => {
    const dayGap = gapDays(report.dateOfLoss, candidate.eventDate);
    const placeMatches = locationMatches(report.lastKnownLocation, candidate.location, candidate.route);
    const confidence = score(dayGap, placeMatches);
    const reason = reasonFor(dayGap, placeMatches);
    if (confidence < 0.35 || !reason) return [];
    return [
      {
        incidentId: candidate.id,
        date: candidate.eventDate ? candidate.eventDate.toISOString().slice(0, 10) : null,
        location: candidate.location,
        casualties: candidate.casualties,
        confidence: Math.round(confidence * 100) / 100,
        reason,
        dayGap: dayGap ?? 99,
        placeMatches,
      },
    ];
  });

  ranked.sort((left, right) => right.confidence - left.confidence || left.dayGap - right.dayGap || Number(right.placeMatches) - Number(left.placeMatches));

  return ranked.slice(0, 8).map((item) => ({
    incidentId: item.incidentId,
    date: item.date,
    location: item.location,
    casualties: item.casualties,
    confidence: item.confidence,
    reason: item.reason,
  }));
}

function gapDays(loss: Date | null, eventDate: Date | null): number | null {
  if (!loss || !eventDate) return null;
  const lossDay = Date.UTC(loss.getUTCFullYear(), loss.getUTCMonth(), loss.getUTCDate());
  const eventDay = Date.UTC(eventDate.getUTCFullYear(), eventDate.getUTCMonth(), eventDate.getUTCDate());
  return Math.round(Math.abs(lossDay - eventDay) / DAY_MS);
}

function score(dayGap: number | null, placeMatches: boolean): number {
  let value = 0;
  if (dayGap === 0) value += 0.72;
  else if (dayGap === 1) value += 0.64;
  else if (dayGap === 2) value += 0.58;
  else if (dayGap != null && dayGap <= 7) value += 0.4;
  else if (dayGap != null && dayGap <= SUGGESTION_WINDOW_DAYS) value += 0.22;
  if (placeMatches) value += dayGap == null ? 0.46 : 0.28;
  return Math.min(1, value);
}

function reasonFor(dayGap: number | null, placeMatches: boolean): string | null {
  const parts: string[] = [];
  if (dayGap != null && dayGap <= SUGGESTION_WINDOW_DAYS) parts.push(dateReason(dayGap));
  if (placeMatches) parts.push("الموقع متقارب مع نقطة الانطلاق");
  return parts.length > 0 ? parts.join("، ") : null;
}

function dateReason(dayGap: number): string {
  if (dayGap === 0) return "التاريخ متطابق";
  if (dayGap === 1) return "التاريخ متطابق بفارق يوم واحد";
  if (dayGap === 2) return "التاريخ متطابق بفارق يومين";
  if (dayGap <= 10) return `التاريخ متطابق بفارق ${dayGap} أيام`;
  return `التاريخ متطابق بفارق ${dayGap} يوماً`;
}

function locationMatches(lastKnown: string | null, location: string | null, route: string | null): boolean {
  const needle = lastKnown?.trim();
  if (!needle) return false;
  const haystack = `${location ?? ""} ${route ?? ""}`.toLowerCase();
  const aliases = PLACE_ALIASES[needle] ?? [needle];
  return aliases.some((alias) => haystack.includes(alias.toLowerCase()));
}
