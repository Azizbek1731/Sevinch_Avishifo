import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import type { AuthUser, MarkAdministrationInput } from '@avishifo/shared';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { TenantContext } from '../src/core/prisma/tenant-context';
import { AuditService } from '../src/core/audit/audit.service';
import { AdmissionsService } from '../src/modules/admissions/admissions.service';
import { RoomBillingService } from '../src/modules/billing/room-billing.service';
import type { InvoicesService } from '../src/modules/billing/invoices.service';
import { PricingService } from '../src/modules/services/pricing.service';
import { PayrollService } from '../src/modules/staff/payroll.service';
import type { StaffService } from '../src/modules/staff/staff.service';
import type { TenantTransactionClient } from '../src/core/prisma/tenant-extension';

describe('legacy ward administration and discharge concurrency', () => {
  let prisma: PrismaService;
  let service: AdmissionsService;
  let clinicId: string;
  let branchId: string;
  let doctorId: string;
  let user: AuthUser;
  const date = '2026-10-13';
  const inClinic = <T>(work: () => T) => TenantContext.run({ clinicId, userId: user.id }, work);
  const discharge = { outcome: 'IMPROVED' as const, finalDiagnosisMain: 'Test diagnosis' };

  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL ?? '').pathname;
    if (database !== '/avishifo_finance_migration' || process.env.TELEGRAM_ENABLED !== 'false') {
      throw new Error('Use an isolated test database');
    }
    prisma = new PrismaService();
    await prisma.unscoped.$connect();
    service = new AdmissionsService(
      prisma,
      new PricingService(prisma),
      new AuditService(prisma),
      {} as InvoicesService,
      new RoomBillingService(prisma, {} as InvoicesService),
    );
    const clinic = await prisma.unscoped.clinic.create({
      data: { name: `Ward test ${randomUUID()}` },
    });
    clinicId = clinic.id;
    const branch = await prisma.unscoped.branch.create({ data: { clinicId, name: 'Test ward' } });
    branchId = branch.id;
    const doctor = await prisma.unscoped.user.create({
      data: {
        clinicId,
        fullName: 'Test doctor',
        role: 'DOCTOR',
        status: 'ACTIVE',
        branches: { create: { clinicId, branchId } },
      },
    });
    doctorId = doctor.id;
    const reception = await prisma.unscoped.user.create({
      data: {
        clinicId,
        fullName: 'Test receptionist',
        role: 'RECEPTIONIST',
        status: 'ACTIVE',
      },
    });
    user = {
      id: reception.id,
      role: 'RECEPTIONIST',
      clinicId,
      branchIds: [branchId],
      permissions: ['admissions.write', 'admissions.administer', 'admissions.force'],
    } as AuthUser;
  });

  afterAll(async () => {
    await prisma?.unscoped.$disconnect();
  });

  async function ward() {
    const patient = await prisma.unscoped.patient.create({
      data: {
        clinicId,
        mrn: randomUUID(),
        firstName: 'Test',
        lastName: 'Ward',
        fullName: 'Test Ward',
        tags: [],
      },
    });
    const category = await prisma.unscoped.serviceCategory.create({
      data: {
        clinicId,
        name: 'Ward treatments',
        kind: 'PROCEDURE',
      },
    });
    const treatment = await prisma.unscoped.service.create({
      data: {
        clinicId,
        categoryId: category.id,
        code: randomUUID(),
        name: { uz: 'Test muolaja' },
        prices: { create: { clinicId, price: '123.45', effectiveFrom: new Date('2020-01-01') } },
      },
    });
    const admission = await inClinic(() =>
      service.admit({ patientId: patient.id }, user, branchId),
    );
    const admissionId = admission.id as string;
    // Existing orders created before upfront billing retain their dose ledger.
    // Seed that historical state explicitly; new createOrder is covered by the
    // HTTP suite and must invoice immediately without fabricated GIVEN rows.
    const order = await prisma.unscoped.treatmentOrder.create({
      data: {
        clinicId,
        admissionId,
        serviceId: treatment.id,
        doctorUserId: doctorId,
        startDate: new Date(date),
        schedule: 'DAILY',
        timesPlanned: 2,
        timesPerDay: 2,
        billedOnOrder: false,
      },
    });
    const mark: MarkAdministrationInput = {
      orderId: order.id as string,
      date,
      slot: 1,
      status: 'GIVEN',
    };
    return { admissionId, patientId: patient.id, serviceId: treatment.id, mark };
  }

  it('records concurrent duplicate GIVEN once, with exactly one charge per dose', async () => {
    const { admissionId, mark } = await ward();
    const results = await Promise.all([
      inClinic(() => service.markAdministration(admissionId, mark, user)),
      inClinic(() => service.markAdministration(admissionId, mark, user)),
    ]);
    expect(results[0]?.id).toBe(results[1]?.id);
    await inClinic(() => service.markAdministration(admissionId, { ...mark, slot: 2 }, user));
    const charges = await prisma.unscoped.chargeItem.findMany({ where: { admissionId } });
    expect(charges).toHaveLength(2);
    expect(charges.map((charge) => charge.quantity)).toEqual([1, 1]);
    expect(charges.reduce((sum, charge) => sum + Number(charge.unitPrice), 0)).toBe(246.9);
  });

  it('preserves the original price on replay and on a corrected mark', async () => {
    const { admissionId, serviceId, mark } = await ward();
    await inClinic(() => service.markAdministration(admissionId, mark, user));
    await prisma.unscoped.servicePrice.updateMany({ where: { serviceId }, data: { price: '999' } });
    await inClinic(() => service.markAdministration(admissionId, mark, user));
    await inClinic(() =>
      service.markAdministration(admissionId, { ...mark, status: 'SKIPPED' }, user),
    );
    await inClinic(() => service.markAdministration(admissionId, mark, user));
    const charges = await prisma.unscoped.chargeItem.findMany({ where: { admissionId } });
    expect(charges).toHaveLength(1);
    expect(charges[0]?.unitPrice.toFixed(2)).toBe('123.45');
    expect(charges[0]?.status).toBe('PENDING');
  });

  it('rejects a billed skip even when billing claims the charge during the request', async () => {
    const { admissionId, mark } = await ward();
    await inClinic(() => service.markAdministration(admissionId, mark, user));
    const charge = await prisma.unscoped.chargeItem.findFirstOrThrow({ where: { admissionId } });
    let release!: () => void;
    let acquired!: () => void;
    const held = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const claim = prisma.unscoped.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ChargeItem" WHERE "id" = ${charge.id} FOR UPDATE`;
      await tx.chargeItem.update({
        where: { id: charge.id },
        data: { status: 'INVOICED', invoiceLineId: randomUUID() },
      });
      acquired();
      await gate;
    });
    await held;
    let settled = false;
    const correcting = inClinic(() =>
      service.markAdministration(admissionId, { ...mark, status: 'SKIPPED' }, user),
    ).then(
      () => {
        settled = true;
        return null;
      },
      (error: unknown) => {
        settled = true;
        return error;
      },
    );
    try {
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(settled).toBe(false);
    } finally {
      release();
    }
    await claim;
    expect(await correcting).toMatchObject({ message: expect.stringContaining('hisob-fakturaga') });
    expect(
      (
        await prisma.unscoped.treatmentAdministration.findFirstOrThrow({
          where: { orderId: mark.orderId },
        })
      ).status,
    ).toBe('GIVEN');
    expect(
      (await prisma.unscoped.chargeItem.findUniqueOrThrow({ where: { id: charge.id } })).status,
    ).toBe('INVOICED');
    // An unchanged retry is still successful after billing, without a second charge.
    await inClinic(() => service.markAdministration(admissionId, mark, user));
    expect(await prisma.unscoped.chargeItem.count({ where: { admissionId } })).toBe(1);
  });

  it('waits for a surgery admission lock, then sees its fee before deciding discharge', async () => {
    const { admissionId, patientId, serviceId } = await ward();
    let release!: () => void;
    let acquired!: () => void;
    const held = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const surgery = prisma.unscoped.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Admission" WHERE "id" = ${admissionId} FOR UPDATE`;
      acquired();
      await gate;
      const fee = await tx.chargeItem.create({
        data: {
          clinicId,
          branchId,
          admissionId,
          patientId,
          serviceId,
          title: { uz: 'Test surgery' },
          date: new Date(date),
          quantity: 1,
          unitPrice: '500',
        },
      });
      const operation = await tx.surgeryCase.create({
        data: {
          clinicId,
          branchId,
          admissionId,
          patientId,
          serviceId,
          surgeonUserId: doctorId,
          serviceChargeId: fee.id,
          scheduledDate: new Date(date),
          createdById: user.id,
          requestKey: randomUUID(),
          requestFingerprint: 'test',
        },
      });
      await tx.chargeItem.update({ where: { id: fee.id }, data: { surgeryId: operation.id } });
    });
    await held;
    let settled = false;
    const closing = inClinic(() => service.discharge(admissionId, discharge, user)).then(
      () => {
        settled = true;
        return null;
      },
      (error: unknown) => {
        settled = true;
        return error;
      },
    );
    try {
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(settled).toBe(false);
    } finally {
      release();
    }
    await surgery;
    expect(await closing).toMatchObject({ message: expect.stringContaining('Hisob-fakturaga') });
    expect(
      (await prisma.unscoped.admission.findUniqueOrThrow({ where: { id: admissionId } })).status,
    ).toBe('ACTIVE');
    await expect(inClinic(() => service.remove(admissionId))).rejects.toThrow(
      'Operatsiya tarixi mavjud',
    );
    await inClinic(() => service.discharge(admissionId, { ...discharge, force: true }, user));
    const closed = await prisma.unscoped.admission.findUniqueOrThrow({
      where: { id: admissionId },
    });
    expect(closed.status).toBe('DISCHARGED');
    expect(closed.debtAtDischarge?.toFixed(2)).toBe('500.00');
    expect(await prisma.unscoped.surgeryCase.count({ where: { admissionId } })).toBe(1);
    expect(
      await prisma.unscoped.chargeItem.count({ where: { admissionId, status: 'PENDING' } }),
    ).toBe(1);
    await expect(
      inClinic(() => service.discharge(admissionId, { ...discharge, force: true }, user)),
    ).rejects.toThrow('Bemor chiqarilgan');
  });

  it('rejects new doses of inactive or unpriced services but still accepts an unchanged replay', async () => {
    const { admissionId, serviceId, mark } = await ward();
    await inClinic(() => service.markAdministration(admissionId, mark, user));
    await prisma.unscoped.service.update({ where: { id: serviceId }, data: { isActive: false } });
    await inClinic(() => service.markAdministration(admissionId, mark, user));
    await expect(
      inClinic(() => service.markAdministration(admissionId, { ...mark, slot: 2 }, user)),
    ).rejects.toThrow('faol emas');
    await prisma.unscoped.service.update({ where: { id: serviceId }, data: { isActive: true } });
    await prisma.unscoped.servicePrice.deleteMany({ where: { serviceId } });
    await expect(
      inClinic(() => service.markAdministration(admissionId, { ...mark, slot: 2 }, user)),
    ).rejects.toThrow('narxi belgilanmagan');
    expect(await prisma.unscoped.chargeItem.count({ where: { admissionId } })).toBe(1);
  });

  it('keeps reception registration available and rejects a deleted attending doctor', async () => {
    const { admissionId } = await ward();
    const admission = await prisma.unscoped.admission.findUniqueOrThrow({
      where: { id: admissionId },
    });
    expect(admission.attendingDoctorUserId).toBeNull();
    await inClinic(() => service.update(admissionId, { attendingDoctorUserId: doctorId }));
    await prisma.unscoped.user.update({ where: { id: doctorId }, data: { deletedAt: new Date() } });
    try {
      await expect(
        inClinic(() => service.update(admissionId, { attendingDoctorUserId: doctorId })),
      ).rejects.toThrow('Faol shifokorni tanlang');
    } finally {
      await prisma.unscoped.user.update({ where: { id: doctorId }, data: { deletedAt: null } });
    }
  });

  it('cannot accrue a surgery fee committed between the payroll exclusion and revenue reads', async () => {
    const { admissionId, patientId, serviceId } = await ward();
    const fee = await prisma.unscoped.chargeItem.create({
      data: {
        clinicId,
        branchId,
        admissionId,
        patientId,
        serviceId,
        title: { uz: 'Snapshot test surgery' },
        date: new Date(date),
        quantity: 1,
        unitPrice: '1000',
      },
    });
    const operation = await prisma.unscoped.surgeryCase.create({
      data: {
        clinicId,
        branchId,
        admissionId,
        patientId,
        serviceId,
        surgeonUserId: doctorId,
        serviceChargeId: fee.id,
        scheduledDate: new Date(date),
        createdById: user.id,
        requestKey: randomUUID(),
        requestFingerprint: 'payroll-snapshot-test',
        status: 'COMPLETED',
      },
    });
    await prisma.unscoped.chargeItem.update({
      where: { id: fee.id },
      data: { surgeryId: operation.id },
    });
    await prisma.unscoped.compensationRule.create({
      data: {
        clinicId,
        doctorUserId: doctorId,
        type: 'REVENUE_PERCENT',
        value: '10',
        effectiveFrom: new Date('2020-01-01'),
      },
    });
    let inserted = false;
    const snapshotPrisma = {
      db: {
        compensationRule: prisma.db.compensationRule,
        payrollAccrual: prisma.db.payrollAccrual,
        $transaction: <T>(
          work: (tx: TenantTransactionClient) => Promise<T>,
          options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
        ) =>
          prisma.db.$transaction(async (tx) => {
            const instrumented = new Proxy(tx, {
              get(target, property) {
                if (property !== 'surgeryCase') return Reflect.get(target, property);
                return {
                  findMany: async (args: Prisma.SurgeryCaseFindManyArgs) => {
                    const rows = await tx.surgeryCase.findMany(args);
                    // A different connection commits after the first snapshot read.
                    await prisma.unscoped.$transaction(async (other) => {
                      const invoice = await other.invoice.create({
                        data: {
                          clinicId,
                          branchId,
                          patientId,
                          number: `SNAP-${randomUUID()}`,
                          status: 'PAID',
                          issuedAt: new Date(date),
                          subtotal: '1000',
                          total: '1000',
                          paidTotal: '1000',
                          lines: {
                            create: {
                              clinicId,
                              serviceId,
                              title: { uz: 'Snapshot test surgery' },
                              quantity: 1,
                              unitPrice: '1000',
                              lineTotal: '1000',
                              performerUserId: doctorId,
                            },
                          },
                          payments: {
                            create: { clinicId, branchId, amount: '1000', method: 'CASH' },
                          },
                        },
                        include: { lines: true },
                      });
                      await other.chargeItem.update({
                        where: { id: fee.id },
                        data: {
                          status: 'INVOICED',
                          invoiceLineId: invoice.lines[0]!.id,
                        },
                      });
                    });
                    inserted = true;
                    return rows;
                  },
                };
              },
            });
            return work(instrumented);
          }, options),
      },
    } as unknown as PrismaService;
    const payroll = new PayrollService(
      snapshotPrisma,
      new AuditService(prisma),
      {} as StaffService,
    );
    const result = await inClinic(() => payroll.generateAccruals('2026-10'));
    expect(inserted).toBe(true);
    expect(result.doctorsProcessed).toBe(1);
    expect(result.totalAccrued).toBe('0.00');
    const normal = new PayrollService(prisma, new AuditService(prisma), {} as StaffService);
    expect((await inClinic(() => normal.generateAccruals('2026-10'))).totalAccrued).toBe('0.00');
  });
});
