import { describe, expect, it } from 'vitest';
import { labShare } from './ambulatory.service';

const row = (over: Partial<Parameters<typeof labShare>[0]> = {}): Parameters<typeof labShare>[0] => ({
  orderId: 'order',
  orderNumber: 'L-1',
  createdAt: new Date('2026-11-12T08:00:00Z'),
  orderStatus: 'ORDERED',
  caseId: 'case',
  caseNumber: 'AK-2026-0001',
  doctorUserId: 'doctor',
  doctorName: 'Doctor',
  patientId: 'patient',
  mrn: 'P-1',
  fullName: 'Patient',
  percent: '25.00',
  invoiceId: 'invoice',
  invoiceNumber: 'INV-1',
  invoiceStatus: 'PAID',
  invoiceTotal: '200000.00',
  paidTotal: '200000.00',
  refunded: '0',
  linesTotal: '200000.00',
  labLinesTotal: '200000.00',
  tests: [],
  ...over,
});

describe('ambulatory lab share', () => {
  it('gives the doctor 25% of a fully paid lab bill', () => {
    const share = labShare(row(), 25);
    expect(share.commission.toFixed(2)).toBe('50000.00');
    expect(share.pendingCommission.toFixed(2)).toBe('0.00');
    expect(share.paymentState).toBe('PAID');
  });

  it('earns only on what the cashier took and keeps the rest as pending', () => {
    const share = labShare(row({ invoiceStatus: 'PARTIALLY_PAID', paidTotal: '80000.00' }), 25);
    expect(share.paidAmount.toFixed(2)).toBe('80000.00');
    expect(share.commission.toFixed(2)).toBe('20000.00');
    expect(share.pendingCommission.toFixed(2)).toBe('30000.00');
    expect(share.paymentState).toBe('PARTIAL');
  });

  it('counts only the lab part of a mixed bill after the invoice discount', () => {
    // 150k lab + 50k consultation, invoice discounted to 180k and paid in full.
    const share = labShare(
      row({ linesTotal: '200000.00', labLinesTotal: '150000.00', invoiceTotal: '180000.00', paidTotal: '180000.00' }),
      25,
    );
    expect(share.labAmount.toFixed(2)).toBe('135000.00');
    expect(share.commission.toFixed(2)).toBe('33750.00');
  });

  it('deducts refunds and drops cancelled work', () => {
    expect(labShare(row({ refunded: '200000.00' }), 25).commission.toFixed(2)).toBe('0.00');
    expect(labShare(row({ orderStatus: 'CANCELLED' }), 25).cancelled).toBe(true);
    expect(labShare(row({ invoiceStatus: 'CANCELLED' }), 25).commission.toFixed(2)).toBe('0.00');
  });

  it('keeps the percent snapshot taken at order time', () => {
    expect(labShare(row({ percent: '30.00' }), 25).commission.toFixed(2)).toBe('60000.00');
    expect(labShare(row({ percent: null }), 20).commission.toFixed(2)).toBe('40000.00');
  });
});
