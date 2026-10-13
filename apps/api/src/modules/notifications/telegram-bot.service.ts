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
import {
  TelegramPatientAccessService,
  type TelegramPatientAccessResult,
} from './telegram-patient-access.service';
import { VisitReportPdfService } from '../visits/visit-report-pdf.service';
import { VISIT_REPORT_INCLUDE, buildVisitReportPdfData } from '../visits/visit-report.data';
import { patientDocumentVisibility } from '../patients/patient-document-access';

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
const CONTACT_KEYBOARD = new Keyboard().requestContact('📱 Raqamni yuborish').resized().oneTime();

/** Patient-only keyboard, re-sent alongside patient answers. */
const PATIENT_KEYBOARD = keyboardFor({ patientIds: ['x'], staff: null });
const CLINIC_PATIENT_KEYBOARD = new Keyboard()
  .text('🧪 Tahlillarim')
  .text('🩻 UZI natijalarim')
  .row()
  .text('🩺 Shifokor xulosalari')
  .text('📄 Hujjatlarim')
  .row()
  .text('👤 Mening ma’lumotlarim')
  .text('🔄 Yangilash')
  .row()
  .text('ℹ️ Yordam')
  .resized()
  .persistent();
const WAITING_PATIENT_KEYBOARD = new Keyboard()
  .requestContact('📱 Raqamni yuborish')
  .row()
  .text('🔄 Yangilash')
  .text('ℹ️ Yordam')
  .resized();

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
    private readonly patientAccess: TelegramPatientAccessService,
    private readonly visitReportPdf: VisitReportPdfService,
  ) {}

  private get patientOnly(): boolean {
    return this.config.env?.SINGLE_CLINIC_MODE === true;
  }

  private get patientKeyboard(): Keyboard {
    return this.patientOnly ? CLINIC_PATIENT_KEYBOARD : PATIENT_KEYBOARD;
  }

  onModuleInit(): void {
    const { TELEGRAM_ENABLED, TELEGRAM_BOT_TOKEN } = this.config.env;
    if (!TELEGRAM_ENABLED || !TELEGRAM_BOT_TOKEN) return;
    this.bot = new Bot(TELEGRAM_BOT_TOKEN);
    this.registerHandlers(this.bot);
    this.bot.catch(async (error) => {
      this.logger.error('Telegram update could not be processed');
      if (error.ctx.chat?.type === 'private' && error.ctx.chat.id === error.ctx.from?.id) {
        await error.ctx
          .reply('So‘rovni bajarib bo‘lmadi. Birozdan keyin /menu orqali qayta urinib ko‘ring.')
          .catch(() => undefined);
      }
    });
    // Long polling must not block Nest bootstrap — fire and forget.
    void this.bot
      .start({
        drop_pending_updates: false,
        onStart: async (info) => {
          this.logger.log(`Telegram patient bot @${info.username} is listening`);
          await this.bot?.api
            .setMyCommands([
              { command: 'start', description: 'Telefon orqali bemor kartasiga ulanish' },
              { command: 'menu', description: 'Natijalar va hujjatlar' },
              { command: 'help', description: 'Foydalanish bo‘yicha yordam' },
              { command: 'unlink', description: 'Bemor kartasidan uzilish' },
            ])
            .catch(() => this.logger.warn('Telegram command menu could not be updated'));
        },
      })
      .catch(() =>
        this.logger.error('Telegram bot stopped; check its token and polling connection'),
      );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.bot) await this.bot.stop().catch(() => undefined);
  }

  private registerHandlers(bot: Bot): void {
    // Contact sharing and medical documents belong only in a person's private
    // conversation. Never resolve or send PHI in a group/channel or inline chat.
    bot.use(async (ctx, next) => {
      if (ctx.chat?.type !== 'private' || ctx.chat.id !== ctx.from?.id) return;
      await next();
    });
    bot.command('start', (ctx) => this.handleStart(ctx));
    bot.command('menu', (ctx) => this.handleMenu(ctx));
    bot.command('unlink', (ctx) => this.handleUnlink(ctx));
    bot.command('help', (ctx) => this.handleHelp(ctx));
    bot.on('message:contact', (ctx) => this.handleContact(ctx));
    // Patient
    bot.hears('🧪 Tahlillarim', (ctx) => this.handleMyResults(ctx));
    bot.hears('📄 Hujjatlarim', (ctx) => this.handleMyDocuments(ctx));
    bot.hears('🩻 UZI natijalarim', (ctx) => this.handleDocumentList(ctx, 'ultrasound', 0));
    bot.hears('🩺 Shifokor xulosalari', (ctx) => this.handleDocumentList(ctx, 'consultation', 0));
    bot.hears('👤 Mening ma’lumotlarim', (ctx) => this.handlePatientProfile(ctx));
    bot.hears('🔄 Yangilash', (ctx) => this.handleMenu(ctx));
    bot.hears('ℹ️ Yordam', (ctx) => this.handleHelp(ctx));
    if (!this.patientOnly) {
      bot.hears('📅 Qabullarim', (ctx) => this.handleMyAppointments(ctx));
      bot.hears('🕐 Navbatim', (ctx) => this.handleMyQueue(ctx));
      bot.hears('📋 Kasallik tarixim', (ctx) => this.handleMyHistory(ctx));
      // Clinic owner / admin
      bot.hears('📊 Bugungi holat', (ctx) => this.handleClinicToday(ctx));
      bot.hears('👥 Navbat holati', (ctx) => this.handleClinicQueue(ctx));
      // Platform super-admin
      bot.hears('🏥 Klinikalar', (ctx) => this.handlePlatformClinics(ctx));
      bot.hears('🆕 Yangi ro‘yxatdan o‘tganlar', (ctx) => this.handlePlatformSignups(ctx));
      bot.callbackQuery(/^(confirm|cancel):(.+)$/, (ctx) => this.handleAppointmentAction(ctx));
    }
    // A ready lab result as a PDF document.
    bot.callbackQuery(/^labpdf:([0-9a-f-]{36})$/, (ctx) =>
      this.handleResultPdf(ctx, ctx.match[1] ?? ''),
    );
    bot.callbackQuery(/^docs:(lab|ultrasound|consultation|files):(\d+)$/, (ctx) =>
      this.handleDocumentList(
        ctx,
        ctx.match[1] as 'lab' | 'ultrasound' | 'consultation' | 'files',
        Number(ctx.match[2]),
      ),
    );
    bot.callbackQuery(/^docfile:([0-9a-f-]{36})$/, (ctx) =>
      this.handleDocumentFile(ctx, ctx.match[1] ?? ''),
    );
    bot.callbackQuery(/^visitpdf:([0-9a-f-]{36})$/, (ctx) =>
      this.handleVisitReportPdf(ctx, ctx.match[1] ?? ''),
    );
    // Patient asks a clinic to release their history.
    if (!this.patientOnly)
      bot.callbackQuery(/^ra_req:(.+)$/, (ctx) => this.handleHistoryRequest(ctx));
    // Doctor / clinic admin decides, straight from the notification.
    if (!this.patientOnly)
      bot.callbackQuery(/^ra_(ok|no):(.+)$/, (ctx) => this.handleHistoryDecision(ctx));
    if (this.patientOnly) {
      bot.on('callback_query:data', async (ctx) => {
        await ctx.answerCallbackQuery({ text: 'Menyuni yangilash uchun /menu bosing.' });
      });
      bot.on('message:text', async (ctx) => {
        const linked = (await this.patientAccess.resolve(ctx.chat.id)).status === 'LINKED';
        await ctx.reply(
          linked
            ? 'Kerakli bo‘limni pastdagi menyudan tanlang. Yordam uchun /help bosing.'
            : 'Telefon raqamini qo‘lda yozish o‘rniga «📱 Raqamni yuborish» tugmasini bosing. Natijalar uchun /menu, yordam uchun /help.',
          {
            reply_markup: linked ? CLINIC_PATIENT_KEYBOARD : WAITING_PATIENT_KEYBOARD,
          },
        );
      });
    }
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
    if (this.patientOnly)
      return { patientIds: await this.patientAccess.patientIds(chatId), staff: null };
    const chat = String(chatId);
    const [links, staff] = await Promise.all([
      this.patientAccess.patientIds(chatId),
      this.prisma.unscoped.user.findFirst({
        where: { telegramChatId: chat, deletedAt: null, status: 'ACTIVE' },
        select: { id: true, clinicId: true, role: true, fullName: true },
      }),
    ]);
    return { patientIds: links, staff };
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
    if (this.patientOnly) return this.replyPatientHome(ctx);
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
    if (this.patientOnly) {
      await this.patientAccess.unlink(chatId);
      await ctx.reply(
        'Bemor kartangiz bilan bog‘lanish uzildi. Qayta ulanish uchun /start bosing.',
        {
          reply_markup: { remove_keyboard: true },
        },
      );
      return;
    }
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

  private async replyPatientHome(
    ctx: Context,
    resolved?: TelegramPatientAccessResult,
  ): Promise<void> {
    if (ctx.chat?.id === undefined) return;
    const access = resolved ?? (await this.patientAccess.resolve(ctx.chat.id));
    if (access.status === 'LINKED') {
      await ctx.reply(
        `Bemor kartangiz ulandi ✅\n\n${access.patients.map((p) => `${p.fullName}\nKarta: ${p.mrn}`).join('\n\n')}\n\nKerakli bo‘limni tanlang. Tasdiqlangan natija va xulosalarni PDF ko‘rinishida olishingiz mumkin.`,
        {
          reply_markup: CLINIC_PATIENT_KEYBOARD,
        },
      );
      return;
    }
    const messages = {
      UNLINKED:
        'Assalomu alaykum! Klinikaning bemorlar botiga xush kelibsiz.\n\nUlanish uchun pastdagi «📱 Raqamni yuborish» tugmasini bosing. Telegram raqamingiz qabulxonada bemor kartasiga kiritilgan asosiy telefon bilan bir xil bo‘lishi kerak.',
      NOT_FOUND:
        'Telefon raqamingiz tasdiqlandi ✅\n\nHozircha klinikada shu raqamga bemor kartasi topilmadi. Qabulxonadan kartangizdagi asosiy telefonni tekshirishni so‘rang, keyin «🔄 Yangilash»ni bosing. Raqamni qayta yuborishingiz shart emas.',
      AMBIGUOUS:
        'Bu telefon raqami bir nechta bemor kartasida ko‘rsatilgan. Ma’lumotlarni to‘g‘ri ulash uchun qabulxonaga murojaat qiling. Tuzatilgach «🔄 Yangilash»ni bosing.',
      UNAVAILABLE:
        'Hozir bemor kartasiga ulanib bo‘lmadi. Birozdan keyin «🔄 Yangilash»ni bosing yoki qabulxonaga murojaat qiling.',
    };
    await ctx.reply(messages[access.status], { reply_markup: WAITING_PATIENT_KEYBOARD });
  }

  private async handlePatientProfile(ctx: Context): Promise<void> {
    if (ctx.chat?.id === undefined) return;
    const access = await this.patientAccess.resolve(ctx.chat.id);
    if (access.status !== 'LINKED') return this.replyPatientHome(ctx, access);
    await ctx.reply(
      access.patients
        .map((p) =>
          [
            '👤 Mening ma’lumotlarim',
            p.fullName,
            `Bemor kartasi: ${p.mrn}`,
            `Telefon: ${p.phone ?? '—'}`,
            `Tug‘ilgan sana: ${p.dob ? formatInTimeZone(p.dob, TIMEZONE, 'dd.MM.yyyy') : '—'}`,
          ].join('\n'),
        )
        .join('\n\n') + '\n\nMa’lumotda xato bo‘lsa, qabulxonaga murojaat qiling.',
      { reply_markup: this.patientKeyboard },
    );
  }

  private async handleHelp(ctx: Context): Promise<void> {
    await ctx.reply(
      'ℹ️ Botdan foydalanish\n\n1. /start ni bosing va «📱 Raqamni yuborish» orqali o‘z raqamingizni yuboring.\n2. Raqam qabulxonada kiritilgan asosiy telefon bilan mos bo‘lsa, kartangiz avtomatik ulanadi.\n3. Laboratoriya, UZI yoki shifokor xulosasini tanlab, kerakli PDFni oling. Natija tasdiqlangandan keyin ko‘rinadi.\n\n/menu — bo‘limlarni ochish\n/unlink — kartadan uzilish\n\nRaqam mos kelmasa yoki bir nechta kartada ishlatilsa, qabulxonaga murojaat qiling.',
    );
  }

  /** /start — with a deep-link payload, consume a web link token; else ask for a contact. */
  private async handleStart(ctx: Context): Promise<void> {
    if (this.patientOnly) return this.replyPatientHome(ctx);
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
    const claimed = await this.prisma.unscoped.portalLinkToken.updateMany({
      where: { id: link.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) {
      await ctx.reply('Ulash havolasi eskirgan yoki ishlatilgan. Portaldan yangi havola oling.');
      return;
    }
    const cards = await this.bindChat(chatId, link.phone, ctx.from?.username ?? null);
    const tail =
      cards === 0
        ? ' Hozircha biriktirilgan bemor kartangiz yo‘q — klinikaga tashrifingizdan so‘ng ma’lumotlar ko‘rinadi.'
        : '';
    await ctx.reply(`Akkauntingiz Telegram bilan bog‘landi ✅${tail}`, {
      reply_markup: this.patientKeyboard,
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

    if (this.patientOnly) {
      const access = await this.patientAccess.linkContact(
        chatId,
        phone,
        ctx.from?.username ?? null,
      );
      return this.replyPatientHome(ctx, access);
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

    const access = await this.patientAccess.linkContact(chatId, phone, username);
    return access.patients.length;
  }

  /** Active links for this chat across clinics (unscoped — cross-clinic bot). */
  private async linkedPatientIds(chatId: number): Promise<string[]> {
    return this.patientAccess.patientIds(chatId);
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
      await ctx.reply('Yaqin kunlarda qabullaringiz yo‘q.', { reply_markup: this.patientKeyboard });
      return;
    }
    const lines = appointments.map(
      (a) =>
        `📅 ${formatInTimeZone(a.startAt, TIMEZONE, 'dd.MM.yyyy HH:mm')} — ${a.doctor.fullName}`,
    );
    await ctx.reply(`Yaqin qabullaringiz:\n${lines.join('\n')}`, {
      reply_markup: this.patientKeyboard,
    });
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
      await ctx.reply('Bugun faol navbatingiz yo‘q.', { reply_markup: this.patientKeyboard });
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
    await ctx.reply(lines.join('\n'), { reply_markup: this.patientKeyboard });
  }

  private async handleMyResults(ctx: Context): Promise<void> {
    await this.handleDocumentList(ctx, 'lab', 0);
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
      await this.audit.log({
        action: AuditAction.EXPORT,
        entity: 'LabResultReport',
        entityId: order.id,
        clinicId: order.clinicId,
        after: { channel: 'telegram', requestedByPatient: true },
      });
    } catch {
      this.logger.warn(`lab result pdf failed for order ${orderId}`);
      await ctx.reply('PDF tayyorlashda xatolik yuz berdi. Birozdan keyin urinib ko‘ring.');
    }
  }

  private async handleMyDocuments(ctx: Context): Promise<void> {
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;
    if ((await this.linkedPatientIds(chatId)).length === 0) {
      if (this.patientOnly) return this.replyPatientHome(ctx);
      await ctx.reply('Avval /start orqali o‘zingizning telefon raqamingizni bog‘lang.');
      return;
    }
    await ctx.reply(
      'Kerakli hujjat turini tanlang. Xulosalar shifokor tasdiqlagandan keyin ko‘rinadi.',
      {
        reply_markup: new InlineKeyboard()
          .text('🧪 Laboratoriya natijalari', 'docs:lab:0')
          .row()
          .text('🩻 UZI xulosalari', 'docs:ultrasound:0')
          .row()
          .text('🩺 Shifokor xulosalari', 'docs:consultation:0')
          .row()
          .text('📎 Yuklangan hujjatlar', 'docs:files:0'),
      },
    );
  }

  /** Explicit patient requests are the consent to deliver these files in this private chat. */
  private async handleDocumentList(
    ctx: Context,
    type: 'lab' | 'ultrasound' | 'consultation' | 'files',
    page: number,
  ): Promise<void> {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery().catch(() => undefined);
    const chatId = ctx.chat?.id;
    if (chatId === undefined || !Number.isInteger(page) || page < 0 || page > 1_000) return;
    const patientIds = await this.linkedPatientIds(chatId);
    if (!patientIds.length) {
      if (this.patientOnly) return this.replyPatientHome(ctx);
      await ctx.reply('Avval /start orqali o‘zingizning telefon raqamingizni bog‘lang.');
      return;
    }
    const limit = 6;
    const keyboard = new InlineKeyboard();
    const captions: string[] = [];
    let hasMore = false;
    // All unscoped reads below are restricted to the sender's freshly verified
    // patient set. Status is checked again when the download button is pressed.
    if (type === 'lab') {
      const orders = await this.prisma.unscoped.labOrder.findMany({
        where: { patientId: { in: patientIds }, status: { in: ['APPROVED', 'DELIVERED'] } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: page * limit,
        take: limit + 1,
        select: {
          id: true,
          orderNumber: true,
          createdAt: true,
          items: {
            select: {
              labTest: { select: { name: true } },
              result: {
                select: {
                  approvedAt: true,
                  approvedById: true,
                  reportDocumentId: true,
                },
              },
            },
          },
        },
      });
      hasMore = orders.length > limit;
      for (const order of orders.slice(0, limit)) {
        const label = `${order.orderNumber} · ${formatInTimeZone(order.createdAt, TIMEZONE, 'dd.MM.yyyy')}`;
        captions.push(`🧪 ${label}`);
        keyboard.text(`📄 ${label}`, `labpdf:${order.id}`).row();
        const attachments = order.items.filter(
          (item) =>
            item.result?.reportDocumentId && item.result.approvedAt && item.result.approvedById,
        );
        for (const item of attachments.slice(0, 4)) {
          if (item.result?.reportDocumentId && item.result.approvedAt && item.result.approvedById) {
            keyboard
              .text(
                `📎 ${pickName(item.labTest.name).slice(0, 45)}`,
                `docfile:${item.result.reportDocumentId}`,
              )
              .row();
          }
        }
        if (attachments.length > 4) keyboard.text('Barcha fayllar', 'docs:files:0').row();
      }
    } else if (type === 'files') {
      const docs = await this.prisma.unscoped.patientDocument.findMany({
        where: patientDocumentVisibility(patientIds),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: page * limit,
        take: limit + 1,
        select: { id: true, title: true, createdAt: true },
      });
      hasMore = docs.length > limit;
      for (const doc of docs.slice(0, limit)) {
        const label = `${doc.title.slice(0, 50)} · ${formatInTimeZone(doc.createdAt, TIMEZONE, 'dd.MM.yyyy')}`;
        captions.push(`📎 ${label}`);
        keyboard.text(label, `docfile:${doc.id}`).row();
      }
    } else {
      const visits = await this.prisma.unscoped.visit.findMany({
        where: {
          patientId: { in: patientIds },
          status: 'COMPLETED',
          completedAt: { not: null },
          kind: type === 'ultrasound' ? 'ULTRASOUND' : 'CONSULTATION',
        },
        orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
        skip: page * limit,
        take: limit + 1,
        select: {
          id: true,
          reportTitle: true,
          completedAt: true,
          doctor: { select: { fullName: true } },
        },
      });
      hasMore = visits.length > limit;
      for (const visit of visits.slice(0, limit)) {
        const date = formatInTimeZone(visit.completedAt!, TIMEZONE, 'dd.MM.yyyy');
        const title =
          visit.reportTitle || (type === 'ultrasound' ? 'UZI xulosasi' : 'Shifokor xulosasi');
        captions.push(`📋 ${title} · ${date} · ${visit.doctor.fullName}`);
        keyboard.text(`${title.slice(0, 45)} · ${date}`, `visitpdf:${visit.id}`).row();
      }
    }
    if (page > 0) keyboard.text('← Oldingi', `docs:${type}:${page - 1}`);
    if (hasMore) keyboard.text('Keyingi →', `docs:${type}:${page + 1}`);
    await ctx.reply(
      captions.length
        ? `${captions.join('\n')}\n\nYuklab olish uchun hujjat tugmasini bosing.`
        : 'Hozircha bu turdagi tayyor hujjatlar yo‘q.',
      { reply_markup: keyboard },
    );
  }

  private async handleDocumentFile(ctx: Context, documentId: string): Promise<void> {
    await ctx.answerCallbackQuery().catch(() => undefined);
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;
    const patientIds = await this.linkedPatientIds(chatId);
    const document = patientIds.length
      ? await this.prisma.unscoped.patientDocument.findFirst({
          where: { AND: [patientDocumentVisibility(patientIds), { id: documentId }] },
          select: { id: true, clinicId: true, fileKey: true, fileName: true, title: true },
        })
      : null;
    if (!document) {
      await ctx.reply('Hujjat topilmadi yoki hali tasdiqlanmagan.');
      return;
    }
    try {
      await ctx.replyWithDocument(
        new InputFile(this.storage.getStream(document.fileKey), document.fileName),
        {
          caption: document.title.slice(0, 200),
        },
      );
      await this.audit.log({
        action: AuditAction.EXPORT,
        entity: 'PatientDocument',
        entityId: document.id,
        clinicId: document.clinicId,
        after: { channel: 'telegram', requestedByPatient: true },
      });
    } catch {
      this.logger.warn(`patient document delivery failed: ${document.id}`);
      await ctx.reply('Hujjatni yuborib bo‘lmadi. Birozdan keyin qayta urinib ko‘ring.');
    }
  }

  private async handleVisitReportPdf(ctx: Context, visitId: string): Promise<void> {
    await ctx.answerCallbackQuery().catch(() => undefined);
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;
    const patientIds = await this.linkedPatientIds(chatId);
    const visit = patientIds.length
      ? await this.prisma.unscoped.visit.findFirst({
          where: {
            id: visitId,
            patientId: { in: patientIds },
            status: 'COMPLETED',
            completedAt: { not: null },
          },
          include: VISIT_REPORT_INCLUDE,
        })
      : null;
    if (!visit) {
      await ctx.reply('Xulosa topilmadi yoki hali tasdiqlanmagan.');
      return;
    }
    try {
      const clinic = await this.prisma.unscoped.clinic.findUnique({
        where: { id: visit.clinicId },
        select: { name: true, legalName: true, address: true, phone: true },
      });
      if (!clinic) throw new Error('Clinic not found');
      const latestAmendment = visit.amendments[0];
      const amendmentAuthor = latestAmendment
        ? await this.prisma.unscoped.user.findFirst({
            where: { id: latestAmendment.authorId, clinicId: visit.clinicId },
            select: { fullName: true },
          })
        : null;
      const buffer = await this.visitReportPdf.render(
        buildVisitReportPdfData(visit, clinic, amendmentAuthor),
      );
      await ctx.replyWithDocument(new InputFile(buffer, `xulosa-${visit.id}.pdf`), {
        caption:
          visit.reportTitle || (visit.kind === 'ULTRASOUND' ? 'UZI xulosasi' : 'Shifokor xulosasi'),
      });
      await this.audit.log({
        action: AuditAction.EXPORT,
        entity: 'VisitReport',
        entityId: visit.id,
        clinicId: visit.clinicId,
        after: { channel: 'telegram', requestedByPatient: true },
      });
    } catch {
      this.logger.warn(`clinical report delivery failed: ${visit.id}`);
      await ctx.reply('Xulosani yuborib bo‘lmadi. Birozdan keyin qayta urinib ko‘ring.');
    }
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
          { reply_markup: this.patientKeyboard },
        );
        return;
      }
      const clinics = await this.prisma.unscoped.clinic.findMany({
        where: { id: { in: [...new Set(patients.map((p) => p.clinicId))] } },
        select: { id: true, name: true },
      });
      if (clinics.length === 0) {
        await ctx.reply('Hozircha kasallik tarixingiz yo‘q.', {
          reply_markup: this.patientKeyboard,
        });
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
        reply_markup: this.patientKeyboard,
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

    await ctx.reply(blocks.join('\n\n'), { reply_markup: this.patientKeyboard });
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
    await ctx.reply('📨 So‘rovingiz klinikaga yuborildi. Tasdiqlangach, shu yerda xabar beramiz.', {
      reply_markup: this.patientKeyboard,
    });
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
    const doctorIds = [
      ...new Set(tickets.map((t) => t.doctorUserId).filter((x): x is string => !!x)),
    ];
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
      select: { id: true, clinicId: true, patientId: true, status: true, startAt: true },
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
    // Same cutoff the portal enforces: within 2 hours of the start the slot can
    // no longer be resold, so the bot button must not offer a cancellation the
    // cabinet would refuse.
    if (action === 'cancel' && appointment.startAt.getTime() - Date.now() < 2 * 60 * 60 * 1000) {
      await ctx.answerCallbackQuery({
        text: 'Boshlanishiga 2 soatdan kam qoldi — bekor qilish uchun klinikaga qo‘ng‘iroq qiling.',
        show_alert: true,
      });
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
    await ctx
      .editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } })
      .catch(() => undefined);
  }
}
