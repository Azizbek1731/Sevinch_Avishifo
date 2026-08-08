import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { Gender as DbGender, Locale as DbLocale, Prisma } from '@prisma/client';
import {
  AppointmentStatus,
  AuditAction,
  ClinicStatus,
  ErrorCode,
  InvoiceStatus,
  LabOrderStatus,
  UserRole,
  UserStatus,
  VisitStatus,
  normalizePhone,
  type PortalCancelAppointmentInput,
  type PortalRequestOtpInput,
  type PortalUpdateProfileInput,
  type PortalVerifyOtpInput,
} from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { paginated, skipTake, type PaginatedResult } from '../../common/pagination';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';
import { AuditService } from '../../core/audit/audit.service';
import { SequenceService } from '../../core/sequence/sequence.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { SlotsService } from '../appointments/slots.service';
import { type FreeSlot } from '../appointments/slots.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SmsChannel } from '../notifications/channels/sms.channel';
import { StorageService } from '../../core/storage/storage.service';
import { AppConfigService } from '../../core/config/app-config.service';
import { RecordAccessService } from '../record-access/record-access.service';
import { TelegramChannel } from '../notifications/channels/telegram.channel';
import { TelegramGatewayChannel } from '../notifications/channels/telegram-gateway.channel';
import type {
  PortalAppointmentsQueryInput,
  PortalBookExtendedInput,
  PortalFeedbackInput,
} from './dto';

const OTP_PURPOSE = 'portal_login';
const OTP_TTL_MINUTES = 5;
const OTP_MAX_ATTEMPTS = 5;
const PORTAL_TOKEN_TTL = '30d';
const CANCEL_MIN_MS = 2 * 3_600_000; // cancellation cutoff: 2h before start
const LINK_TOKEN_TTL_MINUTES = 15; // Telegram web-link deep-link token lifetime

const ARGON2_OPTS: argon2.Options = { type: argon2.argon2id };

/**
 * The shared Locale enum uses the value "uz-Cyrl", but Prisma's client enum
 * member is "uz_Cyrl" (the @map target). Convert at the DB boundary both ways.
 */
const SHARED_TO_DB_LOCALE: Record<string, DbLocale> = {
  uz: 'uz',
  'uz-Cyrl': 'uz_Cyrl',
  ru: 'ru',
  en: 'en',
};
const DB_TO_SHARED_LOCALE: Record<string, string> = {
  uz: 'uz',
  uz_Cyrl: 'uz-Cyrl',
  ru: 'ru',
  en: 'en',
};

/** Typed patch for the durable portal account (scalar-only, no phone). */
interface ProfilePatch {
  firstName?: string;
  lastName?: string;
  email?: string | null;
  dob?: Date;
  gender?: DbGender;
  preferredLocale?: DbLocale;
  notifyAppointments?: boolean;
  notifyResults?: boolean;
  notifyPayments?: boolean;
  notifyPromos?: boolean;
}

/** "+998901234567" → "+998 90*****67" — keep PHI out of log lines. */
function maskPhone(phone: string): string {
  return `${phone.slice(0, 7)}*****${phone.slice(-2)}`;
}

interface PageQuery {
  page: number;
  limit: number;
}

// ---------------------------------------------------------------- output DTOs

export interface PortalClinicDto {
  id: string;
  name: string;
  logoUrl: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  onlineBookingEnabled: boolean;
  branches: Array<{
    id: string;
    name: string;
    address: string | null;
    phone: string | null;
    latitude: number | null;
    longitude: number | null;
    workingHours: unknown;
  }>;
  doctors: Array<{
    id: string;
    fullName: string;
    specialty: string | null;
    photoUrl: string | null;
    bio: string | null;
  }>;
  services: Array<{
    id: string;
    code: string;
    name: unknown;
    durationMin: number;
    category: { name: string; kind: string } | null;
    /** Current clinic-default price as a decimal string, null if not priced. */
    price: string | null;
  }>;
}

export interface PortalBookingResultDto {
  id: string;
  startAt: string;
  endAt: string;
  status: string;
}

export interface PortalPatientCardDto {
  clinicId: string;
  clinicName: string;
  patientId: string;
  mrn: string;
  fullName: string;
}

export interface PortalAppointmentDto {
  id: string;
  clinicId: string;
  clinicName: string;
  branchId: string;
  doctorName: string;
  startAt: string;
  endAt: string;
  status: string;
  note: string | null;
  cancelledReason: string | null;
}

export interface PortalVisitDto {
  id: string;
  clinicId: string;
  clinicName: string;
  doctorName: string;
  doctorSpecialty: string | null;
  startedAt: string;
  completedAt: string | null;
  diagnoses: Array<{
    code: string;
    nameUz: string;
    nameRu: string;
    nameEn: string | null;
    isPrimary: boolean;
  }>;
  prescriptionCount: number;
}

export interface PortalVisitDetailDto {
  id: string;
  clinicName: string;
  doctorName: string;
  doctorSpecialty: string | null;
  startedAt: string;
  completedAt: string | null;
  nextVisitAt: string | null;
  /** SOAP notes as written by the doctor (patient-readable summary of the exam). */
  subjective: string | null;
  objective: string | null;
  assessment: string | null;
  plan: string | null;
  vitals: {
    heightCm: number | null;
    weightKg: number | null;
    bpSystolic: number | null;
    bpDiastolic: number | null;
    pulseBpm: number | null;
    temperatureC: number | null;
    spo2: number | null;
  } | null;
  diagnoses: Array<{
    code: string;
    nameUz: string;
    nameRu: string;
    nameEn: string | null;
    isPrimary: boolean;
    note: string | null;
  }>;
  prescriptions: Array<{
    drugName: string;
    dosage: string | null;
    frequency: string | null;
    durationDays: number | null;
    instructions: string | null;
  }>;
  referrals: Array<{ type: string; targetSpecialty: string | null }>;
}

