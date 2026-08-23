import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { API, createApp, createTestClinic, login, type LoginResult, type TestClinic } from './setup';

/**
 * The first-run checklist must be computed from what actually exists — the
 * whole point is that it cannot lie the way a ticked box can.
 */
describe('clinic setup status (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let clinic: TestClinic;
  let owner: LoginResult;

  const auth = (u: LoginResult): Record<string, string> => ({
    Authorization: `Bearer ${u.accessToken}`,
  });

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createApp();
    clinic = await createTestClinic(prisma, 'setup');
    owner = await login(app, clinic.owner.email);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('reads real state, and flips only when the real thing appears', async () => {
    const before = await request(app.getHttpServer())
      .get(`${API}/clinic/setup-status`)
      .set(auth(owner))
      .expect(200);
    // The test clinic ships with 4 staff users but no profile, services or patients.
    expect(before.body.data.hasStaff).toBe(true);
    expect(before.body.data.profileComplete).toBe(false);
    expect(before.body.data.hasPricedService).toBe(false);
    expect(before.body.data.hasPatient).toBe(false);
    expect(before.body.data.complete).toBe(false);

    // A service WITHOUT a price must not count — the cashier screen stays unusable.
    const cat = await request(app.getHttpServer())
      .post(`${API}/service-categories`)
      .set(auth(owner))
      .send({ name: 'Xizmatlar', kind: 'CONSULTATION' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${API}/services`)
      .set(auth(owner))
      .send({
        categoryId: cat.body.data.id as string,
        code: `S-${clinic.tag.slice(0, 6)}`,
        name: { uz: 'Qabul' },
        durationMin: 15,
        vatIncluded: true,
        price: '50000.00',
      })
      .expect(201);
    await prisma.patient.create({
      data: {
        clinicId: clinic.clinicId,
        mrn: `SU-${randomUUID().slice(0, 6)}`,
        firstName: 'Birinchi',
        lastName: 'Bemor',
        fullName: 'Birinchi Bemor',
      },
    });
    await request(app.getHttpServer())
      .patch(`${API}/clinic`)
      .set(auth(owner))
      .send({ address: 'Toshkent, Test 1', phone: '+998711234567' })
      .expect(200);

    const after = await request(app.getHttpServer())
      .get(`${API}/clinic/setup-status`)
      .set(auth(owner))
      .expect(200);
    expect(after.body.data.hasPricedService).toBe(true);
    expect(after.body.data.hasPatient).toBe(true);
    expect(after.body.data.profileComplete).toBe(true);
    expect(after.body.data.done).toBeGreaterThanOrEqual(4);
  });

  it('is not for the front desk', async () => {
    const recep = await login(app, clinic.receptionist.email);
    await request(app.getHttpServer())
      .get(`${API}/clinic/setup-status`)
      .set(auth(recep))
      .expect(403);
  });
});
