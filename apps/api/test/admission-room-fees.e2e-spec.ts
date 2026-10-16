import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { TenantContext } from '../src/core/prisma/tenant-context';
import { RoomBillingService } from '../src/modules/billing/room-billing.service';
import { InvoicesService } from '../src/modules/billing/invoices.service';
import { roomBillingDate, nextRoomBillingDate } from '../src/modules/billing/room-billing-calendar';
import { API, createApp, createTestClinic, login, type LoginResult, type TestClinic } from './setup';

describe('calendar room fees (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let clinic: TestClinic;
  let recep: LoginResult;
  let cashier: LoginResult;
  let rooms: RoomBillingService;
  const auth = (user: LoginResult) => ({ Authorization: `Bearer ${user.accessToken}`, 'x-branch-id': clinic.branchId });
  const patient = () => prisma.patient.create({ data: {
    clinicId: clinic.clinicId, mrn: randomUUID(), firstName: 'Room', lastName: 'Test', fullName: 'Room Test',
  } });
  const today = () => roomBillingDate(new Date());
  const scoped = <T>(fn: () => Promise<T>) => TenantContext.run({ clinicId: clinic.clinicId }, fn);
  const invoiceFor = async (chargeId: string) => {
    const charge = await prisma.chargeItem.findUniqueOrThrow({ where: { id: chargeId } });
    return (await prisma.invoiceLine.findUniqueOrThrow({ where: { id: charge.invoiceLineId! }, include: { invoice: true } })).invoice;
  };
  beforeAll(async () => {
    if (new URL(process.env.DATABASE_URL ?? '').pathname !== '/avishifo_finance_migration' || process.env.TELEGRAM_ENABLED !== 'false')
      throw new Error('Use isolated avishifo_finance_migration with Telegram disabled');
    prisma = new PrismaClient();
    app = await createApp([]);
    clinic = await createTestClinic(prisma, 'room');
    recep = await login(app, clinic.receptionist.email);
    cashier = await login(app, clinic.cashier.email);
    rooms = app.get(RoomBillingService);
    await request(app.getHttpServer()).post(`${API}/shifts/open`).set(auth(cashier)).send({ openingCash: '0.00' }).expect(201);
  });
  afterAll(async () => { await app?.close(); await prisma?.$disconnect(); });

  it('bills every local calendar date immediately, once under concurrent retries, with immutable rate snapshots', async () => {
    const p = await patient();
    const admittedAt = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const created = await request(app.getHttpServer()).post(`${API}/admissions`).set(auth(recep))
      .send({ patientId: p.id, ward: '4', bed: '2', dailyRoomRate: '100000.00', admittedAt }).expect(201);
    const id = created.body.data.id as string;
    await scoped(() => Promise.all([rooms.reconcileAdmission(id), rooms.reconcileAdmission(id)]));
    const rows = await prisma.admissionRoomCharge.findMany({ where: { admissionId: id }, orderBy: { billingDate: 'asc' } });
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.dailyRate.toFixed(2))).toEqual(['100000.00', '100000.00', '100000.00']);
    expect(await prisma.chargeItem.count({ where: { admissionId: id } })).toBe(3);
    expect((await invoiceFor(rows[0]!.chargeItemId!)).total.toFixed(2)).toBe('300000.00');
    await request(app.getHttpServer()).patch(`${API}/admissions/${id}`).set(auth(recep)).send({ dailyRoomRate: '150000.00' }).expect(200);
    await scoped(() => rooms.reconcileAdmission(id, clinic.branchId, new Date(Date.now() + 86_400_000)));
    const after = await prisma.admissionRoomCharge.findMany({ where: { admissionId: id }, orderBy: { billingDate: 'asc' } });
    expect(after.map((row) => row.dailyRate.toFixed(2))).toEqual(['100000.00', '100000.00', '100000.00', '150000.00']);
    expect(await prisma.treatmentAdministration.count({ where: { order: { admissionId: id } } })).toBe(0);
  });

  it('adds a new date after partial payment without changing an earlier invoice or payment', async () => {
    const p = await patient();
    const res = await request(app.getHttpServer()).post(`${API}/admissions`).set(auth(recep))
      .send({ patientId: p.id, dailyRoomRate: '100000.00' }).expect(201);
    const id = res.body.data.id as string;
    const day = await prisma.admissionRoomCharge.findFirstOrThrow({ where: { admissionId: id } });
    const invoice = await invoiceFor(day.chargeItemId!);
    await request(app.getHttpServer()).post(`${API}/invoices/${invoice.id}/payments`).set(auth(cashier))
      .send({ amount: '40000.00', method: 'CASH', idempotencyKey: randomUUID() }).expect(201);
    await scoped(() => rooms.reconcileAdmission(id, clinic.branchId, new Date(Date.now() + 86_400_000)));
    const invoices = await prisma.invoice.findMany({ where: { patientId: p.id } });
    expect(invoices).toHaveLength(2);
    expect(invoices.find((row) => row.id === invoice.id)?.paidTotal.toFixed(2)).toBe('40000.00');
    expect(invoices.reduce((sum, row) => sum + Number(row.total.sub(row.paidTotal)), 0)).toBe(160000);
  });

  it('persists final-day accrual before the discharge debt gate and stops after discharge', async () => {
    const p = await patient();
    const stay = await prisma.admission.create({ data: {
      clinicId: clinic.clinicId, branchId: clinic.branchId, patientId: p.id,
      historyNumber: `ROOM-${randomUUID()}`, admittedAt: new Date(Date.now() - 60000),
      dailyRoomRate: '200000.00', roomBillingStartsOn: new Date(today()), roomBillingNextDate: new Date(today()), roomRateSetById: clinic.receptionist.id,
    } });
    const payload = { outcome: 'IMPROVED', finalDiagnosisMain: 'Test' };
    await request(app.getHttpServer()).post(`${API}/admissions/${stay.id}/discharge`).set(auth(recep)).send(payload).expect(409);
    const day = await prisma.admissionRoomCharge.findFirstOrThrow({ where: { admissionId: stay.id } });
    const invoice = await invoiceFor(day.chargeItemId!);
    await request(app.getHttpServer()).post(`${API}/invoices/${invoice.id}/payments`).set(auth(cashier))
      .send({ amount: '200000.00', method: 'CASH', idempotencyKey: randomUUID() }).expect(201);
    await request(app.getHttpServer()).post(`${API}/admissions/${stay.id}/discharge`).set(auth(recep)).send(payload).expect(201);
    await scoped(() => rooms.reconcileAdmission(stay.id, clinic.branchId, new Date(Date.now() + 86_400_000)));
    expect(await prisma.admissionRoomCharge.count({ where: { admissionId: stay.id } })).toBe(1);
    const closed = await prisma.admission.findUniqueOrThrow({ where: { id: stay.id } });
    expect(closed.status).toBe('DISCHARGED');
    expect(closed.debtAtDischarge?.toFixed(2)).toBe('0.00');
  });

  it('starts a newly configured legacy stay today and records zero-price days without an invoice', async () => {
    const p = await patient();
    const created = await request(app.getHttpServer()).post(`${API}/admissions`).set(auth(recep))
      .send({ patientId: p.id, admittedAt: new Date(Date.now() - 7 * 86_400_000).toISOString() }).expect(201);
    const id = created.body.data.id as string;
    await request(app.getHttpServer()).patch(`${API}/admissions/${id}`).set(auth(recep)).send({ dailyRoomRate: '0.00' }).expect(200);
    const rows = await prisma.admissionRoomCharge.findMany({ where: { admissionId: id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.billingDate.toISOString().slice(0, 10)).toBe(today());
    expect(rows[0]!.chargeItemId).toBeNull();
    expect(await prisma.invoice.count({ where: { patientId: p.id } })).toBe(0);
    const stay = await prisma.admission.findUniqueOrThrow({ where: { id } });
    expect(stay.roomBillingNextDate?.toISOString().slice(0, 10)).toBe(nextRoomBillingDate(today()));
  });

  it('rolls admission and room costs back together when invoice issuance fails', async () => {
    const p = await patient();
    const spy = vi.spyOn(app.get(InvoicesService), 'issueChargesInTransaction').mockRejectedValueOnce(new Error('simulated failure'));
    try {
      await request(app.getHttpServer()).post(`${API}/admissions`).set(auth(recep))
        .send({ patientId: p.id, dailyRoomRate: '100000.00' }).expect(500);
      expect(await prisma.admission.count({ where: { patientId: p.id } })).toBe(0);
      expect(await prisma.chargeItem.count({ where: { patientId: p.id } })).toBe(0);
    } finally { spy.mockRestore(); }
  });
  it('rejects invalid tariffs and a branch outside the caller scope', async () => {
    const p = await patient();
    for (const rate of ['-1', '0.001', '1000000000000.00']) {
      await request(app.getHttpServer()).post(`${API}/admissions`).set(auth(recep))
        .send({ patientId: p.id, dailyRoomRate: rate }).expect(400);
    }
    expect(await prisma.admission.count({ where: { patientId: p.id } })).toBe(0);
    const other = await prisma.branch.create({ data: { clinicId: clinic.clinicId, name: 'Other branch' } });
    await request(app.getHttpServer()).post(`${API}/admissions`).set(auth(recep)).set('x-branch-id', other.id)
      .send({ patientId: p.id, dailyRoomRate: '100000.00' }).expect(403);
    const otherStay = await prisma.admission.create({ data: {
      clinicId: clinic.clinicId, branchId: other.id, patientId: p.id, historyNumber: `ROOM-${randomUUID()}`, admittedAt: new Date(),
      dailyRoomRate: '100000.00', roomBillingStartsOn: new Date(today()), roomBillingNextDate: new Date(today()), roomRateSetById: clinic.receptionist.id,
    } });
    await request(app.getHttpServer()).get(`${API}/admissions/${otherStay.id}`).set(auth(recep)).expect(404);
    await request(app.getHttpServer()).get(`${API}/admissions/${otherStay.id}/discharge-check`).set(auth(recep)).expect(404);
    expect(await prisma.admissionRoomCharge.count({ where: { admissionId: otherStay.id } })).toBe(0);
  });

});
