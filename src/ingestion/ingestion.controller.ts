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
import {
  DATASET_UPLOAD_MAX_BYTES,
  DatasetUploadService,
  sourceFileUploadOptions,
} from './dataset-upload.service';
import { ProcessFileDto } from './dto/process-file.dto';
import { UploadDatasetDto } from './dto/upload-dataset.dto';
import { IngestionService, UPLOAD_MAX_BYTES } from './ingestion.service';
import { DatasetUploadExceptionFilter, UploadExceptionFilter } from './upload-exception.filter';

@ApiTags('ingestion')
@Controller('ingestion')
export class IngestionController {
  constructor(
    private readonly ingestionService: IngestionService,
    private readonly datasetUpload: DatasetUploadService,
  ) {}

  @Post('upload')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Upload a dataset and ingest it',
    description:
      'Accepts a CSV or XLSX file up to 50 MB, stores it under uploads/sources, and runs the IOM or HDX adapter. AUTO_DETECT chooses the adapter from the file headers.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'datasetType'],
      properties: {
        file: { type: 'string', format: 'binary' },
        datasetType: {
          type: 'string',
          enum: ['IOM_MISSING_MIGRANTS', 'HDX_CONFLICT', 'AUTO_DETECT'],
        },
        organizationId: { type: 'string', format: 'uuid' },
      },
    },
  })
  @UseFilters(DatasetUploadExceptionFilter)
  @UseInterceptors(
    FileInterceptor('file', {
      ...sourceFileUploadOptions(),
      limits: { fileSize: DATASET_UPLOAD_MAX_BYTES },
    }),
  )
  uploadDataset(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadDatasetDto,
  ) {
    return this.datasetUpload.upload(file, dto);
  }

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
