import {
  IsDateString,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { VitalStatus } from '@prisma/client';

export class CreateRawRecordDto {
  @IsUUID()
  sourceFileId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  sourceLocator?: string;

  @IsObject()
  payload!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  extractedName?: string;

  @IsOptional()
  @IsEnum(VitalStatus)
  vitalStatus?: VitalStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  location?: string;

  /** Calendar day the status was observed, as YYYY-MM-DD. */
  @IsOptional()
  @IsDateString()
  eventDate?: string;

  @IsOptional()
  @IsDateString()
  reportedAt?: string;
}
