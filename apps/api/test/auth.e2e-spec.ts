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
  refreshCookieOf,
  setCookies,
  uniqueIp,
  type TestClinic,
} from './setup';

describe('auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let clinic: TestClinic;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createApp();
    clinic = await createTestClinic(prisma, `auth${Date.now()}`);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('logs in with valid credentials and sets the refresh cookie', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/auth/login`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ identifier: clinic.owner.email, password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.data.accessToken).toBe('string');
    expect(res.body.data.user).toMatchObject({
      id: clinic.owner.id,
      role: 'CLINIC_OWNER',
      clinicId: clinic.clinicId,
    });
    // No refresh token in the body — httpOnly cookie only.
    expect(res.body.data.refreshToken).toBeUndefined();

    const cookie = setCookies(res).find((c) => c.startsWith('avishifo_rt='));
    expect(cookie).toBeDefined();
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/api/v1/auth');
  });

  it('rejects a wrong password with the INVALID_CREDENTIALS envelope', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/auth/login`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ identifier: clinic.owner.email, password: 'WrongPass123!' });

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      success: false,
      error: { code: 'INVALID_CREDENTIALS' },
    });
    expect(res.body.data).toBeUndefined();
  });

  it('rejects a malformed body with 400 VALIDATION_ERROR (global ZodValidationPipe)', async () => {
    // Regression guard: DTO imports must stay VALUE imports — `import type`
    // erases them from design:paramtypes and silently disables validation.
    const res = await request(app.getHttpServer())
      .post(`${API}/auth/login`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ identifier: clinic.owner.email, password: 'short' }); // min 8

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
  });

  it('rejects an unknown identifier with 401 (no user enumeration)', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/auth/login`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ identifier: `nobody.${clinic.tag}@e2e.avishifo.test`, password: PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('GET /auth/me returns the user, clinic and branches', async () => {
    const session = await login(app, clinic.owner.email);
    const res = await request(app.getHttpServer())
      .get(`${API}/auth/me`)
      .set('Authorization', `Bearer ${session.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(clinic.owner.id);
    expect(res.body.data.clinic).toMatchObject({ id: clinic.clinicId });
    expect(res.body.data.branches).toEqual([
      expect.objectContaining({ id: clinic.branchId }),
    ]);
  });

  it('GET /auth/me without a token → 401', async () => {
    const res = await request(app.getHttpServer()).get(`${API}/auth/me`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rotates the refresh token; the new access token works', async () => {
    const session = await login(app, clinic.receptionist.email);

    const refreshed = await request(app.getHttpServer())
      .post(`${API}/auth/refresh`)
      .set('X-Forwarded-For', uniqueIp())
      .set('Cookie', session.refreshCookie)
      .send({});

    expect(refreshed.status).toBe(200);
    const newAccess = refreshed.body.data.accessToken as string;
    expect(typeof newAccess).toBe('string');

    const rotatedCookie = refreshCookieOf(refreshed);
    expect(rotatedCookie).not.toBe(session.refreshCookie); // rotated secret

    const me = await request(app.getHttpServer())
      .get(`${API}/auth/me`)
      .set('Authorization', `Bearer ${newAccess}`);
    expect(me.status).toBe(200);
    expect(me.body.data.user.id).toBe(clinic.receptionist.id);

    // Replaying the OLD (already-rotated) token is reuse → whole family revoked.
    const replay = await request(app.getHttpServer())
      .post(`${API}/auth/refresh`)
      .set('X-Forwarded-For', uniqueIp())
      .set('Cookie', session.refreshCookie)
      .send({});
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('REFRESH_REUSE_DETECTED');

    // The rotated token dies with the family too.
    const afterRevoke = await request(app.getHttpServer())
      .post(`${API}/auth/refresh`)
      .set('X-Forwarded-For', uniqueIp())
      .set('Cookie', rotatedCookie)
      .send({});
    expect(afterRevoke.status).toBe(401);
  });

  it('logout revokes the session and clears the cookie', async () => {
    const session = await login(app, clinic.cashier.email);

    const res = await request(app.getHttpServer())
      .post(`${API}/auth/logout`)
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ loggedOut: true });
    const cleared = setCookies(res).find((c) => c.startsWith('avishifo_rt='));
    expect(cleared).toBeDefined(); // clear-cookie directive

    // The revoked session's refresh token no longer works.
    const refreshed = await request(app.getHttpServer())
      .post(`${API}/auth/refresh`)
      .set('X-Forwarded-For', uniqueIp())
      .set('Cookie', session.refreshCookie)
      .send({});
    expect(refreshed.status).toBe(401);
  });
});
