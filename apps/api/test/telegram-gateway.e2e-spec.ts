import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import request from 'supertest';
import { TelegramGatewayChannel } from '../src/modules/notifications/channels/telegram-gateway.channel';
import {
  API,
  PASSWORD,
  createApp,
  createTestClinic,
  login,
  uniqueIp,
  type CapturedTelegram,
  type LoginResult,
  type TestClinic,
} from './setup';

/**
 * Telegram Gateway as a delivery route for verification codes.
 *
 * What it buys is reach: the bot can only message a chat that already pressed
 * /start, which a first-time sign-in never has. Gateway is therefore the
 * default route — one recognisable sender for everybody — with the linked bot
 * chat as the fallback. These tests pin that order, and, more importantly, that
 * turning Gateway off puts every flow back exactly as it was.
 */
describe('telegram gateway delivery (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let clinic: TestClinic;
  let owner: LoginResult;
  const sent: CapturedTelegram[] = [];

  /** The test double swaps availability at runtime; the real one reads config. */
  function setGateway(on: boolean): void {
    (app.get(TelegramGatewayChannel) as unknown as { setEnabled: (v: boolean) => void }).setEnabled(
      on,
    );
  }

  async function requestCode(phone: string): Promise<string> {
    await redis.del(`auth:tglogin:cooldown:${phone}`);
    sent.length = 0;
    const res = await request(app.getHttpServer())
      .post(`${API}/auth/telegram/request-code`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ phone })
      .expect(200);
    return res.body.data.challengeId as string;
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
    app = await createApp(sent);
    clinic = await createTestClinic(prisma, 'tg-gateway');
    owner = await login(app, clinic.owner.email);
  });

  afterAll(async () => {
    setGateway(false);
    await app.close();
    await prisma.$disconnect();
    await redis.quit();
  });

  it('signs in a staff member who never linked the bot', async () => {
    setGateway(true);
    // No telegramChatId anywhere on this account — the bot cannot reach them.
    await prisma.user.update({
      where: { id: clinic.doctor.id },
      data: { telegramChatId: null, status: 'ACTIVE' },
    });
    const phone = (await prisma.user.findUnique({ where: { id: clinic.doctor.id } }))!.phone!;

    const challengeId = await requestCode(phone);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.chatId).toBe(`gateway:${phone}`);

    const code = /(\d{6})/.exec(sent[0]!.text)?.[1] as string;
    const res = await request(app.getHttpServer())
      .post(`${API}/auth/telegram/verify`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ challengeId, code })
      .expect(200);
    expect(res.body.data.user.id).toBe(clinic.doctor.id);
  });

  it('sends through Gateway even when the user has a linked bot chat', async () => {
    setGateway(true);
    const chatId = `gw-chat-${clinic.tag}`;
    await prisma.user.update({
      where: { id: clinic.cashier.id },
      data: { telegramChatId: chatId },
    });
    const phone = (await prisma.user.findUnique({ where: { id: clinic.cashier.id } }))!.phone!;

    await requestCode(phone);
    expect(sent).toHaveLength(1);
    // VERIFICATION_CODE_CHANNEL defaults to `gateway`: every user sees the code
    // arrive from the same recognisable sender, whether or not they ever linked
    // the bot. Exactly one message goes out — never both.
    expect(sent[0]!.chatId).toBe(`gateway:${phone}`);
  });

  it('falls back to the linked bot chat when Gateway cannot deliver', async () => {
    setGateway(false);
    const chatId = `gw-fallback-${clinic.tag}`;
    await prisma.user.update({
      where: { id: clinic.cashier.id },
      data: { telegramChatId: chatId },
    });
    const phone = (await prisma.user.findUnique({ where: { id: clinic.cashier.id } }))!.phone!;

    const challengeId = await requestCode(phone);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.chatId).toBe(chatId);

    // And the fallback code is a real one, not a decoy.
    const code = /(\d{6})/.exec(sent[0]!.text)?.[1] as string;
    await request(app.getHttpServer())
      .post(`${API}/auth/telegram/verify`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ challengeId, code })
      .expect(200);
  });

  it('goes back to refusing unlinked accounts when Gateway is off', async () => {
    setGateway(false);
    await prisma.user.update({
      where: { id: clinic.doctor.id },
      data: { telegramChatId: null },
    });
    const phone = (await prisma.user.findUnique({ where: { id: clinic.doctor.id } }))!.phone!;

    const challengeId = await requestCode(phone);
    // Still a neutral 200 with a challengeId — the endpoint must not become
    // enumerable just because a channel is disabled — but nothing was sent and
    // the challenge is a decoy.
    expect(sent).toHaveLength(0);
    await request(app.getHttpServer())
      .post(`${API}/auth/telegram/verify`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ challengeId, code: '000000' })
      .expect(401);
  });

  it('lets a user without a linked chat enable the second factor', async () => {
    setGateway(true);
    await prisma.user.update({
      where: { id: clinic.owner.id },
      data: { telegramChatId: null, twoFactorEnabled: false },
    });

    await request(app.getHttpServer())
      .post(`${API}/auth/two-factor`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ enabled: true })
      .expect(200);

    sent.length = 0;
    const res = await request(app.getHttpServer())
      .post(`${API}/auth/login`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ identifier: clinic.owner.email, password: PASSWORD })
      .expect(200);
    expect(res.body.data.twoFactorRequired).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.chatId).toMatch(/^gateway:/);

    const code = /(\d{6})/.exec(sent[0]!.text)?.[1] as string;
    const done = await request(app.getHttpServer())
      .post(`${API}/auth/two-factor/verify`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ challengeId: res.body.data.challengeId, code })
      .expect(200);
    expect(done.body.data.accessToken).toBeTypeOf('string');

    await prisma.user.update({
      where: { id: clinic.owner.id },
      data: { twoFactorEnabled: false },
    });
  });

  it('still refuses to enable the second factor with no route at all', async () => {
    setGateway(false);
    await prisma.user.update({
      where: { id: clinic.owner.id },
      data: { telegramChatId: null, twoFactorEnabled: false },
    });

    const res = await request(app.getHttpServer())
      .post(`${API}/auth/two-factor`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ enabled: true })
      .expect(400);
    expect(res.body.error.code).toBe('TELEGRAM_NOT_LINKED');
  });

  it('actually sends the password-reset code instead of only logging it', async () => {
    setGateway(true);
    await prisma.user.update({
      where: { id: clinic.cashier.id },
      data: { telegramChatId: null, status: 'ACTIVE' },
    });
    const phone = (await prisma.user.findUnique({ where: { id: clinic.cashier.id } }))!.phone!;

    sent.length = 0;
    await request(app.getHttpServer())
      .post(`${API}/auth/password-reset/request`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ phone })
      .expect(200);

    // Delivery is fire-and-forget so the response time cannot betray whether the
    // account exists; give the send a moment to land in the recorder.
    await new Promise((r) => setTimeout(r, 200));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.chatId).toBe(`gateway:${phone}`);

    // And the code that arrived is the one that works.
    const code = /(\d{6})/.exec(sent[0]!.text)?.[1] as string;
    await request(app.getHttpServer())
      .post(`${API}/auth/password-reset/confirm`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ phone, otp: code, newPassword: 'NewE2ePass123!' })
      .expect(200);
  });

  it('delivers a portal sign-in code through Gateway when the bot is unlinked', async () => {
    setGateway(true);
    sent.length = 0;
    const phone = '+998770000123';

    await request(app.getHttpServer())
      .post(`${API}/portal/auth/request-otp`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ phone })
      .expect(200);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.chatId).toBe(`gateway:${phone}`);
  });
});
