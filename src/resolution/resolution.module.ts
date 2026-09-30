import { Module } from '@nestjs/common';
import { RecordLinkageService } from './record-linkage.service';
import { ResolutionController } from './resolution.controller';
import { ResolutionService } from './resolution.service';

@Module({
  controllers: [ResolutionController],
  providers: [ResolutionService, RecordLinkageService],
  exports: [ResolutionService, RecordLinkageService],
})
export class ResolutionModule {}
