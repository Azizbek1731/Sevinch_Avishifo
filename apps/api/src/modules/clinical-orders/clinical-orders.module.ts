import { Module } from '@nestjs/common';
import { PatientsModule } from '../patients/patients.module';
import { ServicesModule } from '../services/services.module';
import { ClinicalOrdersController } from './clinical-orders.controller';
import { ClinicalOrdersService } from './clinical-orders.service';

@Module({
  imports: [ServicesModule, PatientsModule],
  controllers: [ClinicalOrdersController],
  providers: [ClinicalOrdersService],
  exports: [ClinicalOrdersService],
})
export class ClinicalOrdersModule {}
