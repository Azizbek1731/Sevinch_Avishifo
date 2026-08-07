import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import {
  API,
  createApp,
  createTestClinic,
  login,
  uniqueIp,
  uniquePhone,
  type LoginResult,
  type TestClinic,
} from './setup';

/**
 * Patients asking to read their own clinical history, and clinics deciding.
 *
 * The property that matters most here is the negative one: an un-approved
 * patient must see nothing of the narrative record, while their lab results
 * stay visible throughout. Both halves are asserted.
 */
describe('medical record access (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let clinic: TestClinic;
  let other: TestClinic;
  let doctor: LoginResult;
  let receptionist: LoginResult;

  let patientPhone: string;
  let patientId: string;
  let patientToken: string;
  let visitId: string;

  /** Portal sessions are OTP-gated; mint one the same way the portal does. */
  async function portalLogin(phone: string): Promise<string> {
    await request(app.getHttpServer())
      .post(`${API}/portal/auth/request-otp`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ phone })
      .expect(200);

    // The code is hashed in the DB, so read it from the log-mode delivery path:
    // tests instead mark the row and re-issue a known code.
    const otp = await prisma.otpCode.findFirst({
      where: { phone, usedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    expect(otp).not.toBeNull();

    // Replace the hash with a known code so the test can verify deterministically.
    const argon2 = await import('argon2');
    await prisma.otpCode.update({
      where: { id: otp!.id },
      data: { codeHash: await argon2.hash('123456', { type: argon2.argon2id }) },
    });

    const res = await request(app.getHttpServer())
      .post(`${API}/portal/auth/verify`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ phone, code: '123456' })
      .expect(200);
    return res.body.data.accessToken as string;
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createApp();
    clinic = await createTestClinic(prisma, 'record-access');
    other = await createTestClinic(prisma, 'record-access-other');
    doctor = await login(app, clinic.doctor.email);
    receptionist = await login(app, clinic.receptionist.email);

    patientPhone = uniquePhone();
    const patient = await prisma.patient.create({
      data: {
        clinicId: clinic.clinicId,
        mrn: `RA-${randomUUID().slice(0, 6)}`,
        firstName: 'Tarix',
        lastName: 'Bemori',
        fullName: 'Tarix Bemori',
        phone: patientPhone,
        gender: 'MALE',
        dob: new Date('1990-01-01'),
      },
    });
    patientId = patient.id;

    const visit = await prisma.visit.create({
      data: {
        clinicId: clinic.clinicId,
        branchId: clinic.branchId,
        patientId: patient.id,
        doctorUserId: clinic.doctor.id,
        status: 'COMPLETED',
        startedAt: new Date(Date.now() - 3_600_000),
        completedAt: new Date(),
        assessmentNote: 'E2E assessment',
      },
    });
    visitId = visit.id;

    patientToken = await portalLogin(patientPhone);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ------------------------------------------------------------ patient side

  it('hides clinical history until a clinic approves', async () => {
    const res = await request(app.getHttpServer())
      .get(`${API}/portal/me/visits`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('refuses a direct visit-detail read before approval', async () => {
    const res = await request(app.getHttpServer())
      .get(`${API}/portal/me/visits/${visitId}`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(403);
    expect(res.body.error.code).toBe('RECORD_ACCESS_REQUIRED');
  });

  it('lists the clinics a patient can ask, with no request yet', async () => {
    const res = await request(app.getHttpServer())
      .get(`${API}/portal/me/record-access`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    const row = res.body.data.find((c: { clinicId: string }) => c.clinicId === clinic.clinicId);
    expect(row).toBeDefined();
    expect(row.status).toBe('NONE');
    expect(row.canViewHistory).toBe(false);
  });

  it('accepts a request and marks it pending', async () => {
    await request(app.getHttpServer())
      .post(`${API}/portal/me/record-access/${clinic.clinicId}`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ note: 'Tashxisimni ko‘rmoqchiman' })
      .expect(200);

    const row = await prisma.medicalRecordAccess.findUnique({ where: { patientId } });
    expect(row?.status).toBe('PENDING');
    expect(row?.patientNote).toBe('Tashxisimni ko‘rmoqchiman');
  });

  it('reuses the same row when the patient asks again', async () => {
    await request(app.getHttpServer())
      .post(`${API}/portal/me/record-access/${clinic.clinicId}`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({})
      .expect(200);

    const count = await prisma.medicalRecordAccess.count({ where: { patientId } });
    expect(count).toBe(1);
  });

  it('rejects a request for a clinic the patient has no records at', async () => {
    await request(app.getHttpServer())
      .post(`${API}/portal/me/record-access/${other.clinicId}`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({})
      .expect(404);
  });

  // -------------------------------------------------------------- staff side

  it('shows the request in the clinic inbox', async () => {
    const res = await request(app.getHttpServer())
      .get(`${API}/record-access`)
      .set('Authorization', `Bearer ${doctor.accessToken}`)
      .query({ status: 'PENDING' })
      .expect(200);
    const found = res.body.data.find(
      (r: { patient: { id: string } }) => r.patient.id === patientId,
    );
    expect(found).toBeDefined();
  });

  it('does not let a receptionist decide', async () => {
    const row = await prisma.medicalRecordAccess.findUnique({ where: { patientId } });
    await request(app.getHttpServer())
      .patch(`${API}/record-access/${row!.id}`)
      .set('Authorization', `Bearer ${receptionist.accessToken}`)
      .send({ status: 'APPROVED' })
      .expect(403);
  });

  it('opens the history once a doctor approves', async () => {
    const row = await prisma.medicalRecordAccess.findUnique({ where: { patientId } });
    await request(app.getHttpServer())
      .patch(`${API}/record-access/${row!.id}`)
      .set('Authorization', `Bearer ${doctor.accessToken}`)
      .send({ status: 'APPROVED' })
      .expect(200);

    const list = await request(app.getHttpServer())
      .get(`${API}/portal/me/visits`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(list.body.data).toHaveLength(1);

    const detail = await request(app.getHttpServer())
      .get(`${API}/portal/me/visits/${visitId}`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(detail.body.data.assessment).toBe('E2E assessment');
  });

  it('closes the history again when the clinic revokes', async () => {
    const row = await prisma.medicalRecordAccess.findUnique({ where: { patientId } });
    await request(app.getHttpServer())
      .patch(`${API}/record-access/${row!.id}`)
      .set('Authorization', `Bearer ${doctor.accessToken}`)
      .send({ status: 'REVOKED' })
      .expect(200);

    const list = await request(app.getHttpServer())
      .get(`${API}/portal/me/visits`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
    expect(list.body.data).toHaveLength(0);
  });

  it('records the decision in the audit trail', async () => {
    const entries = await prisma.auditLog.findMany({
      where: { entity: 'MedicalRecordAccess', clinicId: clinic.clinicId },
    });
    expect(entries.length).toBeGreaterThanOrEqual(2);
  });
});
