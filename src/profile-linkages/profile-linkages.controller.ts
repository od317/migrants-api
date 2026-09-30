import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { pageWindow } from '../common/page-window';
import { ProfileLinkagesService } from './profile-linkages.service';

@Controller('profile-linkages')
export class ProfileLinkagesController {
  constructor(
    private readonly profileLinkagesService: ProfileLinkagesService,
  ) {}

  @Get()
  findAll(
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('masterProfileId', new ParseUUIDPipe({ optional: true }))
    masterProfileId?: string,
  ) {
    const page = pageWindow(skip, take);
    return this.profileLinkagesService.findAll(
      page.skip,
      page.take,
      masterProfileId,
    );
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.profileLinkagesService.findOne(id);
  }
}
