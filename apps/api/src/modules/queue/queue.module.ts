import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { QueueController } from './queue.controller';
import { QueueGateway } from './queue.gateway';
import { QueueService } from './queue.service';
import { QueueStatsService } from './queue-stats.service';

/**
 * M5 — live queue management. Hosts the single Socket.IO gateway (spec §10)
 * and exports QueueService for cross-module enqueueing (appointments check-in).
 */
@Module({
  imports: [NotificationsModule],
  controllers: [QueueController],
  providers: [QueueService, QueueStatsService, QueueGateway],
  exports: [QueueService],
})
export class QueueModule {}
