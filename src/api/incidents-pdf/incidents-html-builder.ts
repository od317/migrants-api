import Handlebars from "handlebars";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { IncidentItem } from "../incidents/incidents.service";

/**
 * Shape of what IncidentsService.findOne() returns.
 * We import the type loosely to avoid coupling to the service's inferred type.
 */
export type IncidentDossier = {
  id: string;
  sourceRecordId: string | null;
  date: string | null;
  year: number | null;
  location: string | null;
  region: string | null;
  latitude: number | null;
  longitude: number | null;
  coordinates: string | null;
  status: string;
  route: string | null;
  causeOfDeath: string | null;
  totalCasualties: number | null;
  sourceUrl: string | null;
  sourceOrg: {
    id: string;
    name: string;
    acronym: string | null;
    reliabilityScore: number;
    url: string | null;
  };
  demographics: {
    men: number | null;
    women: number | null;
    children: number | null;
  };
  claims: Array<{
    id: string;
    fromSourceFile: boolean;
    organization: { id: string; name: string; acronym: string | null };
    reportedDead: number | null;
    reportedMissing: number | null;
    reportedSurvivors: number | null;
    reportedDate: string | null;
    summary: string;
    sourceUrl: string | null;
    sourceQuality: number | null;
    createdAt: Date | string;
  }>;
  evidence: Array<{
    id: string;
    type: string;
    title: string;
    description: string | null;
    fileUrl: string | null;
    submittedBy: string | null;
    isVerified: boolean;
    createdAt: Date | string;
  }>;
  contradictions: {
    detected: boolean;
    disagreements: Array<{
      field: string;
      values: Array<{
        organizationId: string;
        organizationName: string;
        value: unknown;
      }>;
    }>;
  };
};

const TEMPLATE_PATH = join(__dirname, "templates", "incident.hbs");
const SUMMARY_TEMPLATE_PATH = join(
  __dirname,
  "templates",
  "incidents-summary.hbs",
);

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

function hasValue(value: unknown): boolean {
  return value !== null && value !== undefined;
}

function summaryStatusClass(status: unknown): string {
  const key = String(status ?? "");
  const base = statusClass(key);
  return key === "DECEASED_OR_MISSING" ? `${base} compact` : base;
}

// ---- Compilation cache -----------------------------------------------------

let compiled: HandlebarsTemplateDelegate | null = null;
let compiledSummary: HandlebarsTemplateDelegate | null = null;

async function getTemplate(): Promise<HandlebarsTemplateDelegate> {
  if (compiled) return compiled;

  Handlebars.registerHelper("statusClass", statusClass);
  Handlebars.registerHelper("formatDate", formatDate);
  Handlebars.registerHelper("formatConfidence", formatConfidence);
  Handlebars.registerHelper("translateStatus", translateStatus);
  Handlebars.registerHelper("translateEvidenceType", translateEvidenceType);
  Handlebars.registerHelper("translateField", translateField);

  const source = await readFile(TEMPLATE_PATH, "utf8");
  compiled = Handlebars.compile(source, { noEscape: false });
  return compiled;
}

async function getSummaryTemplate(): Promise<HandlebarsTemplateDelegate> {
  if (compiledSummary) return compiledSummary;

  Handlebars.registerHelper("statusClass", statusClass);
  Handlebars.registerHelper("summaryStatusClass", summaryStatusClass);
  Handlebars.registerHelper("formatDate", formatDate);
  Handlebars.registerHelper("translateStatus", translateStatus);
  Handlebars.registerHelper("hasValue", hasValue);

  const source = await readFile(SUMMARY_TEMPLATE_PATH, "utf8");
  compiledSummary = Handlebars.compile(source, { noEscape: false });
  return compiledSummary;
}

// ---- Public builder --------------------------------------------------------

export type IncidentTemplateData = {
  incident: IncidentDossier;
  generatedAt: string;
  statusClass: string;
  hasDemographics: boolean;
};

export async function buildIncidentHtml(
  incident: IncidentDossier,
): Promise<string> {
  const template = await getTemplate();

  const { men, women, children } = incident.demographics;
  const hasDemographics = men != null || women != null || children != null;

  const now = new Date();
  const generatedAt = (() => {
    const day = now.getUTCDate();
    const month = ARABIC_MONTHS[now.getUTCMonth()];
    const year = now.getUTCFullYear();
    const hours = String(now.getUTCHours()).padStart(2, "0");
    const minutes = String(now.getUTCMinutes()).padStart(2, "0");
    return `${day} ${month} ${year} - ${hours}:${minutes} بتوقيت UTC`;
  })();

  const data: IncidentTemplateData = {
    incident,
    generatedAt,
    statusClass: statusClass(incident.status),
    hasDemographics,
  };

  return template(data);
}

export async function buildIncidentsSummaryHtml(
  incidents: IncidentItem[],
): Promise<string> {
  const template = await getSummaryTemplate();
  const now = new Date();
  const day = now.getUTCDate();
  const month = ARABIC_MONTHS[now.getUTCMonth()];
  const year = now.getUTCFullYear();
  const hours = String(now.getUTCHours()).padStart(2, "0");
  const minutes = String(now.getUTCMinutes()).padStart(2, "0");

  const totalCasualties = incidents.reduce(
    (sum, incident) => sum + (incident.peopleCount ?? incident.totalCasualties ?? 0),
    0,
  );

  return template({
    incidents,
    total: incidents.length,
    totalCasualties,
    generatedAt: `${day} ${month} ${year} - ${hours}:${minutes} بتوقيت UTC`,
  });
}