export interface PortalLabOrderDto {
  id: string;
  clinicId: string;
  clinicName: string;
  orderNumber: string;
  status: string;
  createdAt: string;
  deliveredAt: string | null;
  items: Array<{
    id: string;
    testCode: string;
    testName: unknown;
    result: {
      approvedAt: string | null;
      note: string | null;
      values: Array<{
        parameter: string;
        unit: string | null;
        value: string;
        flag: string;
      }>;
    } | null;
  }>;
}

export interface PortalInvoiceDto {
  id: string;
  clinicId: string;
  clinicName: string;
  number: string;
  status: string;
  subtotal: string;
  discountTotal: string;
  total: string;
  paidTotal: string;
  issuedAt: string | null;
  createdAt: string;
}

export interface PortalTelegramStatusDto {
  linked: boolean;
  username: string | null;
  linkedAt: string | null;
  /** Bot @username for building the t.me deep link, null if not configured. */
  botUsername: string | null;
  enabled: boolean;
}

export interface PortalProfileDto {
  phone: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  email: string | null;
  /** "YYYY-MM-DD" or null. */
  dob: string | null;
  gender: string | null;
  preferredLocale: string;
  phoneVerified: boolean;
  memberSince: string;
  telegram: PortalTelegramStatusDto;
  prefs: {
    appointments: boolean;
    results: boolean;
    payments: boolean;
    promos: boolean;
  };
  clinics: PortalPatientCardDto[];
  stats: {
    upcomingAppointments: number;
    visits: number;
    documents: number;
    labResults: number;
  };
}

export interface PortalDocumentDto {
  id: string;
  clinicId: string;
  clinicName: string;
  category: string;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

/**
 * Patient-facing portal API (spec §M14): OTP login, public clinic catalog,
 * online booking and the personal cabinet.
 *
 * Tenancy note: portal requests carry no staff tenant context. Cabinet reads
 * use `prisma.unscoped` restricted to patient cards linked to the OTP-verified
 * phone (the patient owns those records across clinics); booking resolves the
 * clinic from the branch and runs inside TenantContext.run.
 */
@Injectable()
export class PortalService {
  private readonly logger = new Logger(PortalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly sequence: SequenceService,
    private readonly appointments: AppointmentsService,
    private readonly slots: SlotsService,
    private readonly notifications: NotificationsService,
    private readonly sms: SmsChannel,
    private readonly storage: StorageService,
    private readonly config: AppConfigService,
    private readonly recordAccess: RecordAccessService,
    private readonly telegram: TelegramChannel,
    private readonly gateway: TelegramGatewayChannel,
  ) {}

  // ------------------------------------------------------------------- auth

  async requestOtp(input: PortalRequestOtpInput): Promise<{ requested: true }> {
    const phone = normalizePhone(input.phone);
    if (!phone) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Invalid phone number', 400);
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    // Unscoped (justified): OtpCode is a platform model (no clinicId), pre-auth flow.
    await this.prisma.unscoped.otpCode.updateMany({
      where: { phone, purpose: OTP_PURPOSE, usedAt: null },
      data: { usedAt: new Date() }, // invalidate previous outstanding codes
    });
    await this.prisma.unscoped.otpCode.create({
      data: {
        phone,
        codeHash: await argon2.hash(code, ARGON2_OPTS),
        purpose: OTP_PURPOSE,
        expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60_000),
      },
    });

    const message = `AviShifo tasdiqlash kodi: ${code}. Uni hech kimga bermang. Kod ${OTP_TTL_MINUTES} daqiqa amal qiladi.`;

    // Telegram first when the patient has already bound a chat: it is free,
    // instant, and works even when the SMS provider is unconfigured. SMS is the
    // fallback for everyone else.
    // Unscoped (justified): pre-auth lookup keyed by the submitted phone.
    const chat = await this.prisma.unscoped.telegramLink.findFirst({
      where: { isActive: true, patient: { phone, deletedAt: null } },
      select: { chatId: true },
    });

    // Telegram Gateway reaches any number registered on Telegram without the
    // patient ever having opened our bot — which is most of them, and the whole
    // reason a first sign-in used to depend on SMS. VERIFICATION_CODE_CHANNEL
    // decides which of the two Telegram routes is tried first; the other is the
    // fallback, and SMS is the last resort.
    const preferBot = this.config.env.VERIFICATION_CODE_CHANNEL === 'bot';

    const viaBot = async (): Promise<boolean> => {
      if (!chat) return false;
      try {
        await this.telegram.send(chat.chatId, `🔐 ${message}`);
        return true;
      } catch (err) {
        this.logger.warn(`OTP Telegram delivery failed for ${maskPhone(phone)}: ${String(err)}`);
        return false;
      }
    };
    const viaGateway = async (): Promise<boolean> =>
      (await this.gateway.sendCode(phone, code, OTP_TTL_MINUTES * 60)) !== null;

    let via = '';
    for (const [name, attempt] of preferBot
      ? ([['bot', viaBot], ['gateway', viaGateway]] as const)
      : ([['gateway', viaGateway], ['bot', viaBot]] as const)) {
      if (await attempt()) {
        via = name;
        break;
      }
    }

    if (!via) {
      // Real SMS delivery via the Eskiz channel (falls back to app-log when
      // SMS_PROVIDER=log, where SmsChannel prints the full message for dev).
      try {
        await this.sms.send(phone, message);
      } catch (err) {
        // Delivery failure must neither leak provider internals nor block the
        // flow — the code is stored and the patient can request a new one.
        this.logger.error(`OTP SMS delivery failed for ${maskPhone(phone)}: ${String(err)}`);
      }
    }

