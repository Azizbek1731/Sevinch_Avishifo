import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { ClinicalOrdersModule } from '../clinical-orders/clinical-orders.module';
import { LabModule } from '../lab/lab.module';
import { ServicesModule } from '../services/services.module';
import { XlsxService } from '../reports/xlsx.service';
import { AmbulatoryController } from './ambulatory.controller';
import { AmbulatoryService } from './ambulatory.service';

/**
 * Ambulator karta: the desk opens it for a walk-in patient of one doctor, and lab
 * sent from it earns that doctor a share of what the cashier took for the lab.
 */
@Module({
  imports: [LabModule, ClinicalOrdersModule, BillingModule, ServicesModule],
  controllers: [AmbulatoryController],
  providers: [AmbulatoryService, XlsxService],
})
export class AmbulatoryModule {}
