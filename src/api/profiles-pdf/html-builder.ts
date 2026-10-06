import Handlebars from "handlebars";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProfileDetail } from "../profiles/profiles.service";

const TEMPLATE_PATH = join(__dirname, "templates", "case.hbs");

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

/** 2024-08-15T00:00:00.000Z → 15 Aug 2024 */
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

/** 0.85 → 85% */
function formatConfidence(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n * 100)}%`;
}

let compiled: HandlebarsTemplateDelegate | null = null;

async function getTemplate(): Promise<HandlebarsTemplateDelegate> {
  if (compiled) return compiled;

  // Register helpers once.
  Handlebars.registerHelper("eq", (a: unknown, b: unknown) => a === b);
  Handlebars.registerHelper("statusClass", statusClass);
  Handlebars.registerHelper("formatDate", formatDate);
  Handlebars.registerHelper("formatConfidence", formatConfidence);

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

  const data: CaseTemplateData = {
    profile,
    generatedAt:
      new Date().toLocaleString("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }) + " UTC",
    statusClass: statusClass(profile.resolvedStatus),
    organizationCount: organizations.size,
  };

  return template(data);
}