    this.logger.log(
      `[PORTAL OTP → ${maskPhone(phone)}] issued via ${via || 'sms'} (expires in ${OTP_TTL_MINUTES}m)`,
    );
    return { requested: true };
  }

  async verifyOtp(
    input: PortalVerifyOtpInput,
  ): Promise<{ accessToken: string; phone: string; isNew: boolean }> {
    const phone = normalizePhone(input.phone);
    if (!phone) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Invalid phone number', 400);
    }

    // Unscoped (justified): OtpCode is a platform model, pre-auth flow.
    const otp = await this.prisma.unscoped.otpCode.findFirst({
      where: { phone, purpose: OTP_PURPOSE, usedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) {
      throw new AppException(ErrorCode.OTP_INVALID, 'No active code — request a new one', 400);
    }
    if (otp.expiresAt < new Date()) {
      throw new AppException(ErrorCode.OTP_EXPIRED, 'Code expired — request a new one', 400);
    }
    if (otp.attempts >= OTP_MAX_ATTEMPTS) {
      throw new AppException(ErrorCode.OTP_INVALID, 'Too many attempts — request a new code', 400);
    }

    const ok = await argon2.verify(otp.codeHash, input.code).catch(() => false);
    if (!ok) {
      await this.prisma.unscoped.otpCode.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      throw new AppException(ErrorCode.OTP_INVALID, 'Invalid code', 400);
    }

    await this.prisma.unscoped.otpCode.update({
      where: { id: otp.id },
      data: { usedAt: new Date() },
    });

    // Upsert the durable portal account and mark the phone verified. This makes
    // "registered patient" a first-class, persisted concept (not just a token).
    const account = await this.prisma.unscoped.portalAccount.upsert({
      where: { phone },
      update: { phoneVerifiedAt: new Date(), lastLoginAt: new Date() },
      create: { phone, phoneVerifiedAt: new Date(), lastLoginAt: new Date() },
      select: { firstName: true, lastName: true },
    });

    // "New" = the account has no profile name yet and no existing patient card
    // to borrow one from → the UI routes to the registration/profile step.
    let profileComplete = Boolean(account.firstName && account.lastName);
    if (!profileComplete) {
      const card = await this.prisma.unscoped.patient.findFirst({
        where: { phone, deletedAt: null },
        select: { id: true },
      });
      profileComplete = Boolean(card);
    }

    const accessToken = await this.jwt.signAsync(
      { typ: 'portal', sub: phone, sid: randomUUID() },
      { expiresIn: PORTAL_TOKEN_TTL },
    );
    return { accessToken, phone, isNew: !profileComplete };
  }

  // ---------------------------------------------------------------- profile

  /** Full portal profile: account fields, cross-clinic cards, cabinet stats and Telegram status. */
  async getProfile(phone: string): Promise<PortalProfileDto> {
    // Ensure a durable account exists (a token can only be minted post-verify,
    // so upsert is defensive against pre-account tokens from older sessions).
    const account = await this.prisma.unscoped.portalAccount.upsert({
      where: { phone },
      update: {},
      create: { phone, phoneVerifiedAt: new Date() },
    });

    const patients = await this.ownPatients(phone);
    const patientIds = patients.map((p) => p.id);
    const clinicNames = await this.clinicNames(patients.map((p) => p.clinicId));

    const [upcomingAppointments, visits, documents, labResults] = await Promise.all([
      patientIds.length
        ? this.prisma.unscoped.appointment.count({
            where: {
              patientId: { in: patientIds },
              startAt: { gte: new Date() },
              status: { in: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED] },
            },
          })
        : 0,
      patientIds.length
        ? this.prisma.unscoped.visit.count({
            where: { patientId: { in: patientIds }, status: VisitStatus.COMPLETED },
          })
        : 0,
      patientIds.length
        ? this.prisma.unscoped.patientDocument.count({ where: { patientId: { in: patientIds } } })
        : 0,
      patientIds.length
        ? this.prisma.unscoped.labOrder.count({
            where: {
              patientId: { in: patientIds },
              status: { in: [LabOrderStatus.APPROVED, LabOrderStatus.DELIVERED] },
            },
          })
        : 0,
    ]);

    const fullName =
      [account.lastName, account.firstName].filter(Boolean).join(' ') ||
      patients[0]?.fullName ||
      '';

    return {
      phone,
      firstName: account.firstName,
      lastName: account.lastName,
      fullName,
      email: account.email,
      dob: account.dob ? account.dob.toISOString().slice(0, 10) : null,
      gender: account.gender,
      preferredLocale: DB_TO_SHARED_LOCALE[account.preferredLocale] ?? 'uz',
      phoneVerified: Boolean(account.phoneVerifiedAt),
      memberSince: account.createdAt.toISOString(),
      telegram: {
        linked: Boolean(account.telegramChatId),
        username: account.telegramUsername,
        linkedAt: account.telegramLinkedAt ? account.telegramLinkedAt.toISOString() : null,
        botUsername: (this.config.env.TELEGRAM_BOT_USERNAME || null),
        enabled: this.config.env.TELEGRAM_ENABLED,
      },
      prefs: {
        appointments: account.notifyAppointments,
        results: account.notifyResults,
        payments: account.notifyPayments,
        promos: account.notifyPromos,
      },
      clinics: patients.map((p) => ({
        clinicId: p.clinicId,
        clinicName: clinicNames.get(p.clinicId) ?? '',
        patientId: p.id,
        mrn: p.mrn,
        fullName: p.fullName,
      })),
      stats: { upcomingAppointments, visits, documents, labResults },
    };
  }

