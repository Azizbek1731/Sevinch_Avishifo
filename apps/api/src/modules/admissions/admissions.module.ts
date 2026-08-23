import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { ServicesModule } from '../services/services.module';
import { AdmissionsController, ChargesController } from './admissions.controller';
import { AdmissionsService } from './admissions.service';
import { ChargesService } from './charges.service';

/**
 * Statsionar care: the hospital stay, its treatment sheet, and the charge
 * ledger both inpatients and outpatients are billed from.
 */
@Module({
  imports: [BillingModule, ServicesModule],
  controllers: [AdmissionsController, ChargesController],
  providers: [AdmissionsService, ChargesService],
  exports: [AdmissionsService, ChargesService],
})
export class AdmissionsModule {}
