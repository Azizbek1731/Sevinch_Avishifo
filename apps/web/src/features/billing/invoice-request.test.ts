import { describe, expect, it } from 'vitest';
import type { QuickInvoiceInput } from '@avishifo/shared';
import { identifyInvoiceRequest } from './invoice-request';

const payload: Omit<QuickInvoiceInput, 'idempotencyKey'> = {
  patientId: 'patient',
  branchId: 'branch',
  settle: 'DEBT',
  lines: [{ serviceId: 'service', quantity: 1, unitPrice: '100.00', discount: '0' }],
};

describe('reception invoice request identity', () => {
  it('reuses a request key after a lost response for unchanged order data', () => {
    const first = identifyInvoiceRequest(payload, null);
    expect(identifyInvoiceRequest(structuredClone(payload), first)).toBe(first);
  });

  it('assigns a new key after the receptionist changes the order', () => {
    const first = identifyInvoiceRequest(payload, null);
    const changed = identifyInvoiceRequest(
      { ...payload, lines: [{ ...payload.lines[0]!, quantity: 2 }] },
      first,
    );
    expect(changed.key).not.toBe(first.key);
  });

  it('creates a new identity for a fresh form even with the same order', () => {
    const first = identifyInvoiceRequest(payload, null);
    expect(identifyInvoiceRequest(payload, null).key).not.toBe(first.key);
  });
});
