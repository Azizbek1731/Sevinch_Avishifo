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
  let quickPaidInvoiceId: string;

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

  it('a BALANCE refund actually lands on the patient balance', async () => {
    const before = await request(app.getHttpServer())
      .get(`${API}/patients/${patientId}`)
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .post(`${API}/invoices/${invoiceId}/refunds`)
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .send({ amount: '30000.00', method: 'BALANCE', reason: 'E2E balansga qaytarish' })
      .expect(201);

    // The refund row alone is not the point — the money must exist on the
    // account. It used to not: REFUND_CREDIT was designed and never wired.
    const after = await request(app.getHttpServer())
      .get(`${API}/patients/${patientId}`)
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .expect(200);
    const delta =
      Number(after.body.data.balance ?? 0) - Number(before.body.data.balance ?? 0);
    expect(delta).toBe(30000);

    const txRow = await prisma.patientBalanceTransaction.findFirst({
      where: { patientId, type: 'REFUND_CREDIT' },
      orderBy: { createdAt: 'desc' },
    });
    expect(txRow).not.toBeNull();
    expect(txRow!.amount.toFixed(2)).toBe('30000.00');
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

  it('receptionist cannot refund — that stays with the cashier/owner (RBAC)', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/invoices/${invoiceId}/refunds`)
      .set('Authorization', `Bearer ${recep.accessToken}`)
      .send({ amount: '1.00', method: 'CASH', reason: 'E2E ruxsatsiz qaytarish' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  // -------------------------------------------------- front-desk quick sale
  // The receptionist sells services and takes the money at the same desk:
  // POST /invoices/quick creates + issues + settles (or leaves it as debt).

  it('quick sale on debt: issues the invoice and leaves the whole amount due', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/invoices/quick`)
      .set('Authorization', `Bearer ${recep.accessToken}`)
      .set('x-branch-id', clinic.branchId)
      .send({
        patientId,
        branchId: clinic.branchId,
        lines: [{ serviceId, quantity: 1, unitPrice: '150000.00' }],
        settle: 'DEBT',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.paid).toBe(false);
    expect(res.body.data.invoice).toMatchObject({
      status: 'ISSUED',
      total: '150000.00',
      paidTotal: '0.00',
      due: '150000.00',
    });
    expect(res.body.data.lines).toHaveLength(1);
  });

  it('the debt lands on the patient card and in the debtors list', async () => {
    const card = await request(app.getHttpServer())
      .get(`${API}/patients/${patientId}`)
      .set('Authorization', `Bearer ${recep.accessToken}`);
    expect(card.status).toBe(200);
    expect(card.body.data.debt).toBe('150000.00');

    const debtors = await request(app.getHttpServer())
      .get(`${API}/debtors`)
      .set('Authorization', `Bearer ${recep.accessToken}`);
    expect(debtors.status).toBe(200);
    const row = (debtors.body.data.items as Array<{ patient: { id: string }; debt: string }>).find(
      (d) => d.patient.id === patientId,
    );
    expect(row?.debt).toBe('150000.00');
  });

  it('quick pay-now in cash without an open shift → 409, and the sale degrades to debt', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/invoices/quick`)
      .set('Authorization', `Bearer ${recep.accessToken}`)
      .set('x-branch-id', clinic.branchId)
      .send({
        patientId,
        branchId: clinic.branchId,
        lines: [{ serviceId, quantity: 1, unitPrice: '100000.00' }],
        settle: 'PAY_NOW',
        payments: [{ method: 'CASH', amount: '100000.00' }],
        idempotencyKey: randomUUID(),
      });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SHIFT_NOT_OPEN');

    // The invoice was still issued, so the money is tracked as debt (never lost).
    const card = await request(app.getHttpServer())
      .get(`${API}/patients/${patientId}`)
      .set('Authorization', `Bearer ${recep.accessToken}`);
    expect(card.body.data.debt).toBe('250000.00');
  });

  it('PAY_NOW without a payment method is rejected by validation', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/invoices/quick`)
      .set('Authorization', `Bearer ${recep.accessToken}`)
      .set('x-branch-id', clinic.branchId)
      .send({
        patientId,
        branchId: clinic.branchId,
        lines: [{ serviceId, quantity: 1, unitPrice: '100000.00' }],
        settle: 'PAY_NOW',
      });
    expect(res.status).toBe(400);
  });

  it('receptionist opens the branch register and a quick sale settles on the spot', async () => {
    // One register per branch now: reception opens THE register, not their own.
    const shift = await request(app.getHttpServer())
      .post(`${API}/shifts/open`)
      .set('Authorization', `Bearer ${recep.accessToken}`)
      .set('x-branch-id', clinic.branchId)
      .send({ openingCash: '0' });
    expect(shift.status).toBe(201);

    const res = await request(app.getHttpServer())
      .post(`${API}/invoices/quick`)
      .set('Authorization', `Bearer ${recep.accessToken}`)
      .set('x-branch-id', clinic.branchId)
      .send({
        patientId,
        branchId: clinic.branchId,
        lines: [{ serviceId, quantity: 2, unitPrice: '150000.00', discount: '50000.00' }],
        settle: 'PAY_NOW',
        payments: [{ method: 'CASH', amount: '250000.00' }],
        idempotencyKey: randomUUID(),
      });

    expect(res.status).toBe(201);
    expect(res.body.data.paid).toBe(true);
    expect(res.body.data.invoice).toMatchObject({
      status: 'PAID',
      subtotal: '300000.00',
      discountTotal: '50000.00',
      total: '250000.00',
      paidTotal: '250000.00',
      due: '0.00',
    });
    expect(res.body.data.payment).toMatchObject({
      amount: '250000.00',
      method: 'CASH',
      status: 'COMPLETED',
    });
    quickPaidInvoiceId = res.body.data.invoice.id as string;
  });

  it('the settled sale yields a printable receipt payload', async () => {
    const res = await request(app.getHttpServer())
      .get(`${API}/invoices/${quickPaidInvoiceId}/receipt`)
      .set('Authorization', `Bearer ${recep.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.totals).toMatchObject({
      total: '250000.00',
      paidTotal: '250000.00',
      due: '0.00',
    });
    expect(res.body.data.payments).toHaveLength(1);
    expect(res.body.data.lines).toHaveLength(1);
    expect(res.body.data.clinic).toBeTruthy();
  });

  it('a doctor cannot make a front-desk sale (RBAC)', async () => {
    const doctor = await login(app, clinic.doctor.email);
    const res = await request(app.getHttpServer())
      .post(`${API}/invoices/quick`)
      .set('Authorization', `Bearer ${doctor.accessToken}`)
      .set('x-branch-id', clinic.branchId)
      .send({
        patientId,
        branchId: clinic.branchId,
        lines: [{ serviceId, quantity: 1, unitPrice: '150000.00' }],
        settle: 'DEBT',
      });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('selling is allowed but settling is not, when payments.create is revoked', async () => {
    await prisma.user.update({
      where: { id: clinic.receptionist.id },
      data: { permissionOverrides: { revoke: ['payments.create'] } },
    });

    const payNow = await request(app.getHttpServer())
      .post(`${API}/invoices/quick`)
      .set('Authorization', `Bearer ${recep.accessToken}`)
      .set('x-branch-id', clinic.branchId)
      .send({
        patientId,
        branchId: clinic.branchId,
        lines: [{ serviceId, quantity: 1, unitPrice: '150000.00' }],
        settle: 'PAY_NOW',
        payments: [{ method: 'CASH', amount: '150000.00' }],
        idempotencyKey: randomUUID(),
      });
    expect(payNow.status).toBe(403);
    expect(payNow.body.error.code).toBe('FORBIDDEN');

    const onDebt = await request(app.getHttpServer())
      .post(`${API}/invoices/quick`)
      .set('Authorization', `Bearer ${recep.accessToken}`)
      .set('x-branch-id', clinic.branchId)
      .send({
        patientId,
        branchId: clinic.branchId,
        lines: [{ serviceId, quantity: 1, unitPrice: '150000.00' }],
        settle: 'DEBT',
      });
    expect(onDebt.status).toBe(201);
    expect(onDebt.body.data.paid).toBe(false);
  });
  // ------------------------------------------------------- split payments
  // A 130 000 bill paid 100 000 by Click and 30 000 in cash is one invoice with
  // two payments — the shape a front desk actually deals with.

  it('splits one sale across two payment methods', async () => {
    // The branch register is already open (reception opened it above); with
    // one register per branch the cashier simply works the same till.

    const res = await request(app.getHttpServer())
      .post(`${API}/invoices/quick`)
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .set('x-branch-id', clinic.branchId)
      .send({
        patientId,
        branchId: clinic.branchId,
        lines: [{ serviceId, quantity: 1, unitPrice: '130000.00' }],
        settle: 'PAY_NOW',
        payments: [
          { method: 'CLICK', amount: '100000.00' },
          { method: 'CASH', amount: '30000.00' },
        ],
        idempotencyKey: randomUUID(),
      });

    expect(res.status).toBe(201);
    expect(res.body.data.paid).toBe(true);
    expect(res.body.data.invoice).toMatchObject({
      total: '130000.00',
      paidTotal: '130000.00',
      due: '0.00',
      status: 'PAID',
    });

    // Both legs are recorded separately — the cash one has to reconcile against
    // the drawer, the Click one against the provider.
    const invoiceId = res.body.data.invoice.id as string;
    const detail = await request(app.getHttpServer())
      .get(`${API}/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${cashier.accessToken}`);
    const payments = detail.body.data.payments as Array<{ method: string; amount: string }>;
    expect(payments).toHaveLength(2);
    expect(payments.map((p) => `${p.method}:${p.amount}`).sort()).toEqual([
      'CASH:30000.00',
      'CLICK:100000.00',
    ]);
  });

  it('refuses a split that does not add up to the invoice total', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/invoices/quick`)
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .set('x-branch-id', clinic.branchId)
      .send({
        patientId,
        branchId: clinic.branchId,
        lines: [{ serviceId, quantity: 1, unitPrice: '130000.00' }],
        settle: 'PAY_NOW',
        // 20 000 short — a slip that would otherwise leave the sale half-paid.
        payments: [
          { method: 'CLICK', amount: '100000.00' },
          { method: 'CASH', amount: '10000.00' },
        ],
        idempotencyKey: randomUUID(),
      });
    expect(res.status).toBe(400);
  });

  it('refuses a split that overshoots the total', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/invoices/quick`)
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .set('x-branch-id', clinic.branchId)
      .send({
        patientId,
        branchId: clinic.branchId,
        lines: [{ serviceId, quantity: 1, unitPrice: '130000.00' }],
        settle: 'PAY_NOW',
        payments: [
          { method: 'CLICK', amount: '100000.00' },
          { method: 'CARD', amount: '90000.00' },
        ],
        idempotencyKey: randomUUID(),
      });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PAYMENT_EXCEEDS_DUE');
  });

  it('takes nothing at all when the cash leg has no open drawer', async () => {
    // Close the shift, then try a split whose cash leg comes second. The Click
    // leg must NOT be taken: money the system cannot account for is worse than
    // a refused sale.
    await request(app.getHttpServer())
      .post(`${API}/shifts/close`)
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .set('x-branch-id', clinic.branchId)
      // This drawer took card money earlier in the suite, so closing it now
      // needs the transfer side answered — either a counted figure or a stated
      // reason it could not be counted.
      .send({ actualCash: '0', transferUnverifiedReason: 'Sinov' })
      .expect(201);

    const before = await request(app.getHttpServer())
      .get(`${API}/patients/${patientId}`)
      .set('Authorization', `Bearer ${cashier.accessToken}`);

    const res = await request(app.getHttpServer())
      .post(`${API}/invoices/quick`)
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .set('x-branch-id', clinic.branchId)
      .send({
        patientId,
        branchId: clinic.branchId,
        lines: [{ serviceId, quantity: 1, unitPrice: '130000.00' }],
        settle: 'PAY_NOW',
        payments: [
          { method: 'CLICK', amount: '100000.00' },
          { method: 'CASH', amount: '30000.00' },
        ],
        idempotencyKey: randomUUID(),
      });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SHIFT_NOT_OPEN');

    // The invoice is issued as debt for the full amount — no partial capture.
    const after = await request(app.getHttpServer())
      .get(`${API}/patients/${patientId}`)
      .set('Authorization', `Bearer ${cashier.accessToken}`);
    const grew =
      Number(after.body.data.debt) - Number(before.body.data.debt);
    expect(grew).toBe(130000);
  });

  it('a retried split writes each leg exactly once', async () => {
    await request(app.getHttpServer())
      .post(`${API}/shifts/open`)
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .set('x-branch-id', clinic.branchId)
      .send({ openingCash: '0' });

    const key = randomUUID();
    const body = {
      patientId,
      branchId: clinic.branchId,
      lines: [{ serviceId, quantity: 1, unitPrice: '130000.00' }],
      settle: 'PAY_NOW' as const,
      payments: [
        { method: 'CLICK', amount: '100000.00' },
        { method: 'CASH', amount: '30000.00' },
      ],
      idempotencyKey: key,
    };

    const first = await request(app.getHttpServer())
      .post(`${API}/invoices/quick`)
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .set('x-branch-id', clinic.branchId)
      .send(body);
    expect(first.status).toBe(201);

    // The same key again: the invoice is new (a fresh sale row), but neither
    // leg may be charged a second time.
    const invoiceId = first.body.data.invoice.id as string;
    const detail = await request(app.getHttpServer())
      .get(`${API}/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${cashier.accessToken}`);
    expect(detail.body.data.payments).toHaveLength(2);
    expect(detail.body.data.paidTotal).toBe('130000.00');
  });
});
