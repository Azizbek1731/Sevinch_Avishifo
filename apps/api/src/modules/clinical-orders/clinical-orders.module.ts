import { Module } from '@nestjs/common';
import { ServicesModule } from '../services/services.module';
import { ClinicalOrdersController } from './clinical-orders.controller';
import { ClinicalOrdersService } from './clinical-orders.service';
@Module({
  imports: [ServicesModule],
  controllers: [ClinicalOrdersController],
  providers: [ClinicalOrdersService],
})
export class ClinicalOrdersModule {}
