import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '@avishifo/shared';
import { ChargesService } from './charges.service';
import type { PrismaService } from '../../core/prisma/prisma.service';
import type { InvoicesService } from '../billing/invoices.service';
import type { PricingService } from '../services/pricing.service';
import type { AuditService } from '../../core/audit/audit.service';
import { TenantContext } from '../../core/prisma/tenant-context';

const user = { id: 'reception', branchIds: ['branch'] } as AuthUser;
const row = {
  id: 'charge',
  patientId: 'patient',
  serviceId: null,
  title: { uz: 'Palata' },
  quantity: 3,
  unitPrice: new Prisma.Decimal('123.45'),
  status: 'PENDING',
  invoiceLineId: null,
};
function setup() {
  const db = {
    chargeItem: { findMany: vi.fn(), create: vi.fn(), findFirst: vi.fn(), findFirstOrThrow: vi.fn() },
    patient: { findFirst: vi.fn().mockResolvedValue({ id: 'patient' }) },
    admission: { findFirst: vi.fn() },
    visit: { findFirst: vi.fn() },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation((callback) => callback(db));
  const invoices = {
    create: vi.fn().mockResolvedValue({ id: 'invoice', status: 'ISSUED' }),
    issueChargesInTransaction: vi.fn().mockResolvedValue({ id: 'invoice', status: 'ISSUED' }),
  };
  const lab = {
    prepareInpatientOrderForCharge: vi.fn().mockResolvedValue(null),
  };
  const service = new ChargesService(
    { db } as unknown as PrismaService,
    invoices as unknown as InvoicesService,
    {} as PricingService,
    { log: vi.fn() } as unknown as AuditService,
    lab as never,
  );
  return { db, invoices, lab, service };
}

describe('reception charge handoff', () => {
  it('keeps a new inpatient charge PENDING on the stay account until discharge', async () => {
    const { db, invoices, service } = setup();
    const pending = {
      ...row, branchId: 'branch', admissionId: 'stay', visitId: null,
      date: new Date('2026-10-13'), createdAt: new Date('2026-10-13'),
      status: 'PENDING', invoiceLineId: null,
    };
    db.admission.findFirst.mockResolvedValue({ id: 'stay', status: 'ACTIVE' });
    db.chargeItem.create.mockResolvedValue(row);
    db.chargeItem.findFirstOrThrow.mockResolvedValue(pending);
    const result = await TenantContext.run({ clinicId: 'clinic' }, () => service.add({
      patientId: 'patient', admissionId: 'stay', title: 'Palata',
      unitPrice: '123.45', quantity: 3, date: '2026-10-13',
    }, user, 'branch'));
    expect(invoices.issueChargesInTransaction).not.toHaveBeenCalled();
    expect(result).toMatchObject({ id: 'charge', status: 'PENDING', lineTotal: '370.35' });
    expect(invoices.create).not.toHaveBeenCalled();
  });

  it('issues a walk-in charge immediately so failure cannot orphan the cost', async () => {
    const { db, invoices, service } = setup();
    db.chargeItem.create.mockResolvedValue(row);
    invoices.issueChargesInTransaction.mockRejectedValue(new Error('invoice failed'));
    await expect(TenantContext.run({ clinicId: 'clinic' }, () => service.add({
      patientId: 'patient', title: 'Palata', unitPrice: '123.45', quantity: 3, date: '2026-10-13',
    }, user, 'branch'))).rejects.toThrow('invoice failed');
    expect(db.chargeItem.findFirstOrThrow).not.toHaveBeenCalled();
  });

  it('replays a recorded inpatient cost without creating another charge or invoice', async () => {
    const { db, invoices, service } = setup();
    const pending = {
      ...row, branchId: 'branch', admissionId: 'stay', visitId: null,
      date: new Date('2026-10-13'), createdAt: new Date('2026-10-13'),
      status: 'PENDING', invoiceLineId: null,
    };
    const input = {
      patientId: 'patient', admissionId: 'stay', title: 'Palata',
      unitPrice: '123.45', quantity: 3, date: '2026-10-13',
      idempotencyKey: 'ce7f1d36-e737-4a23-ac6b-35b3f0d652b4',
    };
    db.admission.findFirst.mockResolvedValue({ id: 'stay', status: 'ACTIVE' });
    db.chargeItem.create.mockResolvedValue(row);
    db.chargeItem.findFirstOrThrow.mockResolvedValue(pending);
    await TenantContext.run({ clinicId: 'clinic' }, () => service.add(input, user, 'branch'));
    const savedData = db.chargeItem.create.mock.calls[0]![0].data;
    db.chargeItem.findFirst.mockResolvedValue({ ...pending, ...savedData, status: 'PENDING' });
    db.admission.findFirst.mockRejectedValue(new Error('stay no longer active'));
    const replay = await TenantContext.run({ clinicId: 'clinic' }, () => service.add(input, user, 'branch'));
    expect(replay).toMatchObject({ id: 'charge', status: 'PENDING', lineTotal: '370.35' });
    expect(db.chargeItem.create).toHaveBeenCalledTimes(1);
    expect(invoices.issueChargesInTransaction).not.toHaveBeenCalled();
    await expect(TenantContext.run({ clinicId: 'clinic' }, () => service.add({
      ...input, patientId: 'other-patient',
    }, user, 'branch'))).rejects.toThrow('boshqa xarajat');
    expect(invoices.issueChargesInTransaction).not.toHaveBeenCalled();
  });

  it('rejects a partially available selection rather than billing the remaining subset', async () => {
    const { db, invoices, service } = setup();
    db.chargeItem.findMany.mockResolvedValue([row]);
    await expect(
      service.invoiceSelected({ chargeIds: ['charge', 'already-billed'] }, user, 'branch'),
    ).rejects.toThrow();
    expect(invoices.create).not.toHaveBeenCalled();
  });

  it('rejects charges for different patients before creating any invoice', async () => {
    const { db, invoices, service } = setup();
    db.chargeItem.findMany.mockResolvedValue([row, { ...row, id: 'second', patientId: 'another' }]);
    await expect(
      service.invoiceSelected({ chargeIds: ['charge', 'second'] }, user, 'branch'),
    ).rejects.toThrow();
    expect(invoices.create).not.toHaveBeenCalled();
  });

  it('preserves manual ward costs and issues them through the atomic invoice path', async () => {
    const { db, invoices, service } = setup();
    db.chargeItem.findMany.mockResolvedValue([row]);
    const result = await service.invoiceSelected(
      { chargeIds: ['charge', 'charge'] },
      user,
      'branch',
    );
    expect(result.status).toBe('ISSUED');
    expect(invoices.create).toHaveBeenCalledWith(
      {
        patientId: 'patient',
        branchId: 'branch',
        lines: [
          {
            serviceId: undefined,
            title: 'Palata',
            quantity: 3,
            unitPrice: '123.45',
            discount: '0',
            chargeItemId: 'charge',
          },
        ],
      },
      user,
      { issueImmediately: true },
    );
  });

  it('calculates the full pending quantity total even when displayed rows use another status', async () => {
    const { db, service } = setup();
    db.chargeItem.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { quantity: 3, unitPrice: new Prisma.Decimal('0.10') },
      { quantity: 2, unitPrice: new Prisma.Decimal('1.25') },
    ]);
    const result = await service.listForPatient(
      { patientId: 'patient', status: 'INVOICED', admissionId: 'stay' },
      'branch',
    );
    expect(result.pendingTotal).toBe('2.80');
    expect(db.chargeItem.findMany.mock.calls[1]?.[0].where).toEqual({
      patientId: 'patient',
      branchId: 'branch',
      admissionId: 'stay',
      status: 'PENDING',
    });
  });

  it('does not attach a cost to another patient’s or branch’s stay', async () => {
    const { db, service } = setup();
    db.admission.findFirst.mockResolvedValue(null);
    await expect(
      TenantContext.run({ clinicId: 'clinic' }, () => service.add(
        {
          patientId: 'patient',
          admissionId: 'foreign-stay',
          title: 'Room',
          unitPrice: '100',
          date: '2026-10-11',
          quantity: 1,
        },
        user,
        'branch',
      )),
    ).rejects.toThrow();
    expect(db.chargeItem.create).not.toHaveBeenCalled();
  });
});
