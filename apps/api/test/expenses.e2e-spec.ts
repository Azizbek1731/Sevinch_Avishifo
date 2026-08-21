import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { API, createApp, createTestClinic, login, type LoginResult, type TestClinic } from './setup';

/**
 * Recording what the clinic spends.
 *
 * The property worth testing is not that a row can be written — it is that cash
 * leaving the drawer is subtracted from what that drawer is expected to hold.
 * Without it the cashier counts short at closing time for money the clinic
 * itself told them to spend, and a shortfall that has an innocent explanation
 * looks exactly like one that does not.
 */
describe('expenses (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let clinic: TestClinic;
  let owner: LoginResult;
  let cashier: LoginResult;
  let categoryId: string;

  /**
   * Records an expense as the cashier, against their open drawer. Returns the
   * supertest request itself rather than awaiting it, so callers can chain
   * .expect() for the happy path or inspect the status for the refusals.
   */
  function addExpense(body: Record<string, unknown>, token = cashier.accessToken) {
    return request(app.getHttpServer())
      .post(`${API}/expenses`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-branch-id', clinic.branchId)
      .send({ categoryId, date: new Date().toISOString().slice(0, 10), ...body });
  }

  /** What the cashier's open drawer currently says it should hold. */
  async function drawer(): Promise<{ expectedCashSoFar: string; expenseOut: string }> {
    const res = await request(app.getHttpServer())
      .get(`${API}/shifts/current`)
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .set('x-branch-id', clinic.branchId)
      .expect(200);
    return res.body.data as { expectedCashSoFar: string; expenseOut: string };
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createApp();
    clinic = await createTestClinic(prisma, 'expense');
    owner = await login(app, clinic.owner.email);
    cashier = await login(app, clinic.cashier.email);

    const cat = await request(app.getHttpServer())
      .post(`${API}/expense-categories`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set('x-branch-id', clinic.branchId)
      .send({ name: 'Xo‘jalik mollari' })
      .expect(201);
    categoryId = cat.body.data.id as string;

    await request(app.getHttpServer())
      .post(`${API}/shifts/open`)
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .set('x-branch-id', clinic.branchId)
      .send({ openingCash: '500000' })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ------------------------------------------------------------ the drawer

  it('takes a cash expense straight out of the open drawer', async () => {
    const before = await drawer();
    await addExpense({ amount: '120000', method: 'CASH', note: 'Salfetka' }).expect(201);
    const after = await drawer();

    expect(Number(after.expectedCashSoFar)).toBe(Number(before.expectedCashSoFar) - 120000);
    expect(Number(after.expenseOut)).toBe(Number(before.expenseOut) + 120000);
  });

  it('leaves the drawer alone for money that never passed through it', async () => {
    const before = await drawer();
    await addExpense({ amount: '900000', method: 'CLICK', note: 'Ijara' }).expect(201);
    const after = await drawer();

    expect(after.expectedCashSoFar).toBe(before.expectedCashSoFar);
    expect(after.expenseOut).toBe(before.expenseOut);
  });

  it('refuses cash with no drawer open rather than inventing one', async () => {
    // The owner has expenses.write but has not opened a register.
    const res = await addExpense({ amount: '10000', method: 'CASH' }, owner.accessToken);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SHIFT_NOT_OPEN');
  });

  it('still lets the owner record spending that did not come from a till', async () => {
    await addExpense({ amount: '75000', method: 'CARD' }, owner.accessToken).expect(201);
  });

  it('puts the money back when the expense is withdrawn', async () => {
    const created = await addExpense({ amount: '40000', method: 'CASH' }).expect(201);
    const mid = await drawer();

    await request(app.getHttpServer())
      .delete(`${API}/expenses/${created.body.data.id}`)
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .expect(200);

    const after = await drawer();
    expect(Number(after.expectedCashSoFar)).toBe(Number(mid.expectedCashSoFar) + 40000);
  });

  // ------------------------------------------------------- what stays visible

  it('hides a withdrawn expense from the desk but keeps it for management', async () => {
    const created = await addExpense({ amount: '33000', method: 'CASH', note: 'Xato' }).expect(201);
    const id = created.body.data.id as string;
    await request(app.getHttpServer())
      .delete(`${API}/expenses/${id}`)
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .expect(200);

    const desk = await request(app.getHttpServer())
      .get(`${API}/expenses`)
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .query({ limit: 100 })
      .expect(200);
    expect((desk.body.data.items as Array<{ id: string }>).some((e) => e.id === id)).toBe(false);

    const management = await request(app.getHttpServer())
      .get(`${API}/expenses`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .query({ limit: 100, deleted: true })
      .expect(200);
    const row = (management.body.data.items as Array<{ id: string; deletedAt: string | null }>).find(
      (e) => e.id === id,
    );
    expect(row?.deletedAt).toBeTruthy();
  });

  it('ignores the show-deleted flag from someone not allowed to use it', async () => {
    const created = await addExpense({ amount: '21000', method: 'CASH' }).expect(201);
    const id = created.body.data.id as string;
    await request(app.getHttpServer())
      .delete(`${API}/expenses/${id}`)
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .expect(200);

    const res = await request(app.getHttpServer())
      .get(`${API}/expenses`)
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .query({ limit: 100, deleted: true })
      .expect(200);
    expect((res.body.data.items as Array<{ id: string }>).some((e) => e.id === id)).toBe(false);
  });

  it('keeps the headline total free of withdrawn rows', async () => {
    const before = await request(app.getHttpServer())
      .get(`${API}/expenses`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .query({ limit: 100 })
      .expect(200);

    const created = await addExpense({ amount: '55000', method: 'CASH' }).expect(201);
    await request(app.getHttpServer())
      .delete(`${API}/expenses/${created.body.data.id}`)
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .expect(200);

    const after = await request(app.getHttpServer())
      .get(`${API}/expenses`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .query({ limit: 100 })
      .expect(200);
    expect(after.body.data.sum).toBe(before.body.data.sum);
  });

  // ------------------------------------------------------------- guard rails

  it('records the branch from the verified header, not the request body', async () => {
    const res = await addExpense({
      amount: '15000',
      method: 'CARD',
      branchId: randomUUID(),
    }).expect(201);
    expect(res.body.data.branchId).toBe(clinic.branchId);
  });

  it('refuses to move an expense between the drawer and the bank', async () => {
    const created = await addExpense({ amount: '18000', method: 'CASH' }).expect(201);
    const res = await request(app.getHttpServer())
      .patch(`${API}/expenses/${created.body.data.id}`)
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .set('x-branch-id', clinic.branchId)
      .send({ method: 'CARD' });
    expect(res.status).toBe(409);
  });

  it('rejects a zero or negative amount', async () => {
    await addExpense({ amount: '0', method: 'CARD' }).expect(400);
    await addExpense({ amount: '-5000', method: 'CARD' }).expect(400);
  });

  it('will not file an expense under a category that does not exist', async () => {
    const res = await addExpense({ amount: '1000', method: 'CARD', categoryId: randomUUID() });
    expect(res.status).toBe(404);
  });

  it('refuses a caller without the permission', async () => {
    // Reception and the cash desk may both record spending; clinical roles may not.
    const doctor = await login(app, clinic.doctor.email);
    await request(app.getHttpServer())
      .post(`${API}/expenses`)
      .set('Authorization', `Bearer ${doctor.accessToken}`)
      .set('x-branch-id', clinic.branchId)
      .send({ categoryId, amount: '1000', method: 'CARD', date: '2026-08-21' })
      .expect(403);
  });

  it('charges reception spending to reception own drawer, not the cash desk', async () => {
    // The case this exists for: two people hold a drawer in the same branch at
    // the same time. Money the receptionist takes out must leave HER till —
    // charging the cashier's would make the cashier short for a purchase she
    // never saw, which is the exact failure the whole feature prevents.
    const recep = await login(app, clinic.receptionist.email);
    await request(app.getHttpServer())
      .post(`${API}/shifts/open`)
      .set('Authorization', `Bearer ${recep.accessToken}`)
      .set('x-branch-id', clinic.branchId)
      .send({ openingCash: '300000', confirmSecondDrawer: true })
      .expect(201);

    const cashierBefore = await drawer();

    await request(app.getHttpServer())
      .post(`${API}/expenses`)
      .set('Authorization', `Bearer ${recep.accessToken}`)
      .set('x-branch-id', clinic.branchId)
      .send({ categoryId, amount: '70000', method: 'CASH', date: new Date().toISOString().slice(0, 10) })
      .expect(201);

    const recepDrawer = await request(app.getHttpServer())
      .get(`${API}/shifts/current`)
      .set('Authorization', `Bearer ${recep.accessToken}`)
      .set('x-branch-id', clinic.branchId)
      .expect(200);
    expect(Number(recepDrawer.body.data.expenseOut)).toBe(70000);
    expect(Number(recepDrawer.body.data.expectedCashSoFar)).toBe(230000);

    const cashierAfter = await drawer();
    expect(cashierAfter.expectedCashSoFar).toBe(cashierBefore.expectedCashSoFar);
    expect(cashierAfter.expenseOut).toBe(cashierBefore.expenseOut);

    // Leave the branch as this suite found it: the closing test below counts
    // the cashier's drawer and a second open one changes nothing for it, but
    // an abandoned drawer would confuse anything added after.
    await request(app.getHttpServer())
      .post(`${API}/shifts/close`)
      .set('Authorization', `Bearer ${recep.accessToken}`)
      .set('x-branch-id', clinic.branchId)
      .send({ actualCash: '230000', transferUnverifiedReason: 'Sinov' })
      .expect(201);
  });

  // ------------------------------------------------------------ closing time
  // Kept last: closing the shift ends the drawer every test above relies on.

  it('accounts for the spending in the closing report and locks it afterwards', async () => {
    const open = await drawer();
    const spent = Number(open.expenseOut);
    expect(spent).toBeGreaterThan(0);

    const last = await addExpense({ amount: '12000', method: 'CASH' }).expect(201);
    const lastId = last.body.data.id as string;
    const expected = Number(open.expectedCashSoFar) - 12000;

    const closed = await request(app.getHttpServer())
      .post(`${API}/shifts/close`)
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .set('x-branch-id', clinic.branchId)
      .send({ actualCash: String(expected) })
      .expect(201);

    const report = closed.body.data.report as Record<string, string>;
    expect(Number(report.expenseOut)).toBe(spent + 12000);
    expect(Number(report.expectedCash)).toBe(expected);
    // Counted to the figure the report predicted, so the drawer balances.
    expect(Number(report.difference)).toBe(0);

    // The shift has been signed off; its rows are history now.
    await request(app.getHttpServer())
      .delete(`${API}/expenses/${lastId}`)
      .set('Authorization', `Bearer ${cashier.accessToken}`)
      .expect(409);
  });
});
