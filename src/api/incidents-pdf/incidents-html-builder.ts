// ---- Arabic translation tables --------------------------------------------

const ARABIC_MONTHS = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];

const STATUS_LABELS_AR: Record<string, string> = {
  ALIVE: "على قيد الحياة",
  MISSING: "مفقود",
  DECEASED: "متوفى",
  DECEASED_OR_MISSING: "متوفى أو مفقود",
  DETAINED: "معتقل",
  UNKNOWN: "غير معروف",
  FATALITY_EVENT: "حادثة وفيات",
  CONFLICT_EVENT: "حادثة نزاع",
};

const EVIDENCE_TYPE_LABELS_AR: Record<string, string> = {
  LEAK: "تسريب",
  TESTIMONY: "شهادة",
  LINK: "رابط",
  DOCUMENT: "مستند",
};

const FIELD_LABELS_AR: Record<string, string> = {
  reportedDead: "الوفيات المُبلّغ عنها",
  reportedMissing: "المفقودون المُبلّغ عنهم",
  reportedSurvivors: "الناجون المُبلّغ عنهم",
  reportedDate: "تاريخ الإبلاغ",
};

// ---- Handlebars helpers ----------------------------------------------------

function statusClass(status: string | null | undefined): string {
  switch (status) {
    case "ALIVE":
      return "alive";
    case "MISSING":
      return "missing";
    case "DETAINED":
      return "detained";
    case "DECEASED":
    case "DECEASED_OR_MISSING":
      return "deceased";
    case "FATALITY_EVENT":
      return "fatality";
    case "CONFLICT_EVENT":
      return "conflict";
    default:
      return "unknown";
  }
}

function formatDate(value: unknown): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  const day = date.getUTCDate();
  const month = ARABIC_MONTHS[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  return `${day} ${month} ${year}`;
}

function formatConfidence(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n * 100)}%`;
}

function translateStatus(value: unknown): string {
  const key = String(value ?? "");
  return STATUS_LABELS_AR[key] ?? key;
}

function translateEvidenceType(value: unknown): string {
  const key = String(value ?? "");
  return EVIDENCE_TYPE_LABELS_AR[key] ?? key;
}

function translateField(value: unknown): string {
  const key = String(value ?? "");
  return FIELD_LABELS_AR[key] ?? key;
}
