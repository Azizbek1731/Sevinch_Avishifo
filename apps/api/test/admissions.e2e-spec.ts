import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { API, createApp, createTestClinic, login, type LoginResult, type TestClinic } from './setup';

/**
 * Statsionar care, and the charge ledger both care types are billed from.
 *
 * The properties that matter are about money and about honesty on the
 * treatment sheet: a service marked GIVEN becomes payable, a service the
 * patient refused is recorded as refused and billed to nobody, and the desk
 * can bill any subset of what is owed — because some patients pay on arrival,
 * some at discharge, and most somewhere in between.
 */
describe('admissions and charges (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let clinic: TestClinic;
  let owner: LoginResult;
  let doctor: LoginResult;
  let recep: LoginResult;
  let cashier: LoginResult;
  let patientId: string;
  let serviceId: string;
  let admissionId: string;

  const auth = (t: LoginResult) => ({ Authorization: `Bearer ${t.accessToken}`, 'x-branch-id': clinic.branchId });
  const day = (offset = 0) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createApp();
    clinic = await createTestClinic(prisma, 'adm');
    owner = await login(app, clinic.owner.email);
    doctor = await login(app, clinic.doctor.email);
    recep = await login(app, clinic.receptionist.email);
    cashier = await login(app, clinic.cashier.email);

    const patient = await prisma.patient.create({
      data: {
        clinicId: clinic.clinicId,
        mrn: `AD-${randomUUID().slice(0, 6)}`,
        firstName: 'Statsionar',
        lastName: 'Bemor',
        fullName: 'Statsionar Bemor',
        gender: 'MALE',
      },
    });
    patientId = patient.id;

    const cat = await request(app.getHttpServer())
      .post(`${API}/service-categories`)
      .set(auth(owner))
      .send({ name: 'Muolaja', kind: 'PROCEDURE' })
      .expect(201);
    const svc = await request(app.getHttpServer())
      .post(`${API}/services`)
      .set(auth(owner))
      .send({
        categoryId: cat.body.data.id as string,
        code: `AD-${clinic.tag}`,
        name: { uz: 'Ukol' },
        durationMin: 10,
        price: '50000.00',
      })
      .expect(201);
    serviceId = svc.body.data.id as string;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ------------------------------------------------------------- admission

  it('admits a patient, numbers the history and flips them to inpatient', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/admissions`)
      .set(auth(recep))
      .send({ patientId, department: 'Terapiya', ward: '3', bed: '2', admissionDiagnosis: 'Pnevmoniya' })
      .expect(201);
    admissionId = res.body.data.id as string;
    expect(res.body.data.historyNumber).toMatch(/^KT-\d{4}-\d{4}$/);
    expect(res.body.data.status).toBe('ACTIVE');

    const p = await prisma.patient.findUniqueOrThrow({ where: { id: patientId } });
    expect(p.careType).toBe('INPATIENT');
  });

  it('refuses a second stay while one is open', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/admissions`)
      .set(auth(recep))
      .send({ patientId });
    expect(res.status).toBe(409);
  });

  it('stores the 003 narrative the doctor writes', async () => {
    await request(app.getHttpServer())
      .patch(`${API}/admissions/${admissionId}`)
      .set(auth(doctor))
      .send({
        complaints: 'Yo‘tal, nafas qisishi',
        anamnesisMorbi: '3 kun oldin boshlangan',
        objectiveStatus: 'Umumiy ahvoli o‘rtacha og‘ir',
        preliminaryDiagnosis: 'O‘ng tomonlama pnevmoniya',
        clinicalDiagnosis: 'J18.9',
        clinicalDiagnosisAt: day(0),
      })
      .expect(200);

    const got = await request(app.getHttpServer())
      .get(`${API}/admissions/${admissionId}`)
      .set(auth(doctor))
      .expect(200);
    expect(got.body.data.complaints).toContain('Yo‘tal');
    expect(got.body.data.clinicalDiagnosisAt).toBe(day(0));
  });

  // -------------------------------------------------------- treatment sheet

  it('lays out an every-other-day order as a grid of planned dates', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/admissions/${admissionId}/orders`)
      .set(auth(doctor))
      .send({ serviceId, schedule: 'EVERY_OTHER_DAY', startDate: day(0), timesPlanned: 3 })
      .expect(201);
    expect(res.body.data.days).toEqual([day(0), day(2), day(4)]);
  });

  it('bills a day only once it is marked given, and never for a refused one', async () => {
    const admission = await request(app.getHttpServer())
      .get(`${API}/admissions/${admissionId}`)
      .set(auth(doctor))
      .expect(200);
    const orderId = admission.body.data.orders[0].id as string;

    // The nurse reports; the desk marks it off.
    await request(app.getHttpServer())
      .post(`${API}/admissions/${admissionId}/administrations`)
      .set(auth(recep))
      .send({ orderId, date: day(0), status: 'GIVEN' })
      .expect(201);

    // The patient declined the second one — recorded, not billed.
    await request(app.getHttpServer())
      .post(`${API}/admissions/${admissionId}/administrations`)
      .set(auth(recep))
      .send({ orderId, date: day(2), status: 'SKIPPED' })
      .expect(201);

    const charges = await request(app.getHttpServer())
      .get(`${API}/charges`)
      .set(auth(cashier))
      .query({ patientId })
      .expect(200);
    const pending = (charges.body.data.items as Array<{ status: string; date: string }>).filter(
      (c) => c.status === 'PENDING',
    );
    expect(pending).toHaveLength(1);
    expect(pending[0]!.date).toBe(day(0));
    expect(charges.body.data.pendingTotal).toBe('50000.00');

    // The sheet still shows the refusal, which is the point of storing it.
    const after = await request(app.getHttpServer())
      .get(`${API}/admissions/${admissionId}`)
      .set(auth(doctor))
      .expect(200);
    const days = after.body.data.orders[0].days as Array<{ date: string; status: string | null }>;
    expect(days.find((d) => d.date === day(2))!.status).toBe('SKIPPED');
    expect(days.find((d) => d.date === day(4))!.status).toBeNull();
  });

  it('refuses a date that is not on the order schedule', async () => {
    const admission = await request(app.getHttpServer())
      .get(`${API}/admissions/${admissionId}`)
      .set(auth(doctor))
      .expect(200);
    const orderId = admission.body.data.orders[0].id as string;
    const res = await request(app.getHttpServer())
      .post(`${API}/admissions/${admissionId}/administrations`)
      .set(auth(recep))
      .send({ orderId, date: day(1), status: 'GIVEN' });
    expect(res.status).toBe(400);
  });

  it('cancels the charge when a given day is corrected to refused', async () => {
    const admission = await request(app.getHttpServer())
      .get(`${API}/admissions/${admissionId}`)
      .set(auth(doctor))
      .expect(200);
    const orderId = admission.body.data.orders[0].id as string;

    await request(app.getHttpServer())
      .post(`${API}/admissions/${admissionId}/administrations`)
      .set(auth(recep))
      .send({ orderId, date: day(0), status: 'SKIPPED' })
      .expect(201);

    const charges = await request(app.getHttpServer())
      .get(`${API}/charges`)
      .set(auth(cashier))
      .query({ patientId })
      .expect(200);
    expect(charges.body.data.pendingTotal).toBe('0.00');

    // Put it back for the billing tests below.
    await request(app.getHttpServer())
      .post(`${API}/admissions/${admissionId}/administrations`)
      .set(auth(recep))
      .send({ orderId, date: day(0), status: 'GIVEN' })
      .expect(201);
  });

  // -------------------------------------------------------- partial billing

  it('bills only the ticked services and leaves the rest owing', async () => {
    // Two more charges written directly, as at an outpatient desk.
    for (const d of [day(-2), day(-1)]) {
      await request(app.getHttpServer())
        .post(`${API}/charges`)
        .set(auth(recep))
        .send({ patientId, serviceId, date: d, quantity: 1 })
        .expect(201);
    }

    const before = await request(app.getHttpServer())
      .get(`${API}/charges`)
      .set(auth(cashier))
      .query({ patientId, status: 'PENDING' })
      .expect(200);
    const items = before.body.data.items as Array<{ id: string; date: string; admissionId: string | null }>;
    expect(items).toHaveLength(3);
    expect(before.body.data.pendingTotal).toBe('150000.00');

    // Pay for the two walk-in services now and leave the ward treatment
    // owing — the common case: the consultation is settled at the desk, the
    // stay is settled at discharge.
    const walkIns = items.filter((i) => i.admissionId === null);
    expect(walkIns).toHaveLength(2);
    const res = await request(app.getHttpServer())
      .post(`${API}/charges/invoice`)
      .set(auth(cashier))
      .send({ chargeIds: walkIns.map((i) => i.id) })
      .expect(201);
    expect(res.body.data.total).toBe('100000.00');

    const after = await request(app.getHttpServer())
      .get(`${API}/charges`)
      .set(auth(cashier))
      .query({ patientId, status: 'PENDING' })
      .expect(200);
    const left = after.body.data.items as Array<{ admissionId: string | null }>;
    expect(left).toHaveLength(1);
    expect(left[0]!.admissionId).toBe(admissionId);
    expect(after.body.data.pendingTotal).toBe('50000.00');
  });

  it('refuses to bill a service that is already on an invoice', async () => {
    const invoiced = await prisma.chargeItem.findFirstOrThrow({
      where: { patientId, status: 'INVOICED' },
    });
    const res = await request(app.getHttpServer())
      .post(`${API}/charges/invoice`)
      .set(auth(cashier))
      .send({ chargeIds: [invoiced.id] });
    expect(res.status).toBe(400);
  });

  // ------------------------------------------------------------- discharge

  it('refuses discharge while this stay has unbilled services', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/admissions/${admissionId}/discharge`)
      .set(auth(doctor))
      .send({ outcome: 'RECOVERED', finalDiagnosisMain: 'J18.9 Pnevmoniya' });
    expect(res.status).toBe(409);
  });

  it('discharges once everything is billed, and returns the patient to ambulatory', async () => {
    const rest = await request(app.getHttpServer())
      .get(`${API}/charges`)
      .set(auth(cashier))
      .query({ patientId, status: 'PENDING' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`${API}/charges/invoice`)
      .set(auth(cashier))
      .send({ chargeIds: (rest.body.data.items as Array<{ id: string }>).map((i) => i.id) })
      .expect(201);

    await request(app.getHttpServer())
      .post(`${API}/admissions/${admissionId}/discharge`)
      .set(auth(doctor))
      .send({
        outcome: 'RECOVERED',
        finalDiagnosisMain: 'J18.9 O‘ng tomonlama pnevmoniya',
        epicrisis: 'Ahvoli yaxshilandi, uyga chiqarildi',
      })
      .expect(201);

    const p = await prisma.patient.findUniqueOrThrow({ where: { id: patientId } });
    expect(p.careType).toBe('AMBULATORY');

    // A discharged history is closed to edits.
    const res = await request(app.getHttpServer())
      .patch(`${API}/admissions/${admissionId}`)
      .set(auth(doctor))
      .send({ complaints: 'kech qoldi' });
    expect(res.status).toBe(409);
  });

  it('will not let a billed treatment day be un-marked', async () => {
    // Runs after discharge billed the ward treatment: money already on an
    // invoice is not the sheet's to take back.
    const invoiced = await prisma.chargeItem.findFirstOrThrow({
      where: { patientId, status: 'INVOICED', administrationId: { not: null } },
      include: { administration: true },
    });
    const res = await request(app.getHttpServer())
      .post(`${API}/admissions/${admissionId}/administrations`)
      .set(auth(recep))
      .send({ orderId: invoiced.administration!.orderId, date: day(0), status: 'SKIPPED' });
    // The stay is discharged, so the history is closed — either answer is a
    // refusal, and both are the correct one.
    expect([409, 400]).toContain(res.status);
  });

  it('builds the 003 print payload with the form fields and the marked sheet', async () => {
    const res = await request(app.getHttpServer())
      .get(`${API}/admissions/${admissionId}/print`)
      .set(auth(doctor))
      .expect(200);

    const d = res.body.data as {
      clinic: { name: string };
      admission: Record<string, unknown>;
      patient: { fullName: string; mrn: string };
      orders: Array<{ days: Array<{ date: string; status: string | null }> }>;
    };
    // The letterhead and the identity block the paper form asks for.
    expect(d.clinic.name).toBeTruthy();
    expect(d.patient.fullName).toBe('Statsionar Bemor');
    expect(d.admission.historyNumber).toMatch(/^KT-/);
    // Bed-days: the day of admission counts, so a same-day stay is 1, never 0.
    expect(Number(d.admission.bedDays)).toBeGreaterThanOrEqual(1);
    // The sheet carries its marks, including the refusal — that is the whole
    // reason it is printed rather than re-derived.
    const marks = d.orders.flatMap((o) => o.days.map((x) => x.status));
    expect(marks).toContain('SKIPPED');
  });

  it('builds the 025 card payload with the title page and every visit', async () => {
    const res = await request(app.getHttpServer())
      .get(`${API}/patients/${patientId}/card-print`)
      .set(auth(doctor))
      .expect(200);

    const d = res.body.data as {
      clinic: { name: string };
      patient: { mrn: string; fullName: string; bloodGroup: string };
      visits: unknown[];
    };
    expect(d.clinic.name).toBeTruthy();
    expect(d.patient.mrn).toBeTruthy();
    expect(Array.isArray(d.visits)).toBe(true);
  });

  it('lets the cash desk read the ward list without letting it write the history', async () => {
    await request(app.getHttpServer()).get(`${API}/admissions`).set(auth(cashier)).expect(200);
    await request(app.getHttpServer())
      .post(`${API}/admissions`)
      .set(auth(cashier))
      .send({ patientId })
      .expect(403);
  });
});
