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
  type LoginResult,
  type TestClinic,
} from './setup';

describe('atomic rich consultation prescriptions', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let clinic: TestClinic;
  let foreign: TestClinic;
  let doctor: LoginResult;
  let foreignOwner: LoginResult;
  let otherDoctor: LoginResult;
  let reception: LoginResult;
  let patientId: string;
  let globalDrugId: string;
  let foreignDrugId: string;
  const req = (
    method: 'get' | 'post' | 'put' | 'delete',
    path: string,
    user = doctor,
    branchId?: string,
  ) =>
    request(app.getHttpServer())
      [method](`${API}${path}`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .set('x-branch-id', branchId ?? clinic.branchId);
  const visit = () =>
    prisma.visit.create({
      data: {
        clinicId: clinic.clinicId,
        branchId: clinic.branchId,
        patientId,
        doctorUserId: clinic.doctor.id,
      },
    });
  const save = (id: string, body: unknown, user = doctor, branchId?: string) =>
    req('put', `/visits/${id}/prescriptions`, user, branchId).send(body as object);
  const base = {
    drugName: 'Sinov eritma',
    strength: '0.9%',
    form: 'sinov shakli',
    quantity: '2',
    dosage: 'sinov dozasi',
    route: 'sinov yo‘li',
    dripRate: 'sinov tezligi',
    frequency: 'sinov takrorlanishi',
    durationText: 'sinov davomiyligi',
    instructions: 'Faqat dastur sinovi',
  };
  const child = { drugName: 'Sinov tarkibi', strength: '1%', combineWithPrevious: true };

  beforeAll(async () => {
    if (
      !/^\/(?:avishifo_finance_|.*(?:test|e2e))/.test(
        new URL(process.env.DATABASE_URL ?? '').pathname,
      )
    )
      throw new Error('Use an isolated test database');
    prisma = new PrismaClient();
    app = await createApp([]);
    clinic = await createTestClinic(prisma, 'rich-rx');
    foreign = await createTestClinic(prisma, 'foreign-rx');
    doctor = await login(app, clinic.doctor.email);
    reception = await login(app, clinic.receptionist.email);
    foreignOwner = await login(app, foreign.owner.email);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: clinic.doctor.id } });
    const other = await prisma.user.create({
      data: {
        clinicId: clinic.clinicId,
        role: 'DOCTOR',
        fullName: 'Boshqa sinov shifokori',
        email: `${randomUUID()}@rich.test`,
        passwordHash: user.passwordHash,
        branches: { create: { clinicId: clinic.clinicId, branchId: clinic.branchId } },
      },
    });
    otherDoctor = await login(app, other.email!);
    patientId = (
      await prisma.patient.create({
        data: {
          clinicId: clinic.clinicId,
          mrn: 'RICH-RX',
          firstName: 'Retsept',
          lastName: 'Sinov',
          fullName: 'Sinov Retsept',
          tags: [],
        },
      })
    ).id;
    globalDrugId = (
      await prisma.drugDirectory.create({
        data: { name: 'Global sinov', strength: 'different catalogue value' },
      })
    ).id;
    foreignDrugId = (
      await prisma.drugDirectory.create({
        data: { clinicId: foreign.clinicId, name: 'Foreign private drug' },
      })
    ).id;
  });
  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('preserves old dosage and exposes all new fields in detail and print with deterministic order', async () => {
    const v = await visit();
    const timestamp = new Date('2020-01-01');
    const older = await prisma.prescription.create({
      data: {
        clinicId: clinic.clinicId,
        visitId: v.id,
        drugName: 'Old drug',
        dosage: 'old dose',
        createdAt: timestamp,
      },
    });
    const tied = await prisma.prescription.create({
      data: {
        clinicId: clinic.clinicId,
        visitId: v.id,
        drugName: 'Same timestamp',
        createdAt: timestamp,
      },
    });
    const initial = await req('get', `/visits/${v.id}`);
    expect(initial.body.data).toMatchObject({ prescriptionRevision: 0, physiotherapy: null });
    expect(initial.body.data.prescriptions.map((p: { id: string }) => p.id)).toEqual(
      [older.id, tied.id].sort(),
    );
    expect(
      initial.body.data.prescriptions.find((p: { id: string }) => p.id === older.id),
    ).toMatchObject({ dosage: 'old dose', strength: null, combineWithPrevious: false });
    const saved = await save(v.id, {
      expectedRevision: 0,
      physiotherapy: '  Sinov muolajasi  ',
      items: [
        { ...base, drugId: globalDrugId },
        child,
        { drugName: 'Alohida dori', durationDays: 7 },
      ],
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.data).toMatchObject({
      prescriptionRevision: 1,
      physiotherapy: 'Sinov muolajasi',
    });
    expect(saved.body.data.prescriptions.map((p: { sortOrder: number }) => p.sortOrder)).toEqual([
      0, 1, 2,
    ]);
    expect(saved.body.data.prescriptions[0]).toMatchObject({
      ...base,
      drugId: globalDrugId,
      combineWithPrevious: false,
    });
    expect(saved.body.data.prescriptions[1]).toMatchObject({
      ...child,
      dosage: null,
      route: null,
      instructions: null,
      form: null,
      quantity: null,
    });
    expect((await req('get', `/visits/${v.id}/print`)).status).toBe(409);
    await prisma.visit.update({
      where: { id: v.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    const printed = await req('get', `/visits/${v.id}/print`);
    expect(printed.status, JSON.stringify(printed.body)).toBe(200);
    expect(printed.body.data.visit.prescriptions).toEqual(saved.body.data.prescriptions);
    expect(printed.body.data.visit).toMatchObject({
      prescriptionRevision: 1,
      physiotherapy: 'Sinov muolajasi',
    });
  });

  it('allows exactly one concurrent draft save and audits the winning before/after', async () => {
    const v = await visit();
    const payload = { expectedRevision: 0, items: [base, child] };
    const results = await Promise.all([save(v.id, payload), save(v.id, payload)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.prescription.count({ where: { visitId: v.id } })).toBe(2);
    expect((await save(v.id, payload)).status).toBe(409);
    const audits = await prisma.auditLog.findMany({
      where: { clinicId: clinic.clinicId, entity: 'VisitPrescriptions', entityId: v.id },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.diff).toMatchObject({
      prescriptionRevision: { before: 0, after: 1 },
      prescriptions: { before: [], after: expect.any(Array) },
    });
  });

  it('rejects invalid groups and inaccessible directory entries without deleting the existing draft', async () => {
    const v = await visit();
    expect(
      (await save(v.id, { expectedRevision: 0, items: [base], physiotherapy: 'Keep this' })).status,
    ).toBe(200);
    for (const items of [
      [child],
      [{ drugName: '   ' }],
      [base, { ...child, route: 'conflicting route' }],
    ])
      expect((await save(v.id, { expectedRevision: 1, items })).status).toBe(400);
    for (const drugId of [foreignDrugId, randomUUID()])
      expect(
        (
          await save(v.id, {
            expectedRevision: 1,
            items: [{ drugName: 'Wrong drug', drugId }],
            physiotherapy: 'Must rollback',
          })
        ).status,
      ).toBe(404);
    const current = await req('get', `/visits/${v.id}`);
    expect(current.body.data).toMatchObject({
      prescriptionRevision: 1,
      physiotherapy: 'Keep this',
    });
    expect(current.body.data.prescriptions).toHaveLength(1);
    expect(current.body.data.prescriptions[0].drugName).toBe(base.drugName);
  });

  it('keeps legacy add/remove revisions and group boundaries compatible with atomic editing', async () => {
    const v = await visit();
    const added = await req('post', `/visits/${v.id}/prescriptions`).send({
      drugName: 'Legacy append',
      dosage: 'original dose',
    });
    expect(added.status).toBe(201);
    expect(added.body.data).toMatchObject({ sortOrder: 0, prescriptionRevision: 1 });
    // A legacy append cannot identify the intended mixture base during concurrent edits.
    expect((await req('post', `/visits/${v.id}/prescriptions`).send(child)).status).toBe(400);
    expect((await save(v.id, { expectedRevision: 0, items: [] })).status).toBe(409);
    const removed = await req('delete', `/visits/${v.id}/prescriptions/${added.body.data.id}`);
    expect(removed.body.data.prescriptionRevision).toBe(2);
    const group = await save(v.id, { expectedRevision: 2, items: [base, child] });
    expect(group.status).toBe(200);
    expect(
      (await req('delete', `/visits/${v.id}/prescriptions/${group.body.data.prescriptions[0].id}`))
        .status,
    ).toBe(409);
    expect(
      (await req('delete', `/visits/${v.id}/prescriptions/${group.body.data.prescriptions[1].id}`))
        .status,
    ).toBe(200);
    expect(
      (await req('delete', `/visits/${v.id}/prescriptions/${group.body.data.prescriptions[0].id}`))
        .body.data.prescriptionRevision,
    ).toBe(5);
  });

  it('serializes legacy appends with full draft writes without losing the append', async () => {
    const v = await visit();
    const [bulk, append] = await Promise.all([
      save(v.id, { expectedRevision: 0, items: [base] }),
      req('post', `/visits/${v.id}/prescriptions`).send({ drugName: 'Concurrent append' }),
    ]);
    expect(append.status).toBe(201);
    expect([200, 409]).toContain(bulk.status);
    const current = await req('get', `/visits/${v.id}`);
    expect(
      current.body.data.prescriptions.some(
        (p: { drugName: string }) => p.drugName === 'Concurrent append',
      ),
    ).toBe(true);
    expect(current.body.data.prescriptionRevision).toBe(bulk.status === 200 ? 2 : 1);
  });

  it('retains tenant, branch, treating-doctor and write-permission boundaries', async () => {
    const v = await visit();
    const payload = { expectedRevision: 0, items: [base] };
    expect((await save(v.id, payload, foreignOwner, foreign.branchId)).status).toBe(404);
    expect((await save(v.id, payload, otherDoctor)).status).toBe(403);
    expect((await save(v.id, payload, reception)).status).toBe(403);
    const branch = await prisma.branch.create({
      data: { clinicId: clinic.clinicId, name: 'Other clinic branch' },
    });
    await prisma.visit.update({ where: { id: v.id }, data: { branchId: branch.id } });
    expect((await save(v.id, payload)).status).toBe(403);
    expect(await prisma.prescription.count({ where: { visitId: v.id } })).toBe(0);
    expect(
      (await prisma.visit.findUniqueOrThrow({ where: { id: v.id } })).prescriptionRevision,
    ).toBe(0);
  });

  it('leaves completed, cancelled and refunded clinical reports immutable', async () => {
    for (const status of ['COMPLETED', 'CANCELLED'] as const) {
      const v = await visit();
      await prisma.visit.update({
        where: { id: v.id },
        data: { status, ...(status === 'COMPLETED' ? { completedAt: new Date() } : {}) },
      });
      expect((await save(v.id, { expectedRevision: 0, items: [base] })).status).toBe(423);
      expect(
        (await req('post', `/visits/${v.id}/prescriptions`).send({ drugName: 'Locked append' }))
          .status,
      ).toBe(423);
    }
    const v = await visit();
    const invoice = await prisma.invoice.create({
      data: {
        clinicId: clinic.clinicId,
        branchId: clinic.branchId,
        patientId,
        number: randomUUID(),
        status: 'REFUNDED',
      },
    });
    const order = await prisma.clinicalOrder.create({
      data: {
        clinicId: clinic.clinicId,
        branchId: clinic.branchId,
        patientId,
        doctorUserId: clinic.doctor.id,
        kind: 'CONSULTATION',
        initialInvoiceId: invoice.id,
        visitId: v.id,
        requestKey: randomUUID(),
        requestFingerprint: 'test',
      },
    });
    await prisma.invoice.update({ where: { id: invoice.id }, data: { clinicalOrderId: order.id } });
    expect((await save(v.id, { expectedRevision: 0, items: [base] })).status).toBe(423);
    expect(await prisma.prescription.count({ where: { visitId: v.id } })).toBe(0);
  });

  it('round-trips legacy large drafts and long original fields without truncation', async () => {
    const v = await visit();
    const legacy = {
      drugName: 'Legacy '.repeat(50),
      dosage: 'Dose '.repeat(80),
      frequency: 'Frequency '.repeat(30),
      instructions: 'Note '.repeat(450),
      durationDays: 5000,
    };
    await prisma.prescription.createMany({
      data: Array.from({ length: 45 }, () => ({
        clinicId: clinic.clinicId,
        visitId: v.id,
        ...legacy,
      })),
    });
    const before = await req('get', `/visits/${v.id}`);
    expect(before.body.data.prescriptions).toHaveLength(45);
    const items = before.body.data.prescriptions.map(
      (p: {
        drugName: string;
        dosage: string;
        frequency: string;
        instructions: string;
        durationDays: number;
      }) => ({
        drugName: p.drugName,
        dosage: p.dosage,
        frequency: p.frequency,
        instructions: p.instructions,
        durationDays: p.durationDays,
      }),
    );
    const saved = await save(v.id, { expectedRevision: 0, items });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.data.prescriptions).toHaveLength(45);
    expect(saved.body.data.prescriptions[0]).toMatchObject({
      ...legacy,
      drugName: legacy.drugName.trim(),
    });
  });

  it('preserves omitted physiotherapy and explicitly clears the whole draft', async () => {
    const v = await visit();
    expect(
      (await save(v.id, { expectedRevision: 0, items: [base], physiotherapy: 'Keep this' })).status,
    ).toBe(200);
    const kept = await save(v.id, { expectedRevision: 1, items: [] });
    expect(kept.body.data).toMatchObject({
      prescriptionRevision: 2,
      physiotherapy: 'Keep this',
      prescriptions: [],
    });
    const cleared = await save(v.id, { expectedRevision: 2, items: [], physiotherapy: '  ' });
    expect(cleared.body.data).toEqual({
      prescriptionRevision: 3,
      physiotherapy: null,
      prescriptions: [],
    });
  });
});
