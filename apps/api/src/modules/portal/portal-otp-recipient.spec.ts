import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../core/prisma/prisma.service';
import type { TelegramChannel } from '../notifications/channels/telegram.channel';
import { PortalService } from './portal.service';

vi.mock('argon2', () => ({ argon2id: 2, hash: vi.fn().mockResolvedValue('test-hash') }));

function harness(account: { telegramChatId: string | null; phoneVerifiedAt: Date | null } | null) {
  const findUnique = vi.fn().mockResolvedValue(account);
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const create = vi.fn().mockResolvedValue({ id: 'otp-attempt' });
  const prisma = {
    unscoped: {
      portalAccount: { findUnique },
      otpCode: { updateMany, create },
    },
  } as unknown as PrismaService;
  const send = vi.fn().mockResolvedValue(undefined);
  const unused = {} as never;
  const service = new PortalService(
    prisma,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    { send } as unknown as TelegramChannel,
    unused,
  );
  return { service, findUnique, send, updateMany, create };
}

describe('Portal OTP current Telegram recipient', () => {
  it('delivers only to the chat on the currently verified phone account', async () => {
    const h = harness({ telegramChatId: '5678', phoneVerifiedAt: new Date() });
    await expect(h.service.requestOtp({ phone: '+998901234567' })).resolves.toEqual({ requested: true });
    expect(h.findUnique).toHaveBeenCalledWith({
      where: { phone: '+998901234567' },
      select: { telegramChatId: true, phoneVerifiedAt: true },
    });
    expect(h.send).toHaveBeenCalledWith('5678', expect.stringContaining('tasdiqlash kodi'));
    expect(h.findUnique).toHaveBeenCalledTimes(2);
    expect(h.create).toHaveBeenCalledTimes(1);
  });

  it.each([
    null,
    { telegramChatId: '1234', phoneVerifiedAt: null },
    { telegramChatId: null, phoneVerifiedAt: new Date() },
  ])(
    'does not use an old patient link for an absent/unverified/unlinked account (%j)',
    async (account) => {
      const h = harness(account);
      await expect(h.service.requestOtp({ phone: '+998901234567' })).rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining('/start'),
      });
      expect(h.send).not.toHaveBeenCalled();
      expect(h.create).not.toHaveBeenCalled();
      expect(h.updateMany).not.toHaveBeenCalled();
    },
  );

  it('revalidates a changed chat immediately before sending instead of using the old recipient', async () => {
    const h = harness({ telegramChatId: '5678', phoneVerifiedAt: new Date() });
    h.findUnique.mockResolvedValueOnce({ telegramChatId: '1234', phoneVerifiedAt: new Date() });
    await h.service.requestOtp({ phone: '+998901234567' });
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send).toHaveBeenCalledWith('5678', expect.stringContaining('tasdiqlash kodi'));
  });

  it('revokes the new attempt if the phone is unlinked while the code is being prepared', async () => {
    const h = harness(null);
    h.findUnique.mockResolvedValueOnce({ telegramChatId: '1234', phoneVerifiedAt: new Date() });
    await expect(h.service.requestOtp({ phone: '+998901234567' })).rejects.toMatchObject({ status: 503 });
    expect(h.send).not.toHaveBeenCalled();
    expect(h.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'otp-attempt', usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
  });

  it('revokes an undelivered code and reports failure when the clinic bot cannot send', async () => {
    const h = harness({ telegramChatId: '5678', phoneVerifiedAt: new Date() });
    h.send.mockRejectedValueOnce(new Error('upstream failure'));
    await expect(h.service.requestOtp({ phone: '+998901234567' })).rejects.toMatchObject({
      status: 503,
      message: expect.stringContaining('kod yuborilmadi'),
    });
    expect(h.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'otp-attempt', usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
    expect(h.send).toHaveBeenCalledTimes(1);
  });
});
