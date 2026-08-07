import { Global, Module } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';

@Global()
@Module({
  providers: [SubscriptionService],
  exports: [SubscriptionService],
})
export class SubscriptionModule {}
