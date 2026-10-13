import { describe, expect, it, vi } from 'vitest';
import type { Bot, Context } from 'grammy';
import type { AppConfigService } from '../../core/config/app-config.service';
import type { PrismaService } from '../../core/prisma/prisma.service';
import type { AuditService } from '../../core/audit/audit.service';
import type { StorageService } from '../../core/storage/storage.service';
import type { NotificationsService } from './notifications.service';
import type {
  TelegramPatientAccessService,
  TelegramPatientAccessResult,
} from './telegram-patient-access.service';
import type { ResultPdfService } from '../lab/result-pdf.service';
import type { VisitReportPdfService } from '../visits/visit-report-pdf.service';
import { TelegramBotService } from './telegram-bot.service';

interface PatientHandlers {
  registerHandlers(bot: Bot): void;
  handleStart(ctx: Context): Promise<void>;
  handleMenu(ctx: Context): Promise<void>;
  handleContact(ctx: Context): Promise<void>;
  handleUnlink(ctx: Context): Promise<void>;
  handleDocumentList(ctx: Context, type: string, page: number): Promise<void>;
}

const linked: TelegramPatientAccessResult = {
  status: 'LINKED',
  patients: [
    {
      id: 'patient-a',
      clinicId: 'clinic-a',
      mrn: 'P-TEST',
      fullName: 'Test Bemor',
      phone: '+998901234567',
      dob: null,
    },
  ],
};

function harness(state: TelegramPatientAccessResult = { status: 'UNLINKED', patients: [] }) {
  const access = {
    resolve: vi.fn().mockResolvedValue(state),
    linkContact: vi.fn().mockResolvedValue(linked),
    patientIds: vi.fn().mockResolvedValue(state.patients.map((p) => p.id)),
    unlink: vi.fn().mockResolvedValue(undefined),
  };
  const userFind = vi.fn();
  const labFind = vi.fn().mockResolvedValue([]);
  const service = new TelegramBotService(
    { env: { SINGLE_CLINIC_MODE: true } } as AppConfigService,
    {
      unscoped: { user: { findFirst: userFind }, labOrder: { findMany: labFind } },
    } as unknown as PrismaService,
    {} as AuditService,
    {} as NotificationsService,
    {} as StorageService,
    {} as ResultPdfService,
    access as unknown as TelegramPatientAccessService,
    {} as VisitReportPdfService,
  ) as unknown as PatientHandlers;
  const reply = vi.fn().mockResolvedValue({});
  const ctx = {
    chat: { id: 1234, type: 'private' },
    from: { id: 1234, username: 'test' },
    reply,
  } as unknown as Context;
  return { service, access, ctx, reply, userFind, labFind };
}

