import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient, type ServiceKind } from '@prisma/client';
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

describe('inpatient surgery workflow', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let clinic: TestClinic;
  let foreignClinic: TestClinic;
  let reception: LoginResult;
  let room: LoginResult;
  let owner: LoginResult;
  let doctor: LoginResult;
  let cashier: LoginResult;
  let foreignOwner: LoginResult;
  let patientId: string;
  let admissionId: string;
  let otherBranchId: string;
  let otherDoctorId: string;
  let surgeryServiceId: string;
  let materialServiceId: string;
  let medicineServiceId: string;
  let procedureServiceId: string;
  let surgeryId: string;
  const scheduledDate = '2026-10-13';
  const req = (
    method: 'get' | 'post' | 'delete',
    path: string,
    user: LoginResult = reception,
    branch?: string,
  ) =>
    request(app.getHttpServer())
      [method](`${API}${path}`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .set('x-branch-id', branch ?? clinic.branchId);
  const create = async (overrides: Record<string, unknown> = {}) => {
    const result = await req('post', '/surgeries').send({
      admissionId,
      serviceId: surgeryServiceId,
      surgeonUserId: clinic.doctor.id,
      scheduledDate,
      idempotencyKey: randomUUID(),
      ...overrides,
    });
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    return result.body.data as { id: string; serviceCharge: { id: string } };
  };
  const manualEntry = (id: string) =>
    req('post', `/surgeries/${id}/entries`, room).send({
      idempotencyKey: randomUUID(),
      items: [
        {
          kind: 'MATERIAL',
          title: 'Qo‘shimcha material',
          quantity: '1.500',
          unit: 'dona',
          unitPrice: '20',
        },
      ],
    });

  const invoiceForCharge = async (chargeId: string) => {
    const charge = await prisma.chargeItem.findUniqueOrThrow({ where: { id: chargeId } });
    expect(charge.status).toBe('INVOICED');
    expect(charge.invoiceLineId).toBeTruthy();
    const line = await prisma.invoiceLine.findUniqueOrThrow({
      where: { id: charge.invoiceLineId! },
      include: { invoice: true },
    });
    return { charge, line, invoice: line.invoice };
  };
  const pendingInvoices = async () => {
    const response = await req('get', `/invoices?pending=true&patientId=${patientId}`, cashier);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return response.body.data as Array<{ id: string; total: string; due: string; status: string }>;
  };

  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL ?? '').pathname;
    if (database !== '/avishifo_finance_migration' || process.env.TELEGRAM_ENABLED !== 'false')
      throw new Error('Use an isolated test database');
    prisma = new PrismaClient();
    app = await createApp([]);
    clinic = await createTestClinic(prisma, `surgery-${Date.now()}`);
    foreignClinic = await createTestClinic(prisma, `surgery-other-${Date.now()}`);
    const credentials = await prisma.user.findUniqueOrThrow({
      where: { id: clinic.doctor.id },
      select: { passwordHash: true },
    });
    const operating = await prisma.user.create({
      data: {
        clinicId: clinic.clinicId,
        fullName: 'Operatsiya xonasi',
        email: `room-${clinic.tag}@e2e.avishifo.test`,
        phone: uniquePhone(),
        passwordHash: credentials.passwordHash,
        role: 'OPERATING_ROOM',
      },
    });
    await prisma.userBranch.create({
      data: { clinicId: clinic.clinicId, branchId: clinic.branchId, userId: operating.id },
    });
    const otherBranch = await prisma.branch.create({
      data: { clinicId: clinic.clinicId, name: 'Other surgery branch' },
    });
    otherBranchId = otherBranch.id;
    const otherDoctor = await prisma.user.create({
      data: {
        clinicId: clinic.clinicId,
        fullName: 'Other branch doctor',
        email: `surgeon-other-${clinic.tag}@e2e.avishifo.test`,
        passwordHash: credentials.passwordHash,
        role: 'DOCTOR',
      },
    });
    otherDoctorId = otherDoctor.id;
    await prisma.userBranch.create({
      data: { clinicId: clinic.clinicId, branchId: otherBranchId, userId: otherDoctor.id },
    });
    reception = await login(app, clinic.receptionist.email);
    room = await login(app, operating.email!);
    owner = await login(app, clinic.owner.email);
    doctor = await login(app, clinic.doctor.email);
    cashier = await login(app, clinic.cashier.email);
    foreignOwner = await login(app, foreignClinic.owner.email);
    const patient = await req('post', '/patients').send({
      firstName: 'Operatsiya',
      lastName: 'Sinov',
      phone: uniquePhone(),
    });
    expect(patient.status).toBe(201);
    patientId = patient.body.data.id as string;
    const admission = await req('post', '/admissions').send({ patientId, ward: 'A-2', bed: '3' });
    expect(admission.status).toBe(201);
    admissionId = admission.body.data.id as string;
    const catalogue = async (kind: ServiceKind, price: string, unit = 'dona') => {
      const category = await prisma.serviceCategory.create({
        data: { clinicId: clinic.clinicId, name: kind, kind },
      });
      return prisma.service.create({
        data: {
          clinicId: clinic.clinicId,
          categoryId: category.id,
          code: `${kind}-${clinic.tag}`,
          name: { uz: `${kind} sinov` },
          unit,
          prices: {
            create: { clinicId: clinic.clinicId, price, effectiveFrom: new Date('2020-01-01') },
          },
        },
      });
    };
    surgeryServiceId = (await catalogue('SURGERY', '2500')).id;
    await prisma.servicePrice.create({
      data: {
        clinicId: clinic.clinicId,
        branchId: clinic.branchId,
        serviceId: surgeryServiceId,
        price: '2999.99',
        effectiveFrom: new Date('2020-01-01'),
      },
    });
    materialServiceId = (await catalogue('MATERIAL', '100.11', 'dona')).id;
    medicineServiceId = (await catalogue('MEDICINE', '200.01', 'ml')).id;
    procedureServiceId = (await catalogue('PROCEDURE', '5')).id;
  });
  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('rejects surgery services in ordinary ward orders and manual admission charges', async () => {
    expect((await prisma.admission.findUniqueOrThrow({ where: { id: admissionId } })).status).toBe(
      'ACTIVE',
    );
    const order = await req('post', `/admissions/${admissionId}/orders`).send({
      serviceId: surgeryServiceId,
      schedule: 'ONCE',
      startDate: scheduledDate,
      timesPlanned: 1,
      timesPerDay: 1,
    });
    expect(order.status).toBe(400);
    const charge = await req('post', '/charges').send({
      patientId,
      admissionId,
      serviceId: surgeryServiceId,
      date: scheduledDate,
      quantity: 1,
    });
    expect(charge.status).toBe(400);
    expect(await prisma.treatmentOrder.count({ where: { admissionId } })).toBe(0);
    expect(await prisma.chargeItem.count({ where: { admissionId } })).toBe(0);
  });

  it('creates one priced fee for concurrent reception retries and rejects changed reuse', async () => {
    const payload = {
      admissionId,
      serviceId: surgeryServiceId,
      surgeonUserId: clinic.doctor.id,
      scheduledDate,
      idempotencyKey: randomUUID(),
    };
    const results = await Promise.all([
      req('post', '/surgeries').send(payload),
      req('post', '/surgeries').send(payload),
    ]);
    for (const result of results) expect(result.status, JSON.stringify(result.body)).toBe(201);
    surgeryId = results[0]!.body.data.id as string;
    expect(results[1]!.body.data.id).toBe(surgeryId);
    expect(results[0]!.body.data).toMatchObject({
      feeAmount: '2999.99',
      totalAmount: '2999.99',
      status: 'PLANNED',
      patientId,
      admissionId,
    });
    expect(await prisma.chargeItem.count({ where: { surgeryId } })).toBe(1);
    const fee = await invoiceForCharge(results[0]!.body.data.serviceCharge.id as string);
    expect(fee.invoice).toMatchObject({ status: 'ISSUED', patientId, branchId: clinic.branchId });
    expect(fee.invoice.total.toFixed(2)).toBe('2999.99');
    expect(fee.line.performerUserId).toBe(clinic.doctor.id);
    expect(await prisma.invoice.count({ where: { patientId } })).toBe(1);
    expect(await pendingInvoices()).toContainEqual(
      expect.objectContaining({
        id: fee.invoice.id,
        total: '2999.99',
        due: '2999.99',
        status: 'ISSUED',
      }),
    );
    expect(
      await prisma.surgeryCase.count({
        where: { clinicId: clinic.clinicId, requestKey: payload.idempotencyKey },
      }),
    ).toBe(1);
    expect(
      (await req('post', '/surgeries').send({ ...payload, scheduledDate: '2026-10-14' })).status,
    ).toBe(409);
  });

  it('exposes minimal scoped selectors while preserving reception, room and cashier duties', async () => {
    const doctors = await req('get', '/surgeries/doctors', room);
    expect(doctors.status).toBe(200);
    expect(doctors.body.data).toEqual([expect.objectContaining({ id: clinic.doctor.id })]);
    expect(Object.keys(doctors.body.data[0]).sort()).toEqual(['fullName', 'id', 'specialty']);
    const admissions = await req('get', '/surgeries/admissions', room);
    expect(admissions.body.data).toContainEqual(
      expect.objectContaining({ id: admissionId, ward: 'A-2', bed: '3' }),
    );
    expect((await req('get', '/patients', room)).status).toBe(403);
    expect(
      (
        await req('post', `/surgeries/${surgeryId}/entries`).send({
          idempotencyKey: randomUUID(),
          items: [{ kind: 'MATERIAL', serviceId: materialServiceId, quantity: '1' }],
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await req('post', '/surgeries', room).send({
          admissionId,
          serviceId: surgeryServiceId,
          surgeonUserId: clinic.doctor.id,
          scheduledDate,
          idempotencyKey: randomUUID(),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await req('post', `/surgeries/${surgeryId}/entries`, cashier).send({
          idempotencyKey: randomUUID(),
          items: [{ kind: 'MATERIAL', serviceId: materialServiceId, quantity: '1' }],
        })
      ).status,
    ).toBe(403);
  });

  it('records fractional use once with server catalogue prices and exact rounded charges', async () => {
    const payload = {
      idempotencyKey: randomUUID(),
      items: [
        {
          kind: 'MATERIAL',
          serviceId: materialServiceId,
          quantity: '1.125',
          unitPrice: '0.01',
          unit: 'wrong',
        },
        { kind: 'ANESTHESIA', serviceId: medicineServiceId, quantity: '0.333', unitPrice: '0.01' },
        {
          kind: 'ANESTHESIA',
          title: 'Qo‘shimcha anesteziya',
          quantity: '0.500',
          unit: 'ml',
          unitPrice: '1.01',
        },
      ],
    };
    const results = await Promise.all([
      req('post', `/surgeries/${surgeryId}/entries`, room).send(payload),
      req('post', `/surgeries/${surgeryId}/entries`, room).send(payload),
    ]);
    for (const result of results) expect(result.status, JSON.stringify(result.body)).toBe(201);
    expect(results[0]!.body.data).toMatchObject({
      materialTotal: '112.62',
      anesthesiaTotal: '67.11',
      totalAmount: '3179.72',
    });
    expect(results[0]!.body.data.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          quantity: '1.125',
          unit: 'dona',
          unitPrice: '100.11',
          lineTotal: '112.62',
        }),
        expect.objectContaining({
          quantity: '0.333',
          unit: 'ml',
          unitPrice: '200.01',
          lineTotal: '66.60',
        }),
        expect.objectContaining({ quantity: '0.500', unit: 'ml', lineTotal: '0.51' }),
      ]),
    );
    expect(await prisma.surgeryEntry.count({ where: { surgeryId } })).toBe(3);
    expect(await prisma.chargeItem.count({ where: { surgeryId } })).toBe(4);
    const charge = await prisma.chargeItem.findFirstOrThrow({
      where: { surgeryId, serviceId: materialServiceId },
    });
    expect(charge.quantity).toBe(1);
    expect(charge.unitPrice.toFixed(2)).toBe('112.62');
    expect(charge.title).toEqual({ uz: 'MATERIAL sinov (1.125 dona)' });
    const usage = await invoiceForCharge(charge.id);
    expect(usage.invoice.total.toFixed(2)).toBe('179.73');
    expect(await prisma.invoiceLine.count({ where: { invoiceId: usage.invoice.id } })).toBe(3);
    expect(await prisma.invoice.count({ where: { patientId } })).toBe(2);
    expect(await pendingInvoices()).toContainEqual(
      expect.objectContaining({
        id: usage.invoice.id,
        total: '179.73',
        due: '179.73',
      }),
    );
    expect(
      (
        await req('post', `/surgeries/${surgeryId}/entries`, room).send({
          ...payload,
          items: [{ ...payload.items[0], quantity: '2' }],
        })
      ).status,
    ).toBe(409);
  });

  it('rejects invalid sources and rolls the whole usage batch back', async () => {
    const before = await prisma.surgeryEntry.count({ where: { surgeryId } });
    const invoiceCount = await prisma.invoice.count({ where: { patientId } });
    const badBatch = await req('post', `/surgeries/${surgeryId}/entries`, room).send({
      idempotencyKey: randomUUID(),
      items: [
        { kind: 'MATERIAL', title: 'Must rollback', quantity: '1', unit: 'dona', unitPrice: '10' },
        { kind: 'ANESTHESIA', serviceId: materialServiceId, quantity: '1' },
      ],
    });
    expect(badBatch.status).toBe(400);
    expect(await prisma.surgeryEntry.count({ where: { surgeryId } })).toBe(before);
    expect(await prisma.invoice.count({ where: { patientId } })).toBe(invoiceCount);
    expect(await prisma.chargeItem.count({ where: { surgeryId } })).toBe(4);
    for (const quantity of ['0', '-1', '1.0001']) {
      expect(
        (
          await req('post', `/surgeries/${surgeryId}/entries`, room).send({
            idempotencyKey: randomUUID(),
            items: [{ kind: 'MATERIAL', serviceId: materialServiceId, quantity }],
          })
        ).status,
      ).toBe(400);
    }
    for (const overrides of [
      { surgeonUserId: foreignClinic.doctor.id },
      { surgeonUserId: otherDoctorId },
      { serviceId: procedureServiceId },
      { scheduledDate: '2026-02-30' },
    ]) {
      expect(
        (
          await req('post', '/surgeries').send({
            admissionId,
            serviceId: surgeryServiceId,
            surgeonUserId: clinic.doctor.id,
            scheduledDate,
            idempotencyKey: randomUUID(),
            ...overrides,
          })
        ).status,
      ).toBe(400);
    }
  });

  it('rolls back a foreign third row and retries the corrected bulk request without duplicates', async () => {
    const surgery = await create();
    const foreignCategory = await prisma.serviceCategory.create({
      data: { clinicId: foreignClinic.clinicId, name: 'Foreign medicine', kind: 'MEDICINE' },
    });
    const foreignMedicine = await prisma.service.create({
      data: {
        clinicId: foreignClinic.clinicId,
        categoryId: foreignCategory.id,
        code: 'FOREIGN-BULK-MEDICINE',
        name: { uz: 'Foreign medicine' },
        unit: 'ml',
        prices: {
          create: {
            clinicId: foreignClinic.clinicId,
            price: '1',
            effectiveFrom: new Date('2020-01-01'),
          },
        },
      },
    });
    const payload = {
      idempotencyKey: randomUUID(),
      items: [
        { kind: 'MATERIAL', serviceId: materialServiceId, quantity: '0.125' },
        {
          kind: 'ANESTHESIA',
          title: 'Bulk manual anesthesia',
          quantity: '0.500',
          unit: 'ml',
          unitPrice: '10.01',
        },
        { kind: 'ANESTHESIA', serviceId: foreignMedicine.id, quantity: '1.250' },
      ],
    };
    const auditWhere = { clinicId: clinic.clinicId, entity: 'SurgeryEntry', entityId: surgery.id };
    const invoiceCount = await prisma.invoice.count({ where: { patientId } });
    const rejected = await req('post', `/surgeries/${surgery.id}/entries`, room).send(payload);
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(400);
    expect(await prisma.surgeryEntry.count({ where: { surgeryId: surgery.id } })).toBe(0);
    expect(await prisma.chargeItem.count({ where: { surgeryId: surgery.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: auditWhere })).toBe(0);
    expect(await prisma.invoice.count({ where: { patientId } })).toBe(invoiceCount);

    // A failed transaction must not consume its request key or leave the earlier rows behind.
    payload.items[2]!.serviceId = medicineServiceId;
    const saved = await req('post', `/surgeries/${surgery.id}/entries`, room).send(payload);
    expect(saved.status, JSON.stringify(saved.body)).toBe(201);
    expect(saved.body.data).toMatchObject({
      materialTotal: '12.51',
      anesthesiaTotal: '255.02',
      totalAmount: '3267.52',
    });
    expect(saved.body.data.entries.map((entry: { lineTotal: string }) => entry.lineTotal)).toEqual([
      '12.51',
      '5.01',
      '250.01',
    ]);
    const replay = await req('post', `/surgeries/${surgery.id}/entries`, room).send(payload);
    expect(replay.status, JSON.stringify(replay.body)).toBe(201);
    expect(replay.body.data.entries).toEqual(saved.body.data.entries);
    expect(replay.body.data.totalAmount).toBe('3267.52');
    expect(await prisma.surgeryEntry.count({ where: { surgeryId: surgery.id } })).toBe(3);
    expect(await prisma.chargeItem.count({ where: { surgeryId: surgery.id } })).toBe(4);
    expect(await prisma.auditLog.count({ where: auditWhere })).toBe(1);
    expect(await prisma.invoice.count({ where: { patientId } })).toBe(invoiceCount + 1);
    const bulk = await invoiceForCharge(saved.body.data.entries[0].chargeItemId as string);
    expect(bulk.invoice.total.toFixed(2)).toBe('267.53');
    expect(await pendingInvoices()).toContainEqual(
      expect.objectContaining({ id: bulk.invoice.id, due: '267.53' }),
    );
    expect(
      await prisma.surgeryEntry.count({
        where: { clinicId: clinic.clinicId, serviceId: foreignMedicine.id },
      }),
    ).toBe(0);
  });

  it('isolates tenant and branch reads and limits doctors to their own operations', async () => {
    expect(
      (await req('get', `/surgeries/${surgeryId}`, foreignOwner, foreignClinic.branchId)).status,
    ).toBe(404);
    expect(
      (await req('get', '/surgeries', foreignOwner, foreignClinic.branchId)).body.meta.total,
    ).toBe(0);
    expect((await req('get', `/surgeries/${surgeryId}`, reception, otherBranchId)).status).toBe(
      403,
    );
    expect((await req('get', `/surgeries/${surgeryId}`, doctor)).status).toBe(200);
    // Move the second doctor into this branch only after testing the branch mismatch.
    await prisma.userBranch.create({
      data: { clinicId: clinic.clinicId, branchId: clinic.branchId, userId: otherDoctorId },
    });
    const other = await create({ surgeonUserId: otherDoctorId });
    expect((await req('get', `/surgeries/${other.id}`, doctor)).status).toBe(404);
    const list = await req('get', '/surgeries', doctor);
    expect(list.body.data.map((row: { id: string }) => row.id)).not.toContain(other.id);
    await req('post', `/surgeries/${other.id}/cancel`);
  });

  it('keeps cancelled entry history and protects invoice-linked fees and consumables', async () => {
    const surgery = await create();
    const added = await manualEntry(surgery.id);
    expect(added.status).toBe(201);
    const entry = added.body.data.entries[0] as { id: string; chargeItemId: string };
    expect((await req('post', `/surgeries/${surgery.id}/cancel`)).status).toBe(409);
    const bill = await invoiceForCharge(entry.chargeItemId);
    expect(JSON.stringify(bill.line.title)).toContain('1.5 dona');
    expect(
      (await req('post', '/charges/invoice').send({ chargeIds: [entry.chargeItemId] })).status,
    ).toBe(409);
    expect((await req('delete', `/surgeries/${surgery.id}/entries/${entry.id}`, room)).status).toBe(
      409,
    );
    expect((await req('post', `/invoices/${bill.invoice.id}/cancel`, owner)).status).toBe(201);
    const removed = await req('delete', `/surgeries/${surgery.id}/entries/${entry.id}`, room);
    expect(removed.status).toBe(200);
    expect(removed.body.data.entries[0].status).toBe('CANCELLED');
    expect(await prisma.surgeryEntry.count({ where: { surgeryId: surgery.id } })).toBe(1);
    // Automatically issued fees must also be cancelled before cancelling the case.
    const serviceBill = await invoiceForCharge(surgery.serviceCharge.id);
    expect((await req('post', `/invoices/${serviceBill.invoice.id}/cancel`, owner)).status).toBe(
      201,
    );
    const cancelled = await req('post', `/surgeries/${surgery.id}/cancel`);
    expect(cancelled.status).toBe(201);
    expect(cancelled.body.data).toMatchObject({ status: 'CANCELLED', totalAmount: '0.00' });
    expect((await req('post', `/surgeries/${surgery.id}/cancel`)).status).toBe(201);
    expect((await manualEntry(surgery.id)).status).toBe(409);
    expect((await req('post', `/surgeries/${surgery.id}/complete`, room)).status).toBe(409);
    const feeCase = await create();
    const feeBill = await invoiceForCharge(feeCase.serviceCharge.id);
    expect(feeBill.invoice.status).toBe('ISSUED');
    expect((await req('post', `/surgeries/${feeCase.id}/cancel`)).status).toBe(409);
    expect((await req('delete', `/charges/${feeCase.serviceCharge.id}`)).status).toBe(409);
  });

  it('preserves doctor ownership even when mutation permissions are explicitly granted', async () => {
    await prisma.user.update({
      where: { id: clinic.doctor.id },
      data: { permissionOverrides: { grant: ['surgery.schedule', 'surgery.record'] } },
    });
    const empoweredDoctor = await login(app, clinic.doctor.email);
    const other = await create({ surgeonUserId: otherDoctorId });
    const added = await manualEntry(other.id);
    expect(added.status).toBe(201);
    const entry = added.body.data.entries[0] as { id: string; chargeItemId: string };
    expect((await req('post', `/surgeries/${other.id}/complete`, empoweredDoctor)).status).toBe(
      404,
    );
    expect((await req('post', `/surgeries/${other.id}/cancel`, empoweredDoctor)).status).toBe(404);
    expect(
      (await req('delete', `/surgeries/${other.id}/entries/${entry.id}`, empoweredDoctor)).status,
    ).toBe(404);
    expect(
      (
        await req('post', `/surgeries/${other.id}/entries`, empoweredDoctor).send({
          idempotencyKey: randomUUID(),
          items: [{ kind: 'MATERIAL', serviceId: materialServiceId, quantity: '1' }],
        })
      ).status,
    ).toBe(404);
    expect(await prisma.surgeryCase.findUnique({ where: { id: other.id } })).toMatchObject({
      status: 'PLANNED',
    });
    expect(await prisma.surgeryEntry.count({ where: { surgeryId: other.id } })).toBe(1);
    expect(await prisma.chargeItem.findUnique({ where: { id: entry.chargeItemId } })).toMatchObject(
      {
        status: 'INVOICED',
      },
    );
    const payload = {
      admissionId,
      serviceId: surgeryServiceId,
      surgeonUserId: otherDoctorId,
      scheduledDate,
      idempotencyKey: randomUUID(),
    };
    expect((await req('post', '/surgeries', empoweredDoctor).send(payload)).status).toBe(403);
    expect(
      await prisma.surgeryCase.count({
        where: { clinicId: clinic.clinicId, requestKey: payload.idempotencyKey },
      }),
    ).toBe(0);
    expect((await req('post', `/surgeries/${surgeryId}/complete`, empoweredDoctor)).status).toBe(
      201,
    );
  });

  it('shows added surgery usage at the cashier after the original fee is paid', async () => {
    const surgery = await create();
    const fee = await invoiceForCharge(surgery.serviceCharge.id);
    expect((await req('post', '/shifts/open', cashier).send({ openingCash: '0.00' })).status).toBe(
      201,
    );
    const paid = await req('post', `/invoices/${fee.invoice.id}/payments`, cashier).send({
      amount: '2999.99',
      method: 'CASH',
      idempotencyKey: randomUUID(),
    });
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);
    expect((await pendingInvoices()).map((invoice) => invoice.id)).not.toContain(fee.invoice.id);
    const used = await manualEntry(surgery.id);
    expect(used.status, JSON.stringify(used.body)).toBe(201);
    const added = await invoiceForCharge(used.body.data.entries[0].chargeItemId as string);
    expect(added.invoice.id).not.toBe(fee.invoice.id);
    expect(added.invoice.total.toFixed(2)).toBe('30.00');
    expect(await pendingInvoices()).toContainEqual(
      expect.objectContaining({ id: added.invoice.id, due: '30.00' }),
    );
    expect(
      (await prisma.invoice.findUniqueOrThrow({ where: { id: fee.invoice.id } })).paidTotal.toFixed(
        2,
      ),
    ).toBe('2999.99');
  });

  it('completes idempotently and accepts late usage only while the admission remains active', async () => {
    const first = await req('post', `/surgeries/${surgeryId}/complete`, room);
    expect(first.status).toBe(201);
    const repeat = await req('post', `/surgeries/${surgeryId}/complete`, room);
    expect(repeat.body.data.completedAt).toBe(first.body.data.completedAt);
    expect((await manualEntry(surgeryId)).status).toBe(201);
    await prisma.admission.update({
      where: { id: admissionId },
      data: { status: 'DISCHARGED', dischargedAt: new Date() },
    });
    expect((await manualEntry(surgeryId)).status).toBe(409);
    expect(
      (
        await req('post', '/surgeries').send({
          admissionId,
          serviceId: surgeryServiceId,
          surgeonUserId: clinic.doctor.id,
          scheduledDate,
          idempotencyKey: randomUUID(),
        })
      ).status,
    ).toBe(409);
    expect((await req('post', `/surgeries/${surgeryId}/complete`, room)).status).toBe(201);
  });
});
