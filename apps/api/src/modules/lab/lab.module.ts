import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PatientsModule } from '../patients/patients.module';
import { LabService } from './lab.service';
import { LabCatalogService } from './catalog.service';
import { ResultPdfService } from './result-pdf.service';
import { ResultsService } from './results.service';
import { LabCatalogController, LabOrdersController, LabTestsController } from './lab.controller';
import { PricingService } from '../services/pricing.service';

@Module({
  imports: [NotificationsModule, PatientsModule],
  controllers: [LabCatalogController, LabTestsController, LabOrdersController],
  providers: [LabService, LabCatalogService, ResultsService, ResultPdfService, PricingService],
  exports: [LabService, LabCatalogService, ResultPdfService],
})
export class LabModule {}
