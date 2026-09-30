import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ApiModule } from './api/api.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { redisConnection } from './ingestion/redis-connection';
import { MasterProfilesModule } from './master-profiles/master-profiles.module';
import { MatchingModule } from './matching/matching.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProfileLinkagesModule } from './profile-linkages/profile-linkages.module';
import { RawRecordsModule } from './raw-records/raw-records.module';
import { ResolutionModule } from './resolution/resolution.module';
import { SourceFilesModule } from './source-files/source-files.module';

@Module({
  imports: [
    PrismaModule,
    BullModule.forRoot({
      connection: redisConnection(),
      prefix: 'migrants',
    }),
    ApiModule,
    IngestionModule,
    MatchingModule,
    OrganizationsModule,
    SourceFilesModule,
    RawRecordsModule,
    MasterProfilesModule,
    ProfileLinkagesModule,
    ResolutionModule,
  ],
})
export class AppModule {}
