import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from "@nestjs/common";
import puppeteer, { type Browser } from "puppeteer";
import {
  IncidentsService,
  type IncidentItem,
} from "../incidents/incidents.service";
import {
  buildIncidentHtml,
  buildIncidentsSummaryHtml,
  type IncidentDossier,
} from "./incidents-html-builder";

export type RenderedIncidentPdf = {
  buffer: Buffer;
  filename: string;
  asciiFallback: string;
};

@Injectable()
export class IncidentsPdfService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IncidentsPdfService.name);
  private browser: Browser | null = null;
  private starting: Promise<Browser> | null = null;

  constructor(private readonly incidents: IncidentsService) {}

  // ---- Lifecycle ----------------------------------------------------------

  async onModuleInit(): Promise<void> {
    try {
      await this.getBrowser();
      this.logger.log("Incident PDF browser ready");
    } catch (error) {
      this.logger.error(
        `Incident PDF browser failed to start: ${
          error instanceof Error ? error.message : error
        }`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => undefined);
      this.browser = null;
    }
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser) return this.browser;
    if (this.starting) return this.starting;

    this.starting = puppeteer
      .launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
        ],
      })
      .then((browser) => {
        this.browser = browser;
        this.starting = null;
        browser.on("disconnected", () => {
          this.browser = null;
          this.logger.warn(
            "Incident PDF browser disconnected; will relaunch on next request",
          );
        });
        return browser;
      })
      .catch((error) => {
        this.starting = null;
        throw error;
      });

    return this.starting;
  }

  // ---- Public API ---------------------------------------------------------

  async render(incidentId: string): Promise<RenderedIncidentPdf> {
    const incident = (await this.incidents.findOne(
      incidentId,
    )) as IncidentDossier;
    const html = await buildIncidentHtml(incident);
    const buffer = await this.renderPdf(html);
    return {
      buffer,
      filename: this.filenameFor(incident),
      asciiFallback: `incident-${incident.id.slice(0, 8)}.pdf`,
    };
  }

  async renderAll(): Promise<RenderedIncidentPdf> {
    const incidents = (await this.incidents.listAll())
      .filter((incident) => {
        const year = incidentYear(incident);
        return year != null && year >= 2011;
      })
      .sort((left, right) => {
        const leftTime = incidentTime(left);
        const rightTime = incidentTime(right);
        if (leftTime !== rightTime) return leftTime - rightTime;
        return (left.sourceRecordId ?? left.id).localeCompare(
          right.sourceRecordId ?? right.id,
        );
      });
    const html = await buildIncidentsSummaryHtml(incidents);
    const buffer = await this.renderPdf(html);
    const date = new Date().toISOString().slice(0, 10);
    return {
      buffer,
      filename: `incidents-summary-${date}.pdf`,
      asciiFallback: `incidents-summary-${date}.pdf`,
    };
  }

  private async renderPdf(html: string): Promise<Buffer> {
    const browser = await this.getBrowserSafe();
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: "domcontentloaded" });
      const pdf = await page.pdf({
        format: "A4",
        printBackground: true,
      });
      return Buffer.from(pdf);
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  private async getBrowserSafe(): Promise<Browser> {
    try {
      return await this.getBrowser();
    } catch (error) {
      this.logger.error(
        `Could not start incident PDF browser: ${
          error instanceof Error ? error.message : error
        }`,
      );
      throw new ServiceUnavailableException("PDF generation is unavailable");
    }
  }

  private filenameFor(incident: IncidentDossier): string {
    const date = incident.date ? incident.date.replace(/[^\d-]/g, "") : "";
    const loc = (incident.location ?? "")
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}_\- ]+/gu, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 40);
    const parts = ["incident", date, loc].filter(Boolean);
    return `${parts.join("-") || `incident-${incident.id.slice(0, 8)}`}.pdf`;
  }
}

function incidentYear(incident: IncidentItem): number | null {
  if (incident.year != null) return incident.year;
  const match = incident.date?.match(/\d{4}/);
  if (!match) return null;
  const year = Number(match[0]);
  return Number.isInteger(year) ? year : null;
}

function incidentTime(incident: IncidentItem): number {
  if (incident.date) {
    const time = Date.parse(incident.date);
    if (!Number.isNaN(time)) return time;
  }
  const year = incidentYear(incident);
  return year == null ? Number.POSITIVE_INFINITY : Date.UTC(year, 0, 1);
}
