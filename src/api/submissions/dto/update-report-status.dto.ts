import { ApiProperty } from '@nestjs/swagger';
import { MissingPersonReportStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateReportStatusDto {
  @ApiProperty({ enum: MissingPersonReportStatus })
  @IsEnum(MissingPersonReportStatus)
  status!: MissingPersonReportStatus;
}
