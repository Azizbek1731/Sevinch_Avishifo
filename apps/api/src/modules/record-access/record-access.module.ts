import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { RecordAccessController } from './record-access.controller';
import { RecordAccessService } from './record-access.service';

@Module({
  imports: [NotificationsModule],
  controllers: [RecordAccessController],
  providers: [RecordAccessService],
  // The portal reads the same access state to gate its history endpoints.
  exports: [RecordAccessService],
})
export class RecordAccessModule {}
