import { z } from 'zod';
import { dateOnlySchema, idSchema, paginationQuerySchema } from './common';

/** Clinic default when no per-doctor override exists. */
export const AMBULATORY_DEFAULT_LAB_PERCENT = 25;

const optionalText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && !value.trim() ? undefined : value),
    z.string().trim().max(max).optional(),
  );

export const ambulatoryCaseStatusSchema = z.enum(['OPEN', 'CLOSED']);
export type AmbulatoryCaseStatus = z.infer<typeof ambulatoryCaseStatusSchema>;

export const openAmbulatoryCaseSchema = z.object({
  patientId: idSchema,
  /** Doctors open cards for themselves; the desk must pick the doctor. */
  doctorUserId: idSchema.optional(),
  complaint: optionalText(500),
  diagnosis: optionalText(500),
  note: optionalText(1000),
});
export type OpenAmbulatoryCaseInput = z.infer<typeof openAmbulatoryCaseSchema>;

export const updateAmbulatoryCaseSchema = z.object({
  /** Only while no lab work is linked — the share belongs to the doctor at order time. */
  doctorUserId: idSchema.optional(),
  complaint: optionalText(500).nullable(),
  diagnosis: optionalText(500).nullable(),
  note: optionalText(1000).nullable(),
});
export type UpdateAmbulatoryCaseInput = z.infer<typeof updateAmbulatoryCaseSchema>;

export const ambulatoryCaseQuerySchema = paginationQuerySchema.extend({
  status: ambulatoryCaseStatusSchema.optional(),
  patientId: idSchema.optional(),
  doctorUserId: idSchema.optional(),
  /** Card №, patient name or MRN. */
  search: z.string().trim().min(1).max(120).optional(),
  /** Inclusive Tashkent calendar dates of opening. */
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
});
export type AmbulatoryCaseQueryInput = z.infer<typeof ambulatoryCaseQuerySchema>;

export const ambulatoryLabOrderSchema = z.object({
  serviceIds: z.array(idSchema).min(1).max(60),
});
export type AmbulatoryLabOrderInput = z.infer<typeof ambulatoryLabOrderSchema>;

export const ambulatoryUziOrderSchema = z.object({
  /** The ultrasound specialist who performs the scan. */
  doctorUserId: idSchema,
  serviceIds: z.array(idSchema).min(1).max(30),
  note: optionalText(500),
});
export type AmbulatoryUziOrderInput = z.infer<typeof ambulatoryUziOrderSchema>;

export const ambulatoryCommissionQuerySchema = z
  .object({
    from: dateOnlySchema,
    to: dateOnlySchema,
    doctorUserId: idSchema.optional(),
    export: z.enum(['xlsx']).optional(),
  })
  .superRefine((value, ctx) => {
    const from = new Date(`${value.from}T00:00:00Z`);
    const to = new Date(`${value.to}T00:00:00Z`);
    for (const [key, date] of [
      ['from', from],
      ['to', to],
    ] as const) {
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value[key])
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: 'Invalid calendar date' });
    }
    const days = (to.getTime() - from.getTime()) / 86_400_000;
    if (days < 0 || days > 366)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'Choose a period of 1–367 days' });
  });
export type AmbulatoryCommissionQueryInput = z.infer<typeof ambulatoryCommissionQuerySchema>;

const percentSchema = z.coerce.number().min(0).max(100).multipleOf(0.01);

export const ambulatoryRatesSchema = z.object({
  defaultPercent: percentSchema,
  /** percent null removes the override, so the doctor falls back to the default. */
  doctors: z
    .array(z.object({ doctorUserId: idSchema, percent: percentSchema.nullable() }))
    .max(500),
});
export type AmbulatoryRatesInput = z.infer<typeof ambulatoryRatesSchema>;

/** Money values are decimal strings with 2 places. */
export interface AmbulatoryCommissionTotals {
  patients: number;
  orders: number;
  labAmount: string;
  paidAmount: string;
  commission: string;
  /** Share the doctor will earn once the outstanding lab bills are paid. */
  pendingCommission: string;
}

export interface AmbulatoryCommissionDoctor extends AmbulatoryCommissionTotals {
  doctorUserId: string;
  doctorName: string;
  specialty: string | null;
  /** Rate for new orders today (orders keep their own snapshot). */
  currentPercent: number;
}

export type AmbulatoryPaymentState = 'PAID' | 'PARTIAL' | 'UNPAID';

export interface AmbulatoryCommissionOrder {
  orderId: string;
  orderNumber: string;
  createdAt: string;
  caseId: string;
  caseNumber: string;
  patient: { id: string; mrn: string; fullName: string };
  doctorUserId: string;
  doctorName: string;
  /** Lab test names as stored: { uz, ru, en } or a plain string. */
  tests: Array<Record<string, string> | string>;
  invoiceNumber: string | null;
  labAmount: string;
  paidAmount: string;
  percent: number;
  commission: string;
  pendingCommission: string;
  paymentState: AmbulatoryPaymentState;
}

export interface AmbulatoryCommissionReport {
  from: string;
  to: string;
  doctorUserId: string | null;
  defaultPercent: number;
  totals: AmbulatoryCommissionTotals;
  doctors: AmbulatoryCommissionDoctor[];
  orders: AmbulatoryCommissionOrder[];
}

export interface AmbulatoryRates {
  defaultPercent: number;
  doctors: { doctorUserId: string; fullName: string; specialty: string | null; percent: number | null }[];
}
