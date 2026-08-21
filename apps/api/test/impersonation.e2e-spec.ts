import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
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
  uniquePhone,
  type LoginResult,
  type TestClinic,
} from './setup';

/**
 * Entering a clinic from the platform console.
 *
 * The property under test is narrow and load-bearing: the token minted for
 * impersonation carries `sid: 'impersonation'` rather than a real session id,
 * and the whole feature rests on the API accepting it anyway. The panel signs
 * the operator in by calling /auth/me with that token — so the day someone
 * adds a session lookup to token verification, impersonation stops working and
 * nothing else in the suite would notice.
 */
describe('super-admin impersonation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let clinic: TestClinic;
  let platform: LoginResult;
  let ownerEmail: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createApp();
    clinic = await createTestClinic(prisma, 'imp');
    ownerEmail = clinic.owner.email;

    // A platform operator belongs to no clinic.
    const tag = randomUUID().slice(0, 8);
    const email = `super.${tag}@e2e.avishifo.test`;
    await prisma.user.create({
      data: {
        clinicId: null,
        email,
        phone: uniquePhone(),
        passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
        fullName: `E2E SUPER_ADMIN ${tag}`,
        role: 'SUPER_ADMIN',
        locale: 'uz',
      },
    });
    platform = await login(app, email);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('hands back a token for the clinic owner, not for the operator', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/platform/clinics/${clinic.clinicId}/impersonate`)
      .set('Authorization', `Bearer ${platform.accessToken}`)
      .expect(201);

    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.user.id).not.toBe(platform.user.id);

    const owner = await prisma.user.findFirstOrThrow({ where: { email: ownerEmail } });
    expect(res.body.data.user.id).toBe(owner.id);
  });

  it('accepts that token on /auth/me — the call the panel makes to sign in', async () => {
    const imp = await request(app.getHttpServer())
      .post(`${API}/platform/clinics/${clinic.clinicId}/impersonate`)
      .set('Authorization', `Bearer ${platform.accessToken}`)
      .expect(201);

    // No real session backs this token. If verification ever starts requiring
    // one, this is where it breaks — and the button goes dead again.
    const me = await request(app.getHttpServer())
      .get(`${API}/auth/me`)
      .set('Authorization', `Bearer ${imp.body.data.accessToken}`)
      .expect(200);

    expect(me.body.data.user.role).toBe('CLINIC_OWNER');
    expect(me.body.data.user.clinicId).toBe(clinic.clinicId);
  });

  it('sees the clinic own data through the impersonated token', async () => {
    const imp = await request(app.getHttpServer())
      .post(`${API}/platform/clinics/${clinic.clinicId}/impersonate`)
      .set('Authorization', `Bearer ${platform.accessToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .get(`${API}/patients`)
      .set('Authorization', `Bearer ${imp.body.data.accessToken}`)
      .set('x-branch-id', clinic.branchId)
      .expect(200);
  });

  it('refuses a clinic user who tries to impersonate', async () => {
    const owner = await login(app, clinic.owner.email);
    await request(app.getHttpServer())
      .post(`${API}/platform/clinics/${clinic.clinicId}/impersonate`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(403);
  });

  it('records who entered which clinic', async () => {
    await request(app.getHttpServer())
      .post(`${API}/platform/clinics/${clinic.clinicId}/impersonate`)
      .set('Authorization', `Bearer ${platform.accessToken}`)
      .expect(201);

    const entry = await prisma.auditLog.findFirst({
      where: { action: 'IMPERSONATE', clinicId: clinic.clinicId, userId: platform.user.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(entry).not.toBeNull();
  });
});
