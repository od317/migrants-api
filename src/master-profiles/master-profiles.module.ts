import { Module } from '@nestjs/common';
import { MasterProfilesController } from './master-profiles.controller';
import { MasterProfilesService } from './master-profiles.service';

@Module({
  controllers: [MasterProfilesController],
  providers: [MasterProfilesService],
  exports: [MasterProfilesService],
})
export class MasterProfilesModule {}
