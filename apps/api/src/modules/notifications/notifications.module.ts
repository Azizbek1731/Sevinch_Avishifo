import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { NotificationsService, NOTIFICATIONS_QUEUE, REMINDERS_QUEUE } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { TemplatesController } from './templates.controller';
import { NotificationsProcessor } from './notifications.processor';
import { RemindersProcessor } from './reminders.processor';
import { SmsChannel } from './channels/sms.channel';
import { TelegramChannel } from './channels/telegram.channel';
import { TelegramGatewayChannel } from './channels/telegram-gateway.channel';
import { TelegramBotService } from './telegram-bot.service';
import { PlatformAlertsService } from './platform-alerts.service';
// Provided here directly rather than via LabModule: LabModule imports
// NotificationsModule, so importing it back would be a cycle. The renderer is a
// stateless class with no dependencies — a second provider instance is free.
import { ResultPdfService } from '../lab/result-pdf.service';

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
    TelegramGatewayChannel,
    TelegramBotService,
    PlatformAlertsService,
    ResultPdfService,
  ],
  // SmsChannel is exported so the portal can deliver OTP codes over real SMS
  // (Eskiz) instead of the log-only dev fallback.
  exports: [
    NotificationsService,
    SmsChannel,
    TelegramChannel,
    TelegramGatewayChannel,
    PlatformAlertsService,
  ],
})
export class NotificationsModule {}
