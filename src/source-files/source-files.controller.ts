import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { pageWindow } from '../common/page-window';
import { CreateSourceFileDto } from './dto/create-source-file.dto';
import { UpdateIngestionDto } from './dto/update-ingestion.dto';
import { SourceFilesService } from './source-files.service';

@Controller('source-files')
export class SourceFilesController {
  constructor(private readonly sourceFilesService: SourceFilesService) {}

  @Post()
  create(@Body() dto: CreateSourceFileDto) {
    return this.sourceFilesService.create(dto);
  }

  @Get()
  findAll(
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('organizationId', new ParseUUIDPipe({ optional: true }))
    organizationId?: string,
  ) {
    const page = pageWindow(skip, take);
    return this.sourceFilesService.findAll(page.skip, page.take, organizationId);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.sourceFilesService.findOne(id);
  }

  @Patch(':id/ingestion')
  updateIngestion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateIngestionDto,
  ) {
    return this.sourceFilesService.updateIngestion(id, dto);
  }
}
