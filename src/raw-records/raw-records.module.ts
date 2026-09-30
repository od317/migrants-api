import { Module } from '@nestjs/common';
import { RawRecordsController } from './raw-records.controller';
import { RawRecordsService } from './raw-records.service';

@Module({
  controllers: [RawRecordsController],
  providers: [RawRecordsService],
  exports: [RawRecordsService],
})
export class RawRecordsModule {}
