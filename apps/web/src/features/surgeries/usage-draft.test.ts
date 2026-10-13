import { describe, expect, it } from 'vitest';
import { addSurgeryEntriesSchema } from '@avishifo/shared';
import type { ServiceRow } from '../services/api';
import { identifySurgeryRequest } from './request-key';
import {
  emptyUsageRow,
  serializeUsageRows,
  usageRowsTotals,
  validateUsageRows,
  type UsageDraftRow,
} from './usage-draft';

const service: ServiceRow = {
  id: '019abcde-1234-7000-8000-000000000001',
  categoryId: '019abcde-1234-7000-8000-000000000002',
  code: 'MAT-001',
  name: { uz: 'Steril bint', ru: 'Стерильный бинт', en: 'Sterile bandage' },
  durationMin: 0,
  unit: 'dona',
  vatIncluded: false,
  isActive: true,
  currentPrice: '12.20',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

const manualRow = (patch: Partial<UsageDraftRow> = {}): UsageDraftRow => ({
  ...emptyUsageRow(),
  source: 'MANUAL',
  title: 'Additional material',
  unit: 'dona',
  unitPrice: '10.00',
  ...patch,
});

const catalogueRow = (patch: Partial<UsageDraftRow> = {}): UsageDraftRow => ({
  ...emptyUsageRow(),
  service,
  ...patch,
});

describe('surgery usage draft serialization', () => {
  it('starts with an independent blank catalogue row for each addition', () => {
    const first = emptyUsageRow();
    const second = emptyUsageRow();
    expect(first).toEqual({
      source: 'CATALOGUE',
      service: null,
      title: '',
      quantity: '1',
      unit: 'dona',
      unitPrice: '',
      note: '',
    });
    first.quantity = '3';
    expect(second.quantity).toBe('1');
  });

  it.each(['MATERIAL', 'ANESTHESIA'] as const)(
    'serializes mixed %s rows with catalogue authority and normalized manual input',
    (kind) => {
      const rows = [
        catalogueRow({
          title: 'Stale manual title',
          unit: 'stale unit',
          unitPrice: '999.99',
          quantity: ' 0,125 ',
          note: '  Catalogue note  ',
        }),
        manualRow({
          service,
          title: '  Anaesthetic vial  ',
          quantity: ' 2,5 ',
          unit: '  ml  ',
          unitPrice: ' 125,50 ',
          note: '  Manual note  ',
        }),
      ];
      const original = structuredClone(rows);
      const payload = serializeUsageRows(rows, kind);

      expect(payload).toEqual({
        items: [
          { kind, serviceId: service.id, quantity: '0.125', note: 'Catalogue note' },
          {
            kind,
            title: 'Anaesthetic vial',
            quantity: '2.500',
            unit: 'ml',
            unitPrice: '125.50',
            note: 'Manual note',
          },
        ],
      });
      expect(payload.items[0]).not.toHaveProperty('unitPrice');
      expect(payload.items[0]).not.toHaveProperty('title');
      expect(payload.items[0]).not.toHaveProperty('unit');
      expect(payload.items[1]).not.toHaveProperty('serviceId');
      expect(rows).toEqual(original);
      expect(validateUsageRows(rows, kind)).toEqual([]);
      expect(
        addSurgeryEntriesSchema.safeParse({
          ...payload,
          idempotencyKey: '019abcde-1234-7000-8000-000000000003',
        }).success,
      ).toBe(true);
    },
  );

  it('preserves entered rows and their order when a middle row is removed', () => {
    const rows = [
      catalogueRow({ quantity: '2', note: 'First retained' }),
      manualRow({ title: 'Removed', quantity: '9' }),
      manualRow({ title: 'Last retained', quantity: '3', unitPrice: '4.50' }),
    ];
    const original = structuredClone(rows);
    const remaining = rows.filter((_, index) => index !== 1);
    const payload = serializeUsageRows(remaining, 'MATERIAL');

    expect(payload.items).toHaveLength(2);
    expect(payload.items[0]).toMatchObject({ serviceId: service.id, quantity: '2.000' });
    expect(payload.items[1]).toMatchObject({ title: 'Last retained', quantity: '3.000' });
    expect(usageRowsTotals(remaining)).toEqual({ lines: ['24.40', '13.50'], total: '37.90' });
    expect(remaining[0]).toBe(rows[0]);
    expect(remaining[1]).toBe(rows[2]);
    expect(rows).toEqual(original);
  });

  it('retains blank and partially entered rows so validation can identify their positions', () => {
    const rows = [
      catalogueRow(),
      emptyUsageRow(),
      manualRow({ title: '', unitPrice: '', note: 'Keep this entered note' }),
    ];
    const payload = serializeUsageRows(rows, 'MATERIAL');
    expect(payload.items).toHaveLength(3);
    expect(payload.items[2]?.note).toBe('Keep this entered note');
    const issues = validateUsageRows(rows, 'MATERIAL');
    expect(issues).toContainEqual({ index: 1, field: 'service' });
    expect(issues).toContainEqual({ index: 2, field: 'title' });
    expect(issues).toContainEqual({ index: 2, field: 'unitPrice' });
  });

  it('preserves excess precision for validation instead of rounding invalid input', () => {
    const rows = [manualRow({ quantity: ' 1,0001 ', unitPrice: ' 10,001 ' })];
    expect(serializeUsageRows(rows, 'MATERIAL').items[0]).toMatchObject({
      quantity: '1.0001',
      unitPrice: '10.001',
    });
    expect(validateUsageRows(rows, 'MATERIAL')).toEqual(
      expect.arrayContaining([
        { index: 0, field: 'quantity' },
        { index: 0, field: 'unitPrice' },
      ]),
    );
  });
});

describe('surgery usage row validation', () => {
  it.each([1, 50])('accepts %i valid rows', (count) => {
    const rows = Array.from({ length: count }, () => manualRow());
    expect(validateUsageRows(rows, 'MATERIAL')).toEqual([]);
  });

  it.each([0, 51])('rejects %i rows without silently dropping any', (count) => {
    const rows = Array.from({ length: count }, () => manualRow());
    expect(validateUsageRows(rows, 'MATERIAL')).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'items' })]),
    );
    expect(serializeUsageRows(rows, 'MATERIAL').items).toHaveLength(count);
  });

  it('rejects a catalogue item without a current price despite stale manual values', () => {
    const rows = [
      catalogueRow({ service: { ...service, currentPrice: null }, unitPrice: '12.20' }),
    ];
    expect(validateUsageRows(rows, 'MATERIAL')).not.toEqual([]);
    expect(usageRowsTotals(rows)).toEqual({ lines: [null], total: null });
  });

  it.each([
    ['title', ''],
    ['title', ' '.repeat(3)],
    ['title', 'x'.repeat(201)],
    ['unit', ''],
    ['unit', 'x'.repeat(31)],
    ['quantity', '0'],
    ['quantity', '0.000'],
    ['quantity', '-1'],
    ['quantity', '1.0001'],
    ['quantity', '1000000000'],
    ['quantity', '1e3'],
    ['unitPrice', ''],
    ['unitPrice', '-1'],
    ['unitPrice', '1.001'],
    ['unitPrice', '1000000000000'],
    ['note', 'x'.repeat(501)],
  ] as const)('identifies row and field for invalid %s %j', (field, value) => {
    const rows = [catalogueRow(), manualRow({ [field]: value })];
    expect(validateUsageRows(rows, 'ANESTHESIA')).toContainEqual({ index: 1, field });
  });

  it('accepts fractional quantity and a free manual item at the schema boundaries', () => {
    const rows = [manualRow({ quantity: '0.001', unitPrice: '0', note: 'x'.repeat(500) })];
    expect(validateUsageRows(rows, 'MATERIAL')).toEqual([]);
    expect(usageRowsTotals(rows)).toEqual({ lines: ['0.00'], total: '0.00' });
  });
});

