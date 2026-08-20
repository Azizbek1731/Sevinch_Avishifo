import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { API, createApp, createTestClinic, login, type LoginResult, type TestClinic } from './setup';

/**
 * Undoing what the front desk entered by mistake.
 *
 * Two properties matter and they pull against each other: the money has to be
 * put back exactly as it was, and the correction has to stay visible to someone.
 * A void that silently vanished from every screen would be indistinguishable
 * from a till shortfall.
 */
describe('voiding payments and deleting patients (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let clinic: TestClinic;
  let owner: LoginResult;
  let cashier: LoginResult;
  let patientId: string;

  /** A fresh paid invoice, settled in cash against the cashier's open shift. */
  async function paidInvoice(amount: string): Promise<{ invoiceId: string; paymentId: string }> {
    const res = await request(app.getHttpServer())
      .post(`${API}/invoices/quick`)
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .set('x-branch-id', clinic.branchId)
      .send({
        patientId,
        branchId: clinic.branchId,
        lines: [{ title: 'Void sinov xizmati', quantity: 1, unitPrice: amount }],
        settle: 'PAY_NOW',
        payments: [{ method: 'CASH', amount }],
        idempotencyKey: randomUUID(),
      })
      .expect(201);
    const invoiceId = res.body.data.invoice.id as string;
    const detail = await request(app.getHttpServer())
      .get(`${API}/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .expect(200);
    return { invoiceId, paymentId: detail.body.data.payments[0].id as string };
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createApp();
    clinic = await createTestClinic(prisma, 'void-pay');
    owner = await login(app, clinic.owner.email);
    cashier = await login(app, clinic.cashier.email);

    const patient = await prisma.patient.create({
      data: {
        clinicId: clinic.clinicId,
        mrn: `VP-${randomUUID().slice(0, 6)}`,
        firstName: 'Void',
        lastName: 'Test',
        fullName: 'Void Test',
        gender: 'MALE',
      },
    });
    patientId = patient.id;


    await request(app.getHttpServer())
      .post(`${API}/shifts/open`)
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .set('x-branch-id', clinic.branchId)
      .send({ openingCash: '0' });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('puts the invoice back exactly as it was before the payment', async () => {
    const { invoiceId, paymentId } = await paidInvoice('100000.00');

    await request(app.getHttpServer())
      .post(`${API}/invoices/payments/${paymentId}/void`)
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .send({ reason: 'Noto‘g‘ri summa kiritildi' })
      .expect(200);

    const after = await request(app.getHttpServer())
      .get(`${API}/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .expect(200);
    expect(after.body.data).toMatchObject({
      paidTotal: '0.00',
      due: '100000.00',
      status: 'ISSUED',
    });
  });

  it('hides the voided payment from the desk that entered it', async () => {
    const { invoiceId, paymentId } = await paidInvoice('50000.00');
    await request(app.getHttpServer())
      .post(`${API}/invoices/payments/${paymentId}/void`)
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .send({})
      .expect(200);

    const asCashier = await request(app.getHttpServer())
      .get(`${API}/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .expect(200);
    expect(asCashier.body.data.payments).toHaveLength(0);
  });

  it('keeps it visible, and marked, for the clinic management', async () => {
    const { invoiceId, paymentId } = await paidInvoice('70000.00');
    await request(app.getHttpServer())
      .post(`${API}/invoices/payments/${paymentId}/void`)
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .send({ reason: 'Xato' })
      .expect(200);

    const asOwner = await request(app.getHttpServer())
      .get(`${API}/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    expect(asOwner.body.data.payments).toHaveLength(1);
    expect(asOwner.body.data.payments[0].status).toBe('VOIDED');
  });

  it('leaves the cash drawer expecting only what is still taken', async () => {
    const { paymentId } = await paidInvoice('30000.00');

    const before = await request(app.getHttpServer())
      .get(`${API}/shifts/current`)
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .set('x-branch-id', clinic.branchId)
      .expect(200);

    await request(app.getHttpServer())
      .post(`${API}/invoices/payments/${paymentId}/void`)
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .send({})
      .expect(200);

    const after = await request(app.getHttpServer())
      .get(`${API}/shifts/current`)
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .set('x-branch-id', clinic.branchId)
      .expect(200);

    // The voided 30 000 must no longer be money the cashier is answerable for.
    const drop =
      Number(before.body.data.expectedCashSoFar ?? 0) - Number(after.body.data.expectedCashSoFar ?? 0);
    expect(drop).toBe(30000);
  });

  it('is idempotent — a double click does not reverse the invoice twice', async () => {
    const { invoiceId, paymentId } = await paidInvoice('40000.00');
    for (let i = 0; i < 2; i++) {
      await request(app.getHttpServer())
        .post(`${API}/invoices/payments/${paymentId}/void`)
        .set('Authorization', `Bearer ${cashier.accessToken}`)
        .send({})
        .expect(200);
    }
    const after = await request(app.getHttpServer())
      .get(`${API}/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    // Not -40 000: the second void must be a no-op, not another reversal.
    expect(after.body.data.paidTotal).toBe('0.00');
  });

  it('records who voided it and why', async () => {
    const { paymentId } = await paidInvoice('20000.00');
    await request(app.getHttpServer())
      .post(`${API}/invoices/payments/${paymentId}/void`)
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .send({ reason: 'Bemor almashdi' })
      .expect(200);

    const row = await prisma.payment.findUnique({ where: { id: paymentId } });
    expect(row?.voidedById).toBe(clinic.cashier.id);
    expect(row?.voidReason).toBe('Bemor almashdi');
    expect(row?.voidedAt).not.toBeNull();
  });

  // ------------------------------------------------------------- patients

  it('removes a patient for the desk and keeps them for management', async () => {
    const doomed = await prisma.patient.create({
      data: {
        clinicId: clinic.clinicId,
        mrn: `VD-${randomUUID().slice(0, 6)}`,
        firstName: 'Ochirilgan',
        lastName: 'Bemor',
        fullName: 'Ochirilgan Bemor',
        gender: 'FEMALE',
      },
    });

    await request(app.getHttpServer())
      .delete(`${API}/patients/${doomed.id}`)
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .expect(200);

    const forCashier = await request(app.getHttpServer())
      .get(`${API}/patients`)
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .query({ limit: 100 })
      .expect(200);
    expect(forCashier.body.data.some((p: { id: string }) => p.id === doomed.id)).toBe(false);

    // Even asking for them: the flag requests, the permission decides.
    const cashierAsking = await request(app.getHttpServer())
      .get(`${API}/patients`)
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .query({ limit: 100, deleted: true })
      .expect(200);
    expect(cashierAsking.body.data.some((p: { id: string }) => p.id === doomed.id)).toBe(false);

    const forOwner = await request(app.getHttpServer())
      .get(`${API}/patients`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .query({ limit: 100, deleted: true })
      .expect(200);
    expect(forOwner.body.data.some((p: { id: string }) => p.id === doomed.id)).toBe(true);
  });
});
