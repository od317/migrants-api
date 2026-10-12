import { ApiPropertyOptional } from "@nestjs/swagger";
import { EvidenceType, VitalStatus } from "@prisma/client";
import { Transform, Type } from "class-transformer";
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export const INCIDENT_SORTS = [
  "date_desc",
  "date_asc",
  "casualties_desc",
  "casualties_asc",
] as const;

export type IncidentSort = (typeof INCIDENT_SORTS)[number];

export class ListIncidentsQueryDto {
  // ---- Free text ---------------------------------------------------------

  @ApiPropertyOptional({
    description:
      "Free text search across location, name, and source notes (substring match).",
    maxLength: 200,
  })
  @IsOptional()
  @Transform(({ value }) => blankToUndefined(value))
  @IsString()
  @MaxLength(200)
  search?: string;

  // ---- Categorical filters -----------------------------------------------

  @ApiPropertyOptional({
    description:
      "Migration route, matched as a substring. Example: Eastern Mediterranean",
    maxLength: 200,
  })
  @IsOptional()
  @Transform(({ value }) => blankToUndefined(value))
  @IsString()
  @MaxLength(200)
  route?: string;

  @ApiPropertyOptional({
    description: "Cause of death, matched as a substring. Example: drowning",
    maxLength: 200,
  })
  @IsOptional()
  @Transform(({ value }) => blankToUndefined(value))
  @IsString()
  @MaxLength(200)
  causeOfDeath?: string;

  @ApiPropertyOptional({
    enum: VitalStatus,
    description:
      "Incident status. Defaults to DECEASED_OR_MISSING when omitted.",
  })
  @IsOptional()
  @Transform(({ value }) => blankToUndefined(value))
  @IsEnum(VitalStatus)
  status?: VitalStatus;

  @ApiPropertyOptional({ description: "Reporting organization name" })
  @IsOptional()
  @Transform(({ value }) => blankToUndefined(value))
  @IsString()
  @MaxLength(200)
  sourceOrg?: string;

  // ---- Date range --------------------------------------------------------

  @ApiPropertyOptional({ example: 2015, minimum: 1990, maximum: 2100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1990)
  @Max(2100)
  year?: number;

  @ApiPropertyOptional({
    example: "2015-01-01",
    description: "Inclusive start date (YYYY-MM-DD). Overrides year if set.",
  })
  @IsOptional()
  @Transform(({ value }) => blankToUndefined(value))
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: "dateFrom must be a calendar date (YYYY-MM-DD)",
  })
  dateFrom?: string;

  @ApiPropertyOptional({
    example: "2015-12-31",
    description: "Inclusive end date (YYYY-MM-DD). Overrides year if set.",
  })
  @IsOptional()
  @Transform(({ value }) => blankToUndefined(value))
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: "dateTo must be a calendar date (YYYY-MM-DD)",
  })
  dateTo?: string;

  // ---- Casualties range --------------------------------------------------

  @ApiPropertyOptional({
    minimum: 0,
    description: "Minimum total casualties (inclusive).",
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minCasualties?: number;

  @ApiPropertyOptional({
    minimum: 0,
    description: "Maximum total casualties (inclusive).",
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxCasualties?: number;

  // ---- Evidence ----------------------------------------------------------

  @ApiPropertyOptional({
    description: "Only incidents with attached evidence.",
  })
  @IsOptional()
  @Transform(({ value }) => parseBooleanQuery(value))
  @IsBoolean()
  hasEvidence?: boolean;

  @ApiPropertyOptional({
    enum: EvidenceType,
    description:
      "Only incidents that have at least one piece of evidence of this type.",
  })
  @IsOptional()
  @Transform(({ value }) => blankToUndefined(value))
  @IsEnum(EvidenceType)
  evidenceType?: EvidenceType;

  // ---- Sorting -----------------------------------------------------------

  @ApiPropertyOptional({
    enum: INCIDENT_SORTS,
    default: "date_desc",
    description:
      "Sort order. Date sorts use eventDate (nulls last). Casualty sorts use metadata.totalCasualties.",
  })
  @IsOptional()
  @Transform(({ value }) => blankToUndefined(value))
  @IsIn(INCIDENT_SORTS as unknown as string[])
  sort?: IncidentSort;

  // ---- Pagination --------------------------------------------------------

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
}

function blankToUndefined(value: unknown): unknown {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }
  return value;
}

function parseBooleanQuery(value: unknown): unknown {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (value === true || value === "true") {
    return true;
  }
  if (value === false || value === "false") {
    return false;
  }
  return value;
}
