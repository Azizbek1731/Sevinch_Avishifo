/**
 * Spec §9.2 — CRITICAL: structural tenant isolation. Two fresh clinics, each
 * with its own patient; clinic A's staff must never see, edit or smuggle data
 * into clinic B (and vice versa).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import {
  API,
  createApp,
  createTestClinic,
  login,
  uniquePhone,
  type LoginResult,
  type TestClinic,
} from './setup';

describe('tenant isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let clinicA: TestClinic;
  let clinicB: TestClinic;
  let sessionA: LoginResult;
  let sessionB: LoginResult;
  let patientAId: string;
  let patientBId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createApp();
    const suffix = Date.now();
    clinicA = await createTestClinic(prisma, `tenA${suffix}`);
    clinicB = await createTestClinic(prisma, `tenB${suffix}`);
    sessionA = await login(app, clinicA.receptionist.email);
    sessionB = await login(app, clinicB.receptionist.email);

    const createdA = await request(app.getHttpServer())
      .post(`${API}/patients`)
      .set('Authorization', `Bearer ${sessionA.accessToken}`)
      .send({ firstName: 'Alisher', lastName: 'Aliyev', phone: uniquePhone() });
    expect(createdA.status).toBe(201);
    patientAId = createdA.body.data.id as string;

    const createdB = await request(app.getHttpServer())
      .post(`${API}/patients`)
      .set('Authorization', `Bearer ${sessionB.accessToken}`)
      .send({ firstName: 'Bobur', lastName: 'Boboyev', phone: uniquePhone() });
    expect(createdB.status).toBe(201);
    patientBId = createdB.body.data.id as string;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("GET /patients for clinic A lists only A's patients", async () => {
    const res = await request(app.getHttpServer())
      .get(`${API}/patients`)
      .set('Authorization', `Bearer ${sessionA.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const ids = (res.body.data as Array<{ id: string }>).map((p) => p.id);
    expect(ids).toContain(patientAId);
    expect(ids).not.toContain(patientBId);
    // Fresh clinic → exactly the one patient we created.
    expect(res.body.meta.total).toBe(1);
  });

  it("GET /patients/:id of B's patient from clinic A → 404", async () => {
    const res = await request(app.getHttpServer())
      .get(`${API}/patients/${patientBId}`)
      .set('Authorization', `Bearer ${sessionA.accessToken}`);

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, error: { code: 'PATIENT_NOT_FOUND' } });
  });

  it("PATCH on B's patient from clinic A → 404 and leaves the row untouched", async () => {
    const res = await request(app.getHttpServer())
      .patch(`${API}/patients/${patientBId}`)
      .set('Authorization', `Bearer ${sessionA.accessToken}`)
      .send({ firstName: 'Hacked' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PATIENT_NOT_FOUND');

    const row = await prisma.patient.findUniqueOrThrow({ where: { id: patientBId } });
    expect(row.firstName).toBe('Bobur');
    expect(row.clinicId).toBe(clinicB.clinicId);
  });

  it("DELETE on B's patient from clinic A → 404 (owner privileges do not help)", async () => {
    const ownerA = await login(app, clinicA.owner.email);
    const res = await request(app.getHttpServer())
      .delete(`${API}/patients/${patientBId}`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(res.status).toBe(404);

    const row = await prisma.patient.findUniqueOrThrow({ where: { id: patientBId } });
    expect(row.deletedAt).toBeNull();
  });

  it('POST /patients with a smuggled clinicId still lands in the caller clinic', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/patients`)
      .set('Authorization', `Bearer ${sessionA.accessToken}`)
      .send({
        firstName: 'Smuggler',
        lastName: 'Test',
        phone: uniquePhone(),
        clinicId: clinicB.clinicId, // hostile field — must be ignored
      });

    expect(res.status).toBe(201);
    const id = res.body.data.id as string;

    const row = await prisma.patient.findUniqueOrThrow({ where: { id } });
    expect(row.clinicId).toBe(clinicA.clinicId);
    expect(row.clinicId).not.toBe(clinicB.clinicId);

    // Clinic B cannot see it either.
    const fromB = await request(app.getHttpServer())
      .get(`${API}/patients/${id}`)
      .set('Authorization', `Bearer ${sessionB.accessToken}`);
    expect(fromB.status).toBe(404);
  });

  it('cross-tenant search does not leak rows', async () => {
    const res = await request(app.getHttpServer())
      .get(`${API}/patients`)
      .query({ search: 'Bobur' })
      .set('Authorization', `Bearer ${sessionA.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});
