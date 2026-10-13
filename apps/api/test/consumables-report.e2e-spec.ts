import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient, type Service } from '@prisma/client';
import type { ConsumablesReport } from '@avishifo/shared';
import * as ExcelJS from 'exceljs';
import request from 'supertest';
import { API, createApp, createTestClinic, login, uniquePhone, type LoginResult, type TestClinic } from './setup';

describe('consumables report (isolated finance database)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let clinic: TestClinic;
  let cashier: LoginResult;
  let reception: LoginResult;
  let patientId: string;
  let admissionId: string;
  let surgeryId: string;
  let bandage: Service;
  let medicine: Service;
  let feeService: Service;
  let otherBranchId: string;
  let outpatientChargeId: string;
  const day = '2026-10-13';
  const at = new Date('2026-10-13T10:00:00Z');
  const date = new Date(day);
  const get = (query: Record<string, string> = {}, who = cashier) => request(app.getHttpServer())
    .get(`${API}/reports/consumables`).set('Authorization', `Bearer ${who.accessToken}`)
    .set('x-branch-id', clinic.branchId).query({ from: day, to: day, ...query });
  async function charge(service: Service | null, quantity: number, price: string, extra: Record<string, unknown> = {}) {
    return prisma.chargeItem.create({ data: {
      clinicId: clinic.clinicId, branchId: clinic.branchId, patientId, serviceId: service?.id,
      title: service?.name ?? { uz: 'Umumiy xarajat' }, date, quantity, unitPrice: price, ...extra,
    } });
  }
  async function surgeryEntry(options: {
    service?: Service; title?: string; quantity: string; unit: string; price: string; amount: string;
    kind?: 'MATERIAL' | 'ANESTHESIA'; createdAt?: Date; cancelled?: boolean; surgery?: string;
  }) {
    const chargeRow = await charge(options.service ?? null, 1, options.amount, {
      admissionId, surgeryId: options.surgery ?? surgeryId, status: options.cancelled ? 'CANCELLED' : 'PENDING',
      date: new Date('2026-10-01'),
    });
    return prisma.surgeryEntry.create({ data: {
      clinicId: clinic.clinicId, surgeryId: options.surgery ?? surgeryId, kind: options.kind ?? 'MATERIAL',
      serviceId: options.service?.id, title: options.service?.name ?? { uz: options.title ?? 'Sinov' },
      quantity: options.quantity, unit: options.unit, unitPrice: options.price,
      chargeItemId: chargeRow.id, requestKey: randomUUID(), requestFingerprint: 'test', lineIndex: 0,
      createdById: clinic.owner.id, createdAt: options.createdAt ?? at,
    } });
  }
  async function order(upfront: boolean, price: string, cancelled = false) {
    const billing = upfront ? await charge(medicine, 4, price, { admissionId, status: cancelled ? 'CANCELLED' : 'PENDING' }) : null;
    const treatment = await prisma.treatmentOrder.create({ data: {
      clinicId: clinic.clinicId, admissionId, serviceId: medicine.id, doctorUserId: clinic.doctor.id,
      schedule: 'DAILY', startDate: date, timesPlanned: 4, timesPerDay: 1,
      billedOnOrder: upfront, billingChargeId: billing?.id, stoppedAt: at,
    } });
    const mark = await prisma.treatmentAdministration.create({ data: {
      clinicId: clinic.clinicId, orderId: treatment.id, date, slot: 1, status: 'GIVEN',
    } });
    if (!upfront) await charge(medicine, 1, price, { admissionId, administrationId: mark.id, status: cancelled ? 'CANCELLED' : 'PENDING' });
    return treatment;
  }

  beforeAll(async () => {
    if (new URL(process.env.DATABASE_URL ?? '').pathname !== '/avishifo_finance_migration') {
      throw new Error('This suite requires isolated avishifo_finance_migration database');
    }
    if (process.env.NODE_ENV !== 'test' || process.env.TELEGRAM_ENABLED !== 'false' || !process.env.REDIS_URL?.endsWith('/14')) {
      throw new Error('Use NODE_ENV=test, TELEGRAM_ENABLED=false and Redis database 14');
    }
    process.env.SINGLE_CLINIC_MODE = 'true';
    prisma = new PrismaClient();
    app = await createApp([]);
    clinic = await createTestClinic(prisma, `consumables-${Date.now()}`);
    cashier = await login(app, clinic.cashier.email);
    reception = await login(app, clinic.receptionist.email);
    const patient = await prisma.patient.create({ data: {
      clinicId: clinic.clinicId, mrn: 'P-CONSUMABLES', firstName: 'Hisobot', lastName: 'Sinov', fullName: 'Hisobot Sinov', phone: uniquePhone(),
    } });
    patientId = patient.id;
    const admission = await prisma.admission.create({ data: {
      clinicId: clinic.clinicId, branchId: clinic.branchId, patientId, historyNumber: 'KT-REPORT', admittedAt: at,
    } });
    admissionId = admission.id;
    async function service(kind: 'MEDICINE' | 'MATERIAL' | 'SURGERY', name: string) {
      const category = await prisma.serviceCategory.create({ data: { clinicId: clinic.clinicId, kind, name } });
      return prisma.service.create({ data: { clinicId: clinic.clinicId, categoryId: category.id, code: name, name: { uz: name }, unit: 'dona' } });
    }
    bandage = await service('MATERIAL', 'Bint');
    medicine = await service('MEDICINE', 'Dori');
    feeService = await service('SURGERY', 'Operatsiya');
    const fee = await charge(feeService, 1, '1000', { admissionId });
    const surgery = await prisma.surgeryCase.create({ data: {
      clinicId: clinic.clinicId, branchId: clinic.branchId, patientId, admissionId,
      serviceId: feeService.id, surgeonUserId: clinic.doctor.id, serviceChargeId: fee.id,
      scheduledDate: new Date('2026-10-01'), createdById: clinic.owner.id, requestKey: randomUUID(), requestFingerprint: 'test',
    } });
    surgeryId = surgery.id;
    await surgeryEntry({ service: bandage, quantity: '1.250', unit: 'dona', price: '4.10', amount: '5.13', createdAt: new Date('2026-10-12T19:00:00Z') });
    await surgeryEntry({ title: '=1+1', quantity: '2', unit: 'ml', price: '1', amount: '2' });
    await surgeryEntry({ service: bandage, quantity: '.250', unit: 'dona', price: '0', amount: '0' });
    await surgeryEntry({ title: 'Anesteziya', quantity: '.500', unit: 'ampula', price: '.01', amount: '.01', kind: 'ANESTHESIA', createdAt: new Date('2026-10-13T18:59:59.999Z') });
    outpatientChargeId = (await charge(medicine, 3, '.10')).id;
    await charge(bandage, 2, '1.05', { admissionId });
    await order(false, '.20');
    const upfront = await order(true, '.30');
    // SKIPPED doses do not become consumption; giving a dose never repeats the upfront plan.
    await prisma.treatmentAdministration.create({ data: { clinicId: clinic.clinicId, orderId: upfront.id, date: new Date('2026-10-14'), status: 'SKIPPED' } });
    await order(true, '100', true);
    await order(false, '100', true);
    await charge(bandage, 100, '100', { status: 'CANCELLED' });
    await charge(null, 100, '100'); // No catalogue kind: cannot infer a medicine/material.
    await surgeryEntry({ service: bandage, quantity: '100', unit: 'dona', price: '100', amount: '10000', cancelled: true });
    await surgeryEntry({ service: bandage, quantity: '100', unit: 'dona', price: '100', amount: '10000', createdAt: new Date('2026-10-12T18:59:59.999Z') });
    await surgeryEntry({ service: bandage, quantity: '100', unit: 'dona', price: '100', amount: '10000', createdAt: new Date('2026-10-13T19:00:00Z') });
    const canceledFee = await charge(feeService, 1, '1000', { admissionId });
    const canceledSurgery = await prisma.surgeryCase.create({ data: {
      clinicId: clinic.clinicId, branchId: clinic.branchId, patientId, admissionId, serviceId: feeService.id,
      surgeonUserId: clinic.doctor.id, serviceChargeId: canceledFee.id, scheduledDate: date,
      status: 'CANCELLED', createdById: clinic.owner.id, requestKey: randomUUID(), requestFingerprint: 'test',
    } });
    await surgeryEntry({ service: bandage, quantity: '100', unit: 'dona', price: '100', amount: '10000', surgery: canceledSurgery.id });
    const otherBranch = await prisma.branch.create({ data: { clinicId: clinic.clinicId, name: 'Other branch' } });
    otherBranchId = otherBranch.id;
    await charge(medicine, 100, '100', { branchId: otherBranchId });
    const otherClinic = await createTestClinic(prisma, `consumables-other-${Date.now()}`);
    const otherCategory = await prisma.serviceCategory.create({ data: { clinicId: otherClinic.clinicId, name: 'Meds', kind: 'MEDICINE' } });
    const otherService = await prisma.service.create({ data: { clinicId: otherClinic.clinicId, categoryId: otherCategory.id, name: { uz: 'Other med' }, code: 'OM' } });
    const otherPatient = await prisma.patient.create({ data: { clinicId: otherClinic.clinicId, mrn: 'P-OTHER', firstName: 'Other', lastName: 'Test', fullName: 'Other Test' } });
    await prisma.chargeItem.create({ data: {
      clinicId: otherClinic.clinicId, branchId: otherClinic.branchId, patientId: otherPatient.id,
      serviceId: otherService.id, title: { uz: 'Other med' }, date, quantity: 100, unitPrice: '100',
    } });
  });
  afterAll(async () => { await app?.close(); await prisma?.$disconnect(); });

  it('uses actual fractional quantities and tariff snapshots once, with ordered quantities separate', async () => {
    const response = await get();
    expect(response.status).toBe(200);
    const data = response.body.data as ConsumablesReport;
    expect(data.totals).toEqual({ amount: '10.04', entries: 8, orderedAmount: '1.20', orderedEntries: 1, itemCount: 4 });
    expect(data.units).toEqual([
      { unit: 'ampula', quantity: '0.500', orderedQuantity: '0.000' },
      { unit: 'dona', quantity: '8.500', orderedQuantity: '4.000' },
      { unit: 'ml', quantity: '2.000', orderedQuantity: '0.000' },
    ]);
    expect(data.items.find((item) => item.serviceId === bandage.id)).toMatchObject({ quantity: '3.500', amount: '7.23', entries: 3 });
    expect(data.items.find((item) => item.serviceId === medicine.id)).toMatchObject({ quantity: '5.000', amount: '0.80', orderedQuantity: '4.000', orderedAmount: '1.20' });
    expect(data.periods).toEqual([{ bucket: day, amount: '10.04', entries: 8, orderedAmount: '1.20', orderedEntries: 1 }]);
  });

  it('filters source and kind, includes free usage, and groups local days by Monday/month', async () => {
    const surgery = await get({ source: 'SURGERY' });
    expect(surgery.body.data.totals).toMatchObject({ amount: '7.14', entries: 4, orderedAmount: '0.00' });
    const inpatient = await get({ source: 'INPATIENT', kind: 'MEDICINE' });
    expect(inpatient.body.data.totals).toMatchObject({ amount: '0.50', entries: 2, orderedAmount: '1.20' });
    expect((await get({ groupBy: 'week' })).body.data.periods[0].bucket).toBe('2026-10-12');
    expect((await get({ groupBy: 'month' })).body.data.periods[0].bucket).toBe('2026-10-01');
  });

  it('restricts branches and non-financial users and validates invalid dates', async () => {
    expect((await get({ branchId: otherBranchId })).status).toBe(403);
    expect((await get({}, reception)).status).toBe(403);
    expect((await get({ from: '2026-02-30' })).status).toBe(400);
    expect((await get({ from: '2025-01-01' })).status).toBe(400);
  });

  it('does not let payment, refund or invoice cancellation change recorded usage', async () => {
    const invoice = await prisma.invoice.create({ data: {
      clinicId: clinic.clinicId, branchId: clinic.branchId, patientId, number: 'INV-CONSUMABLES',
      subtotal: '.30', total: '.30', status: 'ISSUED',
    } });
    const line = await prisma.invoiceLine.create({ data: {
      clinicId: clinic.clinicId, invoiceId: invoice.id, serviceId: medicine.id,
      title: { uz: 'Dori' }, quantity: 3, unitPrice: '.10', lineTotal: '.30',
    } });
    await prisma.chargeItem.update({ where: { id: outpatientChargeId }, data: { status: 'INVOICED', invoiceLineId: line.id } });
    for (const status of ['ISSUED', 'PAID', 'REFUNDED', 'CANCELLED'] as const) {
      await prisma.invoice.update({ where: { id: invoice.id }, data: { status } });
      expect((await get({ source: 'OUTPATIENT' })).body.data.totals.amount).toBe('0.30');
    }
    // Normal invoice cancellation releases the charge for re-billing, still retaining usage.
    await prisma.chargeItem.update({ where: { id: outpatientChargeId }, data: { status: 'PENDING', invoiceLineId: null } });
    expect((await get({ source: 'OUTPATIENT' })).body.data.totals.amount).toBe('0.30');
  });

  it('exports the same totals with numeric quantities and harmless text names', async () => {
    const response = await get({ export: 'xlsx' }).buffer(true).parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });
    expect(response.status).toBe(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.body as ExcelJS.Buffer);
    expect(workbook.getWorksheet('Jami')!.getCell('B2').value).toBe(10.04);
    const items = workbook.getWorksheet('Dorilar va materiallar')!;
    const names = Array.from({ length: items.rowCount - 1 }, (_, i) => items.getCell(`B${i + 2}`));
    expect(names.find((cell) => cell.text === '=1+1')?.type).toBe(ExcelJS.ValueType.String);
    expect(items.getCell('E2').type).toBe(ExcelJS.ValueType.Number);
    const audit = await prisma.auditLog.findFirst({ where: { clinicId: clinic.clinicId, entity: 'Report', entityId: 'consumables', action: 'EXPORT' } });
    expect(audit).not.toBeNull();
  });
});
