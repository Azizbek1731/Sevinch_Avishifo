import { randomInt } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import request from 'supertest';
import { TelegramChannel } from '../src/modules/notifications/channels/telegram.channel';
import {
  API,
  PASSWORD,
  createApp,
  createTestClinic,
  uniqueIp,
  type CapturedTelegram,
  type TestClinic,
} from './setup';

/** Every transport is mocked: these tests must never deliver real login codes. */
describe('clinic bot authentication codes', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let clinic: TestClinic;
  let phone: string;
  let passwordHash: string;
  const chatId = String(randomInt(1_000_000, 2_000_000));
  const sent: CapturedTelegram[] = [];
  const post = (path: string) =>
    request(app.getHttpServer()).post(`${API}${path}`).set('X-Forwarded-For', uniqueIp());
  const codeOf = () => /Kod:\s*(\d{6})/.exec(sent[0]!.text)![1]!;
  const requestCode = () => post('/auth/telegram/request-code').send({ phone }).expect(200);

  beforeAll(async () => {
    if (
      new URL(process.env.DATABASE_URL ?? '').pathname !== '/avishifo_finance_migration' ||
      process.env.TELEGRAM_ENABLED !== 'false' ||
      process.env.NODE_ENV !== 'test'
    ) {
      throw new Error('Use isolated avishifo_finance_migration with Telegram disabled');
    }
    prisma = new PrismaClient();
    redis = new Redis(process.env.REDIS_URL!);
    app = await createApp(sent);
    clinic = await createTestClinic(prisma, 'clinic-bot-codes');
    passwordHash = (await prisma.user.findUniqueOrThrow({ where: { id: clinic.doctor.id } }))
      .passwordHash!;
    do {
      phone = `+99877${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;
    } while (await prisma.user.findFirst({ where: { phone } }));
    await prisma.user.update({ where: { id: clinic.doctor.id }, data: { phone } });
  });
  beforeEach(async () => {
    sent.length = 0;
    await redis.del(`auth:tglogin:cooldown:${phone}`);
    await prisma.user.update({
      where: { id: clinic.doctor.id },
      data: {
        telegramChatId: chatId,
        twoFactorEnabled: false,
        status: 'ACTIVE',
        passwordHash,
      },
    });
    await prisma.otpCode.updateMany({
      where: { phone, usedAt: null },
      data: { usedAt: new Date() },
    });
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
    await redis?.quit();
  });

  it('uses the clinic bot and accepts exactly one concurrent verification of a code', async () => {
    const start = await requestCode();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.chatId).toBe(chatId);
    const payload = { challengeId: start.body.data.challengeId, code: codeOf() };
    const done = await Promise.all([1, 2].map(() => post('/auth/telegram/verify').send(payload)));
    expect(done.map((response) => response.status).sort()).toEqual([200, 401]);
    expect(done.filter((response) => response.body.data?.accessToken)).toHaveLength(1);
  });

  it('does not use another route when a staff phone has no bot binding', async () => {
    await prisma.user.update({ where: { id: clinic.doctor.id }, data: { telegramChatId: null } });
    const start = await requestCode();
    expect(sent).toHaveLength(0);
    expect(await redis.exists(`auth:2fa:${start.body.data.challengeId}`)).toBe(0);
    await post('/auth/telegram/verify')
      .send({ challengeId: start.body.data.challengeId, code: '000000' })
      .expect(401);
    await post('/auth/password-reset/request').send({ phone }).expect(200);
    expect(await prisma.otpCode.count({ where: { phone, usedAt: null } })).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it.each([null, '9999999'])(
    'rejects a delivered login code after the bot binding changes to %s',
    async (replacement) => {
      const start = await requestCode();
      await vi.waitFor(() => expect(sent).toHaveLength(1));
      const code = codeOf();
      await prisma.user.update({
        where: { id: clinic.doctor.id },
        data: { telegramChatId: replacement },
      });
      const res = await post('/auth/telegram/verify')
        .send({ challengeId: start.body.data.challengeId, code })
        .expect(401);
      expect(res.headers['set-cookie']).toBeUndefined();
    },
  );

  it('does not bypass an enabled second factor when the clinic bot is unreachable', async () => {
    await prisma.user.update({ where: { id: clinic.doctor.id }, data: { twoFactorEnabled: true } });
    const send = vi
      .spyOn(app.get(TelegramChannel), 'send')
      .mockRejectedValueOnce(new Error('Mock offline'));
    const before = await prisma.authSession.count({ where: { userId: clinic.doctor.id } });
    const res = await post('/auth/login')
      .send({ identifier: clinic.doctor.email, password: PASSWORD })
      .expect(503);
    expect(res.body.error.code).toBe('TELEGRAM_NOT_LINKED');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(0);
    expect(await prisma.authSession.count({ where: { userId: clinic.doctor.id } })).toBe(before);
  });

  it('revokes an undeliverable passwordless challenge without falling back', async () => {
    const send = vi
      .spyOn(app.get(TelegramChannel), 'send')
      .mockRejectedValueOnce(new Error('Mock offline'));
    const start = await requestCode();
    await vi.waitFor(async () => {
      expect(send).toHaveBeenCalledTimes(1);
      expect(await redis.exists(`auth:2fa:${start.body.data.challengeId}`)).toBe(0);
    });
    expect(sent).toHaveLength(0);
    await post('/auth/telegram/verify')
      .send({ challengeId: start.body.data.challengeId, code: '000000' })
      .expect(401);
  });

  it('delivers password reset only through the clinic bot and prevents code replay', async () => {
    await post('/auth/password-reset/request').send({ phone }).expect(200);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.chatId).toBe(chatId);
    const payload = { phone, otp: codeOf(), newPassword: 'NewE2ePass123!' };
    await post('/auth/password-reset/confirm').send(payload).expect(200);
    await post('/auth/password-reset/confirm').send(payload).expect(400);
    const login = await post('/auth/login')
      .send({ identifier: clinic.doctor.email, password: payload.newPassword })
      .expect(200);
    expect(login.body.data.user.id).toBe(clinic.doctor.id);
  });

  it.each([null, '8888888'])(
    'rejects a reset code after its original bot binding changes to %s',
    async (replacement) => {
      await post('/auth/password-reset/request').send({ phone }).expect(200);
      await vi.waitFor(() => expect(sent).toHaveLength(1));
      const code = codeOf();
      await prisma.user.update({
        where: { id: clinic.doctor.id },
        data: { telegramChatId: replacement },
      });
      await post('/auth/password-reset/confirm')
        .send({ phone, otp: code, newPassword: 'NeverSet123!' })
        .expect(400);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: clinic.doctor.id } })).passwordHash,
      ).toBe(passwordHash);
    },
  );

  it('allows only one concurrent password reset with the same bot code', async () => {
    await post('/auth/password-reset/request').send({ phone }).expect(200);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const payload = { phone, otp: codeOf(), newPassword: 'ConcurrentNew123!' };
    const responses = await Promise.all(
      [1, 2].map(() => post('/auth/password-reset/confirm').send(payload)),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([200, 400]);
    expect(responses.filter((response) => response.body.data?.reset)).toHaveLength(1);
  });

  it('revokes a password reset code when the bot cannot deliver it', async () => {
    const send = vi
      .spyOn(app.get(TelegramChannel), 'send')
      .mockRejectedValueOnce(new Error('Mock offline'));
    await post('/auth/password-reset/request').send({ phone }).expect(200);
    await vi.waitFor(async () => {
      expect(send).toHaveBeenCalledTimes(1);
      expect(await prisma.otpCode.count({ where: { phone, usedAt: null } })).toBe(0);
    });
    expect(sent).toHaveLength(0);
    await post('/auth/password-reset/confirm')
      .send({ phone, otp: '000000', newPassword: 'NeverSet123!' })
      .expect(400);
  });
});
