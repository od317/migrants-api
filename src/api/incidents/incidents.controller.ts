import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ListIncidentsQueryDto } from './dto/list-incidents.query';
import { IncidentsService } from './incidents.service';

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
}
