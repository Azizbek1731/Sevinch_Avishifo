import {
  fromTiyin,
  surgeryEntryItemSchema,
  toTiyin,
  type AddSurgeryEntriesInput,
} from '@avishifo/shared';
import type { ServiceRow } from '@/features/services/api';
import { usagePreview } from './money';

export interface UsageDraftRow {
  source: 'CATALOGUE' | 'MANUAL';
  service: ServiceRow | null;
  title: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  note: string;
}

export type UsageDraftField =
  'source' | 'service' | 'title' | 'quantity' | 'unit' | 'unitPrice' | 'note' | 'items';

export function emptyUsageRow(): UsageDraftRow {
  return {
    source: 'CATALOGUE',
    service: null,
    title: '',
    quantity: '1',
    unit: 'dona',
    unitPrice: '',
    note: '',
  };
}

function decimal(value: string): string {
  return value.trim().replace(',', '.');
}

function canonicalDecimal(value: string, precision: 2 | 3): string {
  const normalized = decimal(value);
  const pattern = precision === 3 ? /^\d{1,9}(?:\.\d{1,3})?$/ : /^\d{1,12}(?:\.\d{1,2})?$/;
  // Leave malformed input untouched so shared validation reports it, never rounds it.
  if (!pattern.test(normalized)) return normalized;
  const [whole = '0', fraction = ''] = normalized.split('.');
  return `${whole.replace(/^0+(?=\d)/, '')}.${fraction.padEnd(precision, '0')}`;
}

/** Catalogue snapshots are for display only; the server owns catalogue pricing. */
export function serializeUsageRows(
  rows: readonly UsageDraftRow[],
  kind: 'MATERIAL' | 'ANESTHESIA',
): Omit<AddSurgeryEntriesInput, 'idempotencyKey'> {
  return {
    items: rows.map((row) => ({
      kind,
      quantity: canonicalDecimal(row.quantity, 3),
      note: row.note.trim() || undefined,
      ...(row.source === 'CATALOGUE'
        ? { serviceId: row.service?.id }
        : {
            title: row.title.trim(),
            unit: row.unit.trim(),
            unitPrice: canonicalDecimal(row.unitPrice, 2),
          }),
    })),
  };
}

export function validateUsageRows(
  rows: readonly UsageDraftRow[],
  kind: 'MATERIAL' | 'ANESTHESIA',
): Array<{ index: number; field: UsageDraftField }> {
  const errors: Array<{ index: number; field: UsageDraftField }> = [];
  const add = (index: number, field: UsageDraftField) => {
    if (!errors.some((error) => error.index === index && error.field === field)) {
      errors.push({ index, field });
    }
  };
  if (rows.length < 1 || rows.length > 50) add(-1, 'items');
  const payload = serializeUsageRows(rows, kind);
  rows.forEach((row, index) => {
    if (row.source !== 'CATALOGUE' && row.source !== 'MANUAL') add(index, 'source');
    if (row.source === 'CATALOGUE' && (!row.service || row.service.currentPrice === null)) {
      add(index, 'service');
    }
    const parsed = surgeryEntryItemSchema.safeParse(payload.items[index]);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === 'serviceId' || (row.source === 'CATALOGUE' && field === 'title')) {
          add(index, 'service');
        } else if (
          field === 'title' ||
          field === 'quantity' ||
          field === 'unit' ||
          field === 'unitPrice' ||
          field === 'note'
        ) {
          add(index, field);
        }
      }
    }
  });
  return errors;
}

/** Sum rounded line totals, matching the amounts the server stores for each charge. */
export function usageRowsTotals(rows: readonly UsageDraftRow[]): {
  lines: Array<string | null>;
  total: string | null;
} {
  const lines = rows.map((row) => {
    const quantity = decimal(row.quantity);
    const price = decimal(
      row.source === 'CATALOGUE' ? (row.service?.currentPrice ?? '') : row.unitPrice,
    );
    if (!/^\d{1,9}(?:\.\d{1,3})?$/.test(quantity) || !/^\d{1,12}(?:\.\d{1,2})?$/.test(price)) {
      return null;
    }
    return usagePreview(quantity, price);
  });
  return {
    lines,
    total:
      lines.length && lines.every((line) => line !== null)
        ? fromTiyin(lines.reduce((sum, line) => sum + toTiyin(line!), 0n))
        : null,
  };
}
