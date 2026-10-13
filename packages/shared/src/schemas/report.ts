import { z } from 'zod';
import { dateOnlySchema, idSchema } from './common';

export const reportRangeQuerySchema = z.object({
  from: dateOnlySchema,
  to: dateOnlySchema,
  branchId: idSchema.optional(),
  doctorUserId: idSchema.optional(),
  groupBy: z.enum(['day', 'week', 'month']).default('day'),
});
export type ReportRangeQueryInput = z.infer<typeof reportRangeQuerySchema>;

export const exportQuerySchema = reportRangeQuerySchema.extend({
  format: z.enum(['xlsx']).default('xlsx'),
});
export type ExportQueryInput = z.infer<typeof exportQuerySchema>;

/** Inclusive local calendar dates. Reports use the clinic's Asia/Tashkent timezone. */
export const cashflowQuerySchema = reportRangeQuerySchema
  .omit({ doctorUserId: true })
  .extend({
    method: z.enum(['CASH', 'CARD', 'CLICK']).optional(),
    export: z.enum(['xlsx']).optional(),
  })
  .superRefine((value, ctx) => {
    const from = new Date(`${value.from}T00:00:00Z`);
    const to = new Date(`${value.to}T00:00:00Z`);
    for (const [key, date] of [
      ['from', from],
      ['to', to],
    ] as const) {
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: 'Invalid calendar date',
        });
      }
    }
    const days = (to.getTime() - from.getTime()) / 86_400_000;
    if (days < 0 || days > 365) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['to'],
        message: 'Choose a period of 1–366 days',
      });
    }
  });
export type CashflowQueryInput = z.infer<typeof cashflowQuerySchema>;

export interface CashflowTotals {
  receipts: string;
  deposits: string;
  refunds: string;
  expenses: string;
  inflow: string;
  outflow: string;
  net: string;
  operations: number;
}

export interface CashflowReport {
  from: string;
  to: string;
  branchId: string;
  timezone: string;
  groupBy: 'day' | 'week' | 'month';
  method: 'CASH' | 'CARD' | 'CLICK' | null;
  totals: CashflowTotals;
  accounts: Array<CashflowTotals & { method: string }>;
  periods: Array<CashflowTotals & { bucket: string }>;
  expenseCategories: Array<{ category: string; amount: string; operations: number }>;
}

/** Recorded consumption and ordered inpatient quantities are deliberately separate. */
export const consumablesQuerySchema = reportRangeQuerySchema
  .omit({ doctorUserId: true })
  .extend({
    kind: z.enum(['MEDICINE', 'MATERIAL']).optional(),
    source: z.enum(['SURGERY', 'INPATIENT', 'OUTPATIENT']).optional(),
    export: z.enum(['xlsx']).optional(),
  })
  .superRefine((value, ctx) => {
    const result = cashflowQuerySchema.safeParse(value);
    if (!result.success) {
      for (const issue of result.error.issues) ctx.addIssue(issue);
    }
  });
export type ConsumablesQueryInput = z.infer<typeof consumablesQuerySchema>;
export type ConsumablesKind = NonNullable<ConsumablesQueryInput['kind']>;
export type ConsumablesSource = NonNullable<ConsumablesQueryInput['source']>;

export interface ConsumablesReport {
  from: string;
  to: string;
  branchId: string;
  timezone: string;
  groupBy: 'day' | 'week' | 'month';
  kind: ConsumablesKind | null;
  source: ConsumablesSource | null;
  totals: {
    amount: string;
    orderedAmount: string;
    entries: number;
    orderedEntries: number;
    itemCount: number;
  };
  units: Array<{ unit: string; quantity: string; orderedQuantity: string }>;
  items: Array<{
    key: string;
    serviceId: string | null;
    code: string | null;
    title: Record<string, string>;
    kind: ConsumablesKind;
    unit: string;
    quantity: string;
    amount: string;
    entries: number;
    orderedQuantity: string;
    orderedAmount: string;
    orderedEntries: number;
  }>;
  periods: Array<{
    bucket: string;
    amount: string;
    orderedAmount: string;
    entries: number;
    orderedEntries: number;
  }>;
}
