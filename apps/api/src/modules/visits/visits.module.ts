import { Module } from '@nestjs/common';
import { ClinicalOrdersModule } from '../clinical-orders/clinical-orders.module';
import { LabModule } from '../lab/lab.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PatientsModule } from '../patients/patients.module';
import { VisitsService } from './visits.service';
import { VisitsController, VisitTemplatesController } from './visits.controller';
import { DirectoriesController } from './directories.controller';

@Module({
  imports: [LabModule, ClinicalOrdersModule, NotificationsModule, PatientsModule],
  controllers: [VisitsController, VisitTemplatesController, DirectoriesController],
  providers: [VisitsService],
  exports: [VisitsService],
})
export class VisitsModule {}
