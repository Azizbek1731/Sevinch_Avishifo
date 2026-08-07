import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import {
  API,
  PASSWORD,
  createApp,
  login,
  uniqueIp,
  uniquePhone,
  type LoginResult,
} from './setup';

/**
 * Public clinic sign-up + free trial + read-only expiry + super-admin trial
 * management. Access control, so it is exercised end to end rather than unit-mocked.
 */
describe('signup, trial and expiry (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let superAdmin: LoginResult;
  let superAdminEmail: string;

  // The clinic created through the public sign-up endpoint.
  let ownerPhone: string;
  let ownerToken: string;
  let clinicId: string;
  let clinicName: string;
  let subscriptionId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createApp();

    // A platform operator to drive the trial-management endpoints.
    superAdminEmail = `superadmin.${randomUUID().slice(0, 8)}@e2e.avishifo.test`;
    await prisma.user.create({
      data: {
        clinicId: null,
        email: superAdminEmail,
        phone: uniquePhone(),
        passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
        fullName: 'E2E Platform Operator',
        role: 'SUPER_ADMIN',
        locale: 'uz',
      },
    });
    superAdmin = await login(app, superAdminEmail);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ------------------------------------------------------------- sign-up

  it('a director registers a clinic publicly and is signed in on a trial', async () => {
    ownerPhone = uniquePhone();
    clinicName = `E2E Sinov Klinika ${randomUUID().slice(0, 8)}`;

    const res = await request(app.getHttpServer())
      .post(`${API}/auth/register-clinic`)
      .set('X-Forwarded-For', uniqueIp())
      .send({
        clinicName,
        fullName: 'Direktor Direktorov',
        phone: ownerPhone,
        password: PASSWORD,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.user).toMatchObject({ role: 'CLINIC_OWNER' });
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.trialEndsAt).toBeTruthy();

    ownerToken = res.body.data.accessToken as string;
    clinicId = res.body.data.user.clinicId as string;

    // A first branch and a TRIAL subscription came with it.
    const branches = await prisma.branch.count({ where: { clinicId } });
    expect(branches).toBe(1);

    const sub = await prisma.clinicSubscription.findFirst({ where: { clinicId } });
    expect(sub).toBeTruthy();
    expect(sub?.status).toBe('TRIAL');
    subscriptionId = sub!.id;

    // Default trial length is 7 days.
    const days = Math.round((sub!.endsAt!.getTime() - sub!.startsAt.getTime()) / 86_400_000);
    expect(days).toBe(7);
  });

  it('/auth/me reports the trial with a days-left countdown', async () => {
    const res = await request(app.getHttpServer())
      .get(`${API}/auth/me`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.subscription).toMatchObject({
      status: 'TRIAL',
      isTrial: true,
      isExpired: false,
    });
    expect(res.body.data.subscription.daysLeft).toBeGreaterThan(0);
    expect(res.body.data.subscription.daysLeft).toBeLessThanOrEqual(7);
    expect(res.body.data.support).toBeDefined();
  });

  it('the same phone cannot register a second clinic', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/auth/register-clinic`)
      .set('X-Forwarded-For', uniqueIp())
      .send({
        clinicName: `Boshqa klinika ${randomUUID().slice(0, 8)}`,
        fullName: 'Direktor Direktorov',
        phone: ownerPhone,
        password: PASSWORD,
      });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PHONE_ALREADY_OWNS_CLINIC');
  });

  it('a clinic name cannot be taken twice', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/auth/register-clinic`)
      .set('X-Forwarded-For', uniqueIp())
      .send({
        clinicName: clinicName.toUpperCase(), // case-insensitive check
        fullName: 'Boshqa Direktor',
        phone: uniquePhone(),
        password: PASSWORD,
      });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CLINIC_NAME_TAKEN');
  });

  // ------------------------------------------------------- during the trial

  it('during the trial the clinic can write', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/patients`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ firstName: 'Sinov', lastName: 'Bemorov', phone: uniquePhone() });
    expect(res.status).toBe(201);
  });

  // ------------------------------------------------------------- expiry

  it('the trial lapsing with the clock alone flips the clinic to read-only', async () => {
    // End the trial 1.5s out, then prime the cache while it is still valid: the
    // guard must re-derive expiry from the cached end date rather than trust a
    // stale "not expired" verdict for the length of the cache TTL.
    const endsAt = new Date(Date.now() + 1_500).toISOString();
    const pin = await request(app.getHttpServer())
      .patch(`${API}/platform/clinics/${clinicId}/subscription`)
      .set('Authorization', `Bearer ${superAdmin.accessToken}`)
      .send({ endsAt });
    expect(pin.status).toBe(200);
    expect(pin.body.data.isExpired).toBe(false);

    const stillOk = await request(app.getHttpServer())
      .post(`${API}/patients`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ firstName: 'Hali', lastName: 'Ruxsat', phone: uniquePhone() });
    expect(stillOk.status).toBe(201);

    await new Promise((resolve) => setTimeout(resolve, 2_000));

    // Reads keep working — the clinic never loses sight of its own data.
    const read = await request(app.getHttpServer())
      .get(`${API}/patients`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(read.status).toBe(200);

    const write = await request(app.getHttpServer())
      .post(`${API}/patients`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ firstName: 'Bloklangan', lastName: 'Bemorov', phone: uniquePhone() });
    expect(write.status).toBe(402);
    expect(write.body.error.code).toBe('SUBSCRIPTION_EXPIRED');
  });

  it('an expired clinic can still sign in and read its own state', async () => {
    const relogin = await login(app, ownerPhone);
    expect(relogin.accessToken).toBeTruthy();

    const me = await request(app.getHttpServer())
      .get(`${API}/auth/me`)
      .set('Authorization', `Bearer ${relogin.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.subscription).toMatchObject({ isExpired: true, daysLeft: 0 });

    // Signing out is a mutation, but a locked-out clinic must still be able to.
    const logout = await request(app.getHttpServer())
      .post(`${API}/auth/logout`)
      .set('Authorization', `Bearer ${relogin.accessToken}`)
      .send({});
    expect(logout.status).toBe(200);
  });

  it('the super-admin is never blocked by a clinic expiry', async () => {
    const res = await request(app.getHttpServer())
      .get(`${API}/platform/clinics`)
      .set('Authorization', `Bearer ${superAdmin.accessToken}`);
    expect(res.status).toBe(200);
  });

  // --------------------------------------------------- super-admin controls

  it('the clinic shows up as expired in the platform list and filter', async () => {
    const res = await request(app.getHttpServer())
      .get(`${API}/platform/clinics`)
      .query({ subscription: 'expired', search: clinicName, limit: 50 })
      .set('Authorization', `Bearer ${superAdmin.accessToken}`);

    expect(res.status).toBe(200);
    const row = (res.body.data as Array<{ id: string; subscription: unknown }>).find(
      (c) => c.id === clinicId,
    );
    expect(row).toBeTruthy();
    expect(row?.subscription).toMatchObject({ status: 'TRIAL', isExpired: true, daysLeft: 0 });
  });

  it('extending the trial keeps the same subscription row and unblocks writes', async () => {
    const before = await prisma.clinicSubscription.findUnique({ where: { id: subscriptionId } });

    const res = await request(app.getHttpServer())
      .patch(`${API}/platform/clinics/${clinicId}/subscription`)
      .set('Authorization', `Bearer ${superAdmin.accessToken}`)
      .send({ extendDays: 7 });

    expect(res.status).toBe(200);
    // Same row — startsAt untouched, so the trial was extended, not restarted.
    expect(res.body.data.id).toBe(subscriptionId);
    expect(res.body.data.startsAt).toBe(before!.startsAt.toISOString());
    expect(res.body.data.isExpired).toBe(false);
    expect(res.body.data.daysLeft).toBe(7);

    const write = await request(app.getHttpServer())
      .post(`${API}/patients`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ firstName: 'Uzaytirilgan', lastName: 'Bemorov', phone: uniquePhone() });
    expect(write.status).toBe(201);
  });

  it('the super-admin can pin an exact end date', async () => {
    const endsAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const res = await request(app.getHttpServer())
      .patch(`${API}/platform/clinics/${clinicId}/subscription`)
      .set('Authorization', `Bearer ${superAdmin.accessToken}`)
      .send({ endsAt });

    expect(res.status).toBe(200);
    expect(res.body.data.endsAt).toBe(endsAt);
    expect(res.body.data.daysLeft).toBe(30);
  });

  it('shortening the trial pushes the clinic straight back to read-only', async () => {
    const res = await request(app.getHttpServer())
      .patch(`${API}/platform/clinics/${clinicId}/subscription`)
      .set('Authorization', `Bearer ${superAdmin.accessToken}`)
      .send({ endsAt: new Date(Date.now() - 1_000).toISOString() });
    expect(res.status).toBe(200);
    expect(res.body.data.isExpired).toBe(true);

    const write = await request(app.getHttpServer())
      .post(`${API}/patients`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ firstName: 'Yana', lastName: 'Bloklangan', phone: uniquePhone() });
    expect(write.status).toBe(402);
  });

  it('rejects contradictory subscription edits', async () => {
    const res = await request(app.getHttpServer())
      .patch(`${API}/platform/clinics/${clinicId}/subscription`)
      .set('Authorization', `Bearer ${superAdmin.accessToken}`)
      .send({ endsAt: new Date().toISOString(), extendDays: 5 });
    expect(res.status).toBe(400);
  });

  it('a clinic user cannot manage subscriptions (RBAC)', async () => {
    const res = await request(app.getHttpServer())
      .patch(`${API}/platform/clinics/${clinicId}/subscription`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ extendDays: 7 });
    expect(res.status).toBe(403);
  });
});
