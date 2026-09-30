import { ApiPropertyOptional } from '@nestjs/swagger';
import { VitalStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class SearchProfilesQueryDto {
  @ApiPropertyOptional({
    description:
      'Case-insensitive name search across the canonical name and known spellings, with Arabic prefix folding',
    maxLength: 200,
  })
  @IsOptional()
  @Transform(({ value }) => blankToUndefined(value))
  @IsString()
  @MaxLength(200)
  query?: string;

  @ApiPropertyOptional({
    description: 'Alias of query',
    maxLength: 200,
  })
  @IsOptional()
  @Transform(({ value }) => blankToUndefined(value))
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({
    description: 'Match the resolved location or governorate',
    maxLength: 200,
  })
  @IsOptional()
  @Transform(({ value }) => blankToUndefined(value))
  @IsString()
  @MaxLength(200)
  governorate?: string;

  @ApiPropertyOptional({ example: 1990, minimum: 1850, maximum: 2100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1850)
  @Max(2100)
  yearOfBirth?: number;

  @ApiPropertyOptional({ enum: VitalStatus })
  @IsOptional()
  @Transform(({ value }) => blankToUndefined(value))
  @IsEnum(VitalStatus)
  status?: VitalStatus;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(({ value }) => parseBooleanQuery(value))
  @IsBoolean()
  hasConflict?: boolean;

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

  @ApiPropertyOptional({ default: 0, minimum: 0, description: 'Alias of offset' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 100, description: 'Alias of limit' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number;
}

function blankToUndefined(value: unknown): unknown {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  }
  return value;
}

function parseBooleanQuery(value: unknown): unknown {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (value === true || value === 'true') {
    return true;
  }
  if (value === false || value === 'false') {
    return false;
  }
  return value;
}