describe('surgery usage totals', () => {
  it('adds each rounded line rather than rounding the combined unrounded amount', () => {
    const rows = [
      catalogueRow({ service: { ...service, currentPrice: '5.00' }, quantity: '0.001' }),
      manualRow({ quantity: ' 0,001 ', unitPrice: ' 5,00 ' }),
    ];
    expect(usageRowsTotals(rows)).toEqual({ lines: ['0.01', '0.01'], total: '0.02' });
  });

  it('uses the selected catalogue price and manual price according to row source', () => {
    const rows = [
      catalogueRow({ quantity: '0.125', unitPrice: '999.99' }),
      manualRow({ service, quantity: '2', unitPrice: '0.10' }),
    ];
    expect(usageRowsTotals(rows)).toEqual({ lines: ['1.53', '0.20'], total: '1.73' });
  });

  it('preserves cents even when the total exceeds safe floating point integer precision', () => {
    const rows = [
      manualRow({ quantity: '100000', unitPrice: '999999999999.99' }),
      manualRow({ unitPrice: '0.01' }),
    ];
    expect(usageRowsTotals(rows)).toEqual({
      lines: ['99999999999999000.00', '0.01'],
      total: '99999999999999000.01',
    });
  });

  it.each(['', '0', '-1', '0.0001', '1e3'])(
    'withholds the total for invalid quantity %j',
    (quantity) => {
      const rows = [manualRow(), manualRow({ quantity }), manualRow({ unitPrice: '2.25' })];
      expect(usageRowsTotals(rows)).toEqual({ lines: ['10.00', null, '2.25'], total: null });
    },
  );
});

