import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ProcessFileDto } from './dto/process-file.dto';
import { IngestionService, UPLOAD_MAX_BYTES } from './ingestion.service';
import { UploadExceptionFilter } from './upload-exception.filter';

@ApiTags('ingestion')
@Controller('ingestion')
export class IngestionController {
  constructor(private readonly ingestionService: IngestionService) {}

  @Post('upload/:organizationId')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Upload a CSV or XLSX file and start ingestion',
    description:
      'Saves the file, records a PENDING SourceFile, and queues a data-ingestion job. Returns before parsing finishes.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @UseFilters(UploadExceptionFilter)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: UPLOAD_MAX_BYTES },
    }),
  )
  uploadFile(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.ingestionService.receiveUpload(organizationId, file);
  }

  @Get('status/:jobId')
  @ApiOperation({
    summary: 'Check ingestion queue progress',
    description:
      'Returns the BullMQ job state, rows processed, and the SourceFile status for a data-ingestion job.',
  })
  jobStatus(@Param('jobId') jobId: string) {
    return this.ingestionService.getJobStatus(jobId);
  }

  @Post('source-files/:fileId/process')
  @ApiOperation({
    summary: 'Ingest a source file that is already stored',
  })
  processFile(
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Body() dto: ProcessFileDto,
  ) {
    return this.ingestionService.processFile(fileId, dto.organizationId);
  }
}
