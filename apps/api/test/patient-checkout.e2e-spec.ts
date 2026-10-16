import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import {
  API,
  createApp,
  createTestClinic,
  login,
  uniquePhone,
  type TestClinic,
  type LoginResult,
} from './setup';

describe('patient checkout: atomic selected invoices', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let clinic: TestClinic;
  let other: TestClinic;
  let cashier: LoginResult;
  let reception: LoginResult;
  let foreignCashier: LoginResult;
  let patientId: string;
  const req = (method: 'get' | 'post', path: string, actor = cashier, branchId?: string) =>
    request(app.getHttpServer())
      [method](`${API}${path}`)
      .set('Authorization', `Bearer ${actor.accessToken}`)
      .set('x-branch-id', branchId ?? clinic.branchId);
  const invoice = (
    total: string,
    overrides: { patientId?: string; branchId?: string; clinicId?: string } = {},
  ) =>
    prisma.invoice.create({
      data: {
        clinicId: overrides.clinicId ?? clinic.clinicId,
        branchId: overrides.branchId ?? clinic.branchId,
        patientId: overrides.patientId ?? patientId,
        number: `CHECKOUT-${randomUUID()}`,
        status: 'ISSUED',
        subtotal: total,
        total,
        issuedAt: new Date(),
        lines: {
          create: {
            clinicId: overrides.clinicId ?? clinic.clinicId,
            title: { uz: 'Sinov xizmati' },
            quantity: 1,
            unitPrice: total,
            lineTotal: total,
          },
        },
      },
    });
  const checkout = (ids: string[], total: string, key = randomUUID()) => ({
    patientId,
    invoiceIds: ids,
    expectedTotal: total,
    payments: [{ method: 'CASH', amount: total }],
    idempotencyKey: key,
  });
  beforeAll(async () => {
    if (
      new URL(process.env.DATABASE_URL ?? '').pathname !== '/avishifo_finance_migration' ||
      process.env.TELEGRAM_ENABLED !== 'false'
    )
      throw new Error('Isolated database and disabled Telegram required');
    prisma = new PrismaClient();
    app = await createApp([]);
    clinic = await createTestClinic(prisma, `checkout-${Date.now()}`);
    other = await createTestClinic(prisma, `checkout-foreign-${Date.now()}`);
    cashier = await login(app, clinic.cashier.email);
    reception = await login(app, clinic.receptionist.email);
    foreignCashier = await login(app, other.cashier.email);
    const patient = await req('post', '/patients', reception).send({
      firstName: 'Birlashtirilgan',
      lastName: 'To‘lov',
      phone: uniquePhone(),
    });
    expect(patient.status).toBe(201);
    patientId = patient.body.data.id as string;
    expect(
      (
        await req('post', '/shifts/open').send({
          openingCash: '0',
          openingCard: '0',
          openingClick: '0',
        })
      ).status,
    ).toBe(201);
  });
  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('groups bills by patient, settles selected balances with exact split and one receipt', async () => {
    const a = await invoice('100.11');
    const b = await invoice('50.22');
    const excluded = await invoice('7.77');
    expect(
      (
        await req('post', `/invoices/${a.id}/payments`).send({
          amount: '20.01',
          method: 'CASH',
          idempotencyKey: randomUUID(),
        })
      ).status,
    ).toBe(201);
    const pending = await req('get', '/patient-payments/pending?search=Birlashtirilgan');
    expect(pending.status, JSON.stringify(pending.body)).toBe(200);
    expect(pending.body.data).toEqual([
      expect.objectContaining({ id: patientId, invoiceCount: 3, due: '138.09' }),
    ]);
    const searched = await req('get', `/patient-payments/pending?search=${encodeURIComponent(a.number)}`);
    expect(searched.body.data).toEqual([expect.objectContaining({ id: patientId, invoiceCount: 3, due: '138.09' })]);
    const input = {
      ...checkout([a.id, b.id], '130.32'),
      payments: [
        { method: 'CASH', amount: '100', note: 'Naqd qismi' },
        { method: 'CARD', amount: '30.32', note: 'Karta qismi' },
      ],
    };
    const paid = await req('post', '/patient-payments').send(input);
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);
    const id = paid.body.data.checkoutId as string;
    const receipt = await req('get', `/patient-payments/${id}/receipt`);
    expect(receipt.status).toBe(200);
    expect(receipt.body.data.checkout).toMatchObject({ amount: '130.32', paidBefore: '20.01' });
    expect(receipt.body.data.checkout.invoices).toHaveLength(2);
    expect(receipt.body.data.lines).toHaveLength(2);
    expect(receipt.body.data.totals).toMatchObject({
      total: '150.33',
      paidTotal: '150.33',
      due: '0.00',
    });
    const payments = await prisma.payment.findMany({ where: { checkoutId: id } });
    expect(
      payments.filter((p) => p.method === 'CASH').reduce((sum, p) => sum + Number(p.amount), 0),
    ).toBe(100);
    expect(
      payments.filter((p) => p.method === 'CARD').reduce((sum, p) => sum + Number(p.amount), 0),
    ).toBe(30.32);
    expect(payments.every((p) => p.shiftId && p.note)).toBe(true);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: excluded.id } })).status).toBe(
      'ISSUED',
    );
    expect(
      (await req('get', `/patient-payments/patients/${patientId}`)).body.data.invoices,
    ).toEqual([expect.objectContaining({ id: excluded.id })]);
    const replay = await req('post', '/patient-payments').send(input);
    expect(replay.body.data.checkoutId).toBe(id);
    expect(await prisma.payment.count({ where: { checkoutId: id } })).toBe(payments.length);
    const changed = await req('post', '/patient-payments').send({
      ...input,
      payments: [{ method: 'CLICK', amount: '130.32' }],
    });
    expect(changed.status).toBe(409);
  });

  it('serializes duplicate and competing cashier submissions without double payment', async () => {
    const bill = await invoice('30.01');
    const input = checkout([bill.id], '30.01');
    const replies = await Promise.all([
      req('post', '/patient-payments').send(input),
      req('post', '/patient-payments').send(input),
    ]);
    expect(replies.map((reply) => reply.status)).toEqual([201, 201]);
    expect(replies[0]!.body.data.checkoutId).toBe(replies[1]!.body.data.checkoutId);
    expect(await prisma.payment.count({ where: { invoiceId: bill.id } })).toBe(1);
    const next = await invoice('40.02');
    const race = await Promise.all([
      req('post', '/patient-payments').send(checkout([next.id], '40.02')),
      req('post', '/patient-payments').send(checkout([next.id], '40.02')),
    ]);
    expect(race.map((reply) => reply.status).sort()).toEqual([201, 409]);
    expect(await prisma.payment.count({ where: { invoiceId: next.id } })).toBe(1);
  });

  it('rolls back all invoices for stale totals or insufficient balance', async () => {
    const a = await invoice('10');
    const b = await invoice('20');
    const stale = await req('post', '/patient-payments').send(checkout([a.id, b.id], '29.99'));
    expect(stale.status).toBe(409);
    const balance = await req('post', '/patient-payments').send({
      ...checkout([a.id, b.id], '30'),
      payments: [
        { method: 'CASH', amount: '10' },
        { method: 'BALANCE', amount: '20' },
      ],
    });
    expect(balance.status).toBe(422);
    expect(await prisma.payment.count({ where: { invoiceId: { in: [a.id, b.id] } } })).toBe(0);
    expect(
      (await prisma.invoice.findMany({ where: { id: { in: [a.id, b.id] } } })).every((row) =>
        row.paidTotal.isZero(),
      ),
    ).toBe(true);
    expect((await req('post', '/patient-payments').send(checkout([a.id, a.id], '20'))).status).toBe(
      400,
    );
  });

  it('validates patient, clinic, branch and cashier permissions', async () => {
    const a = await invoice('11');
    const extraPatient = await req('post', '/patients', reception).send({
      firstName: 'Other',
      lastName: 'Patient',
      phone: uniquePhone(),
    });
    const b = await invoice('12', { patientId: extraPatient.body.data.id as string });
    expect((await req('post', '/patient-payments').send(checkout([a.id, b.id], '23'))).status).toBe(
      404,
    );
    expect(
      (await req('post', '/patient-payments', reception).send(checkout([a.id], '11'))).status,
    ).toBe(403);
    expect(
      (
        await req('post', '/patient-payments', foreignCashier, other.branchId).send(
          checkout([a.id], '11'),
        )
      ).status,
    ).toBe(404);
    const branch = await prisma.branch.create({
      data: { clinicId: clinic.clinicId, name: 'Other checkout branch' },
    });
    const c = await invoice('13', { branchId: branch.id });
    expect((await req('post', '/patient-payments').send(checkout([a.id, c.id], '24'))).status).toBe(
      404,
    );
    expect(await prisma.payment.count({ where: { invoiceId: { in: [a.id, b.id, c.id] } } })).toBe(
      0,
    );
  });

  it('rejects aggregate totals beyond the money storage limit without writing payments', async () => {
    const a = await invoice('999999999999.99');
    const b = await invoice('0.01');
    const result = await req('post', '/patient-payments').send(checkout([a.id, b.id], '1000000000000.00'));
    expect(result.status).toBe(400);
    expect(await prisma.payment.count({ where: { invoiceId: { in: [a.id, b.id] } } })).toBe(0);
  });

  it('requires an open shift and keeps all bills unchanged when the shift is closed', async () => {
    const bill = await invoice('15');
    await prisma.cashierShift.updateMany({
      where: { clinicId: clinic.clinicId, branchId: clinic.branchId, status: 'OPEN' },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
    const result = await req('post', '/patient-payments').send(checkout([bill.id], '15'));
    expect(result.status).toBe(409);
    expect(await prisma.payment.count({ where: { invoiceId: bill.id } })).toBe(0);
    expect(
      (await prisma.invoice.findUniqueOrThrow({ where: { id: bill.id } })).paidTotal.isZero(),
    ).toBe(true);
  });
});
