import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { normalizePhone } from '@avishifo/shared';
import { AppConfigService } from '../../core/config/app-config.service';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface TelegramPatientIdentity {
  id: string;
  clinicId: string;
  mrn: string;
  fullName: string;
  phone: string | null;
  dob: Date | null;
}

export interface TelegramPatientAccessResult {
  status: 'UNLINKED' | 'NOT_FOUND' | 'AMBIGUOUS' | 'LINKED' | 'UNAVAILABLE';
  patients: TelegramPatientIdentity[];
}

const patientSelect = {
  id: true,
  clinicId: true,
  mrn: true,
  fullName: true,
  phone: true,
  dob: true,
} satisfies Prisma.PatientSelect;

function empty(
  status: Exclude<TelegramPatientAccessResult['status'], 'LINKED'>,
): TelegramPatientAccessResult {
  return { status, patients: [] };
}

function validChat(chatId: number): boolean {
  return Number.isSafeInteger(chatId) && chatId > 0;
}

/**
 * A contact verified by Telegram proves the primary phone only. Resolve that
 * ownership afresh for every command/download and before outbound delivery.
 * Bot requests have no tenant context, so all unscoped access below is bounded
 * by the verified account and the configured clinic, never a callback's ID.
 */
@Injectable()
export class TelegramPatientAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async resolve(chatId: number): Promise<TelegramPatientAccessResult> {
    if (!validChat(chatId)) return empty('UNLINKED');
    return this.transaction((tx) => this.resolveInTransaction(tx, String(chatId)));
  }

  async patientIds(chatId: number): Promise<string[]> {
    const result = await this.resolve(chatId);
    return result.status === 'LINKED' ? result.patients.map((patient) => patient.id) : [];
  }

  /** Caller must first verify contact.user_id equals the private chat's sender. */
  async linkContact(
    chatId: number,
    rawPhone: string,
    username: string | null,
  ): Promise<TelegramPatientAccessResult> {
    const phone = normalizePhone(rawPhone);
    if (!validChat(chatId) || !phone) return empty('UNLINKED');
    const chat = String(chatId);
    return this.transaction(async (tx) => {
      const previous = await tx.portalAccount.findUnique({
        where: { phone },
        select: { telegramChatId: true },
      });
      const now = new Date();
      // Release both sides of the old relationship before moving the unique
      // account binding. A previous chat must lose routing, including old rows.
      await tx.telegramLink.updateMany({
        where: {
          OR: [
            { chatId: chat },
            { phone },
            ...(previous?.telegramChatId ? [{ chatId: previous.telegramChatId }] : []),
          ],
        },
        data: { isActive: false },
      });
      await tx.portalAccount.updateMany({
        where: { telegramChatId: chat, phone: { not: phone } },
        data: { telegramChatId: null, telegramUsername: null, telegramLinkedAt: null },
      });
      await tx.portalAccount.upsert({
        where: { phone },
        update: {
          telegramChatId: chat,
          telegramUsername: username,
          telegramLinkedAt: now,
          phoneVerifiedAt: now,
        },
        create: {
          phone,
          telegramChatId: chat,
          telegramUsername: username,
          telegramLinkedAt: now,
          phoneVerifiedAt: now,
        },
      });
      return this.resolveInTransaction(tx, chat);
    });
  }

  async unlink(chatId: number): Promise<void> {
    if (!validChat(chatId)) return;
    const chat = String(chatId);
    await this.transaction(async (tx) => {
      await tx.telegramLink.updateMany({ where: { chatId: chat }, data: { isActive: false } });
      await tx.portalAccount.updateMany({
        where: { telegramChatId: chat },
        data: { telegramChatId: null, telegramUsername: null, telegramLinkedAt: null },
      });
    });
  }

  /** Resolve immediately before delivery; a queued/stored chat ID is not proof. */
  async recipientFor(patientId: string, clinicId: string): Promise<string | null> {
    return this.transaction(async (tx) => {
      const patient = await tx.patient.findFirst({
        where: { id: patientId, clinicId, deletedAt: null },
        select: { phone: true },
      });
      if (!patient?.phone) return null;
      const account = await tx.portalAccount.findUnique({
        where: { phone: patient.phone },
        select: { telegramChatId: true, phoneVerifiedAt: true },
      });
      const chat = account?.telegramChatId;
      if (
        !account?.phoneVerifiedAt ||
        !chat ||
        !validChat(Number(chat)) ||
        String(Number(chat)) !== chat
      )
        return null;
      const result = await this.resolveInTransaction(tx, chat);
      return result.status === 'LINKED' &&
        result.patients.some((owned) => owned.id === patientId && owned.clinicId === clinicId)
        ? chat
        : null;
    });
  }

  private async resolveInTransaction(
    tx: Prisma.TransactionClient,
    chat: string,
  ): Promise<TelegramPatientAccessResult> {
    const account = await tx.portalAccount.findUnique({
      where: { telegramChatId: chat },
      select: { phone: true, phoneVerifiedAt: true },
    });
    if (!account?.phoneVerifiedAt || normalizePhone(account.phone) !== account.phone) {
      await tx.telegramLink.updateMany({ where: { chatId: chat }, data: { isActive: false } });
      return empty('UNLINKED');
    }

    // Never keep historic routing active while recomputing ownership. This
    // also repairs stale rows created before current-account checks existed.
    await tx.telegramLink.updateMany({
      where: { OR: [{ chatId: chat }, { phone: account.phone }] },
      data: { isActive: false },
    });

    let clinicIds: string[];
    if (this.config.env.SINGLE_CLINIC_MODE) {
      const configured = this.config.env.TELEGRAM_CLINIC_ID;
      const clinics = await tx.clinic.findMany({
        where: { status: 'ACTIVE', ...(configured ? { id: configured } : {}) },
        select: { id: true },
        take: 2,
      });
      if (clinics.length !== 1) return empty('UNAVAILABLE');
      clinicIds = [clinics[0]!.id];
    } else {
      const clinics = await tx.clinic.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true },
      });
      clinicIds = clinics.map((clinic) => clinic.id);
    }
    const patients = await tx.patient.findMany({
      where: {
        phone: account.phone,
        deletedAt: null,
        clinicId: { in: clinicIds },
      },
      select: patientSelect,
      orderBy: [{ clinicId: 'asc' }, { id: 'asc' }],
    });
    if (!patients.length) return empty('NOT_FOUND');
    const clinics = new Set<string>();
    for (const patient of patients) {
      // A family/shared number is not enough to select one patient's records.
      // Do not expose names or arbitrarily choose the last matching card.
      if (clinics.has(patient.clinicId)) return empty('AMBIGUOUS');
      clinics.add(patient.clinicId);
    }
    for (const patient of patients) {
      await tx.telegramLink.upsert({
        where: { clinicId_chatId: { clinicId: patient.clinicId, chatId: chat } },
        update: { patientId: patient.id, phone: account.phone, isActive: true },
        create: {
          clinicId: patient.clinicId,
          patientId: patient.id,
          chatId: chat,
          phone: account.phone,
          isActive: true,
        },
      });
    }
    return { status: 'LINKED', patients };
  }

  private async transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.prisma.unscoped.$transaction(work, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
        // Concurrent contact changes and first-time account/link upserts must
        // either commit together or retry the complete ownership decision.
        if (attempt >= 3 || (code !== 'P2034' && code !== 'P2002')) throw error;
      }
    }
  }
}
