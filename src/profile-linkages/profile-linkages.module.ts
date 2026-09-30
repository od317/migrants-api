import { Module } from '@nestjs/common';
import { ProfileLinkagesController } from './profile-linkages.controller';
import { ProfileLinkagesService } from './profile-linkages.service';

@Module({
  controllers: [ProfileLinkagesController],
  providers: [ProfileLinkagesService],
  exports: [ProfileLinkagesService],
})
export class ProfileLinkagesModule {}
