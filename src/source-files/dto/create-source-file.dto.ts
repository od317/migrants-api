import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { SourceFileFormat } from '@prisma/client';

export class CreateSourceFileDto {
  @IsUUID()
  organizationId!: string;

  @IsString()
  @MaxLength(500)
  originalFilename!: string;

  @IsString()
  @MaxLength(1000)
  storageKey!: string;

  @IsEnum(SourceFileFormat)
  format!: SourceFileFormat;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  mimeType?: string;

  @IsString()
  @Matches(/^[a-f0-9]{64}$/i)
  checksumSha256!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  byteSize?: number;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
