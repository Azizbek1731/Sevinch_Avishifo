import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { SlotsService } from './slots.service';

@Module({
  imports: [QueueModule, NotificationsModule],
  controllers: [AppointmentsController],
  providers: [AppointmentsService, SlotsService],
  exports: [AppointmentsService, SlotsService],
})
export class AppointmentsModule {}
