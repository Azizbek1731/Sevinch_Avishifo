import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Bot, InputFile, Keyboard, type Context } from 'grammy';
import { formatInTimeZone } from 'date-fns-tz';
import { AuditAction, formatTicketNumber, normalizePhone, TIMEZONE } from '@avishifo/shared';
import { AppConfigService } from '../../core/config/app-config.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';
import { AuditService } from '../../core/audit/audit.service';
import { StorageService } from '../../core/storage/storage.service';
import { NotificationsService } from './notifications.service';

const MAIN_KEYBOARD = new Keyboard()
  .text('📅 Qabullarim')
  .text('🕐 Navbatim')
  .row()
  .text('🧪 Tahlillarim')
  .text('📄 Hujjatlarim')
  .resized()
  .persistent();

/** Pick a display name from a multilingual Json name ({ uz, ru, en }). */
function pickName(name: unknown): string {
  if (name && typeof name === 'object' && !Array.isArray(name)) {
    const n = name as Record<string, unknown>;
    for (const k of ['uz', 'ru', 'en']) {
      if (typeof n[k] === 'string' && n[k]) return n[k] as string;
    }
  }
  return typeof name === 'string' ? name : '';
}

/** Short Uzbek label for an abnormal lab flag. */
function flagLabel(flag: string): string {
  if (flag === 'HIGH') return 'yuqori';
  if (flag === 'LOW') return 'past';
  if (flag === 'ABNORMAL') return 'chetlangan';
  return '';
}

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
    private readonly storage: StorageService,
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
    bot.command('start', (ctx) => this.handleStart(ctx));
    bot.on('message:contact', (ctx) => this.handleContact(ctx));
    bot.hears('📅 Qabullarim', (ctx) => this.handleMyAppointments(ctx));
    bot.hears('🕐 Navbatim', (ctx) => this.handleMyQueue(ctx));
    bot.hears('🧪 Tahlillarim', (ctx) => this.handleMyResults(ctx));
    bot.hears('📄 Hujjatlarim', (ctx) => this.handleMyDocuments(ctx));
    bot.callbackQuery(/^(confirm|cancel):(.+)$/, (ctx) => this.handleAppointmentAction(ctx));
  }

  // ------------------------------------------------------------ linking

  /** /start — with a deep-link payload, consume a web link token; else ask for a contact. */
  private async handleStart(ctx: Context): Promise<void> {
    const payload = typeof ctx.match === 'string' ? ctx.match.trim() : '';
    if (payload) {
      await this.handleLinkToken(ctx, payload);
      return;
    }
    await ctx.reply(
      'Assalomu alaykum! AviShifo botiga xush kelibsiz. Ma’lumotlaringizni ko‘rish uchun telefon raqamingizni yuboring.',
      {
        reply_markup: new Keyboard().requestContact('📱 Raqamni yuborish').resized().oneTime(),
      },
    );
  }

  /** Consume a one-time web deep-link token (t.me/<bot>?start=<token>) and bind the chat. */
  private async handleLinkToken(ctx: Context, token: string): Promise<void> {
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;
    const link = await this.prisma.unscoped.portalLinkToken.findFirst({
      where: { token, purpose: 'telegram_link', usedAt: null },
    });
    if (!link || link.expiresAt < new Date()) {
      await ctx.reply(
        'Ulash havolasi eskirgan yoki noto‘g‘ri. Iltimos, portaldan yangi havola oling.',
      );
      return;
    }
    await this.prisma.unscoped.portalLinkToken.update({
      where: { id: link.id },
      data: { usedAt: new Date() },
    });
    const cards = await this.bindChat(chatId, link.phone, ctx.from?.username ?? null);
    const tail =
      cards === 0
        ? ' Hozircha biriktirilgan bemor kartangiz yo‘q — klinikaga tashrifingizdan so‘ng ma’lumotlar ko‘rinadi.'
        : '';
    await ctx.reply(`Akkauntingiz Telegram bilan bog‘landi ✅${tail}`, {
      reply_markup: MAIN_KEYBOARD,
    });
  }

  private async handleContact(ctx: Context): Promise<void> {
    const contact = ctx.message?.contact;
    const chatId = ctx.chat?.id;
    if (!contact || chatId === undefined) return;
    const phone = normalizePhone(contact.phone_number);
    if (!phone) {
      await ctx.reply("Kechirasiz, telefon raqamini aniqlab bo'lmadi.");
      return;
    }
    const cards = await this.bindChat(chatId, phone, ctx.from?.username ?? null);
    if (cards === 0) {
      await ctx.reply(
        'Raqamingiz bog‘landi. Hozircha biriktirilgan bemor kartangiz topilmadi — klinikaga tashrifingizdan so‘ng ma’lumotlaringiz shu yerda ko‘rinadi.',
        { reply_markup: MAIN_KEYBOARD },
      );
      return;
    }
    await ctx.reply("Muvaffaqiyatli bog'landi ✅", { reply_markup: MAIN_KEYBOARD });
  }

  /**
   * Bind a Telegram chat to a phone: sets the durable PortalAccount link and
   * upserts per-clinic TelegramLink routing rows. Cross-clinic by design, so
   * lookups use prisma.unscoped. Returns the number of matched patient cards.
   */
  private async bindChat(
    chatId: number,
    rawPhone: string,
    username: string | null,
  ): Promise<number> {
    const phone = normalizePhone(rawPhone) ?? rawPhone;
    const chat = String(chatId);

    // A Telegram chat maps to at most one account: release the chatId from any
    // other phone first (re-linking to a different number), then bind it here.
    await this.prisma.unscoped.portalAccount.updateMany({
      where: { telegramChatId: chat, phone: { not: phone } },
      data: { telegramChatId: null, telegramUsername: null, telegramLinkedAt: null },
    });
    await this.prisma.unscoped.portalAccount.upsert({
      where: { phone },
      update: { telegramChatId: chat, telegramUsername: username, telegramLinkedAt: new Date() },
      create: {
        phone,
        phoneVerifiedAt: new Date(),
        telegramChatId: chat,
        telegramUsername: username,
        telegramLinkedAt: new Date(),
      },
    });

    // Per-clinic routing links for outbound notifications.
    const patients = await this.prisma.unscoped.patient.findMany({
      where: { OR: [{ phone }, { phoneAlt: phone }], deletedAt: null },
      select: { id: true, clinicId: true },
    });
    for (const patient of patients) {
      await this.prisma.unscoped.telegramLink.upsert({
        where: { clinicId_chatId: { clinicId: patient.clinicId, chatId: chat } },
        update: { patientId: patient.id, phone, isActive: true },
        create: { clinicId: patient.clinicId, patientId: patient.id, chatId: chat, phone },
      });
    }
    return patients.length;
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

  private async handleMyResults(ctx: Context): Promise<void> {
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;
    const patientIds = await this.linkedPatientIds(chatId);
    if (patientIds.length === 0) {
      await ctx.reply('Avval /start orqali telefon raqamingizni bog‘lang.');
      return;
    }
    // Ready (approved/delivered) lab orders for the chat's linked patients.
    const orders = await this.prisma.unscoped.labOrder.findMany({
      where: { patientId: { in: patientIds }, status: { in: ['APPROVED', 'DELIVERED'] } },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: {
        orderNumber: true,
        createdAt: true,
        items: {
          select: {
            labTest: { select: { name: true } },
            result: {
              select: {
                values: {
                  select: { value: true, flag: true, parameter: { select: { name: true, unit: true } } },
                },
              },
            },
          },
        },
      },
    });
    if (orders.length === 0) {
      await ctx.reply('Hozircha tayyor tahlil natijalari yo‘q.', { reply_markup: MAIN_KEYBOARD });
      return;
    }
    const blocks = orders.map((o) => {
      const header = `🧪 ${o.orderNumber} — ${formatInTimeZone(o.createdAt, TIMEZONE, 'dd.MM.yyyy')}`;
      const lines = o.items.flatMap((it) => {
        const values = it.result?.values ?? [];
        if (values.length === 0) return [`• ${pickName(it.labTest.name)}`];
        return values.map((v) => {
          const unit = v.parameter.unit ? ` ${v.parameter.unit}` : '';
          const flag = v.flag && v.flag !== 'NORMAL' ? ` ⚠️ ${flagLabel(v.flag)}` : '';
          return `• ${v.parameter.name}: ${v.value}${unit}${flag}`;
        });
      });
      return [header, ...lines].join('\n');
    });
    await ctx.reply(blocks.join('\n\n'), { reply_markup: MAIN_KEYBOARD });
  }

  private async handleMyDocuments(ctx: Context): Promise<void> {
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;
    const patientIds = await this.linkedPatientIds(chatId);
    if (patientIds.length === 0) {
      await ctx.reply('Avval /start orqali telefon raqamingizni bog‘lang.');
      return;
    }
    const docs = await this.prisma.unscoped.patientDocument.findMany({
      where: { patientId: { in: patientIds } },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { title: true, fileKey: true, fileName: true, createdAt: true },
    });
    if (docs.length === 0) {
      await ctx.reply('Hozircha hujjatlaringiz yo‘q.', { reply_markup: MAIN_KEYBOARD });
      return;
    }
    await ctx.reply(`Sizda ${docs.length} ta hujjat topildi, yuborilmoqda…`);
    for (const doc of docs) {
      try {
        const caption = `📄 ${doc.title} — ${formatInTimeZone(doc.createdAt, TIMEZONE, 'dd.MM.yyyy')}`;
        await ctx.replyWithDocument(new InputFile(this.storage.getStream(doc.fileKey), doc.fileName), {
          caption,
        });
      } catch (err) {
        this.logger.error(`telegram document send failed: ${String(err)}`);
      }
    }
    await ctx.reply('Barcha hujjatlar yuborildi ✅', { reply_markup: MAIN_KEYBOARD });
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
