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

describe('surgeon payouts backed by the cashier ledger', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let clinic: TestClinic;
  let owner: LoginResult;
  let cashier: LoginResult;
  let reception: LoginResult;
  let surgeryId: string;
  let patientId: string;
  let admissionId: string;
  let feeChargeId: string;
  let payoutId: string;
  let expenseId: string;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date());
  const payload = {
    type: 'PERCENT',
    value: '12.5',
    method: 'CASH',
    note: 'Amaliyot uchun berildi',
    idempotencyKey: randomUUID(),
  };
  const post = (path: string, actor = cashier) =>
    request(app.getHttpServer())
      .post(`${API}${path}`)
      .set('Authorization', `Bearer ${actor.accessToken}`)
      .set('x-branch-id', clinic.branchId);
  const get = (path: string, actor = cashier) =>
    request(app.getHttpServer())
      .get(`${API}${path}`)
      .set('Authorization', `Bearer ${actor.accessToken}`)
      .set('x-branch-id', clinic.branchId);

  beforeAll(async () => {
    if (
      !/^\/(?:avishifo_finance_|.*(?:test|e2e))/.test(
        new URL(process.env.DATABASE_URL ?? '').pathname,
      )
    )
      throw new Error('Isolated database required');
    process.env.SINGLE_CLINIC_MODE = 'true';
    app = await createApp([]);
    clinic = await createTestClinic(prisma, 'surgery-payouts');
    owner = await login(app, clinic.owner.email);
    cashier = await login(app, clinic.cashier.email);
    reception = await login(app, clinic.receptionist.email);
    const patient = await post('/patients', reception).send({
      firstName: 'Payout',
      lastName: 'Test',
      phone: uniquePhone(),
    });
    expect(patient.status).toBe(201);
    patientId = patient.body.data.id as string;
    const admission = await post('/admissions', reception).send({ patientId });
    expect(admission.status).toBe(201);
    admissionId = admission.body.data.id as string;
    const category = await prisma.serviceCategory.create({
      data: { clinicId: clinic.clinicId, name: 'Surgery test', kind: 'SURGERY' },
    });
    const service = await prisma.service.create({
      data: {
        clinicId: clinic.clinicId,
        categoryId: category.id,
        code: 'SUR-PAYOUT',
        name: { uz: 'Test operation' },
        prices: {
          create: {
            clinicId: clinic.clinicId,
            price: '333.33',
            effectiveFrom: new Date('2020-01-01'),
          },
        },
      },
    });
    const operation = await post('/surgeries', reception).send({
      admissionId,
      serviceId: service.id,
      surgeonUserId: clinic.doctor.id,
      scheduledDate: today,
      idempotencyKey: randomUUID(),
    });
    expect(operation.status).toBe(201);
    surgeryId = operation.body.data.id as string;
    feeChargeId = operation.body.data.serviceCharge.id as string;
  });
  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  it('requires completed surgery, cashier permission and an open shift', async () => {
    expect((await post(`/surgeries/${surgeryId}/payouts`, reception).send(payload)).status).toBe(
      403,
    );
    expect((await post(`/surgeries/${surgeryId}/payouts`).send(payload)).status).toBe(409);
    expect((await post(`/surgeries/${surgeryId}/complete`, owner).send({})).status).toBe(201);
    expect((await post(`/surgeries/${surgeryId}/payouts`).send(payload)).status).toBe(409);
    expect(await prisma.expense.count({ where: { clinicId: clinic.clinicId } })).toBe(0);
    expect(
      (
        await post('/shifts/open').send({
          openingCash: '1000',
          openingCard: '0',
          openingClick: '500',
        })
      ).status,
    ).toBe(201);
  });

  it('records exactly one rounded expense under simultaneous retries and rejects changed replays', async () => {
    const [first, retry] = await Promise.all([
      post(`/surgeries/${surgeryId}/payouts`).send(payload),
      post(`/surgeries/${surgeryId}/payouts`).send(payload),
    ]);
    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(first.body.data).toMatchObject({
      amount: '41.67',
      basisAmount: '333.33',
      value: '12.50',
      patientId,
      doctorUserId: clinic.doctor.id,
    });
    expect(retry.body.data.id).toBe(first.body.data.id);
    payoutId = first.body.data.id as string;
    expenseId = first.body.data.expenseId as string;
    expect(await prisma.expense.count({ where: { clinicId: clinic.clinicId } })).toBe(1);
    expect(
      (await post(`/surgeries/${surgeryId}/payouts`).send({ ...payload, value: '20' })).status,
    ).toBe(409);
    expect(
      (
        await post(`/surgeries/${surgeryId}/payouts`).send({
          ...payload,
          idempotencyKey: randomUUID(),
        })
      ).status,
    ).toBe(409);
    const report = await get('/reports/cashflow').query({ from: today, to: today, groupBy: 'day' });
    expect(report.status).toBe(200);
    expect(report.body.data.totals.expenses).toBe('41.67');
    expect(report.body.data.expenseCategories).toEqual([
      expect.objectContaining({ category: 'Jarroh ulushi', amount: '41.67' }),
    ]);
    const hidden = await get(`/surgeries/${surgeryId}`, reception);
    expect(hidden.body.data.payouts).toEqual([]);
  });

  it('protects linked expenses and reverses the same cash movement once', async () => {
    for (const method of ['patch', 'delete'] as const) {
      const req = request(app.getHttpServer())
        [method](`${API}/expenses/${expenseId}`)
        .set('Authorization', `Bearer ${cashier.accessToken}`)
        .set('x-branch-id', clinic.branchId);
      const res = method === 'patch' ? await req.send({ amount: '1' }) : await req;
      expect(res.status).toBe(409);
    }
    const [first, retry] = await Promise.all([
      post(`/surgeries/${surgeryId}/payouts/${payoutId}/void`).send({
        reason: 'Xato yozuv tuzatildi',
      }),
      post(`/surgeries/${surgeryId}/payouts/${payoutId}/void`).send({
        reason: 'Xato yozuv tuzatildi',
      }),
    ]);
    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(
      (await prisma.expense.findUniqueOrThrow({ where: { id: expenseId } })).deletedAt,
    ).not.toBeNull();
    expect(
      (await post(`/surgeries/${surgeryId}/payouts`).send(payload)).body.data.voidedAt,
    ).not.toBeNull();
    const replacement = await post(`/surgeries/${surgeryId}/payouts`).send({
      type: 'FIXED',
      value: '50',
      method: 'CLICK',
      idempotencyKey: randomUUID(),
    });
    expect(replacement.status).toBe(201);
    payoutId = replacement.body.data.id as string;
    const report = await get('/reports/cashflow').query({ from: today, to: today });
    expect(report.body.data.totals.expenses).toBe('50.00');
    expect(
      report.body.data.accounts.find((a: { method: string }) => a.method === 'CASH').expenses,
    ).toBe('0.00');
  });

  it('bills the fee once, preserves payment notes, and does not accrue a second monthly commission', async () => {
    // Surgery scheduling already issues its fee. The cashier pays that invoice;
    // requesting another one must not duplicate the patient charge.
    expect(
      (await post('/charges/invoice', reception).send({ chargeIds: [feeChargeId] })).status,
    ).toBe(409);
    const charge = await prisma.chargeItem.findUniqueOrThrow({ where: { id: feeChargeId } });
    const line = await prisma.invoiceLine.findUniqueOrThrow({
      where: { id: charge.invoiceLineId! },
    });
    const invoiceId = line.invoiceId;
    expect(line.performerUserId).toBe(clinic.doctor.id);
    const paid = await post(`/invoices/${invoiceId}/payments`).send({
      method: 'CARD',
      amount: '333.33',
      note: 'Operatsiya haqi',
      idempotencyKey: randomUUID(),
    });
    expect(paid.status).toBe(201);
    expect((await get(`/invoices/${invoiceId}`)).body.data.payments[0].note).toBe(
      'Operatsiya haqi',
    );
    await prisma.compensationRule.create({
      data: {
        clinicId: clinic.clinicId,
        doctorUserId: clinic.doctor.id,
        type: 'REVENUE_PERCENT',
        value: '50',
        effectiveFrom: new Date('2020-01-01'),
      },
    });
    const payroll = await post('/payroll/accruals/generate', owner)
      .query({ period: today.slice(0, 7) })
      .send({});
    expect(payroll.status).toBe(201);
    expect(payroll.body.data.accruals[0].bonusAmount).toBe('0.00');
  });

  it('keeps closed-shift surgeon payouts immutable and isolates other branches', async () => {
    const close = await post('/shifts/close').send({
      actualCash: '1000',
      actualCard: '333.33',
      actualClick: '450',
    });
    expect(close.status).toBe(201);
    for (const a of close.body.data.report.accounts as Array<{ difference: string }>)
      expect(a.difference).toBe('0.00');
    expect(
      (
        await post(`/surgeries/${surgeryId}/payouts/${payoutId}/void`).send({
          reason: 'Closed shift reversal',
        })
      ).status,
    ).toBe(409);
    const branch = await prisma.branch.create({
      data: { clinicId: clinic.clinicId, name: 'Other branch' },
    });
    const denied = await request(app.getHttpServer())
      .post(`${API}/surgeries/${surgeryId}/payouts`)
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .set('x-branch-id', branch.id)
      .send({ ...payload, idempotencyKey: randomUUID() });
    expect([403, 404]).toContain(denied.status);
  });
});
