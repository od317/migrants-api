import Handlebars from "handlebars";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProfileDetail } from "../profiles/profiles.service";

const TEMPLATE_PATH = join(__dirname, "templates", "case.hbs");

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

// ---- Handlebars helpers ----------------------------------------------------

/** Map each VitalStatus to a CSS class for the badge in the template. */
function statusClass(status: string): string {
  switch (status) {
    case "ALIVE":
      return "alive";
    case "DECEASED":
    case "DECEASED_OR_MISSING":
    case "FATALITY_EVENT":
      return "deceased";
    case "MISSING":
      return "missing";
    case "DETAINED":
      return "detained";
    default:
      return "unknown";
  }
}

/** 2024-08-15T00:00:00.000Z → 15 أغسطس 2024 */
function formatDate(value: unknown): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  const day = date.getUTCDate();
  const month = ARABIC_MONTHS[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  return `${day} ${month} ${year}`;
}

/** 0.85 → 85% */
function formatConfidence(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n * 100)}%`;
}

function translateStatus(value: unknown): string {
  const key = String(value ?? "");
  return STATUS_LABELS_AR[key] ?? key;
}

// ---- Compilation cache -----------------------------------------------------

let compiled: HandlebarsTemplateDelegate | null = null;

async function getTemplate(): Promise<HandlebarsTemplateDelegate> {
  if (compiled) return compiled;

  Handlebars.registerHelper("statusClass", statusClass);
  Handlebars.registerHelper("formatDate", formatDate);
  Handlebars.registerHelper("formatConfidence", formatConfidence);
  Handlebars.registerHelper("translateStatus", translateStatus);

  const source = await readFile(TEMPLATE_PATH, "utf8");
  compiled = Handlebars.compile(source, { noEscape: false });
  return compiled;
}

export type CaseTemplateData = {
  profile: ProfileDetail;
  generatedAt: string;
  statusClass: string;
  organizationCount: number;
};

export async function buildCaseHtml(profile: ProfileDetail): Promise<string> {
  const template = await getTemplate();
  const organizations = new Set(profile.linkages.map((l) => l.organization.id));

  const now = new Date();
  const generatedAt = (() => {
    const day = now.getUTCDate();
    const month = ARABIC_MONTHS[now.getUTCMonth()];
    const year = now.getUTCFullYear();
    const hours = String(now.getUTCHours()).padStart(2, "0");
    const minutes = String(now.getUTCMinutes()).padStart(2, "0");
    return `${day} ${month} ${year} - ${hours}:${minutes} بتوقيت UTC`;
  })();

  const data: CaseTemplateData = {
    profile,
    generatedAt,
    statusClass: statusClass(profile.resolvedStatus),
    organizationCount: organizations.size,
  };

  return template(data);
}
