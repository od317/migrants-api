import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateMissingPersonReportDto {
  @ApiProperty({ description: 'Stored encrypted. Not returned by the public response.' })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  reporterName!: string;

  @ApiProperty({ description: 'Phone or email. Stored encrypted.' })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  @Matches(/^([^\s@]+@[^\s@]+\.[^\s@]+|\+?[0-9][0-9\s().-]{6,})$/, {
    message: 'reporterContact must be an email address or a phone number',
  })
  reporterContact!: string;

  @ApiProperty({ description: 'Relationship to the missing person. Stored encrypted.' })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  relationship!: string;

  @ApiProperty()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  missingPersonName!: string;

  @ApiProperty({ description: 'Approximate age in years', minimum: 0, maximum: 120 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(120)
  approximateAge!: number;

  @ApiPropertyOptional({ example: '2015-04-18' })
  @IsOptional()
  @Transform(({ value }) => blankToUndefined(value))
  @IsDateString()
  dateOfLoss?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => blankToUndefined(value))
  @IsString()
  @MaxLength(300)
  lastKnownLocation?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => blankToUndefined(value))
  @IsString()
  @MaxLength(5000)
  smugglerDetails?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => blankToUndefined(value))
  @IsString()
  @MaxLength(5000)
  physicalMarks?: string;
}

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function blankToUndefined(value: unknown): unknown {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  }
  return value;
}
