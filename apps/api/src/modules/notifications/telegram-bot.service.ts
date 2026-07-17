import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Bot, Keyboard, type Context } from 'grammy';
import { formatInTimeZone } from 'date-fns-tz';
import { AuditAction, formatTicketNumber, normalizePhone, TIMEZONE } from '@avishifo/shared';
import { AppConfigService } from '../../core/config/app-config.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';
import { AuditService } from '../../core/audit/audit.service';
import { NotificationsService } from './notifications.service';

const MAIN_KEYBOARD = new Keyboard().text('📅 Qabullarim').text('🕐 Navbatim').resized().persistent();

/**
 * Patient-facing Telegram bot (grammY, long polling). Links patients by phone
 * contact, shows upcoming appointments and live queue position, and handles
 * confirm/cancel buttons on reminder messages.
 *
 * The bot is cross-clinic by design: one platform bot serves patients of every
 * clinic, so lookups here use prisma.unscoped with per-row clinic checks.
 */
@Injectable()
export class TelegramBotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramBotService.name);
  private bot: Bot | null = null;

  constructor(
    private readonly config: AppConfigService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    const { TELEGRAM_ENABLED, TELEGRAM_BOT_TOKEN } = this.config.env;
    if (!TELEGRAM_ENABLED || !TELEGRAM_BOT_TOKEN) return;
    this.bot = new Bot(TELEGRAM_BOT_TOKEN);
    this.registerHandlers(this.bot);
    this.bot.catch((err) => this.logger.error(`telegram bot error: ${err.message}`));
    // Long polling must not block Nest bootstrap — fire and forget.
    void this.bot
      .start({ drop_pending_updates: true })
      .catch((err: unknown) => this.logger.error(`telegram bot stopped: ${String(err)}`));
    this.logger.log('Telegram bot long polling started');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.bot) await this.bot.stop().catch(() => undefined);
  }

  private registerHandlers(bot: Bot): void {
    bot.command('start', async (ctx) => {
      await ctx.reply(
        "Assalomu alaykum! Klinika xizmatlaridan foydalanish uchun telefon raqamingizni yuboring.",
        {
          reply_markup: new Keyboard()
            .requestContact('📱 Raqamni yuborish')
            .resized()
            .oneTime(),
        },
      );
    });

    bot.on('message:contact', (ctx) => this.handleContact(ctx));
    bot.hears('📅 Qabullarim', (ctx) => this.handleMyAppointments(ctx));
    bot.hears('🕐 Navbatim', (ctx) => this.handleMyQueue(ctx));
    bot.callbackQuery(/^(confirm|cancel):(.+)$/, (ctx) => this.handleAppointmentAction(ctx));
  }

  // ------------------------------------------------------------ linking

  private async handleContact(ctx: Context): Promise<void> {
    const contact = ctx.message?.contact;
    const chatId = ctx.chat?.id;
    if (!contact || chatId === undefined) return;
    const phone = normalizePhone(contact.phone_number);
    if (!phone) {
      await ctx.reply("Kechirasiz, telefon raqamini aniqlab bo'lmadi.");
      return;
    }
    // Cross-clinic linking: one bot serves all clinics, so the patient lookup
    // by phone must span tenants — justified unscoped access.
    const patients = await this.prisma.unscoped.patient.findMany({
      where: { OR: [{ phone }, { phoneAlt: phone }], deletedAt: null },
      select: { id: true, clinicId: true },
    });
    if (patients.length === 0) {
      await ctx.reply(
        'Bu raqam bo‘yicha bemor topilmadi. Iltimos, klinika qabulxonasiga murojaat qiling.',
      );
      return;
    }
    for (const patient of patients) {
      // One link per (clinic, chat); unscoped upsert is part of the same
      // cross-clinic linking flow — justified.
      await this.prisma.unscoped.telegramLink.upsert({
        where: { clinicId_chatId: { clinicId: patient.clinicId, chatId: String(chatId) } },
        update: { patientId: patient.id, phone, isActive: true },
        create: {
          clinicId: patient.clinicId,
          patientId: patient.id,
          chatId: String(chatId),
          phone,
        },
      });
    }
    await ctx.reply("Muvaffaqiyatli bog'landi ✅", { reply_markup: MAIN_KEYBOARD });
  }

  /** Active links for this chat across clinics (unscoped — cross-clinic bot). */
  private async linkedPatientIds(chatId: number): Promise<string[]> {
    const links = await this.prisma.unscoped.telegramLink.findMany({
      where: { chatId: String(chatId), isActive: true },
      select: { patientId: true },
    });
    return links.map((l) => l.patientId);
  }

  // ------------------------------------------------------------ commands

  private async handleMyAppointments(ctx: Context): Promise<void> {
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;
    const patientIds = await this.linkedPatientIds(chatId);
    if (patientIds.length === 0) {
      await ctx.reply('Avval /start orqali telefon raqamingizni bog‘lang.');
      return;
    }
    // Upcoming appointments across the patient's linked clinics — justified
    // unscoped read keyed by the chat's own linked patientIds.
    const appointments = await this.prisma.unscoped.appointment.findMany({
      where: {
        patientId: { in: patientIds },
        startAt: { gte: new Date() },
        status: { in: ['SCHEDULED', 'CONFIRMED'] },
      },
      orderBy: { startAt: 'asc' },
      take: 5,
      include: { doctor: { select: { fullName: true } } },
    });
    if (appointments.length === 0) {
      await ctx.reply('Yaqin kunlarda qabullaringiz yo‘q.', { reply_markup: MAIN_KEYBOARD });
      return;
    }
    const lines = appointments.map(
      (a) =>
        `📅 ${formatInTimeZone(a.startAt, TIMEZONE, 'dd.MM.yyyy HH:mm')} — ${a.doctor.fullName}`,
    );
    await ctx.reply(`Yaqin qabullaringiz:\n${lines.join('\n')}`, { reply_markup: MAIN_KEYBOARD });
  }

  private async handleMyQueue(ctx: Context): Promise<void> {
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;
    const patientIds = await this.linkedPatientIds(chatId);
    if (patientIds.length === 0) {
      await ctx.reply('Avval /start orqali telefon raqamingizni bog‘lang.');
      return;
    }
    const today = new Date(`${formatInTimeZone(new Date(), TIMEZONE, 'yyyy-MM-dd')}T00:00:00.000Z`);
    // Today's live tickets for the chat's linked patients — justified unscoped read.
    const tickets = await this.prisma.unscoped.queueTicket.findMany({
      where: {
        patientId: { in: patientIds },
        status: { in: ['WAITING', 'CALLED'] },
        queue: { date: today },
      },
      include: { queue: { select: { prefix: true } } },
      orderBy: { createdAt: 'asc' },
    });
    if (tickets.length === 0) {
      await ctx.reply('Bugun faol navbatingiz yo‘q.', { reply_markup: MAIN_KEYBOARD });
      return;
    }
    const lines: string[] = [];
    for (const ticket of tickets) {
      const number = formatTicketNumber(ticket.queue.prefix, ticket.number);
      if (ticket.status === 'CALLED') {
        lines.push(`🎫 ${number} — sizni chaqirishdi, kabinetga kiring!`);
        continue;
      }
      const ahead = await this.prisma.unscoped.queueTicket.count({
        where: { queueId: ticket.queueId, status: 'WAITING', position: { lt: ticket.position } },
      });
      lines.push(`🎫 ${number} — oldingizda ${ahead} kishi bor.`);
    }
    await ctx.reply(lines.join('\n'), { reply_markup: MAIN_KEYBOARD });
  }

  // ------------------------------------------------------------ reminder buttons

  private async handleAppointmentAction(ctx: Context): Promise<void> {
    const match = ctx.match;
    if (typeof match === 'string' || !match) return;
    const action = match[1];
    const appointmentId = match[2];
    const chatId = ctx.chat?.id ?? ctx.from?.id;
    if (!action || !appointmentId || chatId === undefined) return;

    // Worker/bot context has no tenant — load by id via unscoped, then verify
    // that this chat is actually linked to the appointment's patient (justified).
    const appointment = await this.prisma.unscoped.appointment.findUnique({
      where: { id: appointmentId },
      select: { id: true, clinicId: true, patientId: true, status: true },
    });
    if (!appointment) {
      await ctx.answerCallbackQuery({ text: 'Qabul topilmadi.' });
      return;
    }
    const link = await this.prisma.unscoped.telegramLink.findFirst({
      where: {
        clinicId: appointment.clinicId,
        chatId: String(chatId),
        patientId: appointment.patientId,
        isActive: true,
      },
    });
    if (!link) {
      await ctx.answerCallbackQuery({ text: 'Ruxsat yo‘q.' });
      return;
    }
    if (appointment.status !== 'SCHEDULED' && appointment.status !== 'CONFIRMED') {
      await ctx.answerCallbackQuery({ text: 'Bu qabul holatini o‘zgartirib bo‘lmaydi.' });
      return;
    }

    if (action === 'confirm') {
      await TenantContext.run({ clinicId: appointment.clinicId }, async () => {
        await this.prisma.db.appointment.update({
          where: { id: appointment.id },
          data: { status: 'CONFIRMED' },
        });
        await this.audit.log({
          action: AuditAction.UPDATE,
          entity: 'Appointment',
          entityId: appointment.id,
          before: { status: appointment.status },
          after: { status: 'CONFIRMED' },
        });
      });
      await ctx.answerCallbackQuery({ text: '✅ Qabul tasdiqlandi.' });
    } else {
      await TenantContext.run({ clinicId: appointment.clinicId }, async () => {
        await this.prisma.db.appointment.update({
          where: { id: appointment.id },
          data: { status: 'CANCELLED', cancelledReason: 'Bemor Telegram orqali bekor qildi' },
        });
        await this.audit.log({
          action: AuditAction.UPDATE,
          entity: 'Appointment',
          entityId: appointment.id,
          before: { status: appointment.status },
          after: { status: 'CANCELLED' },
        });
      });
      await this.notifications.cancelAppointmentReminders(appointment.id);
      await ctx.answerCallbackQuery({ text: '❌ Qabul bekor qilindi.' });
    }
    // Remove the inline buttons after the action (best effort).
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => undefined);
  }
}
