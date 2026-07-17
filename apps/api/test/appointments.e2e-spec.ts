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

const TK_OFFSET_MS = 5 * 3_600_000; // Asia/Tashkent = UTC+5, no DST

/** Tashkent calendar date string N days from now. */
function tkDateStr(offsetDays: number): string {
  return new Date(Date.now() + TK_OFFSET_MS + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

function isoWeekday(dateStr: string): number {
  const dow = new Date(`${dateStr}T00:00:00.000Z`).getUTCDay();
  return dow === 0 ? 7 : dow;
}

describe('appointments (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let clinic: TestClinic;
  let recep: LoginResult;
  let patient1Id: string;
  let patient2Id: string;
  let date: string;
  let firstSlotStart: string;
  let appointmentId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createApp();
    clinic = await createTestClinic(prisma, `appt${Date.now()}`);
    recep = await login(app, clinic.receptionist.email);

    // Fully-future working day (≥2 days ahead, Mon-Fri) with a 09:00-12:00 window.
    let offset = 2;
    while (isoWeekday(tkDateStr(offset)) > 5) offset += 1;
    date = tkDateStr(offset);
    await prisma.doctorSchedule.create({
      data: {
        clinicId: clinic.clinicId,
        branchId: clinic.branchId,
        doctorUserId: clinic.doctor.id,
        weekday: isoWeekday(date),
        startTime: '09:00',
        endTime: '12:00',
        slotMinutes: 30,
      },
    });

    const mkPatient = async (first: string) => {
      const res = await request(app.getHttpServer())
        .post(`${API}/patients`)
        .set('Authorization', `Bearer ${recep.accessToken}`)
        .send({ firstName: first, lastName: 'Apptov', phone: uniquePhone() });
      expect(res.status).toBe(201);
      return res.body.data.id as string;
    };
    patient1Id = await mkPatient('Birinchi');
    patient2Id = await mkPatient('Ikkinchi');
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('GET /appointments/slots returns the free grid from the schedule', async () => {
    const res = await request(app.getHttpServer())
      .get(`${API}/appointments/slots`)
      .query({ doctorUserId: clinic.doctor.id, branchId: clinic.branchId, date })
      .set('Authorization', `Bearer ${recep.accessToken}`);

    expect(res.status).toBe(200);
    const slots = res.body.data as Array<{ startAt: string; endAt: string }>;
    expect(slots).toHaveLength(6); // 09:00-12:00 / 30min
    // 09:00 Tashkent = 04:00Z on the same calendar date.
    expect(slots[0]).toEqual({
      startAt: `${date}T04:00:00.000Z`,
      endAt: `${date}T04:30:00.000Z`,
    });
    firstSlotStart = slots[0]!.startAt;
  });

  it('POST /appointments books the slot', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/appointments`)
      .set('Authorization', `Bearer ${recep.accessToken}`)
      .send({
        patientId: patient1Id,
        branchId: clinic.branchId,
        doctorUserId: clinic.doctor.id,
        startAt: firstSlotStart,
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      status: 'SCHEDULED',
      patientId: patient1Id,
      doctorUserId: clinic.doctor.id,
      startAt: firstSlotStart,
      endAt: `${date}T04:30:00.000Z`, // schedule slotMinutes = 30
    });
    appointmentId = res.body.data.id as string;
  });

  it('the booked slot disappears from the free grid', async () => {
    const res = await request(app.getHttpServer())
      .get(`${API}/appointments/slots`)
      .query({ doctorUserId: clinic.doctor.id, branchId: clinic.branchId, date })
      .set('Authorization', `Bearer ${recep.accessToken}`);
    const starts = (res.body.data as Array<{ startAt: string }>).map((s) => s.startAt);
    expect(starts).toHaveLength(5);
    expect(starts).not.toContain(firstSlotStart);
  });

  it('rebooking the same slot → 409 APPOINTMENT_CONFLICT', async () => {
    // walkIn bypasses the free-slot grid and hits the row-locked overlap guard.
    const res = await request(app.getHttpServer())
      .post(`${API}/appointments`)
      .set('Authorization', `Bearer ${recep.accessToken}`)
      .send({
        patientId: patient2Id,
        branchId: clinic.branchId,
        doctorUserId: clinic.doctor.id,
        startAt: firstSlotStart,
        walkIn: true,
      });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ success: false, error: { code: 'APPOINTMENT_CONFLICT' } });
  });

  it('a scheduled rebook of an occupied slot is rejected as outside the free grid', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/appointments`)
      .set('Authorization', `Bearer ${recep.accessToken}`)
      .send({
        patientId: patient2Id,
        branchId: clinic.branchId,
        doctorUserId: clinic.doctor.id,
        startAt: firstSlotStart,
      });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SLOT_OUTSIDE_SCHEDULE');
  });

  it('walks the status machine SCHEDULED → CONFIRMED → CHECKED_IN', async () => {
    const confirm = await request(app.getHttpServer())
      .post(`${API}/appointments/${appointmentId}/status`)
      .set('Authorization', `Bearer ${recep.accessToken}`)
      .send({ status: 'CONFIRMED' });
    expect(confirm.status).toBe(201);
    expect(confirm.body.data.status).toBe('CONFIRMED');

    const checkin = await request(app.getHttpServer())
      .post(`${API}/appointments/${appointmentId}/status`)
      .set('Authorization', `Bearer ${recep.accessToken}`)
      .send({ status: 'CHECKED_IN' });
    expect(checkin.status).toBe(201);
    expect(checkin.body.data.status).toBe('CHECKED_IN');
  });

  it('an illegal jump → 409 INVALID_STATUS_TRANSITION', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/appointments/${appointmentId}/status`)
      .set('Authorization', `Bearer ${recep.accessToken}`)
      .send({ status: 'COMPLETED' }); // CHECKED_IN may only go to IN_QUEUE

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      success: false,
      error: { code: 'INVALID_STATUS_TRANSITION' },
    });

    const fresh = await request(app.getHttpServer())
      .get(`${API}/appointments/${appointmentId}`)
      .set('Authorization', `Bearer ${recep.accessToken}`);
    expect(fresh.body.data.status).toBe('CHECKED_IN'); // unchanged
  });

  it('booking outside any schedule window → 409 SLOT_OUTSIDE_SCHEDULE', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/appointments`)
      .set('Authorization', `Bearer ${recep.accessToken}`)
      .send({
        patientId: patient2Id,
        branchId: clinic.branchId,
        doctorUserId: clinic.doctor.id,
        startAt: `${date}T15:00:00.000Z`, // 20:00 Tashkent — after hours
      });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SLOT_OUTSIDE_SCHEDULE');
  });
});