  /** Update the portal profile (also serves registration name capture). */
  async updateProfile(phone: string, input: PortalUpdateProfileInput): Promise<PortalProfileDto> {
    const patch: ProfilePatch = {};
    if (input.firstName !== undefined) patch.firstName = input.firstName;
    if (input.lastName !== undefined) patch.lastName = input.lastName;
    if (input.email !== undefined) patch.email = input.email === '' ? null : input.email;
    if (input.dob !== undefined) patch.dob = new Date(`${input.dob}T00:00:00.000Z`);
    if (input.gender !== undefined) patch.gender = input.gender as DbGender;
    if (input.preferredLocale !== undefined) {
      patch.preferredLocale = SHARED_TO_DB_LOCALE[input.preferredLocale] ?? 'uz';
    }
    if (input.notifyAppointments !== undefined) patch.notifyAppointments = input.notifyAppointments;
    if (input.notifyResults !== undefined) patch.notifyResults = input.notifyResults;
    if (input.notifyPayments !== undefined) patch.notifyPayments = input.notifyPayments;
    if (input.notifyPromos !== undefined) patch.notifyPromos = input.notifyPromos;

    await this.prisma.unscoped.portalAccount.upsert({
      where: { phone },
      update: patch,
      create: { phone, phoneVerifiedAt: new Date(), ...patch },
    });
    return this.getProfile(phone);
  }

  // -------------------------------------------------------------- documents

