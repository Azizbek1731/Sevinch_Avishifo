import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Bot, InlineKeyboard, InputFile, Keyboard, type Context } from 'grammy';
import { formatInTimeZone } from 'date-fns-tz';
import {
  AuditAction,
  formatTicketNumber,
  formatUZS,
  normalizePhone,
  TIMEZONE,
} from '@avishifo/shared';
import { AppConfigService } from '../../core/config/app-config.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';
import { AuditService } from '../../core/audit/audit.service';
import { StorageService } from '../../core/storage/storage.service';
import { RESULT_PDF_INCLUDE, buildResultPdfData } from '../lab/result-pdf.data';
import { ResultPdfService } from '../lab/result-pdf.service';
import { NotificationsService } from './notifications.service';

/** Buttons a linked patient sees. */
const PATIENT_BUTTONS = [
  '📅 Qabullarim',
  '🕐 Navbatim',
  '🧪 Tahlillarim',
  '📄 Hujjatlarim',
  '📋 Kasallik tarixim',
];
/** Buttons a clinic owner/admin sees. */
const STAFF_BUTTONS = ['📊 Bugungi holat', '👥 Navbat holati'];
/** Buttons the platform super-admin sees. */
const PLATFORM_BUTTONS = ['🏥 Klinikalar', '🆕 Yangi ro‘yxatdan o‘tganlar'];

/** Who this chat is, resolved from its bound phone. */
interface ChatIdentity {
  /** Patient cards across clinics (may be empty). */
  patientIds: string[];
  /** Staff/super-admin account bound to this chat, if any. */
  staff: { id: string; clinicId: string | null; role: string; fullName: string } | null;
}

/** Keyboard composed from whatever roles the chat actually holds. */
function keyboardFor(identity: ChatIdentity): Keyboard {
  const kb = new Keyboard();
  const rows: string[][] = [];
  if (identity.patientIds.length > 0) {
    for (let i = 0; i < PATIENT_BUTTONS.length; i += 2) {
      rows.push(PATIENT_BUTTONS.slice(i, i + 2));
    }
  }
  const role = identity.staff?.role;
  if (role === 'CLINIC_OWNER' || role === 'CLINIC_ADMIN') rows.push(STAFF_BUTTONS);
  if (role === 'SUPER_ADMIN') rows.push(PLATFORM_BUTTONS);
  for (const row of rows) {
    for (const label of row) kb.text(label);
    kb.row();
  }
  return kb.resized().persistent();
}

/** Keyboard shown before the chat is bound to anything. */
const CONTACT_KEYBOARD = new Keyboard()
  .requestContact('📱 Raqamni yuborish')
  .resized()
  .oneTime();

