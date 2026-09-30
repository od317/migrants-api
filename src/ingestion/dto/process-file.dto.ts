import { IsUUID } from 'class-validator';

export class ProcessFileDto {
  @IsUUID()
  organizationId!: string;
}
