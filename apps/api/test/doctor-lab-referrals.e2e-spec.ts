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

describe('doctor laboratory referrals, payment gate and referral reporting', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let clinic: TestClinic;
  let doctor: LoginResult;
  let otherDoctor: LoginResult;
  let reception: LoginResult;
  let cashier: LoginResult;
  let lab: LoginResult;
  let owner: LoginResult;
  let patientId: string;
  let secondPatientId: string;
  let visitId: string;
  let otherVisitId: string;
  let orderId: string;
  let invoiceId: string;
  let testIds: string[];
  let parameters: Record<string, string>;
  const range = 'from=2026-10-15&to=2026-10-15';
  const get = (path: string, actor = doctor, branchId = clinic.branchId) =>
    request(app.getHttpServer())
      .get(`${API}${path}`)
      .set('Authorization', `Bearer ${actor.accessToken}`)
      .set('x-branch-id', branchId);
  const post = (path: string, actor = doctor) =>
    request(app.getHttpServer())
      .post(`${API}${path}`)
      .set('Authorization', `Bearer ${actor.accessToken}`)
      .set('x-branch-id', clinic.branchId);
  const createReferral = async (actor = doctor, visit = visitId, ids = testIds.slice(0, 1)) => {
    const result = await post(`/visits/${visit}/referrals`, actor).send({
      type: 'LAB',
      labTestIds: ids,
      note: 'Isolated referral test',
      referringDoctorUserId: randomUUID(),
    });
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    return prisma.labOrder.findUniqueOrThrow({
      where: { id: result.body.data.labOrderId as string },
    });
  };

  beforeAll(async () => {
    if (
      process.env.NODE_ENV !== 'test' ||
      new URL(process.env.DATABASE_URL ?? '').pathname !== '/avishifo_finance_migration' ||
      new URL(process.env.REDIS_URL ?? '').pathname !== '/14' ||
      process.env.TELEGRAM_ENABLED !== 'false'
    ) {
      throw new Error(
        'Requires avishifo_finance_migration, Redis14, NODE_ENV=test and TELEGRAM_ENABLED=false',
      );
    }
    prisma = new PrismaClient();
    app = await createApp([]);
    clinic = await createTestClinic(prisma, `doctor-lab-${Date.now()}`);
    const base = await prisma.user.findUniqueOrThrow({ where: { id: clinic.doctor.id } });
    const makeUser = (role: 'LAB_TECH' | 'DOCTOR') =>
      prisma.user.create({
        data: {
          clinicId: clinic.clinicId,
          role,
          fullName: `${role} referral test`,
          email: `${role}-${clinic.tag}@e2e.avishifo.test`,
          phone: uniquePhone(),
          passwordHash: base.passwordHash,
          branches: { create: { clinicId: clinic.clinicId, branchId: clinic.branchId } },
        },
      });
    const laboratory = await makeUser('LAB_TECH');
    const secondDoctor = await makeUser('DOCTOR');
    doctor = await login(app, clinic.doctor.email);
    otherDoctor = await login(app, secondDoctor.email!);
    reception = await login(app, clinic.receptionist.email);
    cashier = await login(app, clinic.cashier.email);
    owner = await login(app, clinic.owner.email);
    lab = await login(app, laboratory.email!);
    const patients = [];
    for (const firstName of ['ReferralOne', 'ReferralTwo']) {
      const created = await post('/patients', reception).send({
        firstName,
        lastName: 'Isolated',
        phone: uniquePhone(),
      });
      expect(created.status).toBe(201);
      patients.push(created.body.data.id as string);
    }
    [patientId, secondPatientId] = patients as [string, string];
    const visit = await prisma.visit.create({
      data: {
        clinicId: clinic.clinicId,
        branchId: clinic.branchId,
        patientId,
        doctorUserId: doctor.user.id,
      },
    });
    visitId = visit.id;
    otherVisitId = (
      await prisma.visit.create({
        data: {
          clinicId: clinic.clinicId,
          branchId: clinic.branchId,
          patientId,
          doctorUserId: otherDoctor.user.id,
        },
      })
    ).id;
    const category = await prisma.serviceCategory.create({
      data: { clinicId: clinic.clinicId, name: 'Referral lab tests', kind: 'LAB' },
    });
    testIds = [];
    parameters = {};
    for (let index = 0; index < 2; index += 1) {
      const service = await prisma.service.create({
        data: {
          clinicId: clinic.clinicId,
          categoryId: category.id,
          code: `REF-SVC-${index}`,
          name: { uz: `Referral test ${index}` },
          prices: {
            create: {
              clinicId: clinic.clinicId,
              price: index ? '200' : '100',
              effectiveFrom: new Date(Date.now() - 60_000),
            },
          },
        },
      });
      const test = await prisma.labTest.create({
        data: {
          clinicId: clinic.clinicId,
          code: `REF-LAB-${index}`,
          name: { uz: `Referral test ${index}` },
          serviceId: service.id,
          parameters: {
            create: { clinicId: clinic.clinicId, name: 'Result', referenceRanges: [] },
          },
        },
        include: { parameters: true },
      });
      testIds.push(test.id);
      parameters[test.id] = test.parameters[0]!.id;
    }
    expect(
      (
        await post('/shifts/open', cashier).send({
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

  it('creates an attributed, priced cashier invoice directly from the treating doctor', async () => {
    const order = await createReferral(doctor, visitId, testIds);
    orderId = order.id;
    invoiceId = order.invoiceId!;
    expect(order.referringDoctorUserId).toBe(doctor.user.id);
    expect(order.referringDoctorName).toContain('DOCTOR');
    const invoice = await get(`/invoices/${invoiceId}`, cashier);
    expect(invoice.status).toBe(200);
    expect(invoice.body.data).toMatchObject({ status: 'ISSUED', total: '300.00' });
    const ownOrders = await get(`/lab-orders?visitId=${visitId}&includeUnpaid=true`);
    expect(ownOrders.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: orderId,
          referringDoctor: expect.objectContaining({ id: doctor.user.id }),
          itemCount: 2,
          tests: expect.arrayContaining([expect.objectContaining({ id: testIds[0] })]),
        }),
      ]),
    );
    expect(
      (
        await post(`/visits/${visitId}/referrals`, otherDoctor).send({
          type: 'LAB',
          labTestIds: testIds,
        })
      ).status,
    ).toBe(403);
    expect(
      (await get('/lab-orders', lab)).body.data.some((item: { id: string }) => item.id === orderId),
    ).toBe(false);
  });

  it('requires full payment before collection and preserves result authorization', async () => {
    expect(
      (await post(`/lab-orders/${orderId}/status`, lab).send({ status: 'SPECIMEN_COLLECTED' }))
        .status,
    ).toBe(409);
    expect(
      (
        await post(`/invoices/${invoiceId}/payments`, cashier).send({
          amount: '100',
          method: 'CASH',
          idempotencyKey: randomUUID(),
        })
      ).status,
    ).toBe(201);
    expect(
      (await post(`/lab-orders/${orderId}/status`, lab).send({ status: 'SPECIMEN_COLLECTED' }))
        .status,
    ).toBe(409);
    expect(
      (
        await post(`/invoices/${invoiceId}/payments`, cashier).send({
          amount: '200',
          method: 'CARD',
          idempotencyKey: randomUUID(),
        })
      ).status,
    ).toBe(201);
    expect(
      (await post(`/lab-orders/${orderId}/status`, doctor).send({ status: 'SPECIMEN_COLLECTED' }))
        .status,
    ).toBe(403);
    expect(
      (await post(`/lab-orders/${orderId}/status`, lab).send({ status: 'SPECIMEN_COLLECTED' }))
        .status,
    ).toBe(201);
    const items = await prisma.labOrderItem.findMany({ where: { orderId } });
    for (const item of items) {
      expect(
        (
          await post(`/lab-orders/items/${item.id}/results`, lab).send({
            values: [{ parameterId: parameters[item.labTestId], value: '5' }],
          })
        ).status,
      ).toBe(201);
    }
    expect((await post(`/lab-orders/${orderId}/approve`, doctor).send({})).status).toBe(403);
    expect((await post(`/lab-orders/${orderId}/approve`, lab).send({})).status).toBe(201);
  });

  it('shows approved results to the referring doctor and allows continuing diagnosis and prescription', async () => {
    const history = await get(`/visits/${visitId}/history`);
    expect(history.status).toBe(200);
    expect(history.body.data.labOrders).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: orderId, status: 'APPROVED' })]),
    );
    const detail = await get(`/lab-orders/${orderId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.items[0].result.approvedAt).toBeTruthy();
    const updated = await request(app.getHttpServer())
      .patch(`${API}/visits/${visitId}`)
      .set('Authorization', `Bearer ${doctor.accessToken}`)
      .set('x-branch-id', clinic.branchId)
      .send({
        assessmentNote: 'Assessment after reviewed laboratory results',
        plan: 'Documented treatment plan',
      });
    expect(updated.status).toBe(200);
    expect(
      (
        await post(`/visits/${visitId}/prescriptions`).send({
          drugName: 'Test prescription',
          dosage: 'Test only',
          frequency: 'once',
          durationDays: 1,
        })
      ).status,
    ).toBe(201);
  });

  it('counts distinct patients, referrals and tests per doctor without cancelled orders or invoices', async () => {
    const additional = await createReferral();
    const second = await createReferral(otherDoctor, otherVisitId);
    const direct = await post('/lab-orders', reception).send({
      patientId: secondPatientId,
      branchId: clinic.branchId,
      testIds: testIds.slice(0, 1),
      referringDoctorUserId: doctor.user.id,
    });
    expect(direct.status).toBe(201);
    expect(direct.body.data.referringDoctor).toBeNull();
    const cancelledOrder = await createReferral();
    await prisma.labOrder.update({
      where: { id: cancelledOrder.id },
      data: { status: 'CANCELLED' },
    });
    const cancelledInvoice = await createReferral();
    await prisma.invoice.update({
      where: { id: cancelledInvoice.invoiceId! },
      data: { status: 'CANCELLED' },
    });
    const outside = await createReferral();
    await prisma.labOrder.updateMany({
      where: { clinicId: clinic.clinicId },
      data: { createdAt: new Date('2026-10-15T10:00:00Z') },
    });
    await prisma.labOrder.update({
      where: { id: orderId },
      data: { createdAt: new Date('2026-10-14T19:00:00Z') },
    });
    await prisma.labOrder.update({
      where: { id: second.id },
      data: { createdAt: new Date('2026-10-15T18:59:59.999Z') },
    });
    await prisma.labOrder.update({
      where: { id: outside.id },
      data: { createdAt: new Date('2026-10-15T19:00:00Z') },
    });
    const result = await get(`/reports/lab-referrals?${range}`, lab);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.data.totals).toEqual({
      patients: 2,
      orders: 4,
      tests: 5,
      paidOrders: 1,
      pendingPaymentOrders: 3,
      approvedOrders: 1,
    });
    const firstDoctor = result.body.data.doctors.find(
      (row: { doctorUserId: string }) => row.doctorUserId === doctor.user.id,
    );
    expect(firstDoctor).toMatchObject({
      patients: 1,
      orders: 2,
      tests: 3,
      paidOrders: 1,
      pendingPaymentOrders: 1,
      approvedOrders: 1,
    });
    expect(firstDoctor.testsBreakdown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ labTestId: testIds[0], patients: 1, orders: 2, tests: 2 }),
      ]),
    );
    expect(result.body.data.periods).toEqual([
      expect.objectContaining({ bucket: '2026-10-15', patients: 2, orders: 4, tests: 5 }),
    ]);
    expect(additional.referringDoctorUserId).toBe(doctor.user.id);
  });

  it('restricts doctor reports to their own referrals and rejects invalid date ranges and unprivileged users', async () => {
    const own = await get(`/reports/lab-referrals?${range}`);
    expect(own.status).toBe(200);
    expect(own.body.data.doctors.map((row: { doctorUserId: string }) => row.doctorUserId)).toEqual([
      doctor.user.id,
    ]);
    expect(own.body.data.totals).toMatchObject({ patients: 1, orders: 2, tests: 3 });
    expect(
      (await get(`/reports/lab-referrals?${range}&doctorUserId=${otherDoctor.user.id}`)).status,
    ).toBe(403);
    expect((await get(`/reports/lab-referrals?${range}`, cashier)).status).toBe(403);
    expect((await get(`/reports/lab-referrals?${range}&export=xlsx`, lab)).status).toBe(403);
    expect((await get('/reports/lab-referrals?from=2026-02-30&to=2026-03-01', lab)).status).toBe(
      400,
    );
    expect((await get('/reports/lab-referrals?from=2026-10-16&to=2026-10-15', lab)).status).toBe(
      400,
    );
  });

  it('isolates clinic and active branch scopes and exports the owner report', async () => {
    const branch = await prisma.branch.create({
      data: { clinicId: clinic.clinicId, name: 'Other referral branch' },
    });
    await prisma.labOrder.create({
      data: {
        clinicId: clinic.clinicId,
        branchId: branch.id,
        patientId,
        orderNumber: `OTHER-${randomUUID()}`,
        referringDoctorUserId: doctor.user.id,
        createdAt: new Date('2026-10-15T10:00:00Z'),
        items: { create: { clinicId: clinic.clinicId, labTestId: testIds[0]! } },
      },
    });
    const report = await get(`/reports/lab-referrals?${range}`, lab);
    expect(report.body.data.totals.orders).toBe(4);
    expect((await get(`/reports/lab-referrals?${range}&branchId=${branch.id}`, lab)).status).toBe(
      403,
    );
    const other = await createTestClinic(prisma, `other-referral-${Date.now()}`);
    const otherOwner = await login(app, other.owner.email);
    const isolated = await get(`/reports/lab-referrals?${range}`, otherOwner, other.branchId);
    expect(isolated.status).toBe(200);
    expect(isolated.body.data.totals.orders).toBe(0);
    await prisma.user.update({ where: { id: otherDoctor.user.id }, data: { fullName: '=1+1' } });
    const exported = await get(`/reports/lab-referrals?${range}&export=xlsx`, owner)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      });
    expect(exported.status).toBe(200);
    expect(exported.headers['content-type']).toContain('spreadsheetml');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exported.body as ExcelJS.Buffer);
    expect(workbook.getWorksheet('Jami')!.getCell('A2').value).toBe(2);
    expect(workbook.getWorksheet('Jami')!.getCell('B2').value).toBe(4);
    expect(workbook.getWorksheet('Jami')!.getCell('C2').value).toBe(5);
    const doctorsSheet = workbook.getWorksheet('Shifokorlar')!;
    const names = Array.from({ length: doctorsSheet.rowCount - 1 }, (_, index) =>
      doctorsSheet.getCell(`A${index + 2}`),
    );
    expect(names.find((cell) => cell.text === '=1+1')?.type).toBe(ExcelJS.ValueType.String);

    expect(exported.headers['content-disposition']).toContain(
      'lab-referrals_2026-10-15_2026-10-15.xlsx',
    );
  });
});
