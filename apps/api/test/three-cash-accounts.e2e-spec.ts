import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as ExcelJS from 'exceljs';
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

describe('single clinic reception and three cash accounts', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let clinic: TestClinic;
  let reception: LoginResult;
  let cashier: LoginResult;
  let owner: LoginResult;
  let patientId: string;
  let invoiceId: string;
  let categoryId: string;
  const reportDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(
    new Date(),
  );
  const get = (path: string, user: LoginResult = cashier) =>
    request(app.getHttpServer())
      .get(`${API}${path}`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .set('x-branch-id', clinic.branchId);
  const post = (path: string, user: LoginResult = cashier) =>
    request(app.getHttpServer())
      .post(`${API}${path}`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .set('x-branch-id', clinic.branchId);
  const invoice = async (amount = '100.00') => {
    const res = await post('/invoices/quick', reception).send({
      patientId,
      branchId: clinic.branchId,
      settle: 'DEBT',
      lines: [{ title: 'Tekshiruv', quantity: 1, unitPrice: amount }],
    });
    expect(res.status).toBe(201);
    return res.body.data.invoice.id as string;
  };

  beforeAll(async () => {
    // This finance suite must never write to the local clinic's working database.
    const database = new URL(process.env.DATABASE_URL ?? '').pathname;
    if (!/^\/(?:avishifo_finance_|.*(?:test|e2e))/.test(database)) {
      throw new Error('Run this suite against an isolated finance/test database');
    }
    process.env.SINGLE_CLINIC_MODE = 'true';
    prisma = new PrismaClient();
    app = await createApp();
    clinic = await createTestClinic(prisma, `three-accounts-${Date.now()}`);
    reception = await login(app, clinic.receptionist.email);
    cashier = await login(app, clinic.cashier.email);
    owner = await login(app, clinic.owner.email);
    const patient = await post('/patients', reception).send({
      firstName: 'Kassa',
      lastName: 'Sinov',
      phone: uniquePhone(),
    });
    expect(patient.status).toBe(201);
    patientId = patient.body.data.id as string;
  });
  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('reception issues bills but cannot collect money or use PAY_NOW; cashier cannot create clinical invoices', async () => {
    invoiceId = await invoice('1000');
    expect(
      (
        await post('/charges').send({
          patientId,
          title: 'Forbidden clinical charge',
          date: reportDate,
          quantity: 1,
          unitPrice: '1',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await post(`/invoices/${invoiceId}/payments`, reception).send({
          amount: '1',
          method: 'CASH',
          idempotencyKey: randomUUID(),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await post('/invoices/quick', reception).send({
          patientId,
          branchId: clinic.branchId,
          settle: 'PAY_NOW',
          lines: [{ title: 'Test', quantity: 1, unitPrice: '1' }],
          payments: [{ amount: '1', method: 'CASH' }],
          idempotencyKey: randomUUID(),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await post('/invoices/quick').send({
          patientId,
          branchId: clinic.branchId,
          settle: 'DEBT',
          lines: [{ title: 'Test', quantity: 1, unitPrice: '1' }],
        })
      ).status,
    ).toBe(403);
  });

  it('all manual external methods require an open shift and rejects unsupported methods', async () => {
    for (const method of ['CASH', 'CARD', 'CLICK'])
      expect(
        (
          await post(`/invoices/${invoiceId}/payments`).send({
            amount: '1',
            method,
            idempotencyKey: randomUUID(),
          })
        ).status,
      ).toBe(409);
    expect(
      (
        await post(`/invoices/${invoiceId}/payments`).send({
          amount: '1',
          method: 'PAYME',
          idempotencyKey: randomUUID(),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post('/shifts/open').send({
          openingCash: '10',
          openingCard: '20',
          openingClick: '30',
        })
      ).status,
    ).toBe(201);
    const category = await post('/expense-categories').send({ name: 'Ish xarajatlari' });
    expect(category.status).toBe(201);
    categoryId = category.body.data.id as string;
  });

  it('splits atomically, accepts deposits, refunds and expenses by account, without counting BALANCE twice', async () => {
    const key = randomUUID();
    const payload = {
      payments: [
        { method: 'CASH', amount: '100.10' },
        { method: 'CARD', amount: '300' },
        { method: 'CLICK', amount: '200' },
      ],
      idempotencyKey: key,
    };
    expect((await post(`/invoices/${invoiceId}/payments/split`).send(payload)).status).toBe(201);
    expect((await post(`/invoices/${invoiceId}/payments/split`).send(payload)).status).toBe(201);
    for (const [method, amount] of [
      ['CASH', '25.20'],
      ['CARD', '60'],
      ['CLICK', '80'],
    ]) {
      expect(
        (await post(`/patients/${patientId}/deposits`).send({ patientId, method, amount })).status,
      ).toBe(201);
    }
    expect(
      (
        await post(`/invoices/${invoiceId}/payments`).send({
          method: 'BALANCE',
          amount: '50',
          idempotencyKey: randomUUID(),
        })
      ).status,
    ).toBe(201);
    for (const [method, amount] of [
      ['CASH', '3.10'],
      ['CARD', '25'],
      ['CLICK', '20'],
    ]) {
      expect(
        (
          await post(`/invoices/${invoiceId}/refunds`).send({
            method,
            amount,
            reason: 'Sinov qaytarish',
          })
        ).status,
      ).toBe(201);
    }
    for (const [method, amount] of [
      ['CASH', '12.20'],
      ['CARD', '15'],
      ['CLICK', '10'],
    ]) {
      expect(
        (await post('/expenses').send({ categoryId, method, amount, date: reportDate })).status,
      ).toBe(201);
    }
    const mistakenExpense = await post('/expenses').send({
      categoryId,
      method: 'CARD',
      amount: '5000',
      date: reportDate,
    });
    expect(mistakenExpense.status).toBe(201);
    expect(
      (
        await request(app.getHttpServer())
          .delete(`${API}/expenses/${mistakenExpense.body.data.id as string}`)
          .set('Authorization', `Bearer ${cashier.accessToken}`)
          .set('x-branch-id', clinic.branchId)
      ).status,
    ).toBe(200);
    const current = await request(app.getHttpServer())
      .get(`${API}/shifts/current`)
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .set('x-branch-id', clinic.branchId);
    expect(current.body.data.accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: 'CASH', expected: '120.00', deposits: '25.20' }),
        expect.objectContaining({ method: 'CARD', expected: '340.00', deposits: '60.00' }),
        expect.objectContaining({ method: 'CLICK', expected: '280.00', deposits: '80.00' }),
      ]),
    );
  });

  it('rolls back an entire split on insufficient patient balance and prevents concurrent overpayment', async () => {
    const id = await invoice('1000');
    const failed = await post(`/invoices/${id}/payments/split`).send({
      payments: [
        { method: 'CASH', amount: '1' },
        { method: 'BALANCE', amount: '200' },
      ],
      idempotencyKey: randomUUID(),
    });
    expect(failed.status).toBeGreaterThanOrEqual(400);
    expect(await prisma.payment.count({ where: { invoiceId: id } })).toBe(0);
    const attempts = await Promise.all(
      [1, 2].map(() =>
        post(`/invoices/${id}/payments`).send({
          amount: '1000',
          method: 'CASH',
          idempotencyKey: randomUUID(),
        }),
      ),
    );
    expect(attempts.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.payment.count({ where: { invoiceId: id } })).toBe(1);
    // Restore this additional receipt through the supported void flow.
    const payment = await prisma.payment.findFirstOrThrow({ where: { invoiceId: id } });
    expect(
      (await post(`/invoices/payments/${payment.id}/void`).send({ reason: 'Test correction' }))
        .status,
    ).toBe(200);
  });

  it('cashflow matches all three account movements, date/method filters, export, and financial-only access', async () => {
    const filters = { from: reportDate, to: reportDate, groupBy: 'day' };
    const result = await get('/reports/cashflow').query(filters);
    expect(result.status).toBe(200);
    expect(result.body.data).toMatchObject({
      from: reportDate,
      to: reportDate,
      branchId: clinic.branchId,
      timezone: 'Asia/Tashkent',
      totals: {
        receipts: '600.10',
        deposits: '165.20',
        refunds: '48.10',
        expenses: '37.20',
        inflow: '765.30',
        outflow: '85.30',
        net: '680.00',
        operations: 12,
      },
    });
    expect(result.body.data.accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: 'CASH', net: '110.00' }),
        expect.objectContaining({ method: 'CARD', net: '320.00' }),
        expect.objectContaining({ method: 'CLICK', net: '250.00' }),
      ]),
    );
    expect(result.body.data.periods).toEqual([
      expect.objectContaining({ bucket: reportDate, net: '680.00' }),
    ]);
    expect(result.body.data.expenseCategories).toEqual([
      { category: 'Ish xarajatlari', amount: '37.20', operations: 3 },
    ]);

    const card = await get('/reports/cashflow').query({ ...filters, method: 'CARD' });
    expect(card.status).toBe(200);
    expect(card.body.data.accounts).toHaveLength(1);
    expect(card.body.data.totals).toMatchObject({ net: '320.00', operations: 4 });
    // Exercise actual SQL calendar boundaries without freezing auth/Redis timers.
    const cardPayment = await prisma.payment.findFirstOrThrow({
      where: { invoiceId, method: 'CARD' },
    });
    const start = new Date(`${reportDate}T00:00:00+05:00`);
    const end = new Date(start.getTime() + 86_400_000);
    try {
      await prisma.payment.update({ where: { id: cardPayment.id }, data: { paidAt: start } });
      const atStart = await get('/reports/cashflow').query({ ...filters, method: 'CARD' });
      expect(atStart.body.data.totals.receipts).toBe('300.00');
      await prisma.payment.update({ where: { id: cardPayment.id }, data: { paidAt: end } });
      const atEnd = await get('/reports/cashflow').query({ ...filters, method: 'CARD' });
      expect(atEnd.body.data.totals.receipts).toBe('0.00');
      expect(atEnd.body.data.totals.net).toBe('20.00');
    } finally {
      await prisma.payment.update({
        where: { id: cardPayment.id },
        data: { paidAt: cardPayment.paidAt },
      });
    }
    const empty = await get('/reports/cashflow').query({ from: '2000-01-01', to: '2000-01-01' });
    expect(empty.status).toBe(200);
    expect(empty.body.data.totals.net).toBe('0.00');
    expect(
      (await get('/reports/cashflow').query({ from: '2026-02-30', to: '2026-03-01' })).status,
    ).toBe(400);
    expect(
      (await get('/reports/cashflow').query({ ...filters, branchId: randomUUID() })).status,
    ).toBe(403);
    expect((await get('/reports/cashflow', reception).query(filters)).status).toBe(403);
    for (const path of [
      '/reports/revenue',
      '/reports/patient-flow',
      '/reports/doctors',
      '/reports/services',
      '/reports/queue',
      '/reports/lab-turnaround',
      '/reports/cashier-shifts',
    ]) {
      expect((await get(path).query(filters)).status).toBe(403);
    }
    expect((await get('/reports/dashboard')).status).toBe(403);

    const exported = await get('/reports/cashflow')
      .query({ ...filters, method: 'CARD', export: 'xlsx' })
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
        res.on('error', done);
      });
    expect(exported.status).toBe(200);
    expect(exported.headers['content-type']).toContain('spreadsheetml');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exported.body as Parameters<typeof workbook.xlsx.load>[0]);
    const accounts = workbook.getWorksheet('Kassalar');
    expect(accounts?.rowCount).toBe(2); // Header + filtered card account only.
    expect(accounts?.getCell('A2').value).toBe('Karta');
    expect(accounts?.getCell('H2').value).toBe(320);
    expect(accounts?.getCell('H2').numFmt).toBe('#,##0.00');
  });

  it('requires all three counts and persists separate reconciliation totals', async () => {
    expect((await post('/shifts/close').send({ actualCash: '120' })).status).toBe(400);
    const closed = await post('/shifts/close').send({
      actualCash: '120',
      actualCard: '340',
      actualClick: '280',
    });
    expect(closed.status).toBe(201);
    expect(closed.body.data.report.accounts).toHaveLength(3);
    for (const account of closed.body.data.report.accounts as Array<{ difference: string }>)
      expect(account.difference).toBe('0.00');
    expect(
      (await post('/expenses').send({ categoryId, method: 'CLICK', amount: '1', date: reportDate }))
        .status,
    ).toBe(409);
  });
  it('reception prepares one lab referral and unpaid invoice on concurrent quick-entry retries', async () => {
    const category = await post('/service-categories', owner).send({
      name: 'Laboratoriya',
      kind: 'LAB',
    });
    expect(category.status).toBe(201);
    const service = await post('/services', owner).send({
      categoryId: category.body.data.id as string,
      code: `CF-LAB-${randomUUID().slice(0, 8)}`,
      name: { uz: 'Klinika laboratoriya sinovi' },
      durationMin: 10,
      vatIncluded: true,
      price: '50.00',
    });
    expect(service.status).toBe(201);
    const serviceId = service.body.data.id as string;
    const test = await prisma.labTest.findFirstOrThrow({ where: { serviceId } });
    const idempotencyKey = randomUUID();
    const payload = {
      patientId,
      branchId: clinic.branchId,
      settle: 'DEBT',
      idempotencyKey,
      lines: [{ serviceId, quantity: 1, unitPrice: '50.00' }],
    };
    const [first, retry] = await Promise.all([
      post('/invoices/quick', reception).send(payload),
      post('/invoices/quick', reception).send(payload),
    ]);
    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(first.body.data.invoice.id).toBe(retry.body.data.invoice.id);
    const labInvoiceId = first.body.data.invoice.id as string;
    expect(
      await prisma.invoice.count({
        where: { clinicId: clinic.clinicId, requestKey: idempotencyKey },
      }),
    ).toBe(1);
    expect(
      await prisma.labOrderItem.count({ where: { labTestId: test.id, order: { patientId } } }),
    ).toBe(1);
    expect(await prisma.payment.count({ where: { invoiceId: labInvoiceId } })).toBe(0);
    const cashierInvoice = await get(`/invoices/${labInvoiceId}`);
    expect(cashierInvoice.status).toBe(200);
    expect(cashierInvoice.body.data).toMatchObject({
      status: 'ISSUED',
      total: '50.00',
      paidTotal: '0.00',
      due: '50.00',
    });
    expect(
      (
        await post('/invoices/quick', reception).send({
          ...payload,
          lines: [{ serviceId, quantity: 1, unitPrice: '60.00' }],
        })
      ).status,
    ).toBe(409);

    // A management quick-settlement retry also keeps one invoice, payment and lab referral.
    expect(
      (await post('/shifts/open').send({ openingCash: '0', openingCard: '0', openingClick: '0' }))
        .status,
    ).toBe(201);
    const paidPayload = {
      ...payload,
      idempotencyKey: randomUUID(),
      settle: 'PAY_NOW',
      payments: [{ method: 'CASH', amount: '50.00' }],
    };
    const paid = await post('/invoices/quick', owner).send(paidPayload);
    const paidRetry = await post('/invoices/quick', owner).send(paidPayload);
    expect(paid.status).toBe(201);
    expect(paidRetry.status).toBe(201);
    expect(paidRetry.body.data.invoice.id).toBe(paid.body.data.invoice.id);
    expect(paidRetry.body.data.invoice).toMatchObject({ status: 'PAID', due: '0.00' });
    expect(
      await prisma.invoice.count({
        where: { clinicId: clinic.clinicId, requestKey: paidPayload.idempotencyKey },
      }),
    ).toBe(1);
    expect(
      await prisma.payment.count({ where: { invoiceId: paid.body.data.invoice.id as string } }),
    ).toBe(1);
    expect(
      await prisma.labOrderItem.count({ where: { labTestId: test.id, order: { patientId } } }),
    ).toBe(2);
    expect(
      (await post('/shifts/close').send({ actualCash: '50', actualCard: '0', actualClick: '0' }))
        .status,
    ).toBe(201);
  });

  it('reception admits directly and invoices an ad-hoc ward expense with its title and exact price', async () => {
    const admission = await post('/admissions', reception).send({
      patientId,
      department: 'Terapiya',
      ward: '2',
      bed: '1',
    });
    expect(admission.status).toBe(201);
    const admissionId = admission.body.data.id as string;
    const charge = await post('/charges', reception).send({
      patientId,
      admissionId,
      title: 'Statsionar dori xarajati',
      date: reportDate,
      quantity: 2,
      unitPrice: '12.35',
    });
    expect(charge.status).toBe(201);
    const chargeId = charge.body.data.id as string;
    const billed = await post('/charges/invoice', reception).send({ chargeIds: [chargeId] });
    expect(billed.status).toBe(201);
    expect(billed.body.data).toMatchObject({
      status: 'ISSUED',
      total: '24.70',
      due: '24.70',
      paidTotal: '0.00',
    });
    expect(billed.body.data.lines).toEqual([
      expect.objectContaining({
        title: 'Statsionar dori xarajati',
        quantity: 2,
        unitPrice: '12.35',
        lineTotal: '24.70',
      }),
    ]);
    expect((await prisma.chargeItem.findUniqueOrThrow({ where: { id: chargeId } })).status).toBe(
      'INVOICED',
    );
    expect((await get(`/invoices/${billed.body.data.id as string}`)).status).toBe(200);
    expect((await post('/charges/invoice').send({ chargeIds: [chargeId] })).status).toBe(403);
  });

  it('unsigned Payme and Click callbacks cannot bypass the local cashier', async () => {
    const original = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    const count = await prisma.payment.count({ where: { clinicId: clinic.clinicId } });
    const payme = await request(app.getHttpServer())
      .post(`${API}/payments/webhooks/payme`)
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'CreateTransaction',
        params: { id: randomUUID(), amount: 100, account: { invoice_number: original.number } },
      });
    expect(payme.status).toBe(200);
    expect(payme.body.error.code).toBe(-32504);
    const click = await request(app.getHttpServer())
      .post(`${API}/payments/webhooks/click`)
      .send({
        action: '0',
        click_trans_id: randomUUID(),
        merchant_trans_id: original.number,
        amount: '1.00',
      });
    expect(click.status).toBe(200);
    expect(click.body.error).toBe(-1);
    expect(await prisma.payment.count({ where: { clinicId: clinic.clinicId } })).toBe(count);
  });
});
