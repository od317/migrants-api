import { ApiPropertyOptional } from '@nestjs/swagger';
import { MissingPersonReportStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListSubmissionsQueryDto {
  @ApiPropertyOptional({ enum: MissingPersonReportStatus, example: 'PENDING_REVIEW' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @IsEnum(MissingPersonReportStatus)
  status?: MissingPersonReportStatus;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