  /** Documents (receipts, prescriptions, scans, analysis PDFs) across the patient's cards. */
  async getDocuments(
    phone: string,
    query: PageQuery,
  ): Promise<PaginatedResult<PortalDocumentDto>> {
    const patients = await this.ownPatients(phone);
    const patientIds = patients.map((p) => p.id);
    if (patientIds.length === 0) {
      return paginated([], { page: query.page, limit: query.limit, total: 0 });
    }
    const where: Prisma.PatientDocumentWhereInput = { patientId: { in: patientIds } };
    const { skip, take } = skipTake(query);

    // Unscoped (justified): patient-owned records across clinics by verified phone.
    const [rows, total] = await Promise.all([
      this.prisma.unscoped.patientDocument.findMany({
        where,
        select: {
          id: true,
          clinicId: true,
          category: true,
          title: true,
          fileName: true,
          mimeType: true,
          sizeBytes: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.unscoped.patientDocument.count({ where }),
    ]);

    const clinicNames = await this.clinicNames(rows.map((r) => r.clinicId));
    return paginated(
      rows.map((d) => ({
        id: d.id,
        clinicId: d.clinicId,
        clinicName: clinicNames.get(d.clinicId) ?? '',
        category: d.category,
        title: d.title,
        fileName: d.fileName,
        mimeType: d.mimeType,
        sizeBytes: d.sizeBytes,
        createdAt: d.createdAt.toISOString(),
      })),
      { page: query.page, limit: query.limit, total },
    );
  }

  /** Stream one owned document for download; ownership proven by verified phone. */
  async downloadDocument(
    phone: string,
    docId: string,
  ): Promise<{ stream: Readable; mimeType: string; fileName: string }> {
    const patients = await this.ownPatients(phone);
    const patientIds = patients.map((p) => p.id);
    const doc = patientIds.length
      ? await this.prisma.unscoped.patientDocument.findFirst({
          where: { id: docId, patientId: { in: patientIds } },
          select: { fileKey: true, mimeType: true, fileName: true },
        })
      : null;
    if (!doc) throw new AppException(ErrorCode.NOT_FOUND, 'Hujjat topilmadi', 404);
    return {
      stream: this.storage.getStream(doc.fileKey),
      mimeType: doc.mimeType,
      fileName: doc.fileName,
    };
  }

  // --------------------------------------------------------------- telegram

  async getTelegramStatus(phone: string): Promise<PortalTelegramStatusDto> {
    const account = await this.prisma.unscoped.portalAccount.findUnique({
      where: { phone },
      select: { telegramChatId: true, telegramUsername: true, telegramLinkedAt: true },
    });
    return {
      linked: Boolean(account?.telegramChatId),
      username: account?.telegramUsername ?? null,
      linkedAt: account?.telegramLinkedAt ? account.telegramLinkedAt.toISOString() : null,
      botUsername: (this.config.env.TELEGRAM_BOT_USERNAME || null),
      enabled: this.config.env.TELEGRAM_ENABLED,
    };
  }

  /** Mint a one-time deep-link token; the patient opens t.me/<bot>?start=<token>. */
  async createTelegramLinkToken(
    phone: string,
  ): Promise<{ token: string; deepLink: string | null; botUsername: string | null; enabled: boolean }> {
    const token = randomBytes(24).toString('base64url');
    await this.prisma.unscoped.portalLinkToken.create({
      data: {
        token,
        phone,
        purpose: 'telegram_link',
        expiresAt: new Date(Date.now() + LINK_TOKEN_TTL_MINUTES * 60_000),
      },
    });
    const botUsername = (this.config.env.TELEGRAM_BOT_USERNAME || null);
    return {
      token,
      deepLink: botUsername ? `https://t.me/${botUsername}?start=${token}` : null,
      botUsername,
      enabled: this.config.env.TELEGRAM_ENABLED,
    };
  }

  async unlinkTelegram(phone: string): Promise<{ linked: false }> {
    const account = await this.prisma.unscoped.portalAccount.findUnique({
      where: { phone },
      select: { telegramChatId: true },
    });
    await this.prisma.unscoped.portalAccount
      .update({
        where: { phone },
        data: { telegramChatId: null, telegramUsername: null, telegramLinkedAt: null },
      })
      .catch(() => undefined);
    if (account?.telegramChatId) {
      // Deactivate outbound routing links for this chat across clinics.
      await this.prisma.unscoped.telegramLink.updateMany({
        where: { chatId: account.telegramChatId },
        data: { isActive: false },
      });
    }
    return { linked: false };
  }

  /** Public runtime hints for the portal UI (no auth). */
  getPublicConfig(): { telegramBotUsername: string | null; telegramEnabled: boolean } {
    return {
      telegramBotUsername: (this.config.env.TELEGRAM_BOT_USERNAME || null),
      telegramEnabled: this.config.env.TELEGRAM_ENABLED,
    };
  }

  // --------------------------------------------------------- public catalog

  async getClinic(clinicId: string): Promise<PortalClinicDto> {
    // Unscoped (justified): public catalog endpoint — read-only, whitelisted
    // fields only, every query explicitly scoped to the requested clinicId.
    const clinic = await this.prisma.unscoped.clinic.findFirst({
      where: { id: clinicId, status: ClinicStatus.ACTIVE },
      select: {
        id: true,
        name: true,
        logoUrl: true,
        phone: true,
        email: true,
        address: true,
        settings: true,
      },
    });
    if (!clinic) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Clinic not found', 404);
    }

    const [branches, doctors, services, priceRows] = await Promise.all([
      this.prisma.unscoped.branch.findMany({
        where: { clinicId, isActive: true },
        select: {
          id: true,
          name: true,
          address: true,
          phone: true,
          latitude: true,
          longitude: true,
          workingHours: true,
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.unscoped.user.findMany({
        where: { clinicId, role: UserRole.DOCTOR, status: UserStatus.ACTIVE, deletedAt: null },
        select: {
          id: true,
          fullName: true,
          staffProfile: { select: { specialty: true, photoUrl: true, bio: true } },
        },
        orderBy: { fullName: 'asc' },
      }),
      this.prisma.unscoped.service.findMany({
        where: { clinicId, isActive: true },
        select: {
          id: true,
          code: true,
          name: true,
          durationMin: true,
          category: { select: { name: true, kind: true } },
        },
        orderBy: { code: 'asc' },
      }),
      // Latest clinic-default price per service in one grouped query
      // (DISTINCT ON keeps the newest effective row per serviceId).
      this.prisma.unscoped.$queryRaw<Array<{ serviceId: string; price: Prisma.Decimal }>>`
        SELECT DISTINCT ON ("serviceId") "serviceId", "price"
        FROM "ServicePrice"
        WHERE "clinicId" = ${clinicId}
          AND "branchId" IS NULL
          AND "effectiveFrom" <= now()
          AND ("effectiveTo" IS NULL OR "effectiveTo" > now())
        ORDER BY "serviceId", "effectiveFrom" DESC`,
    ]);

    const priceByService = new Map<string, string>(
      priceRows.map((r) => [r.serviceId, r.price.toFixed(2)]),
    );

    return {
      id: clinic.id,
      name: clinic.name,
      logoUrl: clinic.logoUrl,
      phone: clinic.phone,
      email: clinic.email,
      address: clinic.address,
      onlineBookingEnabled: this.onlineBookingEnabled(clinic.settings),
      branches,
      doctors: doctors.map((d) => ({
        id: d.id,
        fullName: d.fullName,
        specialty: d.staffProfile?.specialty ?? null,
        photoUrl: d.staffProfile?.photoUrl ?? null,
        bio: d.staffProfile?.bio ?? null,
      })),
      services: services.map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        durationMin: s.durationMin,
        category: s.category ? { name: s.category.name, kind: s.category.kind } : null,
        price: priceByService.get(s.id) ?? null,
      })),
    };
  }

  // ---------------------------------------------------------------- booking

  async getSlots(q: {
    clinicId: string;
    branchId: string;
    doctorUserId: string;
    date: string;
    serviceId?: string;
  }): Promise<FreeSlot[]> {
    // Unscoped (justified): public pre-auth lookup — validates that the branch
    // belongs to the requested clinic before entering its tenant context.
    const branch = await this.prisma.unscoped.branch.findFirst({
      where: { id: q.branchId, clinicId: q.clinicId, isActive: true },
      select: { id: true },
    });
    if (!branch) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Branch not found', 404);
    }

    return TenantContext.run({ clinicId: q.clinicId }, () =>
      this.slots.getFreeSlots({
        doctorUserId: q.doctorUserId,
        branchId: q.branchId,
        date: q.date,
        serviceId: q.serviceId,
      }),
    );
  }

  async book(phone: string, input: PortalBookExtendedInput): Promise<PortalBookingResultDto> {
    // Unscoped (justified): the tenant is resolved from the branch — portal
    // requests carry no clinic context of their own.
    const branch = await this.prisma.unscoped.branch.findFirst({
      where: { id: input.branchId, isActive: true },
      select: { id: true, clinicId: true },
    });
    if (!branch) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Branch not found', 404);
    }
    const clinicId = branch.clinicId;

    // Unscoped (justified): clinic root row lookup for the booking toggle.
    const clinic = await this.prisma.unscoped.clinic.findFirst({
      where: { id: clinicId, status: ClinicStatus.ACTIVE },
      select: { settings: true },
    });
    if (!clinic) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Clinic not found', 404);
    }
    if (!this.onlineBookingEnabled(clinic.settings)) {
      throw new AppException(
        ErrorCode.FEATURE_DISABLED,
        'Online booking is disabled for this clinic',
        403,
      );
    }

