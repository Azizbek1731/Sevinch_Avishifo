import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { API, createApp, createTestClinic, login, type LoginResult, type TestClinic } from './setup';

/**
 * The two registers, and who is allowed to see which money.
 *
 * Two properties are under test and they are the ones the clinic actually got
 * burned by. First: the transfer register must be a LEDGER — every figure
 * derived from the shift link, so the number a cashier watches all day and the
 * number printed when the drawer closes cannot disagree. Second: a supervisor
 * must be able to see the clinic's money WITHOUT opening a drawer of their own,
 * because doing exactly that is what made two accounts show two different
 * totals and left an owner believing the till was empty.
 */
describe('cash and transfer registers (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let clinic: TestClinic;
  let owner: LoginResult;
  let cashier: LoginResult;
  let recep: LoginResult;
  let patientId: string;
  let serviceId: string;

  const auth = (t: LoginResult) => ({ Authorization: `Bearer ${t.accessToken}`, 'x-branch-id': clinic.branchId });

  function openShift(who: LoginResult, body: Record<string, unknown> = {}) {
    return request(app.getHttpServer())
      .post(`${API}/shifts/open`)
      .set(auth(who))
      .send({ openingCash: '0', ...body });
  }

  function sell(who: LoginResult, payments: Array<{ method: string; amount: string }>, total: string) {
    return request(app.getHttpServer())
      .post(`${API}/invoices/quick`)
      .set(auth(who))
      .send({
        patientId,
        branchId: clinic.branchId,
        lines: [{ serviceId, quantity: 1, unitPrice: total }],
        settle: 'PAY_NOW',
        payments,
        idempotencyKey: randomUUID(),
      });
  }

  async function drawer(who: LoginResult): Promise<Record<string, string>> {
    const res = await request(app.getHttpServer())
      .get(`${API}/shifts/current`)
      .set(auth(who))
      .expect(200);
    return res.body.data as Record<string, string>;
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createApp();
    clinic = await createTestClinic(prisma, 'registers');
    owner = await login(app, clinic.owner.email);
    cashier = await login(app, clinic.cashier.email);
    recep = await login(app, clinic.receptionist.email);

    const patient = await prisma.patient.create({
      data: {
        clinicId: clinic.clinicId,
        mrn: `RG-${randomUUID().slice(0, 6)}`,
        firstName: 'Kassa',
        lastName: 'Sinov',
        fullName: 'Kassa Sinov',
        gender: 'MALE',
      },
    });
    patientId = patient.id;

    const cat = await request(app.getHttpServer())
      .post(`${API}/service-categories`)
      .set(auth(owner))
      .send({ name: 'Registers konsultatsiya', kind: 'CONSULTATION' })
      .expect(201);
    const svc = await request(app.getHttpServer())
      .post(`${API}/services`)
      .set(auth(owner))
      .send({
        categoryId: cat.body.data.id as string,
        code: `RG-${clinic.tag}`,
        name: { uz: 'Registers xizmat' },
        durationMin: 15,
        price: '150000.00',
      })
      .expect(201);
    serviceId = svc.body.data.id as string;

    await openShift(cashier, { openingCash: '100000' }).expect(201);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ------------------------------------------------- the transfer ledger

  it('routes card money into the transfer register and cash into the drawer', async () => {
    await sell(cashier, [{ method: 'CLICK', amount: '300000' }], '300000').expect(201);
    await sell(cashier, [{ method: 'CASH', amount: '50000' }], '50000').expect(201);

    const d = await drawer(cashier);
    expect(d.transferTotal).toBe('300000.00');
    // 100 000 float + 50 000 taken in cash. The card money is not in the drawer.
    expect(d.expectedCashSoFar).toBe('150000.00');
  });

  it('links non-cash payments to the shift rather than guessing from a time window', async () => {
    const shift = await prisma.cashierShift.findFirst({
      where: { cashierUserId: (await prisma.user.findFirstOrThrow({ where: { email: clinic.cashier.email } })).id, status: 'OPEN' },
    });
    const unlinked = await prisma.payment.count({
      where: { clinicId: clinic.clinicId, method: { in: ['CARD', 'CLICK', 'PAYME', 'UZUM'] }, shiftId: null },
    });
    expect(shift).not.toBeNull();
    // Every card row taken at this desk carries the link; none is left to be
    // reconstructed later from who happened to be on shift.
    expect(unlinked).toBe(0);
  });

  it('keeps a patient balance out of both registers — that som was counted on deposit day', async () => {
    await request(app.getHttpServer())
      .post(`${API}/patients/${patientId}/deposits`)
      .set(auth(cashier))
      .send({ patientId, amount: '200000', method: 'CASH' })
      .expect(201);

    const afterDeposit = await drawer(cashier);
    // The notes went into the drawer, so the drawer has to know about them.
    expect(afterDeposit.expectedCashSoFar).toBe('350000.00');
    const transferBefore = afterDeposit.transferTotal;

    await sell(cashier, [{ method: 'BALANCE', amount: '80000' }], '80000').expect(201);

    const after = await drawer(cashier);
    // Spending a deposit moves no money today: neither register may move.
    expect(after.transferTotal).toBe(transferBefore);
    expect(after.expectedCashSoFar).toBe('350000.00');
  });

  // ------------------------------------------------------- closing honestly

  it('refuses to close a register that took card money without an answer for it', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/shifts/close`)
      .set(auth(cashier))
      .send({ actualCash: '350000' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TRANSFER_COUNT_REQUIRED');
  });

  it('accepts "could not check" as a stated reason rather than forcing an invented number', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/shifts/close`)
      .set(auth(cashier))
      .send({ actualCash: '350000', transferUnverifiedReason: 'Terminal hisoboti yarim tunda yopiladi' })
      .expect(201);

    const report = res.body.data.report as Record<string, string | null>;
    expect(report.actualTransfer).toBeNull();
    expect(report.transferDifference).toBeNull();
    expect(report.transferUnverifiedReason).toBe('Terminal hisoboti yarim tunda yopiladi');
    // The cash side still reconciles exactly.
    expect(report.difference).toBe('0.00');
  });

  it('shows the same transfer figure live and at closing', async () => {
    await openShift(cashier, { confirmSecondDrawer: true }).expect(201);
    await sell(cashier, [{ method: 'CARD', amount: '120000' }], '120000').expect(201);

    const live = await drawer(cashier);
    const res = await request(app.getHttpServer())
      .post(`${API}/shifts/close`)
      .set(auth(cashier))
      .send({ actualCash: '0', actualTransfer: live.transferTotal })
      .expect(201);

    const report = res.body.data.report as Record<string, string>;
    expect(report.expectedTransfer).toBe(live.transferTotal);
    // Counted to what the book said, so the two ledgers agree.
    expect(report.transferDifference).toBe('0.00');
  });

  // ------------------------------------------------------- who sees what

  it('warns before a second drawer is opened in a branch that already has one', async () => {
    await openShift(recep).expect(201); // first drawer in the branch now

    const res = await openShift(cashier);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BRANCH_DRAWER_ALREADY_OPEN');
    // Opening one anyway is allowed — two windows at one desk is real — but it
    // has to be deliberate. Accidentally opening one is what started all this.
    await openShift(cashier, { confirmSecondDrawer: true }).expect(201);
  });

  it('tells each cashier whose drawer they are looking at, and that others exist', async () => {
    const mine = await drawer(cashier);
    expect((mine.cashier as unknown as { fullName: string }).fullName).toBeTruthy();
    expect(Number(mine.otherDrawers)).toBeGreaterThan(0);
  });

  it('gives a supervisor the clinic total without making them open a drawer', async () => {
    const res = await request(app.getHttpServer())
      .get(`${API}/shifts/overview`)
      .set(auth(owner))
      .expect(200);

    const data = res.body.data as {
      registers: Array<{ cashier: { fullName: string }; expectedCash: string }>;
      totals: { expectedCash: string; openDrawers: number };
    };
    expect(data.registers.length).toBe(2);
    for (const r of data.registers) expect(r.cashier.fullName).toBeTruthy();

    const summed = data.registers.reduce((acc, r) => acc + Number(r.expectedCash), 0);
    expect(Number(data.totals.expectedCash)).toBe(summed);
    expect(data.totals.openDrawers).toBe(2);

    // The owner holds no drawer of their own, and does not need one.
    const own = await request(app.getHttpServer())
      .get(`${API}/shifts/current`)
      .set(auth(owner))
      .expect(200);
    expect(own.body.data?.open).not.toBe(true);
  });

  it('keeps the clinic-wide view away from a cashier', async () => {
    await request(app.getHttpServer())
      .get(`${API}/shifts/overview`)
      .set(auth(cashier))
      .expect(403);
  });

  // ------------------------------------------------ undoing a wrong entry

  it('lists this drawer own payments so a wrong one can be found and undone', async () => {
    const sale = await sell(cashier, [{ method: 'CASH', amount: '77000' }], '77000').expect(201);
    expect(sale.body.data.invoice.id).toBeTruthy();

    const res = await request(app.getHttpServer())
      .get(`${API}/shifts/current/payments`)
      .set(auth(cashier))
      .expect(200);

    const rows = res.body.data as Array<{ id: string; amount: string; patientName: string | null }>;
    const row = rows.find((r) => r.amount === '77000.00');
    expect(row).toBeTruthy();
    expect(row?.patientName).toBe('Kassa Sinov');

    await request(app.getHttpServer())
      .post(`${API}/invoices/payments/${row!.id}/void`)
      .set(auth(cashier))
      .send({ reason: 'Xato summa' })
      .expect(200);

    const after = await drawer(cashier);
    const stillCounted = (await request(app.getHttpServer())
      .get(`${API}/shifts/current/payments`)
      .set(auth(cashier))
      .expect(200)).body.data as Array<{ id: string; status: string }>;
    expect(stillCounted.find((r) => r.id === row!.id)?.status).toBe('VOIDED');
    // The drawer stops expecting money it never should have been told about.
    expect(Number(after.cashIn)).toBe(0);
  });

  it('refuses to unwind a payment that belongs to a signed-off shift', async () => {
    const sale = await sell(cashier, [{ method: 'CASH', amount: '25000' }], '25000').expect(201);
    const detail = await request(app.getHttpServer())
      .get(`${API}/invoices/${sale.body.data.invoice.id}`)
      .set(auth(cashier))
      .expect(200);
    const paymentId = detail.body.data.payments[0].id as string;

    await request(app.getHttpServer())
      .post(`${API}/shifts/close`)
      .set(auth(cashier))
      .send({ actualCash: '25000', transferUnverifiedReason: 'Yo‘q' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`${API}/invoices/payments/${paymentId}/void`)
      .set(auth(cashier))
      .send({});
    expect(res.status).toBe(409);
  });
});
