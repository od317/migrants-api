import { Module } from '@nestjs/common';
import { SourceFilesController } from './source-files.controller';
import { SourceFilesService } from './source-files.service';

@Module({
  controllers: [SourceFilesController],
  providers: [SourceFilesService],
  exports: [SourceFilesService],
})
export class SourceFilesModule {}
