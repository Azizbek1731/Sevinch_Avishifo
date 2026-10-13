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
  type LoginResult,
  type TestClinic,
} from './setup';

/** New ward orders and manual costs reach the cashier immediately. Clinical
 * administration remains an honest, optional record and never bills twice. */
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
  let historyNumber: string;
  let stayInvoiceId: string;
  let treatmentOrderId: string;

  const auth = (t: LoginResult) => ({
    Authorization: `Bearer ${t.accessToken}`,
    'x-branch-id': clinic.branchId,
  });
  const day = (offset = 0) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };

  const invoiceForCharge = async (chargeId: string) => {
    const charge = await prisma.chargeItem.findUniqueOrThrow({ where: { id: chargeId } });
    expect(charge.status).toBe('INVOICED');
    const line = await prisma.invoiceLine.findUniqueOrThrow({
      where: { id: charge.invoiceLineId! },
      include: { invoice: true },
    });
    return line.invoice;
  };
  const pendingInvoices = async (id = patientId) => {
    const result = await request(app.getHttpServer())
      .get(`${API}/invoices`)
      .set(auth(cashier))
      .query({ pending: true, patientId: id })
      .expect(200);
    return result.body.data as Array<{ id: string; total: string; due: string; status: string }>;
  };

  beforeAll(async () => {
    if (
      new URL(process.env.DATABASE_URL ?? '').pathname !== '/avishifo_finance_migration' ||
      process.env.TELEGRAM_ENABLED !== 'false'
    ) {
      throw new Error('Use isolated avishifo_finance_migration with Telegram disabled');
    }
    prisma = new PrismaClient();
    app = await createApp([]);
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
      .send({
        patientId,
        department: 'Terapiya',
        ward: '3',
        bed: '2',
        admissionDiagnosis: 'Pnevmoniya',
      })
      .expect(201);
    admissionId = res.body.data.id as string;
    expect(res.body.data.historyNumber).toMatch(/^KT-\d{4}-\d{4}$/);
    historyNumber = res.body.data.historyNumber as string;
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

  // -------------------------------------------------------- immediate billing

  it('creates a scheduled order and an issued cashier invoice without marking treatment given', async () => {
    const payload = {
      serviceId,
      schedule: 'EVERY_OTHER_DAY',
      startDate: day(0),
      timesPlanned: 3,
      idempotencyKey: randomUUID(),
    };
    const results = await Promise.all(
      [1, 2].map(() =>
        request(app.getHttpServer())
          .post(`${API}/admissions/${admissionId}/orders`)
          .set(auth(recep))
          .send(payload),
      ),
    );
    for (const result of results) expect(result.status, JSON.stringify(result.body)).toBe(201);
    const res = results[0]!;
    treatmentOrderId = res.body.data.id as string;
    expect(results[1]!.body.data.id).toBe(treatmentOrderId);
    expect(res.body.data.days).toEqual([day(0), day(2), day(4)]);
    expect(await prisma.treatmentOrder.count({ where: { admissionId } })).toBe(1);
    expect(
      await prisma.treatmentAdministration.count({ where: { orderId: treatmentOrderId } }),
    ).toBe(0);
    const charges = await prisma.chargeItem.findMany({ where: { admissionId } });
    expect(charges).toHaveLength(1);
    expect(charges[0]!.quantity).toBe(3);
    expect(charges[0]!.administrationId).toBeNull();
    const invoice = await invoiceForCharge(charges[0]!.id);
    stayInvoiceId = invoice.id;
    expect(invoice.total.toFixed(2)).toBe('150000.00');
    expect(await pendingInvoices()).toEqual([
      expect.objectContaining({ id: invoice.id, due: '150000.00', status: 'ISSUED' }),
    ]);
    const changed = await request(app.getHttpServer())
      .post(`${API}/admissions/${admissionId}/orders`)
      .set(auth(recep))
      .send({ ...payload, timesPlanned: 4 });
    expect(changed.status).toBe(409);
    expect(await prisma.invoice.count({ where: { patientId } })).toBe(1);
  });

  it('bills all planned doses once while leaving clinical administration untouched', async () => {
    const p = await prisma.patient.create({
      data: {
        clinicId: clinic.clinicId,
        mrn: randomUUID(),
        firstName: 'Ikki',
        lastName: 'Mahal',
        fullName: 'Ikki Mahal',
      },
    });
    const admitted = await request(app.getHttpServer())
      .post(`${API}/admissions`)
      .set(auth(recep))
      .send({ patientId: p.id })
      .expect(201);
    const stay = admitted.body.data.id as string;
    const order = await request(app.getHttpServer())
      .post(`${API}/admissions/${stay}/orders`)
      .set(auth(recep))
      .send({
        serviceId,
        schedule: 'DAILY',
        startDate: day(0),
        timesPlanned: 2,
        timesPerDay: 2,
        idempotencyKey: randomUUID(),
      })
      .expect(201);
    const orderId = order.body.data.id as string;
    const charges = await prisma.chargeItem.findMany({ where: { admissionId: stay } });
    expect(charges).toHaveLength(1);
    expect(charges[0]!.quantity).toBe(4);
    expect((await invoiceForCharge(charges[0]!.id)).total.toFixed(2)).toBe('200000.00');
    expect(await prisma.treatmentAdministration.count({ where: { orderId } })).toBe(0);
    for (const slot of [1, 2, 1]) {
      await request(app.getHttpServer())
        .post(`${API}/admissions/${stay}/administrations`)
        .set(auth(recep))
        .send({ orderId, date: day(0), slot, status: 'GIVEN' })
        .expect(201);
    }
    expect(await prisma.treatmentAdministration.count({ where: { orderId } })).toBe(2);
    expect(await prisma.chargeItem.count({ where: { admissionId: stay } })).toBe(1);
    expect(await prisma.invoice.count({ where: { patientId: p.id } })).toBe(1);
    expect(await pendingInvoices(p.id)).toEqual([expect.objectContaining({ due: '200000.00' })]);
  });

  it('keeps clinical corrections separate from the already issued bill', async () => {
    for (const status of ['GIVEN', 'SKIPPED']) {
      await request(app.getHttpServer())
        .post(`${API}/admissions/${admissionId}/administrations`)
        .set(auth(recep))
        .send({ orderId: treatmentOrderId, date: day(0), status })
        .expect(201);
    }
    expect(await prisma.chargeItem.count({ where: { admissionId } })).toBe(1);
    expect(await prisma.invoice.count({ where: { patientId } })).toBe(1);
    expect(await pendingInvoices()).toEqual([expect.objectContaining({ due: '150000.00' })]);
    const after = await request(app.getHttpServer())
      .get(`${API}/admissions/${admissionId}`)
      .set(auth(doctor))
      .expect(200);
    expect(after.body.data.orders[0].days[0].slots[0].status).toBe('SKIPPED');
    expect(after.body.data.orders[0].days[1].slots[0].status).toBeNull();
  });

  it('rejects off-schedule clinical marks and invalid orders without creating bills', async () => {
    await request(app.getHttpServer())
      .post(`${API}/admissions/${admissionId}/administrations`)
      .set(auth(recep))
      .send({ orderId: treatmentOrderId, date: day(1), status: 'GIVEN' })
      .expect(400);
    const before = await prisma.invoice.count({ where: { patientId } });
    await request(app.getHttpServer())
      .post(`${API}/admissions/${admissionId}/orders`)
      .set(auth(recep))
      .send({ serviceId, schedule: 'DAILY', startDate: day(0), timesPlanned: 0 })
      .expect(400);
    expect(await prisma.invoice.count({ where: { patientId } })).toBe(before);
    expect(await prisma.treatmentOrder.count({ where: { admissionId } })).toBe(1);
  });

  it('rolls the new order and charge back when invoice issuance rejects an oversized total', async () => {
    const categoryId = (await prisma.service.findUniqueOrThrow({ where: { id: serviceId } }))
      .categoryId;
    const expensive = await prisma.service.create({
      data: {
        clinicId: clinic.clinicId,
        categoryId,
        code: randomUUID(),
        name: { uz: 'Overflow fixture' },
        prices: {
          create: {
            clinicId: clinic.clinicId,
            price: '999999999999.99',
            effectiveFrom: new Date('2020-01-01'),
          },
        },
      },
    });
    const before = await Promise.all([
      prisma.treatmentOrder.count({ where: { admissionId } }),
      prisma.chargeItem.count({ where: { admissionId } }),
      prisma.invoice.count({ where: { patientId } }),
    ]);
    const failed = await request(app.getHttpServer())
      .post(`${API}/admissions/${admissionId}/orders`)
      .set(auth(recep))
      .send({
        serviceId: expensive.id,
        schedule: 'DAILY',
        startDate: day(0),
        timesPlanned: 2,
        idempotencyKey: randomUUID(),
      });
    expect(failed.status, JSON.stringify(failed.body)).toBe(400);
    expect(
      await Promise.all([
        prisma.treatmentOrder.count({ where: { admissionId } }),
        prisma.chargeItem.count({ where: { admissionId } }),
        prisma.invoice.count({ where: { patientId } }),
      ]),
    ).toEqual(before);
  });

  it('automatically issues manual costs and does not duplicate the same concurrent submission', async () => {
    const payload = {
      patientId,
      serviceId,
      date: day(-1),
      quantity: 1,
      idempotencyKey: randomUUID(),
    };
    const results = await Promise.all(
      [1, 2].map(() =>
        request(app.getHttpServer()).post(`${API}/charges`).set(auth(recep)).send(payload),
      ),
    );
    for (const result of results) expect(result.status, JSON.stringify(result.body)).toBe(201);
    expect(results[0]!.body.data.id).toBe(results[1]!.body.data.id);
    const invoice = await invoiceForCharge(results[0]!.body.data.id as string);
    expect(invoice.total.toFixed(2)).toBe('50000.00');
    expect(await pendingInvoices()).toContainEqual(
      expect.objectContaining({ id: invoice.id, due: '50000.00' }),
    );
    const changed = await request(app.getHttpServer())
      .post(`${API}/charges`)
      .set(auth(recep))
      .send({ ...payload, quantity: 2 });
    expect(changed.status).toBe(409);
    await prisma.servicePrice.updateMany({ where: { serviceId }, data: { price: '55000' } });
    try {
      const replay = await request(app.getHttpServer())
        .post(`${API}/charges`)
        .set(auth(recep))
        .send(payload)
        .expect(201);
      expect(replay.body.data.id).toBe(results[0]!.body.data.id);
      expect(replay.body.data.unitPrice).toBe('50000.00');
    } finally {
      await prisma.servicePrice.updateMany({ where: { serviceId }, data: { price: '50000' } });
    }
    expect(await prisma.chargeItem.count({ where: { patientId } })).toBe(2);
    expect(await prisma.invoice.count({ where: { patientId } })).toBe(2);
  });

  it('refuses to invoice a cost which was already handed to the cashier', async () => {
    const invoiced = await prisma.chargeItem.findFirstOrThrow({
      where: { patientId, status: 'INVOICED' },
    });
    await request(app.getHttpServer())
      .post(`${API}/charges/invoice`)
      .set(auth(recep))
      .send({ chargeIds: [invoiced.id] })
      .expect(409);
  });

  // ------------------------------------------------------------- discharge

  it('refuses discharge while this stay has an unpaid cashier invoice', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/admissions/${admissionId}/discharge`)
      .set(auth(doctor))
      .send({ outcome: 'RECOVERED', finalDiagnosisMain: 'J18.9 Pnevmoniya' });
    expect(res.status).toBe(409);
  });

  it('names the blocker instead of failing blankly', async () => {
    const res = await request(app.getHttpServer())
      .get(`${API}/admissions/${admissionId}/discharge-check`)
      .set(auth(doctor))
      .expect(200);
    expect(res.body.data.canDischarge).toBe(false);
    expect(res.body.data.blockers).toEqual(['DEBT']);
    expect(res.body.data.unbilled.count).toBe(0);
    expect(res.body.data.unbilled.total).toBe('0.00');
    expect(res.body.data.stayDebt).toBe('150000.00');
  });

  it('reports the automatically issued unpaid invoice and its exact debt', async () => {
    // The stay is now reachable from its invoice — the link that makes a debt
    // gate possible at all.
    const check = await request(app.getHttpServer())
      .get(`${API}/admissions/${admissionId}/discharge-check`)
      .set(auth(doctor))
      .expect(200);
    expect(check.body.data.blockers).toEqual(['DEBT']);
    expect(check.body.data.stayDebt).toBe('150000.00');
    expect(check.body.data.stayInvoices).toHaveLength(1);

    const res = await request(app.getHttpServer())
      .post(`${API}/admissions/${admissionId}/discharge`)
      .set(auth(doctor))
      .send({ outcome: 'RECOVERED', finalDiagnosisMain: 'J18.9 Pnevmoniya' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ADMISSION_DEBT_UNPAID');
    // The amount reaches the person who has to collect it.
    expect(res.body.error.message).toContain('150000.00');
  });

  it('discharges once the stay is paid, and returns the patient to ambulatory', async () => {
    // Cash lands in a drawer, so there has to be one open.
    await request(app.getHttpServer())
      .post(`${API}/shifts/open`)
      .set(auth(cashier))
      .send({ openingCash: '0.00' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${API}/invoices/${stayInvoiceId}/payments`)
      .set(auth(cashier))
      .send({ amount: '150000.00', method: 'CASH', idempotencyKey: randomUUID() })
      .expect(201);

    const extra = await request(app.getHttpServer())
      .post(`${API}/charges`)
      .set(auth(recep))
      .send({
        patientId,
        admissionId,
        serviceId,
        date: day(0),
        quantity: 1,
        idempotencyKey: randomUUID(),
      })
      .expect(201);
    const extraInvoice = await invoiceForCharge(extra.body.data.id as string);
    expect(extraInvoice.id).not.toBe(stayInvoiceId);
    const pending = await pendingInvoices();
    expect(pending.map((invoice) => invoice.id)).not.toContain(stayInvoiceId);
    expect(pending).toContainEqual(
      expect.objectContaining({ id: extraInvoice.id, due: '50000.00' }),
    );
    const extraCheck = await request(app.getHttpServer())
      .get(`${API}/admissions/${admissionId}/discharge-check`)
      .set(auth(doctor))
      .expect(200);
    expect(extraCheck.body.data.stayDebt).toBe('50000.00');
    await request(app.getHttpServer())
      .post(`${API}/invoices/${extraInvoice.id}/payments`)
      .set(auth(cashier))
      .send({ amount: '50000.00', method: 'CARD', idempotencyKey: randomUUID() })
      .expect(201);

    const check = await request(app.getHttpServer())
      .get(`${API}/admissions/${admissionId}/discharge-check`)
      .set(auth(doctor))
      .expect(200);
    expect(check.body.data.canDischarge).toBe(true);
    expect(check.body.data.stayDebt).toBe('0.00');

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
    // "Settled at closure" is recorded as a fact, not left absent.
    const adm = await prisma.admission.findUniqueOrThrow({ where: { id: admissionId } });
    expect(adm.debtAtDischarge?.toFixed(2)).toBe('0.00');

    // A discharged history is closed to edits.
    const res = await request(app.getHttpServer())
      .patch(`${API}/admissions/${admissionId}`)
      .set(auth(doctor))
      .send({ complaints: 'kech qoldi' });
    expect(res.status).toBe(409);
  });

  it('lets the same patient be admitted again after discharge', async () => {
    const again = await request(app.getHttpServer())
      .post(`${API}/admissions`)
      .set(auth(doctor))
      .send({ patientId, ward: '2', bed: '3' })
      .expect(201);
    expect(again.body.data.historyNumber).not.toBe(historyNumber);

    const p = await prisma.patient.findUniqueOrThrow({ where: { id: patientId } });
    expect(p.careType).toBe('INPATIENT');

    // And the first stay stays closed — a re-admission is a NEW history.
    const old = await prisma.admission.findUniqueOrThrow({ where: { id: admissionId } });
    expect(old.status).toBe('DISCHARGED');
  });

  // ------------------------------------------------- never a room with no door

  it('lets an administrator close a stay that still owes, and remembers what it owed', async () => {
    // The stay from the re-admission above, with a service given and unbilled.
    const stay = await prisma.admission.findFirstOrThrow({
      where: { patientId, status: 'ACTIVE' },
    });
    await request(app.getHttpServer())
      .post(`${API}/charges`)
      .set(auth(recep))
      .send({ patientId, serviceId, date: day(0), quantity: 1, admissionId: stay.id })
      .expect(201);

    // Refused without saying so explicitly...
    const blocked = await request(app.getHttpServer())
      .post(`${API}/admissions/${stay.id}/discharge`)
      .set(auth(doctor))
      .send({ outcome: 'IMPROVED', finalDiagnosisMain: 'J18.9' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('ADMISSION_DEBT_UNPAID');

    // ...and the doctor cannot force it either — that is a desk decision.
    const forbidden = await request(app.getHttpServer())
      .post(`${API}/admissions/${stay.id}/discharge`)
      .set(auth(doctor))
      .send({ outcome: 'IMPROVED', finalDiagnosisMain: 'J18.9', force: true });
    expect(forbidden.status).toBe(403);

    // An administrator can, and the amount left behind stays on the history.
    await request(app.getHttpServer())
      .post(`${API}/admissions/${stay.id}/discharge`)
      .set(auth(owner))
      .send({ outcome: 'IMPROVED', finalDiagnosisMain: 'J18.9', force: true })
      .expect(201);

    const closed = await prisma.admission.findUniqueOrThrow({ where: { id: stay.id } });
    expect(closed.status).toBe('DISCHARGED');
    expect(closed.debtAtDischarge?.toFixed(2)).toBe('50000.00');
    // Nothing was forgiven: the unpaid issued invoice remains payable.
    const still = await prisma.chargeItem.count({
      where: { admissionId: stay.id, status: 'INVOICED' },
    });
    expect(still).toBe(1);
  });

  it('frees a stay whose invoice was cancelled, instead of stranding it', async () => {
    const p3 = await prisma.patient.create({
      data: {
        clinicId: clinic.clinicId,
        mrn: `AD3-${randomUUID().slice(0, 6)}`,
        firstName: 'Bekor',
        lastName: 'Qilingan',
        fullName: 'Bekor Qilingan',
        gender: 'MALE',
      },
    });
    const stay = (
      await request(app.getHttpServer())
        .post(`${API}/admissions`)
        .set(auth(recep))
        .send({ patientId: p3.id })
        .expect(201)
    ).body.data.id as string;
    const charge = (
      await request(app.getHttpServer())
        .post(`${API}/charges`)
        .set(auth(recep))
        .send({ patientId: p3.id, serviceId, date: day(0), quantity: 1, admissionId: stay })
        .expect(201)
    ).body.data.id as string;

    const inv = (await invoiceForCharge(charge)).id;

    await request(app.getHttpServer())
      .post(`${API}/invoices/${inv}/cancel`)
      .set(auth(owner))
      .expect(201);

    // Cancelling the bill hands the service back rather than leaving it claimed
    // by an invoice that no longer exists — the state nothing could get out of.
    const back = await prisma.chargeItem.findUniqueOrThrow({ where: { id: charge } });
    expect(back.status).toBe('PENDING');
    expect(back.invoiceLineId).toBeNull();

    // And it can now be removed, which the old code refused forever.
    await request(app.getHttpServer())
      .delete(`${API}/charges/${charge}`)
      .set(auth(recep))
      .expect(200);
  });

  it('deletes a stay opened by mistake, keeping anything already billed', async () => {
    const p4 = await prisma.patient.create({
      data: {
        clinicId: clinic.clinicId,
        mrn: `AD4-${randomUUID().slice(0, 6)}`,
        firstName: 'Xato',
        lastName: 'Yotqizilgan',
        fullName: 'Xato Yotqizilgan',
        gender: 'FEMALE',
      },
    });
    const stay = (
      await request(app.getHttpServer())
        .post(`${API}/admissions`)
        .set(auth(recep))
        .send({ patientId: p4.id })
        .expect(201)
    ).body.data.id as string;
    await request(app.getHttpServer())
      .post(`${API}/charges`)
      .set(auth(recep))
      .send({ patientId: p4.id, serviceId, date: day(0), quantity: 1, admissionId: stay })
      .expect(201);

    // A doctor may not: removing a history is not a clinical act.
    const forbidden = await request(app.getHttpServer())
      .delete(`${API}/admissions/${stay}`)
      .set(auth(doctor));
    expect(forbidden.status).toBe(403);

    const res = await request(app.getHttpServer())
      .delete(`${API}/admissions/${stay}`)
      .set(auth(owner))
      .expect(200);
    expect(res.body.data.invoicedKept).toBe(1);

    expect(await prisma.admission.findUnique({ where: { id: stay } })).toBeNull();
    // The patient is out of the ward and can be admitted again.
    const p = await prisma.patient.findUniqueOrThrow({ where: { id: p4.id } });
    expect(p.careType).toBe('AMBULATORY');
  });

  it('will not let a billed treatment day be un-marked', async () => {
    // Runs after discharge billed the ward treatment: money already on an
    // invoice is not the sheet's to take back.
    const res = await request(app.getHttpServer())
      .post(`${API}/admissions/${admissionId}/administrations`)
      .set(auth(recep))
      .send({ orderId: treatmentOrderId, date: day(0), status: 'SKIPPED' });
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
      orders: Array<{
        days: Array<{ date: string; slots: Array<{ slot: number; status: string | null }> }>;
      }>;
    };
    // The letterhead and the identity block the paper form asks for.
    expect(d.clinic.name).toBeTruthy();
    expect(d.patient.fullName).toBe('Statsionar Bemor');
    expect(d.admission.historyNumber).toMatch(/^KT-/);
    // Bed-days: the day of admission counts, so a same-day stay is 1, never 0.
    expect(Number(d.admission.bedDays)).toBeGreaterThanOrEqual(1);
    // The sheet carries its marks, including the refusal — that is the whole
    // reason it is printed rather than re-derived.
    const marks = d.orders.flatMap((o) => o.days.flatMap((x) => x.slots.map((sl) => sl.status)));
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
