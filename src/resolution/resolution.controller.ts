import {
  Body,
  Controller,
  Delete,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { LinkRecordDto } from './dto/link-record.dto';
import { OpenProfileDto } from './dto/open-profile.dto';
import { RecordLinkageService } from './record-linkage.service';
import { ResolutionService } from './resolution.service';

@Controller('resolution')
export class ResolutionController {
  constructor(
    private readonly resolutionService: ResolutionService,
    private readonly recordLinkageService: RecordLinkageService,
  ) {}

  @Post('profiles')
  openFromRecord(@Body() dto: OpenProfileDto) {
    return this.resolutionService.openFromRecord(dto);
  }

  @Post('links')
  link(@Body() dto: LinkRecordDto) {
    return this.resolutionService.link(dto);
  }

  @Delete('links/:id')
  unlink(@Param('id', ParseUUIDPipe) id: string) {
    return this.resolutionService.unlink(id);
  }

  @Post('profiles/:id/recompute')
  recompute(@Param('id', ParseUUIDPipe) id: string) {
    return this.resolutionService.recompute(id);
  }

  @Post('profiles/:id/conflicts')
  detectConflicts(@Param('id', ParseUUIDPipe) id: string) {
    return this.recordLinkageService.detectConflicts(id);
  }
}
