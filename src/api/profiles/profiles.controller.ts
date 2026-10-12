import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
} from "@nestjs/common";
import { ApiOperation, ApiProduces, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { ProfilesPdfService } from "../profiles-pdf/profiles-pdf.service";
import { SearchProfilesQueryDto } from "./dto/search-profiles.query";
import { ProfilesService } from "./profiles.service";

@ApiTags("profiles")
@Controller("profiles")
export class ProfilesController {
  constructor(
    private readonly profilesService: ProfilesService,
    private readonly profilesPdf: ProfilesPdfService, // ← new
  ) {}

  @Get("search")
  @ApiOperation({
    summary: "Search golden-record profiles",
    description: "...",
  })
  search(@Query() query: SearchProfilesQueryDto) {
    return this.profilesService.search(query);
  }

  @Get("pdf")
  @ApiOperation({
    summary: "Download a PDF summary of all cases",
    description:
      "Renders all matching profiles as a paginated summary report. Search filters are supported; pagination parameters are ignored.",
  })
  @ApiProduces("application/pdf")
  async downloadAllPdf(
    @Query() query: SearchProfilesQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    const { buffer, filename, asciiFallback } =
      await this.profilesPdf.renderAll(query);

    response.setHeader(
      "Content-Disposition",
      `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    response.setHeader("Content-Type", "application/pdf");
    response.setHeader("Content-Length", buffer.length.toString());
    response.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    response.end(buffer);
  }

  // IMPORTANT: declare this BEFORE `@Get(':id')`.
  // Nest matches routes in declaration order within a controller.
  // `:id/pdf` has two segments so it wouldn't actually be shadowed by `:id`,
  // but keeping specific routes above generic ones is a habit that prevents bugs.
  @Get(":id/pdf")
  @ApiOperation({
    summary: "Download a case dossier as PDF",
    description:
      "Renders the golden record (identity, timeline, sources, provenance, contradictions) as a printable PDF.",
  })
  @ApiProduces("application/pdf")
  async downloadPdf(
    @Param("id", ParseUUIDPipe) id: string,
    @Res() response: Response,
  ): Promise<void> {
    const { buffer, filename, asciiFallback } =
      await this.profilesPdf.render(id);

    // RFC 6266: send both an ASCII fallback and a UTF-8 encoded name.
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    response.setHeader("Content-Type", "application/pdf");
    response.setHeader("Content-Length", buffer.length.toString());
    // Prevent intermediaries from caching a stale PDF for a profile whose
    // data may change (a new linkage can be added at any time).
    response.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    response.end(buffer);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one golden record", description: "..." })
  findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.profilesService.findOne(id);
  }
}
