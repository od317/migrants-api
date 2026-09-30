import { Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { MatchingService } from './matching.service';

@Controller('matching')
export class MatchingController {
  constructor(private readonly matchingService: MatchingService) {}

  @Post('raw-records/:id/link')
  linkRecordToProfile(@Param('id', ParseUUIDPipe) id: string) {
    return this.matchingService.linkRecordToProfile(id);
  }
}
