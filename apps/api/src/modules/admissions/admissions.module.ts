import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { LabModule } from '../lab/lab.module';
import { ServicesModule } from '../services/services.module';
import { AdmissionsController, ChargesController } from './admissions.controller';
import { AdmissionsService } from './admissions.service';
import { ChargesService } from './charges.service';
import { InpatientRoomsController } from './inpatient-rooms.controller';
import { InpatientRoomsService } from './inpatient-rooms.service';

/**
 * Statsionar care: the hospital stay, its treatment sheet, and the charge
 * ledger both inpatients and outpatients are billed from.
 */
@Module({
  imports: [BillingModule, LabModule, ServicesModule],
  controllers: [AdmissionsController, ChargesController, InpatientRoomsController],
  providers: [AdmissionsService, ChargesService, InpatientRoomsService],
  exports: [AdmissionsService, ChargesService, InpatientRoomsService],
})
export class AdmissionsModule {}
