import { Module } from "@nestjs/common";
import { ApiModule } from "../api.module";
import { ProfilesPdfService } from "./profiles-pdf.service";

@Module({
  imports: [ApiModule],
  providers: [ProfilesPdfService],
  exports: [ProfilesPdfService],
})
export class ProfilesPdfModule {}
