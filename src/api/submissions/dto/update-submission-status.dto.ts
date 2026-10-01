import { ApiProperty } from '@nestjs/swagger';
import { MissingPersonReportStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateSubmissionStatusDto {
  @ApiProperty({ enum: MissingPersonReportStatus, example: 'MATCH_FOUND' })
  @IsEnum(MissingPersonReportStatus)
  status!: MissingPersonReportStatus;
}
