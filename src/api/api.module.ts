import { Module } from "@nestjs/common";
import { ResolutionModule } from "../resolution/resolution.module";
import { IncidentsController } from "./incidents/incidents.controller";
import { IncidentsService } from "./incidents/incidents.service";
import { IncidentsPdfService } from "./incidents-pdf/incidents-pdf.service"; // ← new
import { ProfilesController } from "./profiles/profiles.controller";
import { ProfilesService } from "./profiles/profiles.service";
import { ProfilesPdfService } from "./profiles-pdf/profiles-pdf.service"; // ← from earlier
import { ReportsController } from "./reports/reports.controller";
import { ReportsService } from "./reports/reports.service";
import { AdminGuard } from "./guards/admin.guard";
import { SubmissionsController } from "./submissions/submissions.controller";
import { SubmissionsService } from "./submissions/submissions.service";
import { SourcesController } from "./sources/sources.controller";
import { SourcesService } from "./sources/sources.service";

@Module({
  imports: [ResolutionModule],
  controllers: [
    ProfilesController,
    SourcesController,
    IncidentsController,
    ReportsController,
    SubmissionsController,
  ],
  providers: [
    ProfilesService,
    ProfilesPdfService, // from earlier
    IncidentsService,
    IncidentsPdfService, // ← new
    SourcesService,
    ReportsService,
    SubmissionsService,
    AdminGuard,
  ],
  exports: [IncidentsService, ProfilesService],
})
export class ApiModule {}
