import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { LabService } from './lab.service';
import { LabCatalogService } from './catalog.service';
import { ResultsService } from './results.service';
import { LabCatalogController, LabOrdersController, LabTestsController } from './lab.controller';

@Module({
  imports: [NotificationsModule],
  controllers: [LabCatalogController, LabTestsController, LabOrdersController],
  providers: [LabService, LabCatalogService, ResultsService],
  exports: [LabService],
})
export class LabModule {}