describe('surgery bulk request retry identity', () => {
  it.each([
    ['1.0', '10.0'],
    ['1.000', '10.00'],
    [' 1,00 ', ' 10,00 '],
  ])(
    'reuses the key when numeric formatting changes to quantity %s and price %s',
    (quantity, unitPrice) => {
      const firstRows = [
        catalogueRow({ quantity: '1' }),
        manualRow({ quantity: '1', unitPrice: '10' }),
      ];
      const retryRows = [catalogueRow({ quantity }), manualRow({ quantity, unitPrice })];
      const initialPayload = serializeUsageRows(firstRows, 'MATERIAL');
      const retryPayload = serializeUsageRows(retryRows, 'MATERIAL');
      const first = identifySurgeryRequest(initialPayload, null);

      expect(initialPayload.items[0]?.quantity).toBe('1.000');
      expect(initialPayload.items[1]).toMatchObject({ quantity: '1.000', unitPrice: '10.00' });
      expect(retryPayload).toEqual(initialPayload);
      expect(identifySurgeryRequest(retryPayload, first)).toBe(first);
    },
  );

  it('reuses the key for an unchanged normalized payload after a lost response', () => {
    const rows = [catalogueRow(), manualRow({ quantity: ' 2,5 ', unitPrice: ' 10,00 ' })];
    const first = identifySurgeryRequest(serializeUsageRows(rows, 'MATERIAL'), null);
    const retry = identifySurgeryRequest(
      serializeUsageRows(
        [rows[0]!, { ...rows[1]!, quantity: '2.5', unitPrice: '10.00' }],
        'MATERIAL',
      ),
      first,
    );
    expect(retry).toBe(first);
  });

  it('uses a new key when a row is edited, removed, or the entry kind changes', () => {
    const rows = [catalogueRow(), manualRow()];
    const first = identifySurgeryRequest(serializeUsageRows(rows, 'MATERIAL'), null);
    const changedPayloads = [
      serializeUsageRows([rows[0]!, { ...rows[1]!, quantity: '2' }], 'MATERIAL'),
      serializeUsageRows([rows[0]!], 'MATERIAL'),
      serializeUsageRows(rows, 'ANESTHESIA'),
    ];
    for (const payload of changedPayloads) {
      expect(identifySurgeryRequest(payload, first).key).not.toBe(first.key);
    }
  });
});
