import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { formatInTimeZone } from 'date-fns-tz';
import { NotificationEvent, TIMEZONE } from '@avishifo/shared';
import { PrismaService } from '../../core/prisma/prisma.service';
import { NotificationsService } from './notifications.service';
import {
  REMINDERS_QUEUE,
  type ReminderJobData,
} from './notifications.service';

/**
 * Worker for the delayed 'reminders' queue. Re-checks that the appointment is
 * still upcoming (SCHEDULED/CONFIRMED) at fire time, then hands the actual
 * delivery to enqueueEvent (which picks Telegram/SMS per recipient).
 */
@Processor(REMINDERS_QUEUE)
export class RemindersProcessor extends WorkerHost {
  private readonly logger = new Logger(RemindersProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {
    super();
  }

  async process(job: Job<ReminderJobData>): Promise<void> {
    const { appointmentId, clinicId, kind } = job.data;
    // System worker without a tenant context: load the appointment by id via
    // unscoped and re-verify the clinicId from the job payload — justified.
    const appointment = await this.prisma.unscoped.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        patient: { select: { fullName: true } },
        doctor: { select: { fullName: true } },
      },
    });
    if (!appointment || appointment.clinicId !== clinicId) return;
    if (appointment.status !== 'SCHEDULED' && appointment.status !== 'CONFIRMED') {
      this.logger.debug(`reminder ${job.id ?? ''} skipped: appointment no longer upcoming`);
      return;
    }
    // Clinic is not tenant-scoped; unscoped read for the display name — justified.
    const clinic = await this.prisma.unscoped.clinic.findUnique({
      where: { id: clinicId },
      select: { name: true },
    });

    await this.notifications.enqueueEvent({
      event:
        kind === '24h'
          ? NotificationEvent.APPOINTMENT_REMINDER_24H
          : NotificationEvent.APPOINTMENT_REMINDER_2H,
      clinicId,
      patientId: appointment.patientId,
      vars: {
        patient_name: appointment.patient.fullName,
        doctor_name: appointment.doctor.fullName,
        time: formatInTimeZone(appointment.startAt, TIMEZONE, 'HH:mm'),
        clinic_name: clinic?.name ?? '',
        // Enables the Telegram confirm/cancel inline keyboard in the delivery worker.
        appointment_id: appointment.id,
      },
    });
  }
}
