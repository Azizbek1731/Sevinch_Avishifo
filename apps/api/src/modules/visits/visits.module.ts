import { Module } from '@nestjs/common';
import { LabModule } from '../lab/lab.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { VisitsService } from './visits.service';
import { VisitsController, VisitTemplatesController } from './visits.controller';
import { DirectoriesController } from './directories.controller';

@Module({
  imports: [LabModule, NotificationsModule],
  controllers: [VisitsController, VisitTemplatesController, DirectoriesController],
  providers: [VisitsService],
  exports: [VisitsService],
})
export class VisitsModule {}
