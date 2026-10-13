import { Module } from '@nestjs/common';
import { SurgeriesController } from './surgeries.controller';
import { SurgeriesService } from './surgeries.service';
import { SurgeryPayoutsController } from './surgery-payouts.controller';
import { SurgeryPayoutsService } from './surgery-payouts.service';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [BillingModule],
  controllers: [SurgeriesController, SurgeryPayoutsController],
  providers: [SurgeriesService, SurgeryPayoutsService],
  exports: [SurgeriesService],
})
export class SurgeriesModule {}
