import Handlebars from "handlebars";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

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
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatConfidence(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n * 100)}%`;
}

/** "reportedDead" → "Reported dead"; "reportedMissing" → "Reported missing". */
function humanize(value: unknown): string {
  const raw = String(value ?? "")
    .replace(/([A-Z])/g, " $1")
    .trim();
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

// ---- Compilation cache -----------------------------------------------------

let compiled: HandlebarsTemplateDelegate | null = null;

async function getTemplate(): Promise<HandlebarsTemplateDelegate> {
  if (compiled) return compiled;

  Handlebars.registerHelper("statusClass", statusClass);
  Handlebars.registerHelper("formatDate", formatDate);
  Handlebars.registerHelper("formatConfidence", formatConfidence);
  Handlebars.registerHelper("humanize", humanize);

  const source = await readFile(TEMPLATE_PATH, "utf8");
  compiled = Handlebars.compile(source, { noEscape: false });
  return compiled;
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

  const data: IncidentTemplateData = {
    incident,
    generatedAt:
      new Date().toLocaleString("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }) + " UTC",
    statusClass: statusClass(incident.status),
    hasDemographics,
  };

  return template(data);
}
