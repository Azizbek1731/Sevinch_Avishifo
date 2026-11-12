import { Module } from '@nestjs/common';
import { ClinicalOrdersModule } from '../clinical-orders/clinical-orders.module';
import { LabModule } from '../lab/lab.module';
import { XlsxService } from '../reports/xlsx.service';
import { AmbulatoryController } from './ambulatory.controller';
import { AmbulatoryService } from './ambulatory.service';

/**
 * Ambulator karta: the desk opens it for a walk-in patient of one doctor, and lab
 * sent from it earns that doctor a share of what the cashier took for the lab.
 */
@Module({
  imports: [LabModule, ClinicalOrdersModule],
  controllers: [AmbulatoryController],
  providers: [AmbulatoryService, XlsxService],
})
export class AmbulatoryModule {}
