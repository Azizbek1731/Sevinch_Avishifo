import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import request from 'supertest';
import {
  API,
  PASSWORD,
  createApp,
  createTestClinic,
  setCookies,
  uniqueIp,
  type CapturedTelegram,
  type TestClinic,
} from './setup';

/**
 * Passwordless sign-in through the Telegram bot.
 *
 * Two rules this suite exists to protect. First, the request endpoint must be
 * useless as a directory: every caller gets the same 200 + challengeId, so the
 * only way to tell a staff phone from a stranger's is to already have the chat.
 * Second, an account that opted into two factors must not be signable-in with
 * one — the convenience flow may never quietly weaken a deliberate choice.
 */
describe('telegram passwordless sign-in (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let clinic: TestClinic;
  /** Everything the app tried to send over Telegram, newest last. */
  const sent: CapturedTelegram[] = [];

  /** The linked chat of the account that signs in normally throughout. */
  let ownerChatId: string;
  /** Phones this suite owns outright — see freshPhone. */
  let ownerPhone: string;
  let receptionistPhone: string;
  let doctorPhone: string;
  let cashierPhone: string;

  /**
   * A +998 number provably held by nobody. The harness's uniquePhone() derives
   * from Date.now() % 1_000_000 and so repeats every 1000 seconds — harmless for
   * suites that log in by email, but this one resolves accounts BY phone, and a
   * number shared with a leftover user would silently test the wrong account.
   */
  async function freshPhone(): Promise<string> {
    for (let attempt = 0; attempt < 25; attempt++) {
      const phone = `+99877${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;
      const taken = await prisma.user.findFirst({ where: { phone }, select: { id: true } });
      if (!taken) return phone;
    }
    throw new Error('could not allocate an unused test phone');
  }

  async function claimPhone(userId: string): Promise<string> {
    const phone = await freshPhone();
    await prisma.user.update({ where: { id: userId }, data: { phone } });
    return phone;
  }

  /**
   * The code as the bot presents it. Anchored to the "Kod:" line rather than the
   * first run of six digits, because the message also carries the user's name
   * and names in this fixture contain digits.
   */
  const codeOf = (message: CapturedTelegram): string =>
    /Kod:\s*(\d{6})/.exec(message.text)?.[1] as string;

  /** Matches only a real code line, so a digit-bearing name cannot pass for one. */
  const CODE_LINE = /Kod:\s*\d{6}/;

  /**
   * Asks for a code. The per-number cooldown is cleared first by default: most
   * tests here reuse the same staff phone and would otherwise be rate-limited
   * into the decoy path, testing nothing. Pass `{ respectCooldown: true }` to
   * exercise the limit itself.
   */
  async function requestCode(
    phone: string,
    opts: { respectCooldown?: boolean } = {},
  ): Promise<string> {
    if (!opts.respectCooldown) await redis.del(`auth:tglogin:cooldown:${phone}`);
    sent.length = 0;
    const res = await request(app.getHttpServer())
      .post(`${API}/auth/telegram/request-code`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ phone })
      .expect(200);
    expect(res.body.data.challengeId).toBeTypeOf('string');
    expect(res.body.data.expiresInSeconds).toBeGreaterThan(0);
    return res.body.data.challengeId as string;
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
    app = await createApp(sent);
    clinic = await createTestClinic(prisma, 'tg-login');

    ownerChatId = `tg-login-owner-${clinic.tag}`;
    await prisma.user.update({
      where: { id: clinic.owner.id },
      data: { telegramChatId: ownerChatId, telegramUsername: 'e2e_owner' },
    });

    ownerPhone = await claimPhone(clinic.owner.id);
    receptionistPhone = await claimPhone(clinic.receptionist.id);
    doctorPhone = await claimPhone(clinic.doctor.id);
    cashierPhone = await claimPhone(clinic.cashier.id);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
    await redis.quit();
  });

  it('signs a linked staff user in with the code from Telegram', async () => {
    const challengeId = await requestCode(ownerPhone);

    expect(sent).toHaveLength(1);
    const message = sent[0]!;
    expect(message.chatId).toBe(ownerChatId);
    expect(message.text).toMatch(CODE_LINE);
    // The message has to say what the code lets someone do, and that sharing it
    // is what hands the account over.
    expect(message.text).toMatch(/HECH KIMGA/);

    const res = await request(app.getHttpServer())
      .post(`${API}/auth/telegram/verify`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ challengeId, code: codeOf(message) })
      .expect(200);

    expect(res.body.data.accessToken).toBeTypeOf('string');
    expect(res.body.data.user.id).toBe(clinic.owner.id);
    expect(setCookies(res).some((c) => c.startsWith('avishifo_rt='))).toBe(true);

    // Audited exactly like a password login.
    const logins = await prisma.auditLog.findMany({
      where: { userId: clinic.owner.id, action: 'LOGIN', entity: 'User' },
    });
    expect(logins.length).toBeGreaterThan(0);
  });

  it('will not spend the same code twice', async () => {
    const challengeId = await requestCode(ownerPhone);
    const code = codeOf(sent[0]!);

    await request(app.getHttpServer())
      .post(`${API}/auth/telegram/verify`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ challengeId, code })
      .expect(200);

    const replay = await request(app.getHttpServer())
      .post(`${API}/auth/telegram/verify`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ challengeId, code })
      .expect(401);
    expect(replay.body.error.code).toBe('TWO_FACTOR_CHALLENGE_INVALID');
  });

  it('answers an unknown phone the same way, and sends nothing', async () => {
    const challengeId = await requestCode(await freshPhone());
    expect(sent).toHaveLength(0);

    // The challenge is real-looking and completely inert.
    for (const code of ['000000', '123456']) {
      await request(app.getHttpServer())
        .post(`${API}/auth/telegram/verify`)
        .set('X-Forwarded-For', uniqueIp())
        .send({ challengeId, code })
        .expect(401);
    }
  });

  it('answers a staff phone with no linked chat the same way', async () => {
    // The cashier exists and is active but never linked the bot.
    const challengeId = await requestCode(cashierPhone);
    expect(sent).toHaveLength(0);
    expect(challengeId).toBeTypeOf('string');
  });

  it('refuses a patient account — the portal has its own OTP flow', async () => {
    const phone = await freshPhone();
    const patient = await prisma.user.create({
      data: {
        clinicId: clinic.clinicId,
        phone,
        fullName: `E2E PATIENT ${clinic.tag}`,
        role: 'PATIENT',
        locale: 'uz',
        telegramChatId: `tg-login-patient-${clinic.tag}`,
      },
    });

    await requestCode(phone);
    expect(sent).toHaveLength(0);

    await prisma.user.delete({ where: { id: patient.id } });
  });

  it('does not let a two-factor account in on the Telegram code alone', async () => {
    const chatId = `tg-login-2fa-${clinic.tag}`;
    await prisma.user.update({
      where: { id: clinic.receptionist.id },
      data: { telegramChatId: chatId, twoFactorEnabled: true },
    });

    const challengeId = await requestCode(receptionistPhone);

    // They are told why, in the chat — but no code is sent, so there is nothing
    // to type even for someone reading over their shoulder.
    expect(sent).toHaveLength(1);
    expect(sent[0]!.chatId).toBe(chatId);
    expect(sent[0]!.text).not.toMatch(CODE_LINE);
    expect(sent[0]!.text).toMatch(/parol/i);

    const res = await request(app.getHttpServer())
      .post(`${API}/auth/telegram/verify`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ challengeId, code: '000000' })
      .expect(401);
    expect(res.body.error.code).toBe('TWO_FACTOR_CHALLENGE_INVALID');
  });

  it('keeps the two-factor account signing in with its password as before', async () => {
    sent.length = 0;
    const res = await request(app.getHttpServer())
      .post(`${API}/auth/login`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ identifier: clinic.receptionist.email, password: PASSWORD })
      .expect(200);

    expect(res.body.data.twoFactorRequired).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toMatch(CODE_LINE);

    await prisma.user.update({
      where: { id: clinic.receptionist.id },
      data: { twoFactorEnabled: false },
    });
  });

  it('does not sign in a suspended user', async () => {
    await prisma.user.update({
      where: { id: clinic.doctor.id },
      data: {
        telegramChatId: `tg-login-doctor-${clinic.tag}`,
        status: 'SUSPENDED',
      },
    });

    const challengeId = await requestCode(doctorPhone);
    expect(sent).toHaveLength(0);

    await request(app.getHttpServer())
      .post(`${API}/auth/telegram/verify`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ challengeId, code: '000000' })
      .expect(401);
  });

  /*
   * The two tests above prove the request step refuses to hand out a code. They
   * do NOT reach verifyTelegramLogin's own re-checks, because their 401 comes
   * from the decoy challenge. These two do: a genuine code is issued while the
   * account is still eligible, the account is then changed, and the real code is
   * spent afterwards. That gap is small in practice but it is exactly when an
   * administrator suspending a compromised account expects the door to shut.
   */
  it('refuses a real code once the account is suspended mid-flow', async () => {
    const chatId = `tg-login-midflow-suspend-${clinic.tag}`;
    await prisma.user.update({
      where: { id: clinic.cashier.id },
      data: { telegramChatId: chatId, status: 'ACTIVE' },
    });

    const challengeId = await requestCode(cashierPhone);
    const code = codeOf(sent[0]!);

    await prisma.user.update({
      where: { id: clinic.cashier.id },
      data: { status: 'SUSPENDED' },
    });

    const res = await request(app.getHttpServer())
      .post(`${API}/auth/telegram/verify`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ challengeId, code })
      .expect(403);
    expect(res.body.error.code).toBe('ACCOUNT_SUSPENDED');

    await prisma.user.update({
      where: { id: clinic.cashier.id },
      data: { status: 'ACTIVE' },
    });
  });

  it('refuses a real code once two-factor is switched on mid-flow', async () => {
    const chatId = `tg-login-midflow-2fa-${clinic.tag}`;
    await prisma.user.update({
      where: { id: clinic.cashier.id },
      data: { telegramChatId: chatId, twoFactorEnabled: false },
    });

    const challengeId = await requestCode(cashierPhone);
    const code = codeOf(sent[0]!);

    await prisma.user.update({
      where: { id: clinic.cashier.id },
      data: { twoFactorEnabled: true },
    });

    const res = await request(app.getHttpServer())
      .post(`${API}/auth/telegram/verify`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ challengeId, code })
      .expect(401);
    expect(res.body.error.code).toBe('TWO_FACTOR_CHALLENGE_INVALID');

    await prisma.user.update({
      where: { id: clinic.cashier.id },
      data: { twoFactorEnabled: false },
    });
  });

  it('sends one code per number per minute, however often it is asked', async () => {
    const chatId = `tg-login-cooldown-${clinic.tag}`;
    await prisma.user.update({
      where: { id: clinic.cashier.id },
      data: { telegramChatId: chatId },
    });

    await requestCode(cashierPhone);
    expect(sent).toHaveLength(1);

    // Same neutral 200 + challengeId, but the victim's chat stays quiet.
    await requestCode(cashierPhone, { respectCooldown: true });
    expect(sent).toHaveLength(0);
    await requestCode(cashierPhone, { respectCooldown: true });
    expect(sent).toHaveLength(0);
  });

  it('rejects a wrong code and burns the challenge after too many tries', async () => {
    const challengeId = await requestCode(ownerPhone);
    const real = codeOf(sent[0]!);
    const wrong = real === '000000' ? '111111' : '000000';

    const first = await request(app.getHttpServer())
      .post(`${API}/auth/telegram/verify`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ challengeId, code: wrong })
      .expect(401);
    expect(first.body.error.code).toBe('OTP_INVALID');

    // AUTH_2FA_MAX_ATTEMPTS is 5: three more rejections, then the fifth burns it.
    for (let i = 0; i < 3; i++) {
      await request(app.getHttpServer())
        .post(`${API}/auth/telegram/verify`)
        .set('X-Forwarded-For', uniqueIp())
        .send({ challengeId, code: wrong })
        .expect(401);
    }
    const burned = await request(app.getHttpServer())
      .post(`${API}/auth/telegram/verify`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ challengeId, code: wrong })
      .expect(401);
    expect(burned.body.error.code).toBe('TWO_FACTOR_CHALLENGE_INVALID');

    // Even the real code is dead now.
    await request(app.getHttpServer())
      .post(`${API}/auth/telegram/verify`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ challengeId, code: real })
      .expect(401);
  });

  it('cannot spend a passwordless code on the two-factor step', async () => {
    const challengeId = await requestCode(ownerPhone);
    const code = codeOf(sent[0]!);

    // /auth/two-factor/verify is reached only after a correct password; a code
    // handed out without one must not be redeemable there.
    const crossed = await request(app.getHttpServer())
      .post(`${API}/auth/two-factor/verify`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ challengeId, code })
      .expect(401);
    expect(crossed.body.error.code).toBe('TWO_FACTOR_CHALLENGE_INVALID');

    // The rejection is a routing decision, not a failed guess — the real flow
    // still works.
    await request(app.getHttpServer())
      .post(`${API}/auth/telegram/verify`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ challengeId, code })
      .expect(200);
  });

  /**
   * Not the Telegram flow, but found by it: this suite's fixture emails carry
   * digits, and login() resolved its identifier with normalizePhone(), which
   * strips every non-digit. An address left holding exactly nine digits was read
   * as a phone number, so the account was looked up by a phone nobody has and
   * the user simply could not sign in.
   */
  it('signs in by email even when the address carries nine digits', async () => {
    // Eight here plus the "2" in "e2e" is the nine that used to break it.
    const email = `cashier.${randomInt(10_000_000, 99_999_999)}@e2e.avishifo.test`;
    await prisma.user.update({ where: { id: clinic.cashier.id }, data: { email } });

    const res = await request(app.getHttpServer())
      .post(`${API}/auth/login`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ identifier: email, password: PASSWORD })
      .expect(200);
    expect(res.body.data.user.id).toBe(clinic.cashier.id);
  });

  it('rejects a malformed phone or code before any challenge is touched', async () => {
    await request(app.getHttpServer())
      .post(`${API}/auth/telegram/request-code`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ phone: '901234567' })
      .expect(400);

    await request(app.getHttpServer())
      .post(`${API}/auth/telegram/verify`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ challengeId: 'whatever', code: 'abc' })
      .expect(400);
  });
});
