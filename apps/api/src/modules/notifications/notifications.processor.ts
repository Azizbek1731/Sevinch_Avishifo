import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { NotificationEvent } from '@avishifo/shared';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';
import { SmsChannel } from './channels/sms.channel';
import { TelegramChannel } from './channels/telegram.channel';
import { type TelegramInlineKeyboard } from './channels/telegram.channel';
import { DEFAULT_TEMPLATES, renderTemplate, templateLang } from './default-templates';
import { NOTIFICATIONS_QUEUE, type NotificationJobData } from './notifications.service';

/**
 * Delivery worker for the 'notifications' queue: renders the clinic template
 * (or the built-in fallback) and sends through the requested channel, updating
 * the NotificationLog row. Failures rethrow so BullMQ retries (3 attempts,
 * exponential backoff from 30s).
 */
@Processor(NOTIFICATIONS_QUEUE)
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: SmsChannel,
    private readonly telegram: TelegramChannel,
  ) {
    super();
  }

  async process(job: Job<NotificationJobData>): Promise<void> {
    const d = job.data;
    // Workers have no HTTP tenant context — establish it from the job payload.
    await TenantContext.run({ clinicId: d.clinicId }, async () => {
      // Clinic is not a tenant-scoped model; unscoped read by id to resolve the
      // clinic's default locale for template selection — justified system read.
      const clinic = await this.prisma.unscoped.clinic.findUnique({
        where: { id: d.clinicId },
        select: { defaultLocale: true },
      });
      const locale = clinic?.defaultLocale ?? 'uz';
      const template = await this.prisma.db.notificationTemplate.findFirst({
        where: { event: d.event, channel: d.channel, locale, isActive: true },
        select: { body: true },
      });
      const raw = template?.body ?? DEFAULT_TEMPLATES[d.event][templateLang(locale)];
      const body = renderTemplate(raw, d.vars);

      try {
        if (d.channel === 'SMS') {
          await this.sms.send(d.recipient, body);
        } else {
          await this.telegram.send(d.recipient, body, this.reminderKeyboard(d));
        }
        await this.prisma.db.notificationLog.update({
          where: { id: d.logId },
          data: {
            status: 'SENT',
            body,
            sentAt: new Date(),
            attempts: job.attemptsMade + 1,
            error: null,
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`notification ${d.logId} attempt ${job.attemptsMade + 1} failed: ${message}`);
        await this.prisma.db.notificationLog
          .update({
            where: { id: d.logId },
            data: { status: 'FAILED', body, attempts: job.attemptsMade + 1, error: message },
          })
          .catch(() => undefined);
        throw err; // let BullMQ retry with backoff
      }
    });
  }

  /** Telegram appointment reminders carry inline confirm/cancel buttons. */
  private reminderKeyboard(d: NotificationJobData): TelegramInlineKeyboard | undefined {
    const isReminder =
      d.event === NotificationEvent.APPOINTMENT_REMINDER_24H ||
      d.event === NotificationEvent.APPOINTMENT_REMINDER_2H;
    const appointmentId = d.vars['appointment_id'];
    if (!isReminder || !appointmentId) return undefined;
    return {
      inline_keyboard: [
        [
          { text: '✅ Tasdiqlash', callback_data: `confirm:${appointmentId}` },
          { text: '❌ Bekor qilish', callback_data: `cancel:${appointmentId}` },
        ],
      ],
    };
  }
}
