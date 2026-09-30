import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { pageWindow } from '../common/page-window';
import { MasterProfilesService } from './master-profiles.service';

@Controller('master-profiles')
export class MasterProfilesController {
  constructor(private readonly masterProfilesService: MasterProfilesService) {}

  @Get()
  findAll(
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('hasConflict') hasConflict?: string,
  ) {
    const page = pageWindow(skip, take);
    return this.masterProfilesService.findAll(
      page.skip,
      page.take,
      parseConflictFilter(hasConflict),
    );
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.masterProfilesService.findOne(id);
  }
}

function parseConflictFilter(value?: string): boolean | undefined {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return undefined;
}