    return TenantContext.run({ clinicId }, async () => {
      let patient = await this.prisma.db.patient.findFirst({
        where: { phone, deletedAt: null },
        select: { id: true },
      });

      if (!patient) {
        if (!input.firstName || !input.lastName) {
          throw new AppException(
            ErrorCode.VALIDATION_ERROR,
            'firstName and lastName are required for the first booking in this clinic',
            400,
          );
        }
        const mrn = await this.sequence.nextFormatted('mrn', 'P');
        patient = await this.prisma.db.patient.create({
          data: {
            // Top-level create is auto-stamped by the tenant extension, but the
            // Prisma input type requires clinicId — same value, kept explicit.
            clinicId,
            mrn,
            firstName: input.firstName,
            lastName: input.lastName,
            fullName: `${input.lastName} ${input.firstName}`,
            phone,
            source: 'portal',
          },
          select: { id: true },
        });
        await this.audit.log({
          action: AuditAction.CREATE,
          entity: 'Patient',
          entityId: patient.id,
          clinicId,
          after: { mrn, source: 'portal' },
        });
      }

      const created = await this.appointments.create(
        {
          patientId: patient.id,
          branchId: input.branchId,
          doctorUserId: input.doctorUserId,
          serviceIds: input.serviceId ? [input.serviceId] : undefined,
          startAt: input.startAt,
          walkIn: false,
        },
        null,
      );

      return {
        id: created.id,
        startAt: created.startAt.toISOString(),
        endAt: created.endAt.toISOString(),
        status: created.status,
      };
    });
  }

  // ---------------------------------------------------------------- cabinet

  async me(phone: string): Promise<PortalPatientCardDto[]> {
    const patients = await this.ownPatients(phone);
    const clinicNames = await this.clinicNames(patients.map((p) => p.clinicId));
    return patients.map((p) => ({
      clinicId: p.clinicId,
      clinicName: clinicNames.get(p.clinicId) ?? '',
      patientId: p.id,
      mrn: p.mrn,
      fullName: p.fullName,
    }));
  }

  async meAppointments(
    phone: string,
    query: PortalAppointmentsQueryInput,
  ): Promise<PaginatedResult<PortalAppointmentDto>> {
    const now = new Date();
    const where: Prisma.AppointmentWhereInput = {
      patient: { phone, deletedAt: null },
      startAt: query.scope === 'upcoming' ? { gte: now } : { lt: now },
    };
    const { skip, take } = skipTake(query);

    // Unscoped (justified): patient-owned records across clinics, linked by
    // the OTP-verified phone.
    const [rows, total] = await Promise.all([
      this.prisma.unscoped.appointment.findMany({
        where,
        select: {
          id: true,
          clinicId: true,
          branchId: true,
          startAt: true,
          endAt: true,
          status: true,
          note: true,
          cancelledReason: true,
          doctor: { select: { fullName: true } },
        },
        orderBy: { startAt: query.scope === 'upcoming' ? 'asc' : 'desc' },
        skip,
        take,
      }),
      this.prisma.unscoped.appointment.count({ where }),
    ]);

    const clinicNames = await this.clinicNames(rows.map((r) => r.clinicId));
    return paginated(
      rows.map((a) => ({
        id: a.id,
        clinicId: a.clinicId,
        clinicName: clinicNames.get(a.clinicId) ?? '',
        branchId: a.branchId,
        doctorName: a.doctor.fullName,
        startAt: a.startAt.toISOString(),
        endAt: a.endAt.toISOString(),
        status: a.status,
        note: a.note,
        cancelledReason: a.cancelledReason,
      })),
      { page: query.page, limit: query.limit, total },
    );
  }

  async cancelAppointment(
    phone: string,
    id: string,
    input: PortalCancelAppointmentInput,
  ): Promise<{ id: string; status: string }> {
    // Unscoped (justified): ownership is proven by the OTP-verified phone —
    // the relation filter restricts the lookup to the patient's own cards.
    const appointment = await this.prisma.unscoped.appointment.findFirst({
      where: { id, patient: { phone, deletedAt: null } },
      select: { id: true, clinicId: true, status: true, startAt: true },
    });
    if (!appointment) {
      throw new AppException(ErrorCode.APPOINTMENT_NOT_FOUND, 'Appointment not found', 404);
    }
    if (
      appointment.status !== AppointmentStatus.SCHEDULED &&
      appointment.status !== AppointmentStatus.CONFIRMED
    ) {
      throw new AppException(
        ErrorCode.INVALID_STATUS_TRANSITION,
        'Only scheduled or confirmed appointments can be cancelled',
        409,
      );
    }
    if (appointment.startAt.getTime() - Date.now() < CANCEL_MIN_MS) {
      throw new AppException(
        ErrorCode.CONFLICT,
        'Appointments can be cancelled no later than 2 hours before the start',
        409,
      );
    }

    // Unscoped (justified): same ownership proof as the lookup above.
    await this.prisma.unscoped.appointment.update({
      where: { id },
      data: {
        status: AppointmentStatus.CANCELLED,
        cancelledReason: input.reason ?? 'Cancelled by patient via portal',
      },
    });
    await this.notifications.cancelAppointmentReminders(id);

    await this.audit.log({
      action: AuditAction.UPDATE,
      entity: 'Appointment',
      entityId: id,
      clinicId: appointment.clinicId,
      before: { status: appointment.status },
      after: {
        status: AppointmentStatus.CANCELLED,
        reason: input.reason ?? null,
        cancelledBy: 'portal',
      },
    });

    return { id, status: AppointmentStatus.CANCELLED };
  }

  async meVisits(phone: string, query: PageQuery): Promise<PaginatedResult<PortalVisitDto>> {
    // Clinical history is released per clinic by a doctor or clinic admin. With
    // no approval anywhere the list is empty rather than an error — the portal
    // shows the "request access" screen instead of a failure.
    const clinicIds = await this.recordAccess.approvedClinicIds(phone);
    if (clinicIds.length === 0) {
      return paginated([], { page: query.page, limit: query.limit, total: 0 });
    }
    const where: Prisma.VisitWhereInput = {
      clinicId: { in: clinicIds },
      patient: { phone, deletedAt: null },
      status: VisitStatus.COMPLETED,
    };
    const { skip, take } = skipTake(query);

    // Unscoped (justified): patient-owned records across clinics by verified phone.
    const [rows, total] = await Promise.all([
      this.prisma.unscoped.visit.findMany({
        where,
        select: {
          id: true,
          clinicId: true,
          startedAt: true,
          completedAt: true,
          doctor: { select: { fullName: true, staffProfile: { select: { specialty: true } } } },
          diagnoses: {
            select: {
              isPrimary: true,
              icd10: { select: { code: true, nameUz: true, nameRu: true, nameEn: true } },
            },
          },
          _count: { select: { prescriptions: true } },
        },
        orderBy: { startedAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.unscoped.visit.count({ where }),
    ]);

    const clinicNames = await this.clinicNames(rows.map((r) => r.clinicId));
    return paginated(
      rows.map((v) => ({
        id: v.id,
        clinicId: v.clinicId,
        clinicName: clinicNames.get(v.clinicId) ?? '',
        doctorName: v.doctor.fullName,
        doctorSpecialty: v.doctor.staffProfile?.specialty ?? null,
        startedAt: v.startedAt.toISOString(),
        completedAt: v.completedAt ? v.completedAt.toISOString() : null,
        diagnoses: v.diagnoses.map((d) => ({
          code: d.icd10.code,
          nameUz: d.icd10.nameUz,
          nameRu: d.icd10.nameRu,
          nameEn: d.icd10.nameEn,
          isPrimary: d.isPrimary,
        })),
        prescriptionCount: v._count.prescriptions,
      })),
      { page: query.page, limit: query.limit, total },
    );
  }

  /** Full medical-history detail for one completed visit the patient owns (by verified phone). */
  async meVisitDetail(phone: string, visitId: string): Promise<PortalVisitDetailDto> {
    // Unscoped (justified): patient-owned record located by verified phone + id.
    const v = await this.prisma.unscoped.visit.findFirst({
      where: { id: visitId, status: VisitStatus.COMPLETED, patient: { phone, deletedAt: null } },
      select: {
        id: true,
        clinicId: true,
        startedAt: true,
        completedAt: true,
        nextVisitAt: true,
        subjective: true,
        objective: true,
        assessmentNote: true,
        plan: true,
        doctor: { select: { fullName: true, staffProfile: { select: { specialty: true } } } },
        vitals: {
          select: {
            heightCm: true,
            weightKg: true,
            bpSystolic: true,
            bpDiastolic: true,
            pulseBpm: true,
            temperatureC: true,
            spo2: true,
          },
        },
        diagnoses: {
          select: {
            isPrimary: true,
            note: true,
            icd10: { select: { code: true, nameUz: true, nameRu: true, nameEn: true } },
          },
        },
        prescriptions: {
          select: {
            drugName: true,
            dosage: true,
            frequency: true,
            durationDays: true,
            instructions: true,
          },
        },
        referrals: { select: { type: true, targetSpecialty: true } },
      },
    });
    if (!v) throw new AppException(ErrorCode.VISIT_NOT_FOUND, 'Tashrif topilmadi', 404);
    if (!(await this.recordAccess.isApprovedForClinic(phone, v.clinicId))) {
      throw new AppException(
        ErrorCode.RECORD_ACCESS_REQUIRED,
        'Kasallik tarixini ko‘rish uchun klinikadan ruxsat oling',
        403,
      );
    }

    const clinicName = (await this.clinicNames([v.clinicId])).get(v.clinicId) ?? '';
    return {
      id: v.id,
      clinicName,
      doctorName: v.doctor.fullName,
      doctorSpecialty: v.doctor.staffProfile?.specialty ?? null,
      startedAt: v.startedAt.toISOString(),
      completedAt: v.completedAt ? v.completedAt.toISOString() : null,
      nextVisitAt: v.nextVisitAt ? v.nextVisitAt.toISOString() : null,
      subjective: v.subjective,
      objective: v.objective,
      assessment: v.assessmentNote,
      plan: v.plan,
      vitals: v.vitals
        ? {
            heightCm: v.vitals.heightCm,
            weightKg: v.vitals.weightKg,
            bpSystolic: v.vitals.bpSystolic,
            bpDiastolic: v.vitals.bpDiastolic,
            pulseBpm: v.vitals.pulseBpm,
            temperatureC: v.vitals.temperatureC,
            spo2: v.vitals.spo2,
          }
        : null,
      diagnoses: v.diagnoses.map((d) => ({
        code: d.icd10.code,
        nameUz: d.icd10.nameUz,
        nameRu: d.icd10.nameRu,
        nameEn: d.icd10.nameEn,
        isPrimary: d.isPrimary,
        note: d.note,
      })),
      prescriptions: v.prescriptions.map((r) => ({
        drugName: r.drugName,
        dosage: r.dosage,
        frequency: r.frequency,
        durationDays: r.durationDays,
        instructions: r.instructions,
      })),
      referrals: v.referrals.map((r) => ({ type: r.type, targetSpecialty: r.targetSpecialty })),
    };
  }

  async meLabResults(phone: string, query: PageQuery): Promise<PaginatedResult<PortalLabOrderDto>> {
    const where: Prisma.LabOrderWhereInput = {
      patient: { phone, deletedAt: null },
      status: { in: [LabOrderStatus.APPROVED, LabOrderStatus.DELIVERED] },
    };
    const { skip, take } = skipTake(query);

    // Unscoped (justified): patient-owned records across clinics by verified phone.
    const [rows, total] = await Promise.all([
      this.prisma.unscoped.labOrder.findMany({
        where,
        select: {
          id: true,
          clinicId: true,
          orderNumber: true,
          status: true,
          createdAt: true,
          deliveredAt: true,
          items: {
            select: {
              id: true,
              labTest: { select: { code: true, name: true } },
              result: {
                select: {
                  approvedAt: true,
                  note: true,
                  values: {
                    select: {
                      value: true,
                      flag: true,
                      parameter: { select: { name: true, unit: true } },
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.unscoped.labOrder.count({ where }),
    ]);

    const clinicNames = await this.clinicNames(rows.map((r) => r.clinicId));
    return paginated(
      rows.map((o) => ({
        id: o.id,
        clinicId: o.clinicId,
        clinicName: clinicNames.get(o.clinicId) ?? '',
        orderNumber: o.orderNumber,
        status: o.status,
        createdAt: o.createdAt.toISOString(),
        deliveredAt: o.deliveredAt ? o.deliveredAt.toISOString() : null,
        items: o.items.map((item) => ({
          id: item.id,
          testCode: item.labTest.code,
          testName: item.labTest.name,
          result: item.result
            ? {
                approvedAt: item.result.approvedAt ? item.result.approvedAt.toISOString() : null,
                note: item.result.note,
                values: item.result.values.map((v) => ({
                  parameter: v.parameter.name,
                  unit: v.parameter.unit,
                  value: v.value,
                  flag: v.flag,
                })),
              }
            : null,
        })),
      })),
      { page: query.page, limit: query.limit, total },
    );
  }

  async meInvoices(phone: string, query: PageQuery): Promise<PaginatedResult<PortalInvoiceDto>> {
    const where: Prisma.InvoiceWhereInput = {
      patient: { phone, deletedAt: null },
      status: { not: InvoiceStatus.DRAFT },
    };
    const { skip, take } = skipTake(query);

    // Unscoped (justified): patient-owned records across clinics by verified phone.
    const [rows, total] = await Promise.all([
      this.prisma.unscoped.invoice.findMany({
        where,
        select: {
          id: true,
          clinicId: true,
          number: true,
          status: true,
          subtotal: true,
          discountTotal: true,
          total: true,
          paidTotal: true,
          issuedAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.unscoped.invoice.count({ where }),
    ]);

    const clinicNames = await this.clinicNames(rows.map((r) => r.clinicId));
    return paginated(
      rows.map((inv) => ({
        id: inv.id,
        clinicId: inv.clinicId,
        clinicName: clinicNames.get(inv.clinicId) ?? '',
        number: inv.number,
        status: inv.status,
        subtotal: inv.subtotal.toFixed(2),
        discountTotal: inv.discountTotal.toFixed(2),
        total: inv.total.toFixed(2),
        paidTotal: inv.paidTotal.toFixed(2),
        issuedAt: inv.issuedAt ? inv.issuedAt.toISOString() : null,
        createdAt: inv.createdAt.toISOString(),
      })),
      { page: query.page, limit: query.limit, total },
    );
  }

  async submitFeedback(phone: string, input: PortalFeedbackInput): Promise<{ id: string }> {
    // Unscoped (justified): ownership proven by the OTP-verified phone — the
    // relation filter restricts the visit lookup to the patient's own records.
    const visit = await this.prisma.unscoped.visit.findFirst({
      where: {
        id: input.visitId,
        status: VisitStatus.COMPLETED,
        patient: { phone, deletedAt: null },
      },
      select: {
        id: true,
        clinicId: true,
        branchId: true,
        patientId: true,
        doctorUserId: true,
        feedback: { select: { id: true } },
      },
    });
    if (!visit) {
      throw new AppException(ErrorCode.VISIT_NOT_FOUND, 'Visit not found', 404);
    }
    if (visit.feedback) {
      throw new AppException(ErrorCode.CONFLICT, 'Feedback for this visit already exists', 409);
    }

    // Unscoped (justified): write scoped by ids taken from the owned visit row.
    const feedback = await this.prisma.unscoped.feedback.create({
      data: {
        clinicId: visit.clinicId,
        branchId: visit.branchId,
        patientId: visit.patientId,
        visitId: visit.id,
        doctorUserId: visit.doctorUserId,
        rating: input.rating,
        comment: input.comment,
      },
      select: { id: true },
    });
    return { id: feedback.id };
  }

  // ---------------------------------------------------------------- helpers

  /**
   * Unscoped (justified): the patient owns their cards across clinics —
   * linked by the OTP-verified phone from the portal token.
   */
  private ownPatients(
    phone: string,
  ): Promise<Array<{ id: string; clinicId: string; mrn: string; fullName: string }>> {
    return this.prisma.unscoped.patient.findMany({
      where: { phone, deletedAt: null },
      select: { id: true, clinicId: true, mrn: true, fullName: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async clinicNames(clinicIds: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(clinicIds)];
    if (unique.length === 0) return new Map();
    // Unscoped (justified): Clinic is the tenant root — name lookup only,
    // restricted to ids already proven to belong to the patient's records.
    const clinics = await this.prisma.unscoped.clinic.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(clinics.map((c) => [c.id, c.name]));
  }

  /** Clinic booking toggle: settings.onlineBookingEnabled !== false (default on). */
  private onlineBookingEnabled(settings: unknown): boolean {
    if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
      return (settings as Record<string, unknown>)['onlineBookingEnabled'] !== false;
    }
    return true;
  }
}
