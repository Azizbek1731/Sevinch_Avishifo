import { Module } from '@nestjs/common';
import { AppointmentsModule } from '../appointments/appointments.module';
import { LabModule } from '../lab/lab.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RecordAccessModule } from '../record-access/record-access.module';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';
import { PortalAuthGuard } from './portal-auth.guard';

@Module({
  imports: [AppointmentsModule, LabModule, NotificationsModule, RecordAccessModule],
  controllers: [PortalController],
  providers: [PortalService, PortalAuthGuard],
})
export class PortalModule {}
