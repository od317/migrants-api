import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SearchProfilesQueryDto } from './dto/search-profiles.query';
import { ProfilesService } from './profiles.service';

@ApiTags('profiles')
@Controller('profiles')
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) {}

  @Get('search')
  @ApiOperation({
    summary: 'Search golden-record profiles',
    description:
      'Paginated MasterProfile summaries from PostgreSQL. query searches the canonical name and known spellings, including Arabic prefix folding. Each row includes the linked organization count and the active contradiction flag.',
  })
  search(@Query() query: SearchProfilesQueryDto) {
    return this.profilesService.search(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get one golden record',
    description:
      'Returns the resolved profile, linked raw records grouped by event year, and source metadata for each observation. Conflicted profiles include the contradiction report.',
  })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.profilesService.findOne(id);
  }
}
