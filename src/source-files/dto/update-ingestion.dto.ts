import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { IngestionStatus } from '@prisma/client';

export class UpdateIngestionDto {
  @IsEnum(IngestionStatus)
  ingestionStatus!: IngestionStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  recordCount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  errorMessage?: string;
}
