import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
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
 * Opt-in Telegram second factor.
 *
 * The rule this suite exists to protect: enabling 2FA must never be able to
 * lock a user out. That means it cannot be switched on without a linked chat,
 * and a flag set on an account with no chat is ignored at login rather than
 * blocking it.
 */
describe('two-factor sign-in (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let clinic: TestClinic;
  let owner: LoginResult;
  /** Everything the app tried to send over Telegram, newest last. */
  const sent: CapturedTelegram[] = [];

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createApp(sent);
    clinic = await createTestClinic(prisma, 'two-factor');
    owner = await login(app, clinic.owner.email);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('reports the security state on /auth/me', async () => {
    const res = await request(app.getHttpServer())
      .get(`${API}/auth/me`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    expect(res.body.data.security).toEqual({
      twoFactorEnabled: false,
      telegramLinked: false,
      telegramUsername: null,
    });
  });

  it('refuses to enable the second factor without a linked Telegram chat', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/auth/two-factor`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ enabled: true })
      .expect(400);
    expect(res.body.error.code).toBe('TELEGRAM_NOT_LINKED');

    const row = await prisma.user.findUnique({ where: { id: clinic.owner.id } });
    expect(row?.twoFactorEnabled).toBe(false);
  });

  it('still signs in normally when the flag is set but no chat is linked', async () => {
    // Force the inconsistent state the API refuses to create, and prove login
    // degrades to password-only instead of demanding an undeliverable code.
    await prisma.user.update({
      where: { id: clinic.owner.id },
      data: { twoFactorEnabled: true, telegramChatId: null },
    });

    const res = await request(app.getHttpServer())
      .post(`${API}/auth/login`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ identifier: clinic.owner.email, password: PASSWORD })
      .expect(200);
    expect(res.body.data.accessToken).toBeTypeOf('string');
    expect(res.body.data.twoFactorRequired).toBeUndefined();

    await prisma.user.update({
      where: { id: clinic.owner.id },
      data: { twoFactorEnabled: false },
    });
  });

  it('enables the second factor once a chat is linked', async () => {
    await prisma.user.update({
      where: { id: clinic.owner.id },
      data: { telegramChatId: `e2e-chat-${clinic.tag}`, telegramUsername: 'e2e_owner' },
    });

    const res = await request(app.getHttpServer())
      .post(`${API}/auth/two-factor`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ enabled: true })
      .expect(200);
    expect(res.body.data.twoFactorEnabled).toBe(true);
  });

  it('challenges instead of issuing a session, and sets no refresh cookie', async () => {
    sent.length = 0;
    const res = await request(app.getHttpServer())
      .post(`${API}/auth/login`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ identifier: clinic.owner.email, password: PASSWORD })
      .expect(200);

    expect(res.body.data.twoFactorRequired).toBe(true);
    expect(res.body.data.challengeId).toBeTypeOf('string');
    // The password step must not hand out anything usable.
    expect(res.body.data.accessToken).toBeUndefined();
    expect(res.headers['set-cookie']).toBeUndefined();

    // The code went to the linked chat, and nowhere else.
    expect(sent).toHaveLength(1);
    const message = sent[0]!;
    expect(message.chatId).toBe(`e2e-chat-${clinic.tag}`);
    expect(message.text).toMatch(/\d{6}/);
  });

  it('completes the login with the code from Telegram', async () => {
    sent.length = 0;
    const start = await request(app.getHttpServer())
      .post(`${API}/auth/login`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ identifier: clinic.owner.email, password: PASSWORD })
      .expect(200);
    const challengeId = start.body.data.challengeId as string;
    const code = /(\d{6})/.exec(sent[0]!.text)?.[1] as string;

    const wrong = await request(app.getHttpServer())
      .post(`${API}/auth/two-factor/verify`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ challengeId, code: code === '000000' ? '111111' : '000000' })
      .expect(401);
    expect(wrong.body.error.code).toBe('OTP_INVALID');

    const res = await request(app.getHttpServer())
      .post(`${API}/auth/two-factor/verify`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ challengeId, code })
      .expect(200);
    expect(res.body.data.accessToken).toBeTypeOf('string');
    expect(res.body.data.user.id).toBe(clinic.owner.id);
    expect(res.headers['set-cookie']).toBeDefined();

    // Single use: the same code must not mint a second session.
    await request(app.getHttpServer())
      .post(`${API}/auth/two-factor/verify`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ challengeId, code })
      .expect(401);
  });

  it('burns the challenge after too many wrong codes', async () => {
    sent.length = 0;
    const start = await request(app.getHttpServer())
      .post(`${API}/auth/login`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ identifier: clinic.owner.email, password: PASSWORD })
      .expect(200);
    const challengeId = start.body.data.challengeId as string;
    const real = /(\d{6})/.exec(sent[0]!.text)?.[1] as string;
    const wrong = real === '000000' ? '111111' : '000000';

    // AUTH_2FA_MAX_ATTEMPTS is 5: four rejections, then the fifth burns it.
    for (let i = 0; i < 4; i++) {
      await request(app.getHttpServer())
        .post(`${API}/auth/two-factor/verify`)
        .set('X-Forwarded-For', uniqueIp())
        .send({ challengeId, code: wrong })
        .expect(401);
    }
    const burned = await request(app.getHttpServer())
      .post(`${API}/auth/two-factor/verify`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ challengeId, code: wrong })
      .expect(401);
    expect(burned.body.error.code).toBe('TWO_FACTOR_CHALLENGE_INVALID');

    // Even the correct code is dead now.
    await request(app.getHttpServer())
      .post(`${API}/auth/two-factor/verify`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ challengeId, code: real })
      .expect(401);
  });

  it('rejects an unknown or expired challenge', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/auth/two-factor/verify`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ challengeId: '00000000-0000-0000-0000-000000000000', code: '123456' })
      .expect(401);
    expect(res.body.error.code).toBe('TWO_FACTOR_CHALLENGE_INVALID');
  });

  it('rejects a malformed code before touching the challenge store', async () => {
    await request(app.getHttpServer())
      .post(`${API}/auth/two-factor/verify`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ challengeId: 'whatever', code: 'abc' })
      .expect(400);
  });

  it('turns the second factor back off', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/auth/two-factor`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ enabled: false })
      .expect(200);
    expect(res.body.data.twoFactorEnabled).toBe(false);

    const login2 = await request(app.getHttpServer())
      .post(`${API}/auth/login`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ identifier: clinic.owner.email, password: PASSWORD })
      .expect(200);
    expect(login2.body.data.accessToken).toBeTypeOf('string');
  });
});
