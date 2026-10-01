import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';

export enum DatasetType {
  IOM_MISSING_MIGRANTS = 'IOM_MISSING_MIGRANTS',
  HDX_CONFLICT = 'HDX_CONFLICT',
  AUTO_DETECT = 'AUTO_DETECT',
}

export class UploadDatasetDto {
  @ApiProperty({ enum: DatasetType, example: DatasetType.AUTO_DETECT })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsEnum(DatasetType)
  datasetType!: DatasetType;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @Transform(({ value }) => blankToUndefined(value))
  @IsUUID()
  organizationId?: string;
}

function blankToUndefined(value: unknown): unknown {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  }
  return value;
}
