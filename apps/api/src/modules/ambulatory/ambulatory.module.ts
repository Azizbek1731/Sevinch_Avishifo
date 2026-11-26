import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { ClinicalOrdersModule } from '../clinical-orders/clinical-orders.module';
import { LabModule } from '../lab/lab.module';
import { ServicesModule } from '../services/services.module';
import { VisitsModule } from '../visits/visits.module';
import { XlsxService } from '../reports/xlsx.service';
import { AmbulatoryController } from './ambulatory.controller';
import { AmbulatoryService } from './ambulatory.service';

/**
 * Ambulator karta: the desk opens it for a walk-in patient of one doctor, and lab
 * sent from it earns that doctor a share of what the cashier took for the lab.
 */
@Module({
  imports: [
    AuthModule,
    LabModule,
    ClinicalOrdersModule,
    BillingModule,
    ServicesModule,
    VisitsModule,
  ],
  controllers: [AmbulatoryController],
  providers: [AmbulatoryService, XlsxService],
  // Telegram bot resolves this via ModuleRef (no Nest import cycle with Notifications).
  exports: [AmbulatoryService],
})
export class AmbulatoryModule {}