describe('Single-clinic patient bot flow (no Telegram delivery)', () => {
  it('starts with the own-contact button, including old portal deep links', async () => {
    const { service, ctx, reply, userFind, access } = harness();
    await service.handleStart({ ...ctx, match: 'old-web-link-token' } as Context);
    expect(reply.mock.calls[0]![0]).toContain('Raqamni yuborish');
    expect(reply.mock.calls[0]![1].reply_markup.keyboard.flat()).toContainEqual({
      text: '📱 Raqamni yuborish',
      request_contact: true,
    });
    expect(access.linkContact).not.toHaveBeenCalled();
    expect(userFind).not.toHaveBeenCalled();
  });

  it('links only the sender’s own contact and shows document categories', async () => {
    const { service, ctx, reply, access, userFind } = harness();
    await service.handleContact({
      ...ctx,
      message: { contact: { user_id: 1234, phone_number: '998901234567' } },
    } as Context);
    expect(access.linkContact).toHaveBeenCalledWith(1234, '+998901234567', 'test');
    expect(reply.mock.calls[0]![0]).toContain('P-TEST');
    const labels = reply.mock.calls[0]![1].reply_markup.keyboard.flat().map(
      (b: { text: string }) => b.text,
    );
    expect(labels).toContain('🧪 Tahlillarim');
    expect(labels).toContain('🩻 UZI natijalarim');
    expect(labels).toContain('🩺 Shifokor xulosalari');
    expect(labels).not.toContain('🕐 Navbatim');
    expect(userFind).not.toHaveBeenCalled();
  });

  it.each([undefined, 9999])(
    'rejects a contact without positive sender ownership (%s)',
    async (userId) => {
      const { service, ctx, reply, access } = harness();
      await service.handleContact({
        ...ctx,
        message: { contact: { user_id: userId, phone_number: '+998901234567' } },
      } as Context);
      expect(access.linkContact).not.toHaveBeenCalled();
      expect(reply.mock.calls[0]![0]).toContain('o‘zingizning');
    },
  );

  it('shows reception guidance for an unknown or ambiguous patient without names', async () => {
    for (const status of ['NOT_FOUND', 'AMBIGUOUS'] as const) {
      const { service, ctx, reply } = harness({ status, patients: [] });
      await service.handleMenu(ctx);
      expect(reply.mock.calls[0]![0]).toMatch(/qabulxona/i);
      expect(reply.mock.calls[0]![0]).toContain('Yangilash');
      expect(reply.mock.calls[0]![0]).not.toContain('Test Bemor');
    }
  });

  it('refreshes after reception creates the card, without another contact', async () => {
    const { service, ctx, reply, access } = harness({ status: 'NOT_FOUND', patients: [] });
    await service.handleStart(ctx);
    access.resolve.mockResolvedValue(linked);
    await service.handleMenu(ctx);
    expect(reply.mock.calls[1]![0]).toContain('P-TEST');
    expect(access.linkContact).not.toHaveBeenCalled();
  });

  it('unlinks the patient account without touching staff accounts', async () => {
    const { service, ctx, access, reply } = harness(linked);
    await service.handleUnlink(ctx);
    expect(access.unlink).toHaveBeenCalledWith(1234);
    expect(reply.mock.calls[0]![1].reply_markup).toEqual({ remove_keyboard: true });
  });

  it('does not register queue, platform or appointment actions in patient mode', () => {
    const { service } = harness();
    const bot = {
      use: vi.fn(),
      command: vi.fn(),
      on: vi.fn(),
      hears: vi.fn(),
      callbackQuery: vi.fn(),
    };
    service.registerHandlers(bot as unknown as Bot);
    expect(bot.hears.mock.calls.map((call) => call[0])).not.toContain('🏥 Klinikalar');
    expect(bot.hears.mock.calls.map((call) => call[0])).not.toContain('📅 Qabullarim');
    expect(
      bot.callbackQuery.mock.calls
        .map((call) => String(call[0]))
        .some((pattern) => pattern.includes('confirm|cancel')),
    ).toBe(false);
  });

  it('does not bind manually typed phone numbers', async () => {
    const { service, ctx, access, reply } = harness();
    const bot = {
      use: vi.fn(),
      command: vi.fn(),
      on: vi.fn(),
      hears: vi.fn(),
      callbackQuery: vi.fn(),
    };
    service.registerHandlers(bot as unknown as Bot);
    const handler = bot.on.mock.calls.find((call) => call[0] === 'message:text')![1];
    await handler({ ...ctx, message: { text: '+998901234567' } });
    expect(access.linkContact).not.toHaveBeenCalled();
    expect(reply.mock.calls[0]![0]).toContain('tugmasini bosing');
  });

  it('lists only the freshly linked patient’s approved laboratory results', async () => {
    const { service, ctx, access, labFind } = harness(linked);
    await service.handleDocumentList(ctx, 'lab', 0);
    expect(access.patientIds).toHaveBeenCalledWith(1234);
    expect(labFind.mock.calls[0]![0].where).toEqual({
      patientId: { in: ['patient-a'] },
      status: { in: ['APPROVED', 'DELIVERED'] },
    });
  });
});
