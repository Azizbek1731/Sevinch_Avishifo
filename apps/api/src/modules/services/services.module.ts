import { Module } from '@nestjs/common';
import { LabModule } from '../lab/lab.module';
import { ServicesController } from './services.controller';
import { ServicesService } from './services.service';
import { PricingService } from './pricing.service';

/**
 * M7 — Services & price list: categories, catalog, effective-dated prices
 * (branch overrides), packages, discount rules.
 * PricingService is exported for billing/appointments/lab price resolution.
 */
@Module({
  imports: [LabModule],
  controllers: [ServicesController],
  providers: [ServicesService, PricingService],
  exports: [PricingService],
})
export class ServicesModule {}
