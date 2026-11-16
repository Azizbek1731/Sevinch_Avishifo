import { describe, expect, it } from 'vitest';
import { labShare, totalsOf, uziShares, type UziRow } from './ambulatory-share';

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

const uzi = (over: Partial<UziRow> = {}): UziRow => ({
  orderId: 'uzi-order',
  createdAt: new Date('2026-11-17T08:00:00Z'),
  caseId: 'case',
  caseNumber: 'AK-2026-0001',
  doctorUserId: 'doctor',
  doctorName: 'Doctor',
  patientId: 'patient',
  mrn: 'P-1',
  fullName: 'Patient',
  orderNumber: 'INV-10',
  orderCancelled: false,
  uziPercent: '10.00',
  echoPercent: '0.00',
  invoiceId: 'inv-10',
  invoiceNumber: 'INV-10',
  invoiceStatus: 'PAID',
  invoiceTotal: '240000.00',
  paidTotal: '240000.00',
  refunded: '0',
  linesTotal: '240000.00',
  uziLinesTotal: '90000.00',
  echoLinesTotal: '150000.00',
  uziTitles: [{ uz: 'Qalqonsimon bez' }],
  echoTitles: [{ uz: 'ExoKG' }],
  ...over,
});

describe('ambulatory lab share', () => {
  it('gives the doctor 25% of a fully paid lab bill', () => {
    const share = labShare(row(), 25);
    expect(share.group).toBe('LAB');
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
    expect(share.amount.toFixed(2)).toBe('135000.00');
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

describe('ambulatory UZI / EXO share', () => {
  it('splits one order into UZI and EXO parts with their own percents', () => {
    const shares = uziShares([uzi()]);
    const uziPart = shares.find((share) => share.group === 'UZI')!;
    const echoPart = shares.find((share) => share.group === 'EXO')!;
    expect(uziPart.amount.toFixed(2)).toBe('90000.00');
    expect(uziPart.commission.toFixed(2)).toBe('9000.00');
    expect(echoPart.amount.toFixed(2)).toBe('150000.00');
    expect(echoPart.commission.toFixed(2)).toBe('0.00');
    expect(uziPart.tests).toEqual([{ uz: 'Qalqonsimon bez' }]);
  });

  it('adds examinations billed during the scan and earns only on what was paid', () => {
    const shares = uziShares([
      uzi({ echoLinesTotal: '0', linesTotal: '90000.00', invoiceTotal: '90000.00', paidTotal: '90000.00', uziLinesTotal: '90000.00' }),
      uzi({
        invoiceId: 'inv-11',
        invoiceNumber: 'INV-11',
        invoiceStatus: 'ISSUED',
        invoiceTotal: '85000.00',
        paidTotal: '0.00',
        linesTotal: '85000.00',
        uziLinesTotal: '85000.00',
        echoLinesTotal: '0',
      }),
    ]);
    expect(shares).toHaveLength(1);
    expect(shares[0]!.amount.toFixed(2)).toBe('175000.00');
    expect(shares[0]!.paidAmount.toFixed(2)).toBe('90000.00');
    expect(shares[0]!.commission.toFixed(2)).toBe('9000.00');
    expect(shares[0]!.pendingCommission.toFixed(2)).toBe('8500.00');
    expect(shares[0]!.paymentState).toBe('PARTIAL');
  });

  it('gives nothing for orders without a snapshot or cancelled orders', () => {
    const legacy = uziShares([uzi({ uziPercent: null, echoPercent: null })]);
    expect(legacy.every((share) => share.commission.isZero())).toBe(true);
    const cancelled = uziShares([uzi({ orderCancelled: true })]);
    expect(cancelled.every((share) => share.cancelled)).toBe(true);
  });

  it('totals by group', () => {
    const totals = totalsOf([labShare(row(), 25), ...uziShares([uzi({ echoPercent: '20.00' })])]);
    expect(totals.commission).toBe('89000.00');
    expect(totals.byGroup.LAB.commission).toBe('50000.00');
    expect(totals.byGroup.UZI.commission).toBe('9000.00');
    expect(totals.byGroup.EXO.commission).toBe('30000.00');
    expect(totals.orders).toBe(2);
  });
});
