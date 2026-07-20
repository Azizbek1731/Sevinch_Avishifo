import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { NotificationsService, NOTIFICATIONS_QUEUE, REMINDERS_QUEUE } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { TemplatesController } from './templates.controller';
import { NotificationsProcessor } from './notifications.processor';
import { RemindersProcessor } from './reminders.processor';
import { SmsChannel } from './channels/sms.channel';
import { TelegramChannel } from './channels/telegram.channel';
import { TelegramBotService } from './telegram-bot.service';

/**
 * M13 — notifications hub: BullMQ delivery + reminder queues, SMS (Eskiz) and
 * Telegram channels, patient Telegram bot, templates, delivery log and the
 * in-app notification center. Imported by many feature modules; providers are
 * self-contained (only global core modules are used).
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE }, { name: REMINDERS_QUEUE }),
  ],
  controllers: [NotificationsController, TemplatesController],
  providers: [
    NotificationsService,
    NotificationsProcessor,
    RemindersProcessor,
    SmsChannel,
    TelegramChannel,
    TelegramBotService,
  ],
  // SmsChannel is exported so the portal can deliver OTP codes over real SMS
  // (Eskiz) instead of the log-only dev fallback.
  exports: [NotificationsService, SmsChannel],
})
export class NotificationsModule {}
