import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlatformAlertsService, type NewClinicAlert } from './platform-alerts.service';
import type { TelegramChannel } from './channels/telegram.channel';
import type { PrismaService } from '../../core/prisma/prisma.service';

const ALERT: NewClinicAlert = {
  clinicName: 'Yangi Shifo',
  ownerName: 'Rahimov Sardor',
  ownerPhone: '+998901234567',
  ownerEmail: 'sardor@example.uz',
  planName: 'Pro',
  trialEndsAt: new Date('2026-09-15T00:00:00Z'),
};

function harness(admins: Array<{ id: string; telegramChatId: string | null }>) {
  const findMany = vi.fn().mockResolvedValue(admins);
  const send = vi.fn().mockResolvedValue(undefined);
  const prisma = { unscoped: { user: { findMany } } } as unknown as PrismaService;
  const telegram = { send } as unknown as TelegramChannel;
  return { service: new PlatformAlertsService(prisma, telegram), findMany, send };
}

describe('PlatformAlertsService', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('messages every platform admin who linked the bot', async () => {
    const { service, send } = harness([
      { id: 'a', telegramChatId: '111' },
      { id: 'b', telegramChatId: '222' },
    ]);
    await service.newClinicRegistered(ALERT);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.map((c) => c[0])).toEqual(['111', '222']);
  });

  it('asks only for active, non-deleted admins that have a chat id', async () => {
    const { service, findMany } = harness([]);
    await service.newClinicRegistered(ALERT);
    const where = findMany.mock.calls[0]?.[0]?.where;
    expect(where).toMatchObject({
      role: 'SUPER_ADMIN',
      deletedAt: null,
      status: 'ACTIVE',
      telegramChatId: { not: null },
    });
  });

  it('sends nothing when nobody has linked the bot', async () => {
    const { service, send } = harness([]);
    await service.newClinicRegistered(ALERT);
    expect(send).not.toHaveBeenCalled();
  });

  it('carries the details an operator needs', async () => {
    const { service, send } = harness([{ id: 'a', telegramChatId: '111' }]);
    await service.newClinicRegistered(ALERT);
    const text = send.mock.calls[0]?.[1] as string;
    expect(text).toContain('Yangi Shifo');
    expect(text).toContain('Rahimov Sardor');
    expect(text).toContain('+998901234567');
    expect(text).toContain('sardor@example.uz');
    expect(text).toContain('Pro');
  });

  it('escapes a clinic name that would otherwise be read as markup', async () => {
    const { service, send } = harness([{ id: 'a', telegramChatId: '111' }]);
    await service.newClinicRegistered({ ...ALERT, clinicName: '<b>Shifo</b> & Co' });
    const text = send.mock.calls[0]?.[1] as string;
    // The name must survive as text; only the bold tags this service writes
    // itself may reach Telegram as markup.
    expect(text).toContain('&lt;b&gt;Shifo&lt;/b&gt; &amp; Co');
  });

  it('never throws when Telegram is down — a signup must not fail on it', async () => {
    const { service, send } = harness([{ id: 'a', telegramChatId: '111' }]);
    send.mockRejectedValue(new Error('Telegram send failed: HTTP 502'));
    await expect(service.newClinicRegistered(ALERT)).resolves.toBeUndefined();
  });

  it('never throws when the admin lookup itself fails', async () => {
    const { service, findMany } = harness([]);
    findMany.mockRejectedValue(new Error('db down'));
    await expect(service.newClinicRegistered(ALERT)).resolves.toBeUndefined();
  });

  it('still reaches the second admin when the first one blocked the bot', async () => {
    const { service, send } = harness([
      { id: 'a', telegramChatId: '111' },
      { id: 'b', telegramChatId: '222' },
    ]);
    send.mockRejectedValueOnce(new Error('bot was blocked by the user'));
    await service.newClinicRegistered(ALERT);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
