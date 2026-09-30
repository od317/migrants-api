import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SourcesService } from './sources.service';

@ApiTags('sources')
@Controller('sources')
export class SourcesController {
  constructor(private readonly sourcesService: SourcesService) {}

  @Get()
  @ApiOperation({
    summary: 'List source organizations',
    description:
      'Registered organizations with their mandate, methodology, reliability rating, and total raw records ingested.',
  })
  list() {
    return this.sourcesService.list();
  }
}
