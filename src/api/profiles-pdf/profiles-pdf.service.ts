import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from "@nestjs/common";
import puppeteer, { type Browser } from "puppeteer";
import {
  ProfilesService,
  type ProfileDetail,
} from "../profiles/profiles.service";
import type { SearchProfilesQueryDto } from "../profiles/dto/search-profiles.query";
import { buildCaseHtml, buildProfilesSummaryHtml } from "./html-builder";

export type RenderedPdf = {
  buffer: Buffer;
  filename: string;
  asciiFallback: string;
};

@Injectable()
export class ProfilesPdfService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProfilesPdfService.name);
  private browser: Browser | null = null;
  private starting: Promise<Browser> | null = null;

  constructor(private readonly profiles: ProfilesService) {}

  // --- Lifecycle ----------------------------------------------------------

  async onModuleInit(): Promise<void> {
    // Eagerly start the browser so the first request isn't slow.
    // Swallow errors so a dev without Chromium can still boot the app
    // (the first real request will surface the error clearly).
    try {
      await this.getBrowser();
      this.logger.log("PDF browser ready");
    } catch (error) {
      this.logger.error(
        `PDF browser failed to start: ${error instanceof Error ? error.message : error}`,
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
          "--disable-dev-shm-usage", // avoids /dev/shm exhaustion in Docker
        ],
      })
      .then((browser) => {
        this.browser = browser;
        this.starting = null;
        browser.on("disconnected", () => {
          this.browser = null;
          this.logger.warn(
            "PDF browser disconnected; will relaunch on next request",
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

  // --- Public API ---------------------------------------------------------

  async render(profileId: string): Promise<RenderedPdf> {
    // ProfilesService.findOne throws NotFoundException if missing.
    const profile = await this.profiles.findOne(profileId);
    const html = await buildCaseHtml(profile);
    const buffer = await this.renderPdf(html);
    return {
      buffer,
      filename: this.filenameFor(profile),
      asciiFallback: `case-${profile.id.slice(0, 8)}.pdf`,
    };
  }

  async renderAll(query: SearchProfilesQueryDto): Promise<RenderedPdf> {
    const profiles = await this.profiles.searchAll(query);
    const html = await buildProfilesSummaryHtml(profiles);
    const buffer = await this.renderPdf(html);
    const date = new Date().toISOString().slice(0, 10);
    return {
      buffer,
      filename: `case-summaries-${date}.pdf`,
      asciiFallback: `case-summaries-${date}.pdf`,
    };
  }

  private async renderPdf(html: string): Promise<Buffer> {
    const browser = await this.getBrowserSafe();
    const page = await browser.newPage();
    try {
      // setContent avoids needing a running HTTP server for our own HTML.
      // domcontentloaded is fast and enough for static content.
      await page.setContent(html, { waitUntil: "domcontentloaded" });
      const pdf = await page.pdf({
        format: "A4",
        printBackground: true,
        // Prefer CSS @page margins; if you'd rather set them here, use:
        // margin: { top: '18mm', bottom: '22mm', left: '16mm', right: '16mm' },
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
        `Could not start PDF browser: ${error instanceof Error ? error.message : error}`,
      );
      throw new ServiceUnavailableException("PDF generation is unavailable");
    }
  }

  private filenameFor(profile: ProfileDetail): string {
    const name = profile.canonicalName ?? "";
    const safe = name
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}_\- ]+/gu, "") // keep letters, digits, _, -, space
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 80);
    return `case-${safe || profile.id.slice(0, 8)}.pdf`;
  }
}
