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
  uniquePhone,
  type LoginResult,
  type TestClinic,
} from './setup';

describe('billing: invoices, payments, shift (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let clinic: TestClinic;
  let owner: LoginResult; // services.write
  let recep: LoginResult; // patients.write
  let cashier: LoginResult; // invoices/payments/refunds/shifts
  let serviceId: string;
  let patientId: string;
  let invoiceId: string;
  let finalPaymentKey: string;
  let finalPaymentId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createApp();
    clinic = await createTestClinic(prisma, `pay${Date.now()}`);
    owner = await login(app, clinic.owner.email);
    recep = await login(app, clinic.receptionist.email);
    cashier = await login(app, clinic.cashier.email);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('sets up a service with a price via the API', async () => {
    const cat = await request(app.getHttpServer())
      .post(`${API}/service-categories`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'E2E Konsultatsiya', kind: 'CONSULTATION' });
    expect(cat.status).toBe(201);

    const svc = await request(app.getHttpServer())
      .post(`${API}/services`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        categoryId: cat.body.data.id as string,
        code: `E2E-${clinic.tag}`,
        name: { uz: 'E2E xizmat' },
        durationMin: 15,
        price: '150000.00',
      });
    expect(svc.status).toBe(201);
    serviceId = svc.body.data.id as string;

    const patient = await request(app.getHttpServer())
      .post(`${API}/patients`)
      .set('Authorization', `Bearer ${recep.accessToken}`)
      .send({ firstName: 'Tolov', lastName: 'Bemorov', phone: uniquePhone() });
    expect(patient.status).toBe(201);
    patientId = patient.body.data.id as string;
  });

  it('creates a DRAFT invoice from manual lines with money as strings', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/invoices`)
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .send({
        patientId,
        branchId: clinic.branchId,
        lines: [
          { serviceId, quantity: 2, unitPrice: '150000.00' },
          { title: 'Qoshimcha material', quantity: 1, unitPrice: '50000.00' },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      status: 'DRAFT',
      subtotal: '350000.00',
      discountTotal: '0.00',
      total: '350000.00',
      paidTotal: '0.00',
      due: '350000.00',
    });
    expect(res.body.data.number).toMatch(/^INV-\d{4}-\d{6}$/);
    expect(res.body.data.lines).toHaveLength(2);
    invoiceId = res.body.data.id as string;
  });

  it('rejects payment on a DRAFT invoice', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/invoices/${invoiceId}/payments`)
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .send({ amount: '100000.00', method: 'CASH', idempotencyKey: randomUUID() });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVOICE_INVALID_STATE');
  });

  it('issues the invoice', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/invoices/${invoiceId}/issue`)
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('ISSUED');
    expect(res.body.data.issuedAt).toBeTruthy();
  });

  it('cash payment without an open shift → 409 SHIFT_NOT_OPEN', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/invoices/${invoiceId}/payments`)
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .send({ amount: '100000.00', method: 'CASH', idempotencyKey: randomUUID() });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SHIFT_NOT_OPEN');
  });

  it('opens a cashier shift', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/shifts/open`)
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .set('x-branch-id', clinic.branchId)
      .send({ openingCash: '100000.00' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'OPEN', openingCash: '100000.00' });
  });

  it('partial cash payment → PARTIALLY_PAID', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/invoices/${invoiceId}/payments`)
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .send({ amount: '200000.00', method: 'CASH', idempotencyKey: randomUUID() });

    expect(res.status).toBe(201);
    expect(res.body.data.payment).toMatchObject({
      amount: '200000.00',
      method: 'CASH',
      status: 'COMPLETED',
    });
    expect(res.body.data.invoice).toMatchObject({
      status: 'PARTIALLY_PAID',
      paidTotal: '200000.00',
      due: '150000.00',
    });
  });

  it('overpaying the remaining due → PAYMENT_EXCEEDS_DUE', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/invoices/${invoiceId}/payments`)
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .send({ amount: '200000.00', method: 'CASH', idempotencyKey: randomUUID() });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ success: false, error: { code: 'PAYMENT_EXCEEDS_DUE' } });
  });

  it('the final payment settles the invoice → PAID', async () => {
    finalPaymentKey = randomUUID();
    const res = await request(app.getHttpServer())
      .post(`${API}/invoices/${invoiceId}/payments`)
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .send({ amount: '150000.00', method: 'CASH', idempotencyKey: finalPaymentKey });

    expect(res.status).toBe(201);
    expect(res.body.data.invoice).toMatchObject({ status: 'PAID', paidTotal: '350000.00', due: '0.00' });
    finalPaymentId = res.body.data.payment.id as string;
  });

  it('replaying the same idempotencyKey returns the SAME payment, no duplicate', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/invoices/${invoiceId}/payments`)
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .send({ amount: '150000.00', method: 'CASH', idempotencyKey: finalPaymentKey });

    expect(res.status).toBe(201);
    expect(res.body.data.payment.id).toBe(finalPaymentId);
    expect(res.body.data.invoice).toMatchObject({ status: 'PAID', paidTotal: '350000.00' });

    const detail = await request(app.getHttpServer())
      .get(`${API}/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${cashier.accessToken}`);
    expect(detail.body.data.payments).toHaveLength(2); // partial + final only
  });

  it('refunds part of the paid total in cash', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/invoices/${invoiceId}/refunds`)
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .send({ amount: '50000.00', method: 'CASH', reason: 'E2E qisman qaytarish' });

    expect(res.status).toBe(201);
    expect(res.body.data.refund).toMatchObject({ amount: '50000.00', method: 'CASH' });
    expect(res.body.data.invoice.status).toBe('PAID'); // not fully refunded
  });

  it('refunding more than what remains paid → REFUND_EXCEEDS_PAID', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/invoices/${invoiceId}/refunds`)
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .send({ amount: '350000.00', method: 'CASH', reason: 'E2E juda kop' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('REFUND_EXCEEDS_PAID');
  });

  it('closes the shift with a consistent expectedCash', async () => {
    // opening 100000 + cash in 350000 − cash refund 50000 = 400000.
    const res = await request(app.getHttpServer())
      .post(`${API}/shifts/close`)
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .set('x-branch-id', clinic.branchId)
      .send({ actualCash: '400000.00' });

    expect(res.status).toBe(201);
    expect(res.body.data.shift.status).toBe('CLOSED');
    expect(res.body.data.report).toMatchObject({
      openingCash: '100000.00',
      cashIn: '350000.00',
      cashOut: '50000.00',
      expectedCash: '400000.00',
      actualCash: '400000.00',
      difference: '0.00',
    });
    const byMethod = res.body.data.report.byMethod as Array<{ method: string; amount: string; count: number }>;
    expect(byMethod).toEqual([{ method: 'CASH', amount: '350000.00', count: 2 }]);
  });

  it('receptionist cannot take payments (RBAC)', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/invoices/${invoiceId}/payments`)
      .set('Authorization', `Bearer ${recep.accessToken}`)
      .send({ amount: '1.00', method: 'CASH', idempotencyKey: randomUUID() });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});
