import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class OpenProfileDto {
  @IsUUID()
  rawRecordId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  linkedBy?: string;
}
