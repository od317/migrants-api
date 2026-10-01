import { Injectable, NotFoundException } from '@nestjs/common';
import { MissingPersonReportStatus, Prisma, VitalStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { decryptField, encryptField } from './report-cipher';
import { CreateMissingPersonReportDto } from './dto/create-missing-person-report.dto';
import { rankIncidentSuggestions, suggestionDateWindow, type RankedSuggestion } from './suggestion-rank';

const INCIDENT_STATUSES: VitalStatus[] = [
  VitalStatus.DECEASED_OR_MISSING,
  VitalStatus.FATALITY_EVENT,
  VitalStatus.CONFLICT_EVENT,
  VitalStatus.DECEASED,
  VitalStatus.MISSING,
];

export type PublicReportReceipt = {
  id: string;
  missingPersonName: string;
  dateOfLoss: string | null;
  lastKnownLocation: string | null;
  status: MissingPersonReportStatus;
  createdAt: Date;
};

export type AdminReport = PublicReportReceipt & {
  reporterName: string;
  reporterContact: string;
  relationship: string | null;
  approximateAge: number | null;
  smugglerDetails: string | null;
  physicalMarks: string | null;
};

export type SubmissionSuggestions = {
  suggestions: RankedSuggestion[];
};

@Injectable()
export class SubmissionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateMissingPersonReportDto): Promise<PublicReportReceipt> {
    const report = await this.prisma.missingPersonReport.create({
      data: {
        reporterName: encryptField(dto.reporterName),
        reporterContact: encryptField(dto.reporterContact),
        relationship: encryptField(dto.relationship),
        missingPersonName: dto.missingPersonName,
        approximateAge: dto.approximateAge,
        dateOfLoss: dto.dateOfLoss ? new Date(`${dto.dateOfLoss.slice(0, 10)}T00:00:00.000Z`) : null,
        lastKnownLocation: dto.lastKnownLocation ?? null,
        smugglerDetails: dto.smugglerDetails ?? null,
        physicalMarks: dto.physicalMarks ?? null,
        status: MissingPersonReportStatus.PENDING_REVIEW,
      },
    });

    return toPublicReceipt(report);
  }

  async listForAdmin(): Promise<AdminReport[]> {
    const reports = await this.prisma.missingPersonReport.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return reports.map((report) => toAdminReport(report));
  }

  async suggestions(id: string): Promise<SubmissionSuggestions> {
    const report = await this.prisma.missingPersonReport.findUnique({ where: { id } });
    if (!report) {
      throw new NotFoundException('Report not found');
    }

    const window = suggestionDateWindow(report.dateOfLoss);
    const records = await this.prisma.rawRecord.findMany({
      where: {
        vitalStatus: { in: INCIDENT_STATUSES },
        ...(window ? { eventDate: window } : {}),
      },
      take: window ? 300 : 120,
      orderBy: { eventDate: 'desc' },
      select: {
        id: true,
        eventDate: true,
        location: true,
        payload: true,
      },
    });

    return {
      suggestions: rankIncidentSuggestions(
        { dateOfLoss: report.dateOfLoss, lastKnownLocation: report.lastKnownLocation },
        records.map((record) => {
          const details = readIncidentDetails(record.payload);
          return {
            id: record.id,
            eventDate: record.eventDate,
            location: record.location,
            route: details.route,
            casualties: details.casualties,
          };
        }),
      ),
    };
  }

  async updateStatus(id: string, status: MissingPersonReportStatus): Promise<AdminReport> {
    try {
      const report = await this.prisma.missingPersonReport.update({
        where: { id },
        data: { status },
      });
      return toAdminReport(report);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException('Report not found');
      }
      throw error;
    }
  }
}

function toAdminReport(report: {
  id: string;
  missingPersonName: string;
  dateOfLoss: Date | null;
  lastKnownLocation: string | null;
  status: MissingPersonReportStatus;
  createdAt: Date;
  reporterName: string;
  reporterContact: string;
  relationship: string | null;
  approximateAge: number | null;
  smugglerDetails: string | null;
  physicalMarks: string | null;
}): AdminReport {
  return {
    ...toPublicReceipt(report),
    reporterName: decryptField(report.reporterName),
    reporterContact: decryptField(report.reporterContact),
    relationship: report.relationship ? decryptField(report.relationship) : null,
    approximateAge: report.approximateAge,
    smugglerDetails: report.smugglerDetails,
    physicalMarks: report.physicalMarks,
  };
}

function toPublicReceipt(report: {
  id: string;
  missingPersonName: string;
  dateOfLoss: Date | null;
  lastKnownLocation: string | null;
  status: MissingPersonReportStatus;
  createdAt: Date;
}): PublicReportReceipt {
  return {
    id: report.id,
    missingPersonName: report.missingPersonName,
    dateOfLoss: report.dateOfLoss ? report.dateOfLoss.toISOString().slice(0, 10) : null,
    lastKnownLocation: report.lastKnownLocation,
    status: report.status,
    createdAt: report.createdAt,
  };
}

function readIncidentDetails(payload: Prisma.JsonValue): { route: string | null; casualties: number | null } {
  const root = asObject(payload);
  const metadata = asObject(root?.metadata);
  const casualties = metadata?.totalCasualties;
  return {
    route: typeof metadata?.route === 'string' ? metadata.route : null,
    casualties: typeof casualties === 'number' && Number.isFinite(casualties) ? Math.trunc(casualties) : null,
  };
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
