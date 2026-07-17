import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { LabService } from './lab.service';
import { ResultsService } from './results.service';
import { LabOrdersController, LabTestsController } from './lab.controller';

@Module({
  imports: [NotificationsModule],
  controllers: [LabTestsController, LabOrdersController],
  providers: [LabService, ResultsService],
  exports: [LabService],
})
export class LabModule {}
