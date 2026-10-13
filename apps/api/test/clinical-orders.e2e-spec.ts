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

describe('paid consultation and ultrasound workflow', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let clinic: TestClinic;
  let reception: LoginResult;
  let cashier: LoginResult;
  let doctor: LoginResult;
  let owner: LoginResult;
  let patientId: string;
  let consult: string;
  let ultrasound: string;
  let additional: string;
  let consultationVisitId: string;
  let ultrasoundVisitId: string;
  let secondDoctor: LoginResult;
  const req = (method: 'get' | 'post' | 'patch', path: string, user: LoginResult = reception) =>
    request(app.getHttpServer())
      [method](`${API}${path}`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .set('x-branch-id', clinic.branchId);
  const pay = async (invoiceId: string, amount: string) => {
    const result = await req('post', `/invoices/${invoiceId}/payments/split`, cashier).send({
      payments: [{ method: 'CASH', amount }],
      idempotencyKey: randomUUID(),
    });
    expect(result.status, JSON.stringify(result.body)).toBe(201);
  };
  const create = async (kind: 'CONSULTATION' | 'ULTRASOUND', doctorUserId = clinic.doctor.id) => {
    const body = {
      patientId,
      branchId: clinic.branchId,
      doctorUserId,
      kind,
      serviceIds: [kind === 'ULTRASOUND' ? ultrasound : consult],
      idempotencyKey: randomUUID(),
    };
    const res = await req('post', '/clinical-orders').send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return { data: res.body.data, body };
  };
  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL ?? '').pathname;
    if (!/^\/(?:avishifo_finance_|.*(?:test|e2e))/.test(database))
      throw new Error('Use an isolated test database');
    process.env.SINGLE_CLINIC_MODE = 'true';
    prisma = new PrismaClient();
    app = await createApp([]);
    clinic = await createTestClinic(prisma, 'outpatient');
    reception = await login(app, clinic.receptionist.email);
    cashier = await login(app, clinic.cashier.email);
    doctor = await login(app, clinic.doctor.email);
    owner = await login(app, clinic.owner.email);
    const patient = await req('post', '/patients').send({
      firstName: 'Sinov',
      lastName: 'Ambulator',
      phone: uniquePhone(),
    });
    expect(patient.status).toBe(201);
    patientId = patient.body.data.id as string;
    const shift = await req('post', '/shifts/open', cashier).send({
      openingCash: '0',
      openingCard: '0',
      openingClick: '0',
    });
    expect(shift.status, JSON.stringify(shift.body)).toBe(201);
    for (const kind of ['CONSULTATION', 'ULTRASOUND'] as const) {
      const category = await prisma.serviceCategory.create({
        data: { clinicId: clinic.clinicId, name: kind, kind },
      });
      const service = await prisma.service.create({
        data: {
          clinicId: clinic.clinicId,
          categoryId: category.id,
          code: kind,
          name: { uz: kind },
          prices: {
            create: {
              clinicId: clinic.clinicId,
              price: '100',
              effectiveFrom: new Date('2020-01-01'),
            },
          },
        },
      });
      if (kind === 'CONSULTATION') consult = service.id;
      else {
        ultrasound = service.id;
        const extra = await prisma.service.create({
          data: {
            clinicId: clinic.clinicId,
            categoryId: category.id,
            code: 'EXTRA',
            name: { uz: 'Qo‘shimcha UZI' },
            prices: {
              create: {
                clinicId: clinic.clinicId,
                price: '50',
                effectiveFrom: new Date('2020-01-01'),
              },
            },
          },
        });
        additional = extra.id;
      }
    }
    const base = await prisma.user.findUniqueOrThrow({ where: { id: clinic.doctor.id } });
    const second = await prisma.user.create({
      data: {
        clinicId: clinic.clinicId,
        role: 'DOCTOR',
        status: 'ACTIVE',
        fullName: 'Boshqa shifokor',
        email: `${randomUUID()}@clinical.e2e.test`,
        passwordHash: base.passwordHash,
        branches: { create: { clinicId: clinic.clinicId, branchId: clinic.branchId } },
      },
    });
    secondDoctor = await login(app, second.email!);
  });
  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('reception can choose bookable doctors without access to private staff records', async () => {
    expect((await req('get', '/staff?role=DOCTOR')).status).toBe(403);
    const otherBranch = await prisma.branch.create({
      data: { clinicId: clinic.clinicId, name: 'Other booking branch' },
    });
    const base = await prisma.user.findUniqueOrThrow({ where: { id: clinic.doctor.id } });
    for (const variant of ['INACTIVE', 'DELETED', 'OTHER_BRANCH'] as const) {
      await prisma.user.create({
        data: {
          clinicId: clinic.clinicId,
          role: 'DOCTOR',
          status: variant === 'INACTIVE' ? 'SUSPENDED' : 'ACTIVE',
          deletedAt: variant === 'DELETED' ? new Date() : null,
          fullName: `Excluded ${variant}`,
          email: `${randomUUID()}@booking.e2e.test`,
          passwordHash: base.passwordHash,
          branches: {
            create: {
              clinicId: clinic.clinicId,
              branchId: variant === 'OTHER_BRANCH' ? otherBranch.id : clinic.branchId,
            },
          },
        },
      });
    }
    await createTestClinic(prisma, 'other-booking-clinic');
    const listed = await req('get', '/clinical-orders/doctors');
    expect(listed.status, JSON.stringify(listed.body)).toBe(200);
    expect(listed.body.data.map((item: { id: string }) => item.id).sort()).toEqual(
      [clinic.doctor.id, secondDoctor.user.id].sort(),
    );
    for (const item of listed.body.data) {
      expect(Object.keys(item).sort()).toEqual(['fullName', 'id', 'specialty']);
    }
    expect((await req('get', '/clinical-orders/doctors', cashier)).status).toBe(403);
    expect(
      (await req('get', '/clinical-orders/doctors').set('x-branch-id', otherBranch.id)).status,
    ).toBe(403);
  });

  it('reception creates a priced invoice once; unpaid and partially paid care cannot start', async () => {
    const { data: order, body } = await create('CONSULTATION');
    expect(order.status).toBe('WAITING_PAYMENT');
    expect(order.invoice.total).toBe('100.00');
    const replay = await req('post', '/clinical-orders').send(body);
    expect(replay.body.data.id).toBe(order.id);
    const mismatch = await req('post', '/clinical-orders').send({
      ...body,
      note: 'different order',
    });
    expect(mismatch.status).toBe(409);
    expect(
      (
        await req('post', '/clinical-orders', cashier).send({
          ...body,
          idempotencyKey: randomUUID(),
        })
      ).status,
    ).toBe(403);
    expect((await req('post', `/clinical-orders/${order.id}/start`, secondDoctor)).status).toBe(
      404,
    );
    expect((await req('post', `/clinical-orders/${order.id}/start`, doctor)).status).toBe(409);
    await pay(order.invoice.id, '40');
    expect((await req('post', `/clinical-orders/${order.id}/start`, doctor)).status).toBe(409);
    await pay(order.invoice.id, '60');
    const ready = await req('get', '/clinical-orders?status=READY&mine=true', doctor);
    expect(ready.body.data.some((o: { id: string }) => o.id === order.id)).toBe(true);
    const starts = await Promise.all([
      req('post', `/clinical-orders/${order.id}/start`, doctor),
      req('post', `/clinical-orders/${order.id}/start`, doctor),
    ]);
    expect(starts.map((res) => res.status)).toEqual([201, 201]);
    consultationVisitId = starts[0]!.body.data.visitId as string;
    expect(starts[1]!.body.data.visitId).toBe(consultationVisitId);
    expect((await req('post', '/visits', doctor).send({ patientId })).status).toBe(409);
  });

  it('doctor records diagnosis and prescription, confirms, prints; confirmed records reject ordinary edits', async () => {
    expect((await req('get', `/visits/${consultationVisitId}/pdf`, doctor)).status).toBe(409);
    expect((await req('post', `/visits/${consultationVisitId}/complete`, doctor)).status).toBe(400);
    const saved = await req('patch', `/visits/${consultationVisitId}`, doctor).send({
      subjective: 'Sinov shikoyati',
      assessmentNote: 'Sinov tashxisi',
      plan: 'Sinov tavsiyalari',
    });
    expect(saved.status).toBe(200);
    const rx = await req('post', `/visits/${consultationVisitId}/prescriptions`, doctor).send({
      drugName: 'Sinov dori',
      dosage: 'Sinov',
      durationDays: 2,
    });
    expect(rx.status).toBe(201);
    expect((await req('post', `/visits/${consultationVisitId}/complete`, doctor)).status).toBe(201);
    expect(
      (await req('patch', `/visits/${consultationVisitId}`, doctor).send({ plan: 'Silent edit' }))
        .status,
    ).toBe(423);
    expect(
      (
        await req('post', `/visits/${consultationVisitId}/prescriptions`, doctor).send({
          drugName: 'Silent drug',
        })
      ).status,
    ).toBe(423);
    const pdf = await req('get', `/visits/${consultationVisitId}/pdf`, doctor);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.body.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('ultrasound extras issue one separate invoice; unpaid extras block confirmation', async () => {
    const { data: order } = await create('ULTRASOUND');
    await pay(order.invoice.id, '100');
    const started = await req('post', `/clinical-orders/${order.id}/start`, doctor);
    expect(started.status).toBe(201);
    ultrasoundVisitId = started.body.data.visitId as string;
    const saved = await req('patch', `/visits/${ultrasoundVisitId}`, doctor).send({
      reportTitle: 'UZI sinov xulosasi',
      reportBody: 'Birinchi sahifa.\n'.repeat(60),
      assessmentNote: 'Sinov xulosasi',
      plan: 'Sinov tavsiyasi',
    });
    expect(saved.status).toBe(200);
    expect(saved.body.data.kind).toBe('ULTRASOUND');
    expect(saved.body.data.clinicalOrderId).toBe(order.id);
    const body = { serviceIds: [additional], idempotencyKey: randomUUID() };
    const extras = await Promise.all([
      req('post', `/clinical-orders/${order.id}/services`, doctor).send(body),
      req('post', `/clinical-orders/${order.id}/services`, doctor).send(body),
    ]);
    expect(extras.map((res) => res.status)).toEqual([201, 201]);
    const invoiceId = extras[0]!.body.data.invoiceId as string;
    expect(extras[1]!.body.data.invoiceId).toBe(invoiceId);
    expect(
      (
        await req('post', `/clinical-orders/${order.id}/services`, doctor).send({
          ...body,
          idempotencyKey: randomUUID(),
        })
      ).status,
    ).toBe(409);
    expect((await req('post', `/visits/${ultrasoundVisitId}/complete`, doctor)).status).toBe(409);
    await pay(invoiceId, '50');
    expect((await req('post', `/visits/${ultrasoundVisitId}/complete`, doctor)).status).toBe(201);
    expect(
      (
        await req('post', `/clinical-orders/${order.id}/services`, doctor).send({
          serviceIds: [additional],
          idempotencyKey: randomUUID(),
        })
      ).status,
    ).toBe(409);
    expect((await req('get', `/visits/${ultrasoundVisitId}/pdf`, doctor)).status).toBe(200);
    expect(
      (
        await req('post', `/visits/${ultrasoundVisitId}/amendments`, doctor).send({
          reason: 'Invalid correction',
          reportBody: '   ',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await req('post', `/visits/${ultrasoundVisitId}/amendments`, doctor).send({
          reason: 'Corrected report wording',
          reportBody: 'Corrected ultrasound report',
        })
      ).status,
    ).toBe(201);
  });

  it('another treating doctor sees prior confirmed reports but cannot edit them', async () => {
    expect((await req('get', `/visits/${consultationVisitId}`, secondDoctor)).status).toBe(403);
    const { data: order } = await create('CONSULTATION', secondDoctor.user.id);
    await pay(order.invoice.id, '100');
    const started = await req('post', `/clinical-orders/${order.id}/start`, secondDoctor);
    const history = await req('get', `/visits/${started.body.data.visitId}/history`, secondDoctor);
    expect(history.status).toBe(200);
    expect(history.body.data.visits.map((v: { id: string }) => v.id)).toEqual(
      expect.arrayContaining([consultationVisitId, ultrasoundVisitId]),
    );
    expect((await req('get', `/visits/${ultrasoundVisitId}/pdf`, secondDoctor)).status).toBe(200);
    const chart = await req('get', `/visits?patientId=${patientId}`, secondDoctor);
    expect(chart.body.data.map((v: { id: string }) => v.id)).toEqual(
      expect.arrayContaining([consultationVisitId, ultrasoundVisitId]),
    );
    expect(
      (
        await req('patch', `/visits/${ultrasoundVisitId}`, secondDoctor).send({
          reportBody: 'Unauthorized edit',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await req('post', `/visits/${ultrasoundVisitId}/amendments`, secondDoctor).send({
          reason: 'Unauthorized change',
          reportBody: 'changed',
        })
      ).status,
    ).toBe(403);
  });

  it('returned payments remove unfinished care from the paid worklist', async () => {
    const { data: order } = await create('CONSULTATION');
    await pay(order.invoice.id, '100');
    const refund = await req('post', `/invoices/${order.invoice.id}/refunds`, cashier).send({
      method: 'CASH',
      amount: '20',
      reason: 'Cancelled examination',
    });
    expect(refund.status, JSON.stringify(refund.body)).toBe(201);
    expect((await req('post', `/clinical-orders/${order.id}/start`, doctor)).status).toBe(409);
    const cancelled = await req('get', '/clinical-orders?status=CANCELLED', doctor);
    expect(cancelled.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: order.id,
          status: 'CANCELLED',
          invoice: expect.objectContaining({ due: '20.00', paidTotal: '80.00' }),
        }),
      ]),
    );
    const active = await req('get', '/clinical-orders?status=READY', doctor);
    expect(active.body.data.some((item: { id: string }) => item.id === order.id)).toBe(false);

    const { data: uzi } = await create('ULTRASOUND');
    await pay(uzi.invoice.id, '100');
    const started = await req('post', `/clinical-orders/${uzi.id}/start`, doctor);
    const extra = await req('post', `/clinical-orders/${uzi.id}/services`, doctor).send({
      serviceIds: [additional],
      idempotencyKey: randomUUID(),
    });
    await pay(extra.body.data.invoiceId as string, '50');
    expect(
      (
        await req('post', `/invoices/${extra.body.data.invoiceId}/refunds`, cashier).send({
          method: 'CASH',
          amount: '10',
          reason: 'Cancelled additional examination',
        })
      ).status,
    ).toBe(201);
    expect(
      (await req('post', `/visits/${started.body.data.visitId}/complete`, doctor)).status,
    ).toBe(409);
    expect(
      (
        await req('patch', `/visits/${started.body.data.visitId}`, doctor).send({
          reportBody: 'After refund',
        })
      ).status,
    ).toBe(423);
    expect(
      (
        await req('post', `/clinical-orders/${uzi.id}/services`, doctor).send({
          serviceIds: [additional],
          idempotencyKey: randomUUID(),
        })
      ).status,
    ).toBe(409);
    const cancelledExtra = await req('get', `/clinical-orders/${uzi.id}`, doctor);
    expect(cancelledExtra.body.data).toMatchObject({ status: 'CANCELLED', additionalDue: '10.00' });
    const working = await req('get', '/clinical-orders?status=IN_PROGRESS', doctor);
    expect(working.body.data.some((item: { id: string }) => item.id === uzi.id)).toBe(false);
  });

  it('branches and service kinds cannot be crossed', async () => {
    const { body } = await create('CONSULTATION');
    expect(
      (
        await req('post', '/clinical-orders').send({
          ...body,
          kind: 'ULTRASOUND',
          idempotencyKey: randomUUID(),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await req('post', '/clinical-orders').send({
          ...body,
          branchId: randomUUID(),
          idempotencyKey: randomUUID(),
        })
      ).status,
    ).toBe(403);
    expect((await req('get', '/clinical-orders', cashier)).status).toBe(403);
    expect((await req('get', '/clinical-orders', owner)).status).toBe(200);
  });
});
