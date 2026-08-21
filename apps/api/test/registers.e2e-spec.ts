import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { API, createApp, createTestClinic, login, type LoginResult, type TestClinic } from './setup';

/**
 * ONE register per branch, two books inside it.
 *
 * The model under test is the owner's decision after living with per-user
 * drawers: a clinic runs one physical cash box, so the register belongs to the
 * branch. Whoever opens it enters a starting figure for BOTH books — cash in
 * the box, transfer per the terminal/PSP — and closing counts both the same
 * way. Everyone at the desk reads the same numbers; every payment still
 * records who took it.
 */
describe('the branch register (e2e)', () => {
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
      .send({ openingCash: '0', openingTransfer: '0', ...body });
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

  async function register(who: LoginResult): Promise<Record<string, string>> {
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
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ------------------------------------------------- opening with two books

  it('opens with a starting figure for each book and reports both', async () => {
    await openShift(cashier, { openingCash: '100000', openingTransfer: '500000' }).expect(201);

    const r = await register(cashier);
    expect(r.openingCash).toBe('100000.00');
    expect(r.openingTransfer).toBe('500000.00');
    expect(r.expectedCashSoFar).toBe('100000.00');
    // The transfer book starts at what the terminal/PSP held, not at zero.
    expect(r.transferTotal).toBe('500000.00');
  });

  it('refuses a second register while one is open, whoever asks', async () => {
    const res = await openShift(owner, { openingCash: '1' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SHIFT_ALREADY_OPEN');
  });

  // ------------------------------------------------------------ the two books

  it('routes card money into the transfer book and cash into the drawer', async () => {
    await sell(cashier, [{ method: 'CLICK', amount: '300000' }], '300000').expect(201);
    await sell(cashier, [{ method: 'CASH', amount: '50000' }], '50000').expect(201);

    const r = await register(cashier);
    expect(r.transferTotal).toBe('800000.00'); // 500 000 opening + 300 000 turnover
    expect(r.expectedCashSoFar).toBe('150000.00');
  });

  it('shows reception exactly what the cashier sees — it is the same register', async () => {
    const before = await register(recep);
    const cashierView = await register(cashier);
    expect(before.expectedCashSoFar).toBe(cashierView.expectedCashSoFar);
    expect(before.transferTotal).toBe(cashierView.transferTotal);

    // Reception takes a payment; it lands in THE register, visible to both.
    await sell(recep, [{ method: 'CASH', amount: '30000' }], '30000').expect(201);
    const after = await register(cashier);
    expect(after.expectedCashSoFar).toBe('180000.00');
  });

  it('links non-cash payments to the shift rather than guessing from a time window', async () => {
    const unlinked = await prisma.payment.count({
      where: { clinicId: clinic.clinicId, method: { in: ['CARD', 'CLICK', 'PAYME', 'UZUM'] }, shiftId: null },
    });
    expect(unlinked).toBe(0);
  });

  it('keeps a patient balance out of both books — that som was counted on deposit day', async () => {
    await request(app.getHttpServer())
      .post(`${API}/patients/${patientId}/deposits`)
      .set(auth(cashier))
      .send({ patientId, amount: '200000', method: 'CASH' })
      .expect(201);

    const afterDeposit = await register(cashier);
    expect(afterDeposit.expectedCashSoFar).toBe('380000.00');
    const transferBefore = afterDeposit.transferTotal;

    await sell(cashier, [{ method: 'BALANCE', amount: '80000' }], '80000').expect(201);

    const after = await register(cashier);
    expect(after.transferTotal).toBe(transferBefore);
    expect(after.expectedCashSoFar).toBe('380000.00');
  });

  // ------------------------------------------------------- closing both books

  it('refuses to close without answering for the transfer book', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/shifts/close`)
      .set(auth(cashier))
      .send({ actualCash: '380000' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TRANSFER_COUNT_REQUIRED');
  });

  it('lets anyone with shifts.manage close it, counting both books', async () => {
    const live = await register(cashier);

    // Reception closes what the cashier opened — the register is the branch's.
    const res = await request(app.getHttpServer())
      .post(`${API}/shifts/close`)
      .set(auth(recep))
      .send({ actualCash: '380000', actualTransfer: live.transferTotal })
      .expect(201);

    const report = res.body.data.report as Record<string, string | null>;
    expect(report.openingTransfer).toBe('500000.00');
    // The closing figure IS the live figure — one ledger, one rule.
    expect(report.expectedTransfer).toBe(live.transferTotal);
    expect(report.transferDifference).toBe('0.00');
    expect(report.difference).toBe('0.00');

    const shift = res.body.data.shift as Record<string, string>;
    expect(shift.cashierUserId).toBe(cashier.user.id); // who opened
    expect(shift.closedById).toBe(recep.user.id); // who counted it out
  });

  it('accepts "could not check" as a stated reason rather than forcing an invented number', async () => {
    await openShift(cashier).expect(201);
    await sell(cashier, [{ method: 'CARD', amount: '120000' }], '120000').expect(201);

    const res = await request(app.getHttpServer())
      .post(`${API}/shifts/close`)
      .set(auth(cashier))
      .send({ actualCash: '0', transferUnverifiedReason: 'Terminal hisoboti yarim tunda yopiladi' })
      .expect(201);

    const report = res.body.data.report as Record<string, string | null>;
    expect(report.actualTransfer).toBeNull();
    expect(report.transferDifference).toBeNull();
    expect(report.transferUnverifiedReason).toBe('Terminal hisoboti yarim tunda yopiladi');
  });

  // ------------------------------------------------------- oversight

  it('gives a supervisor the register without making them open anything', async () => {
    await openShift(cashier, { openingCash: '50000', openingTransfer: '70000' }).expect(201);

    const res = await request(app.getHttpServer())
      .get(`${API}/shifts/overview`)
      .set(auth(owner))
      .expect(200);

    const data = res.body.data as {
      registers: Array<{ cashier: { fullName: string }; expectedCash: string; transferTotal: string }>;
      totals: { expectedCash: string; openDrawers: number };
    };
    expect(data.registers.length).toBe(1);
    expect(data.registers[0]!.expectedCash).toBe('50000.00');
    expect(data.registers[0]!.transferTotal).toBe('70000.00');
    expect(data.totals.openDrawers).toBe(1);
  });

  it('keeps the clinic-wide view away from a cashier', async () => {
    await request(app.getHttpServer())
      .get(`${API}/shifts/overview`)
      .set(auth(cashier))
      .expect(403);
  });

  // ------------------------------------------------ undoing a wrong entry

  it('lists the register payments for everyone at the desk, and undoes into it', async () => {
    await sell(cashier, [{ method: 'CASH', amount: '77000' }], '77000').expect(201);

    // Reception sees the same list — same register.
    const res = await request(app.getHttpServer())
      .get(`${API}/shifts/current/payments`)
      .set(auth(recep))
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

    const after = await register(cashier);
    expect(Number(after.cashIn)).toBe(0);
    expect(after.expectedCashSoFar).toBe('50000.00');
  });

  it('refuses to unwind a payment that belongs to a signed-off register', async () => {
    const sale = await sell(cashier, [{ method: 'CASH', amount: '25000' }], '25000').expect(201);
    const detail = await request(app.getHttpServer())
      .get(`${API}/invoices/${sale.body.data.invoice.id}`)
      .set(auth(cashier))
      .expect(200);
    const paymentId = detail.body.data.payments[0].id as string;

    await request(app.getHttpServer())
      .post(`${API}/shifts/close`)
      .set(auth(cashier))
      .send({ actualCash: '75000', transferUnverifiedReason: 'Yo‘q' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`${API}/invoices/payments/${paymentId}/void`)
      .set(auth(cashier))
      .send({});
    expect(res.status).toBe(409);

    // And a second close cannot overwrite the signed-off report — the claim
    // is status-guarded, so the late closer is told, not obeyed.
    const again = await request(app.getHttpServer())
      .post(`${API}/shifts/close`)
      .set(auth(recep))
      .send({ actualCash: '0', transferUnverifiedReason: 'Kech qoldim' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('SHIFT_NOT_OPEN');
  });
});
