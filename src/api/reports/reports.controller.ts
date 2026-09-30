import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get()
  @ApiOperation({
    summary: 'List ingested source reports',
    description:
      'Source files stored in PostgreSQL, with the publishing organization and the live ingested record count.',
  })
  list() {
    return this.reportsService.list();
  }
}