/** Patient-only keyboard, re-sent alongside patient answers. */
const PATIENT_KEYBOARD = keyboardFor({ patientIds: ['x'], staff: null });

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
 * The platform Telegram bot (grammY, long polling), serving THREE audiences from
 * one chat: patients, clinic owners/admins, and the platform super-admin.
 *
 * Registration is uniform — /start asks for the contact, and the phone is looked
 * up against both Patient cards and staff User rows. Whatever it matches is what
 * the chat gets: a phone that is both a patient and a clinic owner gets both
 * sections of the menu. Every handler re-resolves the identity from the chat id,
 * so a role can be revoked simply by clearing the binding.
 *
 * The bot is cross-clinic and pre-tenant by design, so lookups use
 * prisma.unscoped, always keyed by the chat's own id — never by user input.
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
    private readonly resultPdf: ResultPdfService,
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
    bot.command('menu', (ctx) => this.handleMenu(ctx));
    bot.command('unlink', (ctx) => this.handleUnlink(ctx));
    bot.on('message:contact', (ctx) => this.handleContact(ctx));
    // Patient
    bot.hears('📅 Qabullarim', (ctx) => this.handleMyAppointments(ctx));
    bot.hears('🕐 Navbatim', (ctx) => this.handleMyQueue(ctx));
    bot.hears('🧪 Tahlillarim', (ctx) => this.handleMyResults(ctx));
    bot.hears('📄 Hujjatlarim', (ctx) => this.handleMyDocuments(ctx));
    bot.hears('📋 Kasallik tarixim', (ctx) => this.handleMyHistory(ctx));
    // Clinic owner / admin
    bot.hears('📊 Bugungi holat', (ctx) => this.handleClinicToday(ctx));
    bot.hears('👥 Navbat holati', (ctx) => this.handleClinicQueue(ctx));
    // Platform super-admin
    bot.hears('🏥 Klinikalar', (ctx) => this.handlePlatformClinics(ctx));
    bot.hears('🆕 Yangi ro‘yxatdan o‘tganlar', (ctx) => this.handlePlatformSignups(ctx));
    bot.callbackQuery(/^(confirm|cancel):(.+)$/, (ctx) => this.handleAppointmentAction(ctx));
    // A ready lab result as a PDF document.
    bot.callbackQuery(/^labpdf:(.+)$/, (ctx) => this.handleResultPdf(ctx, ctx.match[1] ?? ''));
    // Patient asks a clinic to release their history.
    bot.callbackQuery(/^ra_req:(.+)$/, (ctx) => this.handleHistoryRequest(ctx));
    // Doctor / clinic admin decides, straight from the notification.
    bot.callbackQuery(/^ra_(ok|no):(.+)$/, (ctx) => this.handleHistoryDecision(ctx));
  }

  // ------------------------------------------------------------ identity

  /**
   * Who is this chat? Resolves BOTH sides: the patient cards routed to it and
   * the staff/super-admin account bound to it. A phone can legitimately be both
   * (a doctor who is also a patient), so the menu is composed, not exclusive.
   *
   * prisma.unscoped justified: the bot is cross-clinic and pre-tenant; every
   * lookup is keyed by the chat's own id, never by user-supplied input.
   */
  private async identify(chatId: number): Promise<ChatIdentity> {
    const chat = String(chatId);
    const [links, staff] = await Promise.all([
      this.prisma.unscoped.telegramLink.findMany({
        where: { chatId: chat, isActive: true },
        select: { patientId: true },
      }),
      this.prisma.unscoped.user.findFirst({
        where: { telegramChatId: chat, deletedAt: null, status: 'ACTIVE' },
        select: { id: true, clinicId: true, role: true, fullName: true },
      }),
    ]);
    return { patientIds: links.map((l) => l.patientId), staff };
  }

  private roleLabel(role: string): string {
    switch (role) {
      case 'SUPER_ADMIN':
        return 'Platforma administratori';
      case 'CLINIC_OWNER':
        return 'Klinika egasi';
      case 'CLINIC_ADMIN':
        return 'Klinika administratori';
      case 'DOCTOR':
        return 'Shifokor';
      case 'RECEPTIONIST':
        return 'Qabulxona';
      case 'CASHIER':
        return 'Kassir';
      case 'LAB_TECH':
        return 'Laborant';
      default:
        return 'Xodim';
    }
  }

  /** Re-send the menu for whoever this chat is. */
  private async handleMenu(ctx: Context): Promise<void> {
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;
    const identity = await this.identify(chatId);
    if (identity.patientIds.length === 0 && !identity.staff) {
      await ctx.reply('Avval /start orqali telefon raqamingizni yuboring.', {
        reply_markup: CONTACT_KEYBOARD,
      });
      return;
    }
    await ctx.reply(this.welcomeText(identity), { reply_markup: keyboardFor(identity) });
  }

  /** Release this chat from every identity it holds. */
  private async handleUnlink(ctx: Context): Promise<void> {
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;
    const chat = String(chatId);
    await Promise.all([
      this.prisma.unscoped.telegramLink.updateMany({
        where: { chatId: chat },
        data: { isActive: false },
      }),
      this.prisma.unscoped.portalAccount.updateMany({
        where: { telegramChatId: chat },
        data: { telegramChatId: null, telegramUsername: null, telegramLinkedAt: null },
      }),
      this.prisma.unscoped.user.updateMany({
        where: { telegramChatId: chat },
        data: { telegramChatId: null, telegramUsername: null, telegramLinkedAt: null },
      }),
    ]);
    await ctx.reply('Akkaunt uzildi. Qayta ulash uchun /start bosing.', {
      reply_markup: { remove_keyboard: true },
    });
  }

  private welcomeText(identity: ChatIdentity): string {
    const parts: string[] = [];
    if (identity.staff) {
      parts.push(`${identity.staff.fullName} — ${this.roleLabel(identity.staff.role)}`);
    }
    if (identity.patientIds.length > 0) {
      parts.push(`Bemor kartalari: ${identity.patientIds.length} ta klinikada`);
    }
    return parts.length > 0 ? `Xush kelibsiz!\n${parts.join('\n')}` : 'Xush kelibsiz!';
  }

  // ------------------------------------------------------------ linking

  /** /start — with a deep-link payload, consume a web link token; else ask for a contact. */
  private async handleStart(ctx: Context): Promise<void> {
    const payload = typeof ctx.match === 'string' ? ctx.match.trim() : '';
    if (payload) {
      await this.handleLinkToken(ctx, payload);
      return;
    }
    const chatId = ctx.chat?.id;
    if (chatId !== undefined) {
      // Already bound (e.g. /start pressed again) — go straight to the menu.
      const identity = await this.identify(chatId);
      if (identity.patientIds.length > 0 || identity.staff) {
        await ctx.reply(this.welcomeText(identity), { reply_markup: keyboardFor(identity) });
        return;
      }
    }
    await ctx.reply(
      'Assalomu alaykum! AviShifo botiga xush kelibsiz.\n\n' +
        'Ro‘yxatdan o‘tish uchun telefon raqamingizni yuboring — raqamingiz tizimdagi ' +
        'bemor, xodim yoki administrator hisobiga bog‘lanadi.',
      { reply_markup: CONTACT_KEYBOARD },
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
      reply_markup: PATIENT_KEYBOARD,
    });
  }

  private async handleContact(ctx: Context): Promise<void> {
    const contact = ctx.message?.contact;
    const chatId = ctx.chat?.id;
    if (!contact || chatId === undefined) return;

    // Only accept the sender's OWN contact, and require positive proof of it.
    // `Contact.user_id` is optional in the Bot API: it is present when the user
    // taps the request-contact button (their own card) and absent when they
    // share an arbitrary address-book entry — which is exactly what an attacker
    // does after saving a colleague's number. Treating "absent" as acceptable
    // would let them bind that colleague's staff account to their own chat, and
    // since the Telegram binding is now sufficient to sign in on its own, that
    // is a full account takeover. Missing user_id therefore fails closed.
    if (contact.user_id === undefined || contact.user_id !== ctx.from?.id) {
      await ctx.reply('Iltimos, faqat o‘zingizning raqamingizni yuboring.', {
        reply_markup: CONTACT_KEYBOARD,
      });
      return;
    }

    const phone = normalizePhone(contact.phone_number);
    if (!phone) {
      await ctx.reply("Kechirasiz, telefon raqamini aniqlab bo'lmadi.", {
        reply_markup: CONTACT_KEYBOARD,
      });
      return;
    }

    await this.bindChat(chatId, phone, ctx.from?.username ?? null);
    const identity = await this.identify(chatId);

    if (identity.patientIds.length === 0 && !identity.staff) {
      await ctx.reply(
        'Raqamingiz qabul qilindi, lekin tizimda bu raqam bilan hisob topilmadi.\n\n' +
          'Agar siz bemor bo‘lsangiz — klinikaga tashrifingizdan so‘ng ma’lumotlaringiz shu yerda ko‘rinadi.\n' +
          'Agar siz klinika xodimi bo‘lsangiz — administratoringiz profilingizga shu raqamni kiritishi kerak.',
      );
      return;
    }

    await ctx.reply(`Muvaffaqiyatli bog‘landi ✅\n\n${this.welcomeText(identity)}`, {
      reply_markup: keyboardFor(identity),
    });
  }

  /**
   * Bind a Telegram chat to a phone across EVERY identity that phone holds:
   * the durable PortalAccount link, per-clinic TelegramLink routing rows for
   * patient cards, and the staff/super-admin User row. A phone can be both a
   * patient and a staff member, so all matching bindings are made.
   *
   * Cross-clinic and pre-tenant by design, so lookups use prisma.unscoped.
   * Returns the number of matched patient cards.
   */
  private async bindChat(
    chatId: number,
    rawPhone: string,
    username: string | null,
  ): Promise<number> {
    const phone = normalizePhone(rawPhone) ?? rawPhone;
    const chat = String(chatId);
    const now = new Date();

    // Staff / super-admin: release the chat from any other user first (the
    // telegramChatId unique index would otherwise reject the bind), then attach
    // it to whoever owns this phone. PATIENT-role users are excluded — they go
    // through the patient path below.
    await this.prisma.unscoped.user.updateMany({
      where: { telegramChatId: chat, phone: { not: phone } },
      data: { telegramChatId: null, telegramUsername: null, telegramLinkedAt: null },
    });
    const staff = await this.prisma.unscoped.user.findFirst({
      where: { phone, deletedAt: null, status: 'ACTIVE', role: { not: 'PATIENT' } },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (staff) {
      await this.prisma.unscoped.user.update({
        where: { id: staff.id },
        data: { telegramChatId: chat, telegramUsername: username, telegramLinkedAt: now },
      });
    }

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
      await ctx.reply('Yaqin kunlarda qabullaringiz yo‘q.', { reply_markup: PATIENT_KEYBOARD });
      return;
    }
    const lines = appointments.map(
      (a) =>
        `📅 ${formatInTimeZone(a.startAt, TIMEZONE, 'dd.MM.yyyy HH:mm')} — ${a.doctor.fullName}`,
    );
    await ctx.reply(`Yaqin qabullaringiz:\n${lines.join('\n')}`, { reply_markup: PATIENT_KEYBOARD });
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
      await ctx.reply('Bugun faol navbatingiz yo‘q.', { reply_markup: PATIENT_KEYBOARD });
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
    await ctx.reply(lines.join('\n'), { reply_markup: PATIENT_KEYBOARD });
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
        id: true,
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
      await ctx.reply('Hozircha tayyor tahlil natijalari yo‘q.', { reply_markup: PATIENT_KEYBOARD });
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
    // The keyboard swap is deliberate: the persistent reply keyboard survives on
    // the chat, while the inline buttons ride on this one message.
    const pdfButtons = new InlineKeyboard();
    for (const o of orders) pdfButtons.text(`📄 ${o.orderNumber} — PDF`, `labpdf:${o.id}`).row();
    await ctx.reply(blocks.join('\n\n'), { reply_markup: pdfButtons });
  }

  /**
   * "📄 L-000123 — PDF" pressed: render the result and hand the file over.
   *
   * Ownership is re-checked at press time, not trusted from the button — a
   * forwarded message carries the same callback data into someone else's chat.
   */
  private async handleResultPdf(ctx: Context, orderId: string): Promise<void> {
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;
    await ctx.answerCallbackQuery().catch(() => undefined);
    const patientIds = await this.linkedPatientIds(chatId);
    // prisma.unscoped justified: bot is cross-clinic; scoping is the chat's own patient set.
    const order = patientIds.length
      ? await this.prisma.unscoped.labOrder.findFirst({
          where: {
            id: orderId,
            patientId: { in: patientIds },
            status: { in: ['APPROVED', 'DELIVERED'] },
          },
          include: RESULT_PDF_INCLUDE,
        })
      : null;
    if (!order) {
      await ctx.reply('Bu natija topilmadi.');
      return;
    }
    try {
      const clinic = await this.prisma.unscoped.clinic.findUnique({
        where: { id: order.clinicId },
        select: { name: true, legalName: true, address: true, phone: true },
      });
      const approvedById =
        order.items.map((it) => it.result?.approvedById).find((v): v is string => Boolean(v)) ??
        null;
      const approver = approvedById
        ? await this.prisma.unscoped.user.findFirst({
            where: { id: approvedById, clinicId: order.clinicId },
            select: { fullName: true },
          })
        : null;
      const data = buildResultPdfData(
        order,
        {
          name: clinic?.name ?? '',
          legalName: clinic?.legalName ?? null,
          address: clinic?.address ?? null,
          phone: clinic?.phone ?? null,
        },
        approver,
      );
      const buffer = await this.resultPdf.render(data, 'uz');
      await ctx.replyWithDocument(new InputFile(buffer, `natija-${order.orderNumber}.pdf`), {
        caption: `🧪 ${order.orderNumber}`,
      });
    } catch (err: unknown) {
      this.logger.error(`lab result pdf failed for order ${orderId}: ${String(err)}`);
      await ctx.reply('PDF tayyorlashda xatolik yuz berdi. Birozdan keyin urinib ko‘ring.');
    }
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
      await ctx.reply('Hozircha hujjatlaringiz yo‘q.', { reply_markup: PATIENT_KEYBOARD });
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
    await ctx.reply('Barcha hujjatlar yuborildi ✅', { reply_markup: PATIENT_KEYBOARD });
  }

  // -------------------------------------------------- medical-record access

  /**
   * The clinical narrative — diagnoses, prescriptions, doctor's plan — is shown
   * only for clinics that approved this patient. Lab results are never gated
   * this way (see 🧪 Tahlillarim); what needs a human decision is the record a
   * patient could misread without a clinician present.
   */
  private async handleMyHistory(ctx: Context): Promise<void> {
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;
    const patientIds = await this.linkedPatientIds(chatId);
    if (patientIds.length === 0) {
      await ctx.reply('Avval /start orqali telefon raqamingizni bog‘lang.');
      return;
    }

    // Unscoped justified: the bot is pre-tenant; patientIds come from this
    // chat's own bindings, never from user input.
    const patients = await this.prisma.unscoped.patient.findMany({
      where: { id: { in: patientIds } },
      select: { id: true, clinicId: true, recordAccess: { select: { status: true } } },
    });
    const approved = patients.filter((p) => p.recordAccess?.status === 'APPROVED');

    if (approved.length === 0) {
      const pending = patients.filter((p) => p.recordAccess?.status === 'PENDING');
      if (pending.length > 0) {
        await ctx.reply(
          '⏳ So‘rovingiz klinikaga yuborilgan. Shifokor yoki administrator tasdiqlagach, ' +
            'kasallik tarixingiz shu yerda ko‘rinadi.',
          { reply_markup: PATIENT_KEYBOARD },
        );
        return;
      }
      const clinics = await this.prisma.unscoped.clinic.findMany({
        where: { id: { in: [...new Set(patients.map((p) => p.clinicId))] } },
        select: { id: true, name: true },
      });
      if (clinics.length === 0) {
        await ctx.reply('Hozircha kasallik tarixingiz yo‘q.', { reply_markup: PATIENT_KEYBOARD });
        return;
      }
      await ctx.reply(
        '🔒 Kasallik tarixini ko‘rish uchun klinikadan ruxsat kerak.\n\n' +
          'Quyidagi tugma orqali so‘rov yuboring — shifokor yoki administrator ' +
          'tasdiqlagach, tarixingiz shu yerda ochiladi.',
        {
          reply_markup: {
            inline_keyboard: clinics.map((c) => [
              { text: `📨 ${c.name} — so‘rov yuborish`, callback_data: `ra_req:${c.id}` },
            ]),
          },
        },
      );
      return;
    }

    const visits = await this.prisma.unscoped.visit.findMany({
      where: {
        patientId: { in: approved.map((p) => p.id) },
        status: 'COMPLETED',
      },
      orderBy: { startedAt: 'desc' },
      take: 5,
      select: {
        startedAt: true,
        assessmentNote: true,
        plan: true,
        doctor: { select: { fullName: true } },
        diagnoses: {
          select: { isPrimary: true, icd10: { select: { code: true, nameUz: true } } },
        },
        prescriptions: { select: { drugName: true, dosage: true, frequency: true } },
      },
    });

    if (visits.length === 0) {
      await ctx.reply('Hozircha yakunlangan tashriflaringiz yo‘q.', {
        reply_markup: PATIENT_KEYBOARD,
      });
      return;
    }

    const blocks = visits.map((v) => {
      const lines = [
        `📋 ${formatInTimeZone(v.startedAt, TIMEZONE, 'dd.MM.yyyy')} — ${v.doctor.fullName}`,
      ];
      for (const d of v.diagnoses) {
        lines.push(`• ${d.isPrimary ? 'Asosiy' : 'Qo‘shimcha'}: ${d.icd10.code} ${d.icd10.nameUz}`);
      }
      if (v.assessmentNote) lines.push(`🩺 ${v.assessmentNote}`);
      if (v.plan) lines.push(`📝 ${v.plan}`);
      for (const rx of v.prescriptions) {
        lines.push(
          `💊 ${rx.drugName}${rx.dosage ? ` — ${rx.dosage}` : ''}${rx.frequency ? `, ${rx.frequency}` : ''}`,
        );
      }
      return lines.join('\n');
    });

    await ctx.reply(blocks.join('\n\n'), { reply_markup: PATIENT_KEYBOARD });
  }

  /** Patient tapped "so‘rov yuborish" under a clinic. */
  private async handleHistoryRequest(ctx: Context): Promise<void> {
    const match = ctx.match;
    if (typeof match === 'string' || !match) return;
    const clinicId = match[1];
    const chatId = ctx.chat?.id ?? ctx.from?.id;
    if (!clinicId || chatId === undefined) return;

    // The chat must actually own a patient card at that clinic — the clinicId
    // arrives from a callback payload, so it is treated as untrusted.
    const link = await this.prisma.unscoped.telegramLink.findFirst({
      where: { clinicId, chatId: String(chatId), isActive: true },
      select: { patientId: true },
    });
    if (!link) {
      await ctx.answerCallbackQuery({ text: 'Ruxsat yo‘q.' });
      return;
    }

    const patient = await this.prisma.unscoped.patient.findUnique({
      where: { id: link.patientId },
      select: { id: true, fullName: true, mrn: true, recordAccess: { select: { status: true } } },
    });
    if (!patient) {
      await ctx.answerCallbackQuery({ text: 'Bemor kartasi topilmadi.' });
      return;
    }
    if (patient.recordAccess?.status === 'APPROVED') {
      await ctx.answerCallbackQuery({ text: 'Ruxsat allaqachon berilgan.' });
      return;
    }

    const row = await this.prisma.unscoped.medicalRecordAccess.upsert({
      where: { patientId: patient.id },
      create: { clinicId, patientId: patient.id, status: 'PENDING' },
      update: {
        status: 'PENDING',
        requestedAt: new Date(),
        decidedAt: null,
        decidedById: null,
        decisionNote: null,
      },
      select: { id: true },
    });

    await this.notifyStaffOfHistoryRequest(clinicId, row.id, patient.fullName, patient.mrn);
    await ctx.answerCallbackQuery({ text: '✅ So‘rov yuborildi.' });
    await ctx.reply(
      '📨 So‘rovingiz klinikaga yuborildi. Tasdiqlangach, shu yerda xabar beramiz.',
      { reply_markup: PATIENT_KEYBOARD },
    );
  }

  /** Doctor / clinic admin approves or rejects straight from the notification. */
  private async handleHistoryDecision(ctx: Context): Promise<void> {
    const match = ctx.match;
    if (typeof match === 'string' || !match) return;
    const decision = match[1];
    const requestId = match[2];
    const chatId = ctx.chat?.id ?? ctx.from?.id;
    if (!decision || !requestId || chatId === undefined) return;

    const identity = await this.identify(chatId);
    const staff = identity.staff;
    if (!staff || !['CLINIC_OWNER', 'CLINIC_ADMIN', 'DOCTOR'].includes(staff.role)) {
      await ctx.answerCallbackQuery({ text: 'Ruxsatingiz yo‘q.' });
      return;
    }

    const request = await this.prisma.unscoped.medicalRecordAccess.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        clinicId: true,
        status: true,
        patient: { select: { fullName: true, phone: true } },
      },
    });
    // The decider must belong to the clinic that owns the request.
    if (!request || request.clinicId !== staff.clinicId) {
      await ctx.answerCallbackQuery({ text: 'So‘rov topilmadi.' });
      return;
    }
    if (request.status !== 'PENDING') {
      await ctx.answerCallbackQuery({ text: 'Bu so‘rov allaqachon hal qilingan.' });
      return;
    }

    const status = decision === 'ok' ? 'APPROVED' : 'REJECTED';
    await TenantContext.run({ clinicId: request.clinicId }, async () => {
      await this.prisma.db.medicalRecordAccess.update({
        where: { id: request.id },
        data: { status, decidedById: staff.id, decidedAt: new Date() },
      });
      await this.audit.log({
        action: AuditAction.UPDATE,
        entity: 'MedicalRecordAccess',
        entityId: request.id,
        userId: staff.id,
        before: { status: request.status },
        after: { status, via: 'telegram' },
      });
    });

    await ctx.answerCallbackQuery({
      text: status === 'APPROVED' ? '✅ Ruxsat berildi.' : '❌ Rad etildi.',
    });
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
    await ctx.reply(
      `${request.patient.fullName}: ${status === 'APPROVED' ? 'ruxsat berildi ✅' : 'rad etildi ❌'}`,
    );

    // Tell the patient, if they have the bot.
    if (request.patient.phone) {
      const patientLink = await this.prisma.unscoped.telegramLink.findFirst({
        where: {
          clinicId: request.clinicId,
          isActive: true,
          patient: { phone: request.patient.phone, deletedAt: null },
        },
        select: { chatId: true },
      });
      if (patientLink) {
        await this.bot?.api
          .sendMessage(
            patientLink.chatId,
            status === 'APPROVED'
              ? '✅ Kasallik tarixingizni ko‘rishga ruxsat berildi. «📋 Kasallik tarixim» tugmasini bosing.'
              : '❌ Kasallik tarixiga so‘rovingiz rad etildi. Klinikaga murojaat qiling.',
          )
          .catch((e: unknown) => this.logger.warn(`patient notify failed: ${String(e)}`));
      }
    }
  }

  /** Push the request to every decision-maker who linked a chat. */
  private async notifyStaffOfHistoryRequest(
    clinicId: string,
    requestId: string,
    patientName: string,
    mrn: string,
  ): Promise<void> {
    const staff = await this.prisma.unscoped.user.findMany({
      where: {
        clinicId,
        status: 'ACTIVE',
        telegramChatId: { not: null },
        role: { in: ['CLINIC_OWNER', 'CLINIC_ADMIN', 'DOCTOR'] },
      },
      select: { telegramChatId: true },
    });
    const text =
      `🔐 Kasallik tarixiga ruxsat so‘raldi\n\n` +
      `Bemor: ${patientName} (${mrn})\n\n` +
      `Ruxsat bersangiz, bemor o‘z tashxislari va retseptlarini ilovada va botda ko‘ra oladi.`;
    const keyboard = {
      inline_keyboard: [
        [
          { text: '✅ Ruxsat berish', callback_data: `ra_ok:${requestId}` },
          { text: '❌ Rad etish', callback_data: `ra_no:${requestId}` },
        ],
      ],
    };
    await Promise.all(
      staff.map((u) =>
        this.bot?.api
          .sendMessage(u.telegramChatId as string, text, { reply_markup: keyboard })
          .catch((e: unknown) => this.logger.warn(`staff notify failed: ${String(e)}`)),
      ),
    );
  }

  // ------------------------------------------------------------ clinic staff

  /** Resolve the staff identity, replying with a hint when the chat lacks the role. */
  private async requireStaff(
    ctx: Context,
    roles: string[],
  ): Promise<{ id: string; clinicId: string | null; role: string; fullName: string } | null> {
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return null;
    const identity = await this.identify(chatId);
    if (!identity.staff || !roles.includes(identity.staff.role)) {
      await ctx.reply('Bu bo‘lim uchun ruxsatingiz yo‘q.');
      return null;
    }
    return identity.staff;
  }

  /** Start of today in the clinic's timezone, as a UTC instant. */
  private todayRange(): { from: Date; to: Date } {
    const day = formatInTimeZone(new Date(), TIMEZONE, 'yyyy-MM-dd');
    // Asia/Tashkent is UTC+5 year-round (no DST), so the day starts at 19:00 UTC.
    const from = new Date(`${day}T00:00:00.000+05:00`);
    return { from, to: new Date(from.getTime() + 86_400_000) };
  }

  private async handleClinicToday(ctx: Context): Promise<void> {
    const staff = await this.requireStaff(ctx, ['CLINIC_OWNER', 'CLINIC_ADMIN']);
    if (!staff?.clinicId) return;
    const clinicId = staff.clinicId;
    const { from, to } = this.todayRange();

    // Unscoped justified: bot runs pre-tenant; clinicId comes from the bound
    // staff row, never from user input.
    const [appointments, completed, waiting, newPatients, payments] = await Promise.all([
      this.prisma.unscoped.appointment.count({
        where: { clinicId, startAt: { gte: from, lt: to } },
      }),
      this.prisma.unscoped.visit.count({
        where: { clinicId, completedAt: { gte: from, lt: to } },
      }),
      this.prisma.unscoped.queueTicket.count({ where: { clinicId, status: 'WAITING' } }),
      this.prisma.unscoped.patient.count({
        where: { clinicId, createdAt: { gte: from, lt: to }, deletedAt: null },
      }),
      this.prisma.unscoped.payment.aggregate({
        where: { clinicId, status: 'COMPLETED', paidAt: { gte: from, lt: to } },
        _sum: { amount: true },
      }),
    ]);

    const revenue = payments._sum.amount?.toFixed(2) ?? '0.00';
    await ctx.reply(
      `📊 Bugungi holat — ${formatInTimeZone(new Date(), TIMEZONE, 'dd.MM.yyyy')}\n\n` +
        `📅 Qabullar: ${appointments}\n` +
        `✅ Yakunlangan tashriflar: ${completed}\n` +
        `🕐 Navbatda kutmoqda: ${waiting}\n` +
        `🆕 Yangi bemorlar: ${newPatients}\n` +
        `💰 Tushum: ${formatUZS(revenue)}`,
    );
  }

  private async handleClinicQueue(ctx: Context): Promise<void> {
    const staff = await this.requireStaff(ctx, ['CLINIC_OWNER', 'CLINIC_ADMIN']);
    if (!staff?.clinicId) return;
    const clinicId = staff.clinicId;

    const tickets = await this.prisma.unscoped.queueTicket.groupBy({
      by: ['doctorUserId', 'status'],
      where: { clinicId, status: { in: ['WAITING', 'IN_ROOM'] } },
      _count: { _all: true },
    });
    if (tickets.length === 0) {
      await ctx.reply('Hozir navbat bo‘sh.');
      return;
    }
    const doctorIds = [...new Set(tickets.map((t) => t.doctorUserId).filter((x): x is string => !!x))];
    const doctors = await this.prisma.unscoped.user.findMany({
      where: { id: { in: doctorIds } },
      select: { id: true, fullName: true },
    });
    const nameById = new Map(doctors.map((d) => [d.id, d.fullName]));

    const byDoctor = new Map<string, { waiting: number; inRoom: number }>();
    for (const row of tickets) {
      const key = row.doctorUserId ?? 'other';
      const entry = byDoctor.get(key) ?? { waiting: 0, inRoom: 0 };
      if (row.status === 'WAITING') entry.waiting += row._count._all;
      else entry.inRoom += row._count._all;
      byDoctor.set(key, entry);
    }
    const lines = [...byDoctor.entries()].map(([id, c]) => {
      const name = nameById.get(id) ?? 'Boshqa';
      return `👨‍⚕️ ${name} — kutmoqda: ${c.waiting}, qabulda: ${c.inRoom}`;
    });
    await ctx.reply(`👥 Navbat holati\n\n${lines.join('\n')}`);
  }

  // ------------------------------------------------------------ platform

  private async handlePlatformClinics(ctx: Context): Promise<void> {
    const staff = await this.requireStaff(ctx, ['SUPER_ADMIN']);
    if (!staff) return;
    const now = new Date();
    const soon = new Date(now.getTime() + 3 * 86_400_000);

    const [total, active, trial, expiring, expired] = await Promise.all([
      this.prisma.unscoped.clinic.count(),
      this.prisma.unscoped.clinic.count({ where: { status: 'ACTIVE' } }),
      this.prisma.unscoped.clinicSubscription.count({
        where: { status: 'TRIAL', endsAt: { gt: now } },
      }),
      this.prisma.unscoped.clinicSubscription.count({
        where: { status: { in: ['TRIAL', 'ACTIVE'] }, endsAt: { gt: now, lte: soon } },
      }),
      this.prisma.unscoped.clinicSubscription.count({
        where: { status: { in: ['TRIAL', 'ACTIVE', 'PAST_DUE'] }, endsAt: { lte: now } },
      }),
    ]);

    await ctx.reply(
      `🏥 Platforma holati\n\n` +
        `Jami klinikalar: ${total}\n` +
        `Faol: ${active}\n` +
        `Sinovda: ${trial}\n` +
        `⚠️ 3 kun ichida tugaydi: ${expiring}\n` +
        `⛔ Muddati tugagan: ${expired}`,
    );
  }

  private async handlePlatformSignups(ctx: Context): Promise<void> {
    const staff = await this.requireStaff(ctx, ['SUPER_ADMIN']);
    if (!staff) return;
    const clinics = await this.prisma.unscoped.clinic.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        name: true,
        phone: true,
        createdAt: true,
        subscriptions: {
          where: { status: { in: ['TRIAL', 'ACTIVE', 'PAST_DUE'] } },
          orderBy: [{ startsAt: 'desc' }],
          take: 1,
          select: { status: true, endsAt: true },
        },
      },
    });
    if (clinics.length === 0) {
      await ctx.reply('Hozircha ro‘yxatdan o‘tgan klinika yo‘q.');
      return;
    }
    const now = Date.now();
    const lines = clinics.map((c) => {
      const sub = c.subscriptions[0];
      const days =
        sub?.endsAt != null
          ? Math.max(0, Math.ceil((sub.endsAt.getTime() - now) / 86_400_000))
          : null;
      const state = !sub
        ? 'obunasiz'
        : days === null
          ? 'muddatsiz'
          : days === 0
            ? '⛔ tugagan'
            : `${days} kun qoldi`;
      return `🏥 ${c.name}\n   ${c.phone ?? 'raqamsiz'} · ${formatInTimeZone(c.createdAt, TIMEZONE, 'dd.MM.yyyy')} · ${state}`;
    });
    await ctx.reply(`🆕 So‘nggi ro‘yxatdan o‘tganlar\n\n${lines.join('\n')}`);
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
