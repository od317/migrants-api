import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { pageWindow } from '../common/page-window';
import { CreateRawRecordDto } from './dto/create-raw-record.dto';
import { RawRecordsService } from './raw-records.service';

@Controller('raw-records')
export class RawRecordsController {
  constructor(private readonly rawRecordsService: RawRecordsService) {}

  @Post()
  create(@Body() dto: CreateRawRecordDto) {
    return this.rawRecordsService.create(dto);
  }

  @Get()
  findAll(
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('sourceFileId', new ParseUUIDPipe({ optional: true }))
    sourceFileId?: string,
  ) {
    const page = pageWindow(skip, take);
    return this.rawRecordsService.findAll(page.skip, page.take, sourceFileId);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.rawRecordsService.findOne(id);
  }
}
