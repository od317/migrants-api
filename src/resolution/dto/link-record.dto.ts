import {
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MatchMethod } from '@prisma/client';

export class LinkRecordDto {
  @IsUUID()
  masterProfileId!: string;

  @IsUUID()
  rawRecordId!: string;

  @IsNumber()
  @Min(0)
  @Max(1)
  confidenceScore!: number;

  @IsOptional()
  @IsEnum(MatchMethod)
  matchMethod?: MatchMethod;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  linkedBy?: string;

  @IsOptional()
  @IsObject()
  matchedOn?: Record<string, unknown>;
}
