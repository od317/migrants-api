import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { createReadStream } from 'node:fs';
import { CreateIncidentEvidenceDto } from './dto/create-incident-evidence.dto';
import { ListIncidentsQueryDto } from './dto/list-incidents.query';
import { EvidenceUploadExceptionFilter } from './evidence-upload.filter';
import { evidenceUploadOptions, IncidentsService } from './incidents.service';

@ApiTags('incidents')
@Controller('incidents')
export class IncidentsController {
  constructor(private readonly incidentsService: IncidentsService) {}

  @Get('stats')
  @ApiOperation({
    summary: 'Aggregate Syrian incident statistics',
    description:
      'Total casualties, a breakdown by migration route, and the five sources that reported the most incidents.',
  })
  stats() {
    return this.incidentsService.stats();
  }

  @Get()
  @ApiOperation({
    summary: 'List ingested Syrian incidents',
    description:
      'Filter by migration route, year, or reporting organization. Results are paginated with limit and offset.',
  })
  list(@Query() query: ListIncidentsQueryDto) {
    return this.incidentsService.list(query);
  }

  @Get(':id/evidence/:evidenceId/file')
  @ApiOperation({ summary: 'Download an evidence attachment' })
  async evidenceFile(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('evidenceId', ParseUUIDPipe) evidenceId: string,
    @Res() response: Response,
  ) {
    const file = await this.incidentsService.evidenceFile(id, evidenceId);
    response.setHeader('Content-Disposition', `inline; filename="${file.filename}"`);
    createReadStream(file.absolute).pipe(response);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get an incident dossier',
    description:
      'Returns the incident, source claims that share its date and coordinates, attached evidence, and a contradiction block when those claims disagree.',
  })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.incidentsService.findOne(id);
  }

  @Post(':id/evidence')
  @ApiOperation({
    summary: 'Submit evidence for an incident',
    description:
      'Stores a leak, testimony, link, or document. A file up to 15 MB may be attached. New submissions stay unverified until they are reviewed.',
  })
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({ type: CreateIncidentEvidenceDto })
  @UseFilters(EvidenceUploadExceptionFilter)
  @UseInterceptors(FileInterceptor('file', evidenceUploadOptions()))
  addEvidence(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateIncidentEvidenceDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.incidentsService.addEvidence(id, dto, file);
  }
}
