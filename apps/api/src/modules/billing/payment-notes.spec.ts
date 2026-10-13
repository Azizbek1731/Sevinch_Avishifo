import { describe, expect, it, vi } from 'vitest';
import { Prisma, type Invoice, type Payment } from '@prisma/client';
import { PaymentMethod, type AuthUser, type QuickInvoiceInput } from '@avishifo/shared';
import { TenantContext } from '../../core/prisma/tenant-context';
import { InvoicesService } from './invoices.service';
import { ShiftsService } from './shifts.service';

const key = '12345678-1234-4234-a234-123456789abc';
const user = { id: 'cashier', branchIds: ['branch'], permissions: ['payments.create'] } as AuthUser;
const d = (value: string) => new Prisma.Decimal(value);

function fixture() {
  let invoice = {
    id: 'invoice',
    clinicId: 'clinic',
    branchId: 'branch',
    patientId: 'patient',
    number: 'INV-1',
    status: 'ISSUED',
    total: d('100'),
    subtotal: d('100'),
    discountTotal: d('0'),
    paidTotal: d('0'),
    issuedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Invoice;
  const payments: Payment[] = [];
  const createPayment = vi.fn(async ({ data }: { data: Prisma.PaymentUncheckedCreateInput }) => {
    const payment = {
      ...data,
      id: `payment-${payments.length + 1}`,
      paidAt: new Date(),
      createdAt: new Date(),
    } as Payment;
    payments.push(payment);
    return payment;
  });
  const paymentRows = {
    findMany: vi.fn(async () => payments),
    findFirst: vi.fn(async ({ where }: { where: { id: string } }) =>
      payments.find((payment) => payment.id === where.id),
    ),
    create: createPayment,
  };
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'locked' }]),
    invoice: {
      findFirst: vi.fn(async () => invoice),
      update: vi.fn(async ({ data }: { data: Partial<Invoice> }) => {
        invoice = { ...invoice, ...data };
        return invoice;
      }),
    },
    payment: paymentRows,
    cashierShift: { findFirst: vi.fn().mockResolvedValue({ id: 'shift' }) },
  };
  const prisma = {
    db: {
      ...tx,
      $transaction: (work: (connection: typeof tx) => Promise<unknown>) => work(tx),
      labOrder: { findFirst: vi.fn().mockResolvedValue(null) },
    },
    unscoped: { clinic: { findUnique: vi.fn().mockResolvedValue({ name: 'Test clinic' }) } },
  };
  const audit = { log: vi.fn().mockResolvedValue(undefined) };
  const config = { env: { SINGLE_CLINIC_MODE: true } };
  const args = [
    prisma,
    {},
    { toClinic: vi.fn() },
    audit,
    {},
    { enqueueEvent: vi.fn().mockResolvedValue(undefined) },
    { registerReceipt: vi.fn().mockResolvedValue(undefined) },
    {},
    config,
  ] as unknown as ConstructorParameters<typeof InvoicesService>;
  return { service: new InvoicesService(...args), createPayment, payments, prisma, audit, config };
}

const inClinic = <T>(work: () => T) => TenantContext.run({ clinicId: 'clinic' }, work);

describe('payment note persistence and replay', () => {
  it('persists the note and returns it with the payment used by invoice history and receipts', async () => {
    const { service, payments } = fixture();
    const result = await inClinic(() =>
      service.addPayment(
        'invoice',
        {
          amount: '100',
          method: PaymentMethod.CASH,
          note: '  Bemor to‘ladi  ',
          idempotencyKey: key,
        },
        user,
      ),
    );
    expect(payments[0]?.note).toBe('Bemor to‘ladi');
    expect(result.payment).toMatchObject({ note: 'Bemor to‘ladi' });
  });

  it('keeps different notes on each split leg and replays without duplicate payments', async () => {
    const { service, payments, createPayment, audit } = fixture();
    const parts = [
      { amount: '60', method: PaymentMethod.CARD, note: 'Terminal 123' },
      { amount: '40', method: PaymentMethod.CLICK, note: 'Tranzaksiya 456' },
    ];
    await inClinic(() => service.addPayments('invoice', parts, key, user));
    await inClinic(() => service.addPayments('invoice', parts, key, user));
    expect(payments.map((payment) => payment.note)).toEqual(['Terminal 123', 'Tranzaksiya 456']);
    expect(createPayment).toHaveBeenCalledTimes(2);
    expect(audit.log).toHaveBeenCalledTimes(2);
  });

  it('rejects a reused payment key if a split note changes', async () => {
    const { service, createPayment } = fixture();
    const part = { amount: '100', method: PaymentMethod.CLICK, note: 'Tranzaksiya 123' };
    await inClinic(() => service.addPayments('invoice', [part], key, user));
    await expect(
      inClinic(() =>
        service.addPayments('invoice', [{ ...part, note: 'Tranzaksiya 456' }], key, user),
      ),
    ).rejects.toThrow('Idempotency key already belongs to a different payment');
    expect(createPayment).toHaveBeenCalledOnce();
  });

  it('stores an empty note as null and accepts an omitted note on retry', async () => {
    const { service, payments, createPayment } = fixture();
    const part = { amount: '100', method: PaymentMethod.CASH, idempotencyKey: key };
    await inClinic(() => service.addPayment('invoice', { ...part, note: '  ' }, user));
    await inClinic(() => service.addPayment('invoice', part, user));
    expect(payments[0]?.note).toBeNull();
    expect(createPayment).toHaveBeenCalledOnce();
  });

  it('includes notes in quick-sale request identity without changing empty-note identities', async () => {
    const { service, prisma } = fixture();
    prisma.db.invoice.findFirst.mockResolvedValue(null as unknown as Invoice);
    const create = vi.spyOn(service, 'create').mockResolvedValue({ id: 'invoice', lines: [] });
    vi.spyOn(service, 'addPayments').mockResolvedValue({});
    const input: QuickInvoiceInput = {
      patientId: 'patient',
      branchId: 'branch',
      settle: 'PAY_NOW',
      idempotencyKey: key,
      lines: [{ title: 'Service', quantity: 1, unitPrice: '100', discount: '0' }],
      payments: [{ amount: '100', method: PaymentMethod.CARD }],
    };
    for (const note of [undefined, '', 'Terminal 123', 'Terminal 456']) {
      await inClinic(() =>
        service.quick(
          {
            ...input,
            payments: [{ ...input.payments![0]!, note }],
          },
          user,
        ),
      );
    }
    const identities = create.mock.calls.map((call) => call[2]?.requestFingerprint);
    expect(identities[0]).toBe(identities[1]);
    expect(identities[2]).not.toBe(identities[0]);
    expect(identities[3]).not.toBe(identities[2]);
  });

  it('exposes the stored note in current shift history', async () => {
    const { service, prisma, audit, config, payments } = fixture();
    await inClinic(() =>
      service.addPayment(
        'invoice',
        {
          amount: '100',
          method: PaymentMethod.CARD,
          note: 'Terminal 123',
          idempotencyKey: key,
        },
        user,
      ),
    );
    prisma.db.payment.findMany.mockResolvedValue([
      {
        ...payments[0]!,
        invoice: { number: 'INV-1', patient: { fullName: 'Test patient' } },
      } as Payment,
    ]);
    const args = [prisma, audit, config] as unknown as ConstructorParameters<typeof ShiftsService>;
    const rows = await new ShiftsService(...args).currentPayments(user, 'branch');
    expect(rows[0]).toMatchObject({ note: 'Terminal 123', method: 'CARD' });
  });
});
