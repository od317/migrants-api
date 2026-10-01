import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EvidenceType } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateIncidentEvidenceDto {
  @ApiProperty({ enum: EvidenceType })
  @IsEnum(EvidenceType)
  type!: EvidenceType;

  @ApiProperty({ maxLength: 200 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiProperty({ description: 'Markdown or rich text' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  description!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => blankToUndefined(value))
  @IsString()
  @MaxLength(2000)
  fileUrl?: string;

  @ApiPropertyOptional({ example: 'Anonymous Researcher' })
  @IsOptional()
  @Transform(({ value }) => blankToUndefined(value))
  @IsString()
  @MaxLength(200)
  submittedBy?: string;
}

function blankToUndefined(value: unknown): unknown {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  }
  return value;
}
